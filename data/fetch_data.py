import teslapy
import csv
import time
import os

# CONFIGURATION
# Replace with your actual Tesla account email
EMAIL = 'your_email@example.com'
LOG_FILE = 'drive_log.csv'

def main():
    print("Authenticating with Tesla...")
    
    # 1. Connect to Tesla Cloud
    # On first run, this will print a URL. Click it, login, and paste the "Page Not Found" URL back here.
    with teslapy.Tesla(EMAIL) as tesla:
        if not tesla.authorized:
            print("Please authorize in the browser...")
            tesla.refresh_token(refresh_token=None)
        
        # 2. Select Vehicle
        vehicles = tesla.vehicle_list()
        if not vehicles:
            print("Error: No vehicles found!")
            return

        vehicle = vehicles[0]
        print(f"Connected to: {vehicle['display_name']}")
        
        # 3. Wake Up (if asleep)
        if vehicle['state'] != 'online':
            print("Waking up vehicle... (This may take 30 seconds)")
            vehicle.sync_wake_up()
            print("Vehicle is Online!")

        print(f"Logging telemetry to {LOG_FILE}... Press Ctrl+C to stop.")
        
        # 4. Initialize CSV File
        # We use 'w' (write) mode. If you want to append to an existing file, use 'a'.
        with open(LOG_FILE, 'w', newline='') as f:
            writer = csv.writer(f)
            # Header Row
            writer.writerow(['timestamp', 'speed', 'battery', 'power', 'gear', 'inside_temp', 'lat', 'lon'])
            
            try:
                while True:
                    # 5. Fetch Data from API
                    # Note: We fetch 'vehicle_data' which contains everything
                    data = vehicle.get_vehicle_data()
                    
                    drive = data['drive_state']
                    charge = data['charge_state']
                    climate = data['climate_state']
                    
                    # 6. Extract Specific Metrics
                    ts = int(time.time() * 1000) # Current time in ms
                    
                    # Speed can be None if stopped, so default to 0
                    speed = drive.get('speed') if drive.get('speed') is not None else 0
                    
                    battery = charge.get('battery_level', 0)
                    
                    # Power: Positive = Discharge, Negative = Regen
                    power = drive.get('power', 0) 
                    
                    gear = drive.get('shift_state', 'P') # P, D, R, N
                    if gear is None: gear = "P" # Default to Park if null
                    
                    temp = climate.get('inside_temp', 0)
                    
                    lat = drive.get('latitude', 0)
                    lon = drive.get('longitude', 0)

                    # 7. Write to CSV
                    row = [ts, speed, battery, power, gear, temp, lat, lon]
                    writer.writerow(row)
                    f.flush() # Ensure data hits the disk immediately
                    
                    # Console Feedback
                    print(f"Logged: {speed} mph | {power} kW | Gear: {gear}")
                    
                    # 8. Rate Limit (2 seconds is safe for free tier)
                    time.sleep(2.0) 
                    
            except KeyboardInterrupt:
                print("\nLogging stopped. CSV saved safely.")
            except Exception as e:
                print(f"\nError: {e}")

if __name__ == "__main__":
    main()