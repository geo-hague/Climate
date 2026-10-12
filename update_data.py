# update_data.py

import io
import json
import os
import pathlib
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# --- SETTINGS ---
base_path = pathlib.Path(__file__).parent
daily_dir = base_path / "data" / "daily"
manifest_path = base_path / "data" / "manifest.json"  # lives in data/ so the workflow commits it
base_url = "https://www.ncei.noaa.gov/data/global-historical-climatology-network-daily/access/"
keep_cols = ["DATE", "TMAX", "TMIN", "PRCP", "SNWD", "SNOW"]

# If the station hasn't reported in 2 years, we assume it's a historical/closed record
INACTIVE_THRESHOLD_DAYS = 730
cutoff_date = datetime.now() - timedelta(days=INACTIVE_THRESHOLD_DAYS)

# Concurrency settings
MAX_WORKERS = 5
PER_REQUEST_PAUSE = 0.5
REQUEST_TIMEOUT = 30

retry_strategy = Retry(
    total=3,
    backoff_factor=2,
    status_forcelist=[429, 500, 502, 503, 504],
    allowed_methods=["GET"],
)
thread_local = threading.local()

# Matches rows in the Apache-style directory listing:
#   <a href="USC00010008.csv">USC00010008.csv</a></td><td align="right">2025-01-01 06:00  </td>
INDEX_ROW = re.compile(
    r'href="([^"/]+)\.csv"[^>]*>[^<]*</a>(?:\s*</td>\s*<td[^>]*>)?\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})'
)


def get_session():
    if not hasattr(thread_local, "session"):
        session = requests.Session()
        adapter = HTTPAdapter(max_retries=retry_strategy)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        thread_local.session = session
    return thread_local.session


def fetch_csv(station_id):
    """Fetch a station CSV with a timeout + automatic retry/backoff. Raises on failure."""
    url = f"{base_url}{station_id}.csv"
    response = get_session().get(url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    return pd.read_csv(io.StringIO(response.text), low_memory=False)


def fetch_remote_index():
    """One request for the whole directory listing -> {station_id: last_modified_string}.
    Returns {} if the listing can't be fetched or parsed (caller falls back to refreshing everything)."""
    try:
        response = get_session().get(base_url, timeout=REQUEST_TIMEOUT * 4)
        response.raise_for_status()
        return {sid: stamp for sid, stamp in INDEX_ROW.findall(response.text)}
    except Exception as e:
        print(f"Could not read remote index ({e}).")
        return {}


def load_manifest():
    try:
        return json.loads(manifest_path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_manifest(manifest):
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=0, sort_keys=True))


def set_github_output(changed):
    """Lets the workflow skip later steps when nothing changed."""
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"changed={'true' if changed else 'false'}\n")


print_lock = threading.Lock()


def safe_print(msg):
    with print_lock:
        print(msg)


def process_station(file_path, i, total):
    """Returns (message, ok, refreshed). ok=True means safe to record the remote timestamp."""
    station_id = file_path.stem

    try:
        existing_df = pd.read_csv(file_path, usecols=["DATE"])
        if existing_df.empty:
            raise ValueError("File is empty")

        last_date_str = existing_df["DATE"].iloc[-1]
        last_date = datetime.strptime(last_date_str, "%Y-%m-%d")

        if last_date < cutoff_date:
            return (f"[{i}/{total}] {station_id}: Skipping (Closed since {last_date_str})", True, False)

        new_df = fetch_csv(station_id)
        new_df.reindex(columns=keep_cols).to_csv(file_path, index=False)
        time.sleep(PER_REQUEST_PAUSE)
        return (f"[{i}/{total}] {station_id}: Changed upstream. Refreshed.", True, True)

    except Exception as e:
        try:
            new_df = fetch_csv(station_id)
            new_df.reindex(columns=keep_cols).to_csv(file_path, index=False)
            time.sleep(PER_REQUEST_PAUSE)
            return (f"[{i}/{total}] {station_id}: Error or new file ({e}). Updated now.", True, True)
        except Exception as fetch_err:
            return (f"[{i}/{total}] {station_id}: !! Critical error: Could not fetch ({fetch_err})", False, False)


def main():
    if not daily_dir.exists():
        print("Data directory not found. Check your folder structure.")
        set_github_output(False)
        return

    # 1. Single lightweight request: what does NOAA currently have, and when was each file modified?
    remote = fetch_remote_index()
    manifest = load_manifest()
    index_ok = bool(remote)

    # 2. Work out which local stations actually need attention
    work = []  # (file_path, remote_stamp)
    for state_folder in (d for d in daily_dir.iterdir() if d.is_dir()):
        for fp in state_folder.glob("*.csv"):
            sid = fp.stem
            if not index_ok:
                work.append((fp, None))  # fail-safe: no index -> old behavior, refresh everything
            elif sid in remote and remote[sid] != manifest.get(sid):
                work.append((fp, remote[sid]))

    if not work:
        print("No station files have changed upstream. Nothing to do.")
        set_github_output(False)
        return

    mode = "changed" if index_ok else "all (index unavailable)"
    print(f"{len(work)} station(s) to process [{mode}].")

    # 3. Process only those stations
    total = len(work)
    any_refreshed = False
    manifest_lock = threading.Lock()

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(process_station, fp, i, total): stamp
            for i, (fp, stamp) in enumerate(work, 1)
        }
        for future in as_completed(futures):
            msg, ok, refreshed = future.result()
            safe_print(msg)
            any_refreshed |= refreshed
            stamp = futures[future]
            sid = msg.split("] ", 1)[1].split(":", 1)[0]
            if ok and stamp:
                with manifest_lock:
                    manifest[sid] = stamp  # only record on success, so failures retry next run

    save_manifest(manifest)
    set_github_output(any_refreshed)
    print("\nDone. Only stations that changed upstream were refreshed.")


if __name__ == "__main__":
    main()
