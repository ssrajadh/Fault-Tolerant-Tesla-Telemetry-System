# Data Utilities

Scripts and data files for fetching, processing, and replaying Tesla vehicle telemetry data. This directory contains tools for data collection and simulation.

## Overview

This directory contains:
- **Data fetching scripts** for collecting real Tesla vehicle data via TeslaPy API
- **Raw log files** in JSON Lines format (.jsonl)
- **Vehicle-specific logs** for multi-vehicle fleet simulation
- **Replay harness** data for the C++ edge logger

## Files

### fetch_data.py
Python script that connects to a real Tesla vehicle via the TeslaPy library and logs telemetry data to a JSON Lines file.

**Features:**
- Authenticates with Tesla account
- Wakes up vehicle if sleeping
- Fetches full vehicle data at regular intervals
- Logs to JSON Lines format (one JSON object per line)
- Retry logic for network failures
- Graceful shutdown on Ctrl+C

**Usage:**
```bash
cd data
python fetch_data.py
```

**Configuration:**
Set credentials in `../config.py`:
```python
EMAIL = "your-email@example.com"
```

**Output:**
Creates `tesla_raw_log.jsonl` with entries like:
```json
{
  "drive_state": {"speed": 65, "heading": 180, ...},
  "charge_state": {"battery_level": 82, ...},
  "vehicle_state": {"odometer": 12345.6, ...},
  "local_timestamp": "2024-01-15T10:30:00"
}
```

### tesla_raw_log.jsonl
Master log file containing raw vehicle data from `fetch_data.py`. Used as source for generating vehicle-specific logs.

### vehicle_logs/
Directory containing per-vehicle log files for fleet simulation:

- `tesla_log_5YJ3E1EA1KF000001.jsonl` - Model 3 (Vehicle 1)
- `tesla_log_5YJ3E1EA2KF000002.jsonl` - Model 3 (Vehicle 2)
- `tesla_log_5YJSA1E26MF000003.jsonl` - Model S (Vehicle 3)
- `tesla_log_7SAYGDEE3MF000004.jsonl` - Model Y (Vehicle 4)
- `tesla_log_5YJ3E1EB9MF000005.jsonl` - Model X (Vehicle 5)

**Format:**
Each file contains JSON Lines format with telemetry records that can be replayed by the C++ edge logger.

## Data Collection

### Using fetch_data.py

1. **Install Dependencies:**
```bash
pip install teslapy requests
```

2. **Configure Credentials:**
Edit `../config.py` with your Tesla account email.

3. **Run Data Collection:**
```bash
python fetch_data.py
```

4. **First Run:**
   - Script will prompt for Tesla account authorization
   - Follow instructions to authorize the app
   - Refresh token is saved for future runs

5. **Data Collection:**
   - Script fetches data every few seconds
   - Logs to `tesla_raw_log.jsonl`
   - Press Ctrl+C to stop

### Data Fields

The raw logs contain comprehensive vehicle data:

**Drive State:**
- `speed` - Current speed (mph)
- `heading` - Compass heading (0-359)
- `latitude` / `longitude` - GPS coordinates
- `odometer` - Odometer reading (miles)

**Charge State:**
- `battery_level` - Battery percentage (0-100)
- `charging_state` - Current charging status
- `charge_rate` - Charging rate (mph)

**Vehicle State:**
- `odometer` - Odometer reading
- `locked` - Door lock status
- `sentry_mode` - Sentry mode status

**Climate State:**
- `inside_temp` - Interior temperature
- `outside_temp` - Exterior temperature

## Data Processing

### Converting to CSV (for C++ logger)

The C++ edge logger expects CSV format. Example conversion script:

```python
import json

with open('tesla_raw_log.jsonl', 'r') as f_in, \
     open('telemetry.csv', 'w') as f_out:
    
    f_out.write('timestamp,speed,battery,power,heading,odometer,lat,lng\n')
    
    for line in f_in:
        data = json.loads(line)
        ds = data['drive_state']
        cs = data['charge_state']
        
        # Extract and convert data
        timestamp = int(data.get('local_timestamp', 0))
        speed = ds.get('speed', 0) or 0
        battery = cs.get('battery_level', 0)
        heading = ds.get('heading', 0) or 0
        odometer = data['vehicle_state'].get('odometer', 0)
        lat = ds.get('latitude', 0)
        lng = ds.get('longitude', 0)
        
        # Calculate power (simplified)
        power = 0  # Would need additional calculation
        
        f_out.write(f'{timestamp},{speed},{battery},{power},{heading},{odometer},{lat},{lng}\n')
```

### Generating Fleet Data

Use the root-level script to generate vehicle-specific logs:
```bash
python generate_fleet_data.py
```

This script:
- Reads from `tesla_raw_log.jsonl`
- Generates variations for different vehicle types
- Creates per-vehicle log files in `vehicle_logs/`
- Applies realistic variations (speed, battery, power) per model

## Data Format

### JSON Lines (.jsonl)
Each line is a complete JSON object:
```
{"drive_state": {...}, "charge_state": {...}, ...}
{"drive_state": {...}, "charge_state": {...}, ...}
```

**Advantages:**
- Append-only (easy to stream)
- One record per line (easy to parse)
- Human-readable
- No need to parse entire file

### CSV Format (for C++ logger)
Comma-separated values with header:
```
timestamp,speed,battery,power,heading,odometer,lat,lng
1234567890,65.0,82,12.5,180,12345.6,37.7749,-122.4194
```

## Data Privacy

⚠️ **Important:** Vehicle telemetry data may contain:
- GPS coordinates (location history)
- Personal information
- Vehicle identifiers (VIN)

**Best Practices:**
- Do not commit raw log files to version control
- Anonymize VINs if sharing data
- Remove or obfuscate GPS coordinates if needed
- Follow Tesla's Terms of Service for API usage

## Data Retention

The repository includes sample log files for testing. For production:
- Raw logs can be archived after processing
- Consider compression for long-term storage
- Implement rotation (daily/weekly files)
- Set up automated backups if needed

## Troubleshooting

### Authentication Errors
- Ensure Tesla account credentials are correct
- Re-authorize if token expires
- Check TeslaPy library version compatibility

### Vehicle Offline
- Script attempts to wake vehicle automatically
- May take 30-60 seconds for vehicle to come online
- Check vehicle's connectivity status in Tesla app

### Rate Limiting
- Tesla API has rate limits
- Script includes retry logic with exponential backoff
- If issues persist, increase delay between requests

### Missing Data Fields
- Some fields may be null/None if vehicle is parked
- Handle null values in processing scripts
- Check Tesla API documentation for field availability

## Future Enhancements

- [ ] Automated data collection scheduling
- [ ] Data validation and quality checks
- [ ] Automated conversion to CSV format
- [ ] Data anonymization tools
- [ ] Statistical analysis scripts
- [ ] Data visualization tools
- [ ] Integration with data lakes (S3, BigQuery)
- [ ] Real-time streaming data pipeline

