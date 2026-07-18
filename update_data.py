# update_data.py

import pandas as pd
import pathlib
import time
import threading
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
MAX_WORKERS = 5       # number of concurrent downloads
PER_REQUEST_PAUSE = 0.5  # pause per worker after each request (~MAX_WORKERS / PER_REQUEST_PAUSE req/sec overall)

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
        url = f"{base_url}{station_id}.csv"
        new_df = pd.read_csv(url, low_memory=False)

        # Reindex ensures columns match your 6-column requirement exactly
        new_df = new_df.reindex(columns=keep_cols)
        new_df.to_csv(file_path, index=False)

        # 4. Respectful pause (per worker)
        time.sleep(PER_REQUEST_PAUSE)

        return f"[{i}/{total}] {station_id}: Active. Refreshed."

    except Exception as e:
        # If we can't read the file or the date, let's update it just to be safe
        try:
            new_df = pd.read_csv(f"{base_url}{station_id}.csv", low_memory=False)
            new_df[keep_cols].to_csv(file_path, index=False)
            time.sleep(PER_REQUEST_PAUSE)
            return f"[{i}/{total}] {station_id}: Error or new file ({e}). Updated now."
        except Exception:
            return f"[{i}/{total}] {station_id}: !! Critical error: Could not fetch"


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
