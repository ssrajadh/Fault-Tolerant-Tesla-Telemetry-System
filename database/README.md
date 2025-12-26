# Database Schema and Client

Database layer for storing vehicle metadata and telemetry data in Supabase PostgreSQL. Provides schema definitions, initialization scripts, and a Python client for database operations.

## Overview

This directory contains:
- **Schema definitions** for vehicles, telemetry data, and compression statistics
- **Initialization scripts** for setting up the database
- **Supabase client** Python wrapper for database operations
- **SQL scripts** for fleet setup and data management

## Schema

### vehicles
Stores vehicle metadata and owner information.

**Columns:**
- `id` (UUID, Primary Key) - Auto-generated vehicle ID
- `vin` (VARCHAR(17), Unique) - Vehicle Identification Number
- `model` (VARCHAR(100)) - Vehicle model (e.g., "Model 3")
- `year` (INTEGER) - Manufacturing year
- `owner_email` (VARCHAR(255)) - Owner contact email
- `created_at` (TIMESTAMPTZ) - Record creation timestamp
- `updated_at` (TIMESTAMPTZ) - Last update timestamp

### telemetry_data
Time-series table for storing telemetry records from vehicles.

**Columns:**
- `id` (BIGSERIAL, Primary Key) - Auto-incrementing record ID
- `vehicle_id` (UUID, Foreign Key) - References vehicles.id
- `timestamp` (BIGINT) - Unix timestamp (milliseconds) from vehicle
- `vehicle_speed` (REAL) - Speed in mph
- `battery_level` (INTEGER) - Battery percentage (0-100)
- `power_kw` (REAL) - Power consumption in kW
- `odometer` (REAL) - Odometer reading in miles
- `heading` (INTEGER) - Compass heading (0-359 degrees)
- `latitude` (REAL) - GPS latitude
- `longitude` (REAL) - GPS longitude
- `received_at` (TIMESTAMPTZ) - Server receipt timestamp
- `is_compressed` (BOOLEAN) - Whether record was reconstructed from compression

**Indexes:**
- `idx_telemetry_timestamp` - On `timestamp DESC` for time-series queries
- `idx_telemetry_vehicle_timestamp` - On `(vehicle_id, timestamp DESC)` for per-vehicle queries
- `idx_telemetry_received_at` - On `received_at DESC` for recent data queries

**Constraints:**
- `valid_battery`: Battery level must be 0-100
- `valid_heading`: Heading must be 0-359

### compression_stats
Daily aggregation of compression statistics per vehicle.

**Columns:**
- `id` (BIGSERIAL, Primary Key)
- `vehicle_id` (UUID, Foreign Key) - References vehicles.id
- `date` (DATE) - Aggregation date
- `total_packets` (INTEGER) - Total telemetry packets received
- `transmitted_fields` (INTEGER) - Total fields transmitted
- `skipped_fields` (INTEGER) - Total fields skipped (reconstructed)
- `bandwidth_saved_percent` (REAL) - Percentage bandwidth saved
- `created_at` (TIMESTAMPTZ) - Record creation timestamp

**Unique Constraint:** `(vehicle_id, date)` - One record per vehicle per day

## Files

### schema.sql
Complete database schema including:
- UUID extension
- All table definitions
- Indexes for performance
- Constraints for data integrity
- Foreign key relationships

### init.sql
Initialization script that:
- Runs schema.sql
- Optionally seeds sample vehicle data
- Sets up default permissions

### add_fleet_vehicles.sql
Pre-configured SQL script to insert the 5-vehicle fleet:
- Model 3 (5YJ3E1EA1KF000001)
- Model 3 (5YJ3E1EA2KF000002)
- Model S (5YJSA1E26MF000003)
- Model Y (7SAYGDEE3MF000004)
- Model X (5YJ3E1EB9MF000005)

### supabase_client.py
Python client wrapper for Supabase operations.

**Class: SupabaseClient**

**Methods:**
- `get_vehicle_by_vin(vin: str)` - Fetch vehicle by VIN
- `insert_telemetry(vehicle_id: str, telemetry_data: Dict)` - Insert telemetry record
- `insert_or_update_compression_stats(vehicle_id: str, stats: Dict)` - Update daily compression stats
- `get_recent_telemetry(vehicle_id: str, limit: int = 100)` - Fetch recent telemetry
- `get_telemetry_history(vehicle_id: str, start_time: int, end_time: int)` - Time-range query

## Setup

### 1. Create Supabase Project
1. Go to [supabase.com](https://supabase.com)
2. Create a new project
3. Note your project URL and service role key

### 2. Run Schema
Execute `schema.sql` in Supabase SQL Editor:
```sql
-- Copy and paste contents of schema.sql
```

### 3. Add Fleet Vehicles
Execute `add_fleet_vehicles.sql` to add sample vehicles:
```sql
-- Copy and paste contents of add_fleet_vehicles.sql
```

Or use the Python script from root:
```bash
python add_fleet_to_supabase.py
```

### 4. Configure Environment
Create `.env` file in project root:
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
```

## Usage

### Python Client

```python
from database.supabase_client import get_supabase_client

# Get client (reads from environment)
supabase = get_supabase_client()

# Get vehicle
vehicle = supabase.get_vehicle_by_vin("5YJ3E1EA1KF000001")
print(f"Vehicle: {vehicle['model']} (ID: {vehicle['id']})")

# Insert telemetry
telemetry = {
    "timestamp": 1234567890000,
    "speed": 65.0,
    "battery": 82,
    "power": 12.5,
    "heading": 45,
    "odometer": 12345.6,
    "latitude": 37.7749,
    "longitude": -122.4194
}
supabase.insert_telemetry(vehicle['id'], telemetry)

# Get recent telemetry
recent = supabase.get_recent_telemetry(vehicle['id'], limit=10)
```

### Direct SQL Queries

**Get latest telemetry for a vehicle:**
```sql
SELECT * FROM telemetry_data
WHERE vehicle_id = (SELECT id FROM vehicles WHERE vin = '5YJ3E1EA1KF000001')
ORDER BY timestamp DESC
LIMIT 100;
```

**Get compression stats for today:**
```sql
SELECT * FROM compression_stats
WHERE vehicle_id = (SELECT id FROM vehicles WHERE vin = '5YJ3E1EA1KF000001')
  AND date = CURRENT_DATE;
```

**Get speed over time (last hour):**
```sql
SELECT timestamp, vehicle_speed
FROM telemetry_data
WHERE vehicle_id = (SELECT id FROM vehicles WHERE vin = '5YJ3E1EA1KF000001')
  AND timestamp > EXTRACT(EPOCH FROM NOW() - INTERVAL '1 hour') * 1000
ORDER BY timestamp ASC;
```

## Performance Considerations

### Indexes
The schema includes indexes optimized for:
- Time-series queries (timestamp DESC)
- Per-vehicle queries (vehicle_id + timestamp)
- Recent data queries (received_at DESC)

### Partitioning (Future)
For high-volume deployments, consider partitioning `telemetry_data` by:
- Date range (monthly partitions)
- Vehicle ID (hash partitioning)

### Retention Policy
Consider implementing data retention:
```sql
-- Delete telemetry older than 1 year
DELETE FROM telemetry_data
WHERE timestamp < EXTRACT(EPOCH FROM NOW() - INTERVAL '1 year') * 1000;
```

## Data Types

- **Timestamps**: Stored as BIGINT (milliseconds since epoch) in `telemetry_data.timestamp`, TIMESTAMPTZ in metadata columns
- **Coordinates**: REAL (float) for latitude/longitude
- **Speed**: REAL (mph)
- **Power**: REAL (kW)
- **Battery**: INTEGER (0-100)
- **Heading**: INTEGER (0-359 degrees)

## Migration Guide

To add new fields to `telemetry_data`:

1. Add column to schema:
```sql
ALTER TABLE telemetry_data
ADD COLUMN new_field REAL;
```

2. Update Python client `insert_telemetry()` method
3. Update Protocol Buffer schema if needed
4. Deploy updated server code

## Backup and Recovery

Supabase provides automatic backups. For manual backup:

```bash
# Export schema
pg_dump -h <host> -U postgres -d postgres -s > schema_backup.sql

# Export data
pg_dump -h <host> -U postgres -d postgres -a > data_backup.sql
```

## Security

- Use **service role key** for server-side operations (full access)
- Use **anon key** for client-side operations (with RLS policies)
- Implement Row Level Security (RLS) for multi-tenant scenarios
- Never expose service role key in frontend code

## Future Enhancements

- [ ] Row Level Security (RLS) policies for multi-user access
- [ ] Partitioning for large-scale time-series data
- [ ] Materialized views for aggregated statistics
- [ ] TimescaleDB extension for better time-series performance
- [ ] Automated data retention policies
- [ ] Database migrations system (Alembic/Flyway)

