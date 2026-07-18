# update_data.py

import pandas as pd
import pathlib
import time
import threading
import io
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

# --- SETTINGS ---
base_path = pathlib.Path(__file__).parent
daily_dir = base_path / "data" / "daily"
base_url = "https://www.ncei.noaa.gov/data/global-historical-climatology-network-daily/access/"
keep_cols = ["DATE", "TMAX", "TMIN", "PRCP", "SNWD", "SNOW"]

# If the station hasn't reported in 2 years, we assume it's a historical/closed record
INACTIVE_THRESHOLD_DAYS = 730
cutoff_date = datetime.now() - timedelta(days=INACTIVE_THRESHOLD_DAYS)

# Concurrency settings
MAX_WORKERS = 5           # number of concurrent downloads
PER_REQUEST_PAUSE = 0.5   # pause per worker after each request (~MAX_WORKERS / PER_REQUEST_PAUSE req/sec overall)
REQUEST_TIMEOUT = 30      # seconds before giving up on a hung request

# Retry/backoff for transient failures (timeouts, connection resets, 5xx, 429)
# Each thread gets its own Session (Session objects aren't guaranteed thread-safe),
# but the Retry/HTTPAdapter config is shared.
retry_strategy = Retry(
    total=3,
    backoff_factor=2,               # waits ~2s, 4s, 8s between retries
    status_forcelist=[429, 500, 502, 503, 504],
    allowed_methods=["GET"],
)
thread_local = threading.local()


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
    session = get_session()
    response = session.get(url, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    return pd.read_csv(io.StringIO(response.text), low_memory=False)


print_lock = threading.Lock()


def safe_print(msg):
    with print_lock:
        print(msg)


def process_station(file_path, i, total):
    station_id = file_path.stem

    try:
        # 1. Read the LAST date from the existing file
        existing_df = pd.read_csv(file_path, usecols=['DATE'])
        if existing_df.empty:
            raise ValueError("File is empty")

        last_date_str = existing_df['DATE'].iloc[-1]
        last_date = datetime.strptime(last_date_str, '%Y-%m-%d')

        # 2. Skip logic: If the last entry is older than 2 years ago
        if last_date < cutoff_date:
            return f"[{i}/{total}] {station_id}: Skipping (Closed since {last_date_str})"

        # 3. Download the full refresh for active stations
        new_df = fetch_csv(station_id)

        # Reindex ensures columns match your 6-column requirement exactly
        new_df = new_df.reindex(columns=keep_cols)
        new_df.to_csv(file_path, index=False)

        # 4. Respectful pause (per worker)
        time.sleep(PER_REQUEST_PAUSE)

        return f"[{i}/{total}] {station_id}: Active. Refreshed."

    except Exception as e:
        # If we can't read the file or the date, let's update it just to be safe
        try:
            new_df = fetch_csv(station_id)
            new_df.reindex(columns=keep_cols).to_csv(file_path, index=False)
            time.sleep(PER_REQUEST_PAUSE)
            return f"[{i}/{total}] {station_id}: Error or new file ({e}). Updated now."
        except Exception as fetch_err:
            return f"[{i}/{total}] {station_id}: !! Critical error: Could not fetch ({fetch_err})"


if not daily_dir.exists():
    print("Data directory not found. Check your folder structure.")
    exit()

state_folders = [d for d in daily_dir.iterdir() if d.is_dir()]

for state_folder in state_folders:
    print(f"\n>>> Checking State: {state_folder.name}")
    station_files = list(state_folder.glob("*.csv"))
    total = len(station_files)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [
            executor.submit(process_station, fp, i, total)
            for i, fp in enumerate(station_files, 1)
        ]
        for future in as_completed(futures):
            safe_print(future.result())

print("\nAll states processed. Inactive stations preserved, active stations refreshed.")
