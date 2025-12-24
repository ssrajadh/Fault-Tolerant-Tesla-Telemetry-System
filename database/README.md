# Supabase Integration for Tesla Telemetry

This project uses **Supabase** for PostgreSQL database, authentication, and real-time subscriptions.

## Setup Steps

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Click "Start your project" (free, no credit card)
3. Create new project:
   - **Name:** tesla-telemetry
   - **Database Password:** (save this securely)
   - **Region:** Choose closest to you
4. Wait 2-3 minutes for project provisioning

### 2. Get Your Credentials

From your Supabase dashboard:

**Project Settings → API:**
- `SUPABASE_URL`: `https://xxxxx.supabase.co`
- `SUPABASE_ANON_KEY`: `eyJhbGc...` (public, safe for client)
- `SUPABASE_SERVICE_KEY`: `eyJhbGc...` (secret, server-only)

### 3. Setup Database Schema

**Option A: SQL Editor (Recommended)**

1. Go to **SQL Editor** in Supabase dashboard
2. Copy contents of `database/schema.sql`
3. Click "Run" to create tables

**Option B: Local psql**

```bash
psql "postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres" \
  -f database/schema.sql
```

### 4. Configure Environment Variables

Create `.env` file in project root:

```bash
# Supabase Configuration
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Database Direct Connection (for server-side operations)
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres

# Server Configuration
PORT=8000
ENVIRONMENT=development
```

**Security:** Add `.env` to `.gitignore` (already done)

### 5. Install Python Dependencies

```bash
pip install supabase psycopg2-binary python-dotenv
```

Add to `requirements.txt`:
```
supabase==2.3.4
psycopg2-binary==2.9.9
python-dotenv==1.0.0
```

### 6. Test Connection

```bash
python database/test_connection.py
```

You should see:
```
✓ Connected to Supabase
✓ Database schema verified
✓ Sample vehicle found: Model 3 Long Range (VIN: 5YJ3E1EA1KF000001)
```

## Database Schema

### Tables

**`vehicles`**
- Stores vehicle information (VIN, model, owner)
- Primary entity for multi-vehicle fleet

**`telemetry_data`**
- Time-series telemetry records
- Indexed by timestamp for fast queries
- Foreign key to vehicles table

**`compression_stats`**
- Daily aggregated compression statistics
- Tracks bandwidth savings per vehicle

**`offline_sessions`**
- Tracks offline buffering periods
- Used for network reliability analytics

### Key Features

✅ **Row Level Security (RLS):** Users only see their own data  
✅ **Time-series optimized:** Indexes on timestamp columns  
✅ **Data validation:** CHECK constraints on battery, heading  
✅ **Auto-timestamps:** `created_at`, `updated_at` automatically managed  
✅ **UUID primary keys:** Globally unique vehicle IDs

## Using Supabase in Python

### Basic Insert

```python
from supabase import create_client, Client
import os

supabase: Client = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_SERVICE_KEY")
)

# Insert telemetry
data = supabase.table('telemetry_data').insert({
    "vehicle_id": "uuid-here",
    "timestamp": 1703289600000,
    "vehicle_speed": 65.5,
    "battery_level": 82,
    "power_kw": -15.2,
    "odometer": 12543.7,
    "heading": 180
}).execute()
```

### Query with Filters

```python
# Get last 100 records for a vehicle
data = supabase.table('telemetry_data') \
    .select("*") \
    .eq('vehicle_id', vehicle_id) \
    .order('timestamp', desc=True) \
    .limit(100) \
    .execute()
```

### Real-time Subscriptions

```python
def handle_telemetry_update(payload):
    print(f"New telemetry: {payload}")

# Subscribe to real-time updates
supabase.table('telemetry_data') \
    .on('INSERT', handle_telemetry_update) \
    .subscribe()
```

## Supabase Features You Get

### 1. **Auto-generated REST API**
```bash
# GET all telemetry
curl https://xxxxx.supabase.co/rest/v1/telemetry_data \
  -H "apikey: YOUR_ANON_KEY"

# POST new telemetry
curl -X POST https://xxxxx.supabase.co/rest/v1/telemetry_data \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"vehicle_id": "...", "speed": 65}'
```

### 2. **Real-time Database**
Dashboard auto-updates when new telemetry arrives (no polling!)

### 3. **Authentication** (Optional)
```python
# Sign up user
auth_response = supabase.auth.sign_up({
    "email": "user@example.com",
    "password": "securepassword"
})

# Sign in
auth_response = supabase.auth.sign_in_with_password({
    "email": "user@example.com",
    "password": "securepassword"
})
```

### 4. **Storage** (Optional)
Store CSV logs, screenshots, or video clips:
```python
# Upload file
supabase.storage.from_('telemetry-logs').upload(
    'vehicle-123/log-2025-12-23.csv',
    file_content
)
```

## Local Development

Use Docker Compose for local PostgreSQL:

```bash
# Start local database
docker-compose up postgres

# Connect locally
DATABASE_URL=postgresql://telemetry_app:dev_password@localhost:5432/telemetry
```

**When to use local vs Supabase:**
- **Local:** Fast iteration, offline work, no internet required
- **Supabase:** Testing real deployment, real-time features, production demo

## Cost

**Free Tier Includes:**
- ✅ 500 MB database storage
- ✅ 2 GB bandwidth/month
- ✅ 50,000 monthly active users
- ✅ 500,000 reads/month
- ✅ Unlimited API requests
- ✅ Real-time subscriptions
- ✅ 1 GB file storage

**Estimated Usage for Single Vehicle:**
- 50Hz telemetry → ~4.3M records/day
- Each record: ~100 bytes → 430 MB/day
- **You'll exceed free tier in 1-2 days of continuous logging**

**Solution:** Use Supabase for **demo/testing**, local PostgreSQL for development

## Terraform Integration

Keep your Terraform config but use Supabase for now:

```hcl
# environments/dev/main.tf
# Comment out Cloud SQL module
# module "cloud_sql" { ... }

# Add Supabase URL as output
output "database_url" {
  value = "postgresql://postgres:${var.supabase_password}@db.xxxxx.supabase.co:5432/postgres"
  sensitive = true
}
```

## Migration to Cloud SQL Later

When ready to scale:

```bash
# Export from Supabase
pg_dump "postgresql://postgres:pass@db.xxxxx.supabase.co:5432/postgres" > backup.sql

# Import to Cloud SQL
psql "postgresql://user:pass@cloud-sql-ip:5432/telemetry" < backup.sql
```

## Troubleshooting

**Connection refused:**
- Check firewall: Supabase → Settings → Database → Network restrictions
- Use connection pooler: `db.xxxxx.supabase.co:6543` (port 6543)

**Slow queries:**
- Enable pg_stat_statements in Supabase dashboard
- Add indexes: `CREATE INDEX idx_name ON table(column);`

**Free tier exceeded:**
- Upgrade to Pro ($25/month)
- Or switch to Cloud SQL with Terraform
- Or use data retention policy (delete old records)

## Next Steps

1. ✅ Create Supabase project
2. ✅ Run `database/schema.sql` 
3. ✅ Update `.env` with credentials
4. ✅ Test with `python database/test_connection.py`
5. 🚀 Integrate with `server.py` (see `database/supabase_client.py`)

Ready to integrate Supabase into your backend!
