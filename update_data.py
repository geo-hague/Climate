# update_data.py

import pandas as pd
import pathlib
import time
from datetime import datetime, timedelta

# --- SETTINGS ---
base_path = pathlib.Path(__file__).parent
daily_dir = base_path / "data" / "daily"
base_url = "https://www.ncei.noaa.gov/data/global-historical-climatology-network-daily/access/"
keep_cols = ["DATE", "TMAX", "TMIN", "PRCP", "SNWD", "SNOW"]

# If the station hasn't reported in 2 years, we assume it's a historical/closed record
INACTIVE_THRESHOLD_DAYS = 730
cutoff_date = datetime.now() - timedelta(days=INACTIVE_THRESHOLD_DAYS)

if not daily_dir.exists():
    print("Data directory not found. Check your folder structure.")
    exit()

state_folders = [d for d in daily_dir.iterdir() if d.is_dir()]

for state_folder in state_folders:
    print(f"\n>>> Checking State: {state_folder.name}")
    station_files = list(state_folder.glob("*.csv"))
    
    for i, file_path in enumerate(station_files, 1):
        station_id = file_path.stem
        
        try:
            # 1. Read the LAST date from the existing file
            # We use nrows=1 and skip-logic or tail to keep this fast
            existing_df = pd.read_csv(file_path, usecols=['DATE'])
            if existing_df.empty:
                raise ValueError("File is empty")
                
            last_date_str = existing_df['DATE'].iloc[-1]
            last_date = datetime.strptime(last_date_str, '%Y-%m-%d')
            
            # 2. Skip logic: If the last entry is older than 2 years ago
            if last_date < cutoff_date:
                print(f"[{i}/{len(station_files)}] {station_id}: Skipping (Closed since {last_date_str})")
                continue
            
            # 3. Download the full refresh for active stations
            print(f"[{i}/{len(station_files)}] {station_id}: Active. Refreshing data...")
            url = f"{base_url}{station_id}.csv"
            new_df = pd.read_csv(url, low_memory=False)
            
            # Reindex ensures columns match your 6-column requirement exactly
            new_df = new_df.reindex(columns=keep_cols)
            new_df.to_csv(file_path, index=False)
            
            # 4. Respectful pause (1 second)
            time.sleep(1) 
            
        except Exception as e:
            # If we can't read the file or the date, let's update it just to be safe
            print(f"[{i}/{len(station_files)}] {station_id}: Error or new file ({e}). Updating now...")
            try:
                new_df = pd.read_csv(f"{base_url}{station_id}.csv", low_memory=False)
                new_df[keep_cols].to_csv(file_path, index=False)
                time.sleep(1)
            except:
                print(f"    !! Critical error: Could not fetch {station_id}")

print("\nAll states processed. Inactive stations preserved, active stations refreshed.")