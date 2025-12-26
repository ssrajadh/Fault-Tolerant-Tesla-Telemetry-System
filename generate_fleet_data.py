#!/usr/bin/env python3
"""
Generate varied telemetry data for multi-vehicle simulation
Creates different JSONL files for each vehicle with realistic variations
"""

import json
import random
import sys
from pathlib import Path

# Vehicle profiles with different characteristics
VEHICLE_PROFILES = {
    "5YJ3E1EA1KF000001": {  # Model 3 Long Range
        "name": "Model 3 LR",
        "battery_capacity": 82,  # kWh
        "speed_variance": 5,     # mph
        "power_variance": 15,    # kW
    },
    "5YJ3E1EA2KF000002": {  # Model Y Performance
        "name": "Model Y Perf",
        "battery_capacity": 75,
        "speed_variance": 8,
        "power_variance": 25,
    },
    "5YJSA1E26MF000003": {  # Model S Plaid
        "name": "Model S Plaid",
        "battery_capacity": 100,
        "speed_variance": 12,
        "power_variance": 40,
    },
    "7SAYGDEE3MF000004": {  # Model X Long Range
        "name": "Model X LR",
        "battery_capacity": 100,
        "speed_variance": 6,
        "power_variance": 20,
    },
    "5YJ3E1EB9MF000005": {  # Model 3 Standard Range
        "name": "Model 3 SR",
        "battery_capacity": 60,
        "speed_variance": 4,
        "power_variance": 12,
    }
}

def apply_vehicle_variance(data, profile):
    """Apply realistic variance to telemetry data based on vehicle profile"""
    varied = json.loads(json.dumps(data))  # Deep copy
    
    # Speed variance
    if "drive_state" in varied and varied["drive_state"] and "speed" in varied["drive_state"]:
        speed = varied["drive_state"]["speed"]
        if speed is not None:
            variance = random.uniform(-profile["speed_variance"], profile["speed_variance"])
            varied["drive_state"]["speed"] = max(0, speed + variance)
    
    # Power variance
    if "drive_state" in varied and varied["drive_state"] and "power" in varied["drive_state"]:
        power = varied["drive_state"]["power"]
        if power is not None:
            variance = random.uniform(-profile["power_variance"], profile["power_variance"])
            varied["drive_state"]["power"] = power + variance
    
    # Battery level variance (slight drift over time)
    if "charge_state" in varied and varied["charge_state"] and "battery_level" in varied["charge_state"]:
        battery = varied["charge_state"]["battery_level"]
        if battery is not None:
            # Slowly decrease battery (discharge simulation)
            drift = random.uniform(-0.1, 0.05)
            varied["charge_state"]["battery_level"] = max(10, min(100, battery + drift))
    
    # Heading variance (realistic turning)
    if "drive_state" in varied and varied["drive_state"] and "heading" in varied["drive_state"]:
        heading = varied["drive_state"]["heading"]
        if heading is not None:
            variance = random.randint(-15, 15)
            varied["drive_state"]["heading"] = (heading + variance) % 360
    
    # Odometer offset (each vehicle has different mileage)
    if "vehicle_state" in varied and varied["vehicle_state"] and "odometer" in varied["vehicle_state"]:
        odometer = varied["vehicle_state"]["odometer"]
        if odometer is not None:
            # Add random offset based on vehicle (0-50k miles)
            vehicle_hash = sum(ord(c) for c in profile["name"])
            offset = (vehicle_hash % 50000)
            varied["vehicle_state"]["odometer"] = odometer + offset
    
    return varied

def generate_vehicle_data(source_file, output_dir, vin, max_records=None):
    """Generate varied telemetry data for a specific vehicle"""
    profile = VEHICLE_PROFILES[vin]
    output_file = output_dir / f"tesla_log_{vin}.jsonl"
    
    print(f"Generating data for {profile['name']} (VIN: {vin[-6:]})...")
    
    with open(source_file, 'r') as src, open(output_file, 'w') as dst:
        count = 0
        for line in src:
            if max_records and count >= max_records:
                break
            
            try:
                data = json.loads(line)
                varied_data = apply_vehicle_variance(data, profile)
                dst.write(json.dumps(varied_data) + '\n')
                count += 1
            except json.JSONDecodeError:
                continue
    
    print(f"  → Generated {count} records in {output_file.name}")
    return count

def main():
    # Paths
    project_dir = Path(__file__).parent
    data_dir = project_dir / "data"
    source_file = data_dir / "tesla_raw_log.jsonl"
    
    if not source_file.exists():
        print(f"Error: Source file not found: {source_file}")
        print("Make sure tesla_raw_log.jsonl exists in the data/ directory")
        sys.exit(1)
    
    # Create output directory for vehicle-specific logs
    vehicle_data_dir = data_dir / "vehicle_logs"
    vehicle_data_dir.mkdir(exist_ok=True)
    
    print("=" * 60)
    print("  Multi-Vehicle Telemetry Data Generator")
    print("=" * 60)
    print()
    
    # Generate data for each vehicle
    max_records = 200  # Limit to 200 records per vehicle for testing
    total = 0
    
    for vin, profile in VEHICLE_PROFILES.items():
        count = generate_vehicle_data(source_file, vehicle_data_dir, vin, max_records)
        total += count
    
    print()
    print(f"✓ Successfully generated {total} total records for {len(VEHICLE_PROFILES)} vehicles")
    print(f"✓ Output directory: {vehicle_data_dir}")
    print()
    print("Next steps:")
    print("  1. Add vehicles to Supabase: psql < database/add_fleet_vehicles.sql")
    print("  2. Start server: python python_cloud/server.py")
    print("  3. Run fleet: ./run_fleet.sh")

if __name__ == "__main__":
    main()
