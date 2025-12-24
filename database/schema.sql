-- Telemetry Database Schema for Supabase/PostgreSQL

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Vehicles table
CREATE TABLE vehicles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vin VARCHAR(17) UNIQUE NOT NULL,
    model VARCHAR(100),
    year INTEGER,
    owner_email VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Telemetry data table (time-series optimized)
CREATE TABLE telemetry_data (
    id BIGSERIAL PRIMARY KEY,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    timestamp BIGINT NOT NULL,
    vehicle_speed REAL,
    battery_level INTEGER,
    power_kw REAL,
    odometer REAL,
    heading INTEGER,
    latitude REAL,
    longitude REAL,
    received_at TIMESTAMPTZ DEFAULT NOW(),
    is_compressed BOOLEAN DEFAULT false,
    CONSTRAINT valid_battery CHECK (battery_level >= 0 AND battery_level <= 100),
    CONSTRAINT valid_heading CHECK (heading >= 0 AND heading < 360)
);

-- Create index on timestamp for time-series queries
CREATE INDEX idx_telemetry_timestamp ON telemetry_data(timestamp DESC);
CREATE INDEX idx_telemetry_vehicle_timestamp ON telemetry_data(vehicle_id, timestamp DESC);
CREATE INDEX idx_telemetry_received_at ON telemetry_data(received_at DESC);

-- Compression statistics table
CREATE TABLE compression_stats (
    id BIGSERIAL PRIMARY KEY,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    date DATE DEFAULT CURRENT_DATE,
    total_packets INTEGER DEFAULT 0,
    transmitted_fields INTEGER DEFAULT 0,
    skipped_fields INTEGER DEFAULT 0,
    bandwidth_saved_percent REAL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(vehicle_id, date)
);

-- Offline buffer tracking (for multi-vehicle coordination)
CREATE TABLE offline_sessions (
    id BIGSERIAL PRIMARY KEY,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    records_buffered INTEGER DEFAULT 0,
    records_uploaded INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active', -- active, syncing, synced
    CONSTRAINT valid_status CHECK (status IN ('active', 'syncing', 'synced'))
);

-- Create hypertable for time-series optimization (if using TimescaleDB)
-- SELECT create_hypertable('telemetry_data', 'received_at', if_not_exists => TRUE);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER update_vehicles_updated_at
    BEFORE UPDATE ON vehicles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Sample vehicle for testing
INSERT INTO vehicles (vin, model, year, owner_email)
VALUES ('5YJ3E1EA1KF000001', 'Model 3 Long Range', 2023, 'demo@tesla-telemetry.com')
ON CONFLICT (vin) DO NOTHING;

-- Grant permissions (adjust for your Supabase roles)
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Row Level Security (RLS) policies for multi-tenancy
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry_data ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own vehicles
CREATE POLICY vehicles_owner_policy ON vehicles
    FOR ALL
    USING (owner_email = current_setting('request.jwt.claims', true)::json->>'email');

-- Policy: Users can only see telemetry for their vehicles
CREATE POLICY telemetry_owner_policy ON telemetry_data
    FOR ALL
    USING (
        vehicle_id IN (
            SELECT id FROM vehicles 
            WHERE owner_email = current_setting('request.jwt.claims', true)::json->>'email'
        )
    );

-- Public access policy for demo (remove in production)
CREATE POLICY telemetry_public_read ON telemetry_data
    FOR SELECT
    USING (true);

CREATE POLICY vehicles_public_read ON vehicles
    FOR SELECT
    USING (true);
