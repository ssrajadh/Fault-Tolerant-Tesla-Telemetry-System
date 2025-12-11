import teslapy
import json
import time
from datetime import datetime
import config
from requests.exceptions import HTTPError

# CONFIGURATION
EMAIL = config.EMAIL
LOG_FILE = 'tesla_raw_log.jsonl' # JSON Lines format (one JSON object per line)
MAX_RETRIES = 3
RETRY_DELAY = 5  # seconds

def main():
    print("Authenticating...")
    with teslapy.Tesla(EMAIL) as tesla:
        if not tesla.authorized:
            print("Please authorize...")
            tesla.refresh_token(refresh_token=None)
        
        vehicle = tesla.vehicle_list()[0]
        print(f"Connected to: {vehicle['display_name']}")
        
        if vehicle['state'] != 'online':
            print("Waking up...")
            vehicle.sync_wake_up()

        print(f"Logging RAW data to {LOG_FILE}... Press Ctrl+C to stop.")
        
        with open(LOG_FILE, 'a') as f: # Append mode
            try:
                while True:
                    # Retry logic for fetching data
                    for attempt in range(MAX_RETRIES):
                        try:
                            # 1. Fetch EVERYTHING
                            vehicle_data = vehicle.get_vehicle_data()
                            
                            # 2. Add a local timestamp (for your own debugging)
                            vehicle_data['local_timestamp'] = datetime.now().isoformat()
                            
                            # 3. Write the full JSON object as one line
                            f.write(json.dumps(vehicle_data) + "\n")
                            f.flush()
                            
                            # Console feedback (just so you know it's working)
                            speed = vehicle_data['drive_state'].get('speed', 0)
                            print(f"Logged raw packet. Speed: {speed}")
                            break  # Success, exit retry loop
                            
                        except HTTPError as e:
                            if '408' in str(e) or 'timeout' in str(e).lower():
                                print(f"Timeout (attempt {attempt + 1}/{MAX_RETRIES}). Retrying...")
                                if attempt < MAX_RETRIES - 1:
                                    time.sleep(RETRY_DELAY)
                                else:
                                    print("Max retries reached. Skipping this data point.")
                            else:
                                raise  # Re-raise non-timeout errors
                        except Exception as e:
                            print(f"Error fetching data: {e}")
                            break  # Skip this iteration
                    
                    time.sleep(2) # 2s poll rate
                    
            except KeyboardInterrupt:
                print("\nStopped. Raw data saved.")

if __name__ == "__main__":
    main()