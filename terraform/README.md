# Terraform Infrastructure

Infrastructure as Code (IaC) configuration for deploying the Tesla Telemetry System to Google Cloud Platform. Defines Cloud Run services, VPC networking, and CI/CD pipelines.

## Overview

This Terraform configuration provisions:
- **Google Cloud Run** - Serverless backend service
- **VPC Network** - Optional virtual network for advanced networking
- **Cloud Build** - CI/CD pipeline for automated deployments
- **Container Registry** - Docker image storage
- **Required APIs** - Automatic enablement of GCP services

## Architecture

```
GitHub → Cloud Build → Container Registry → Cloud Run
                              ↓
                        VPC Network (optional)
```

## Structure

```
terraform/
├── main.tf                    # Main configuration
├── terraform.tfvars          # Variable values
└── modules/
    ├── cloud-run/
    │   └── main.tf           # Cloud Run service module
    └── vpc/
        └── main.tf           # VPC network module
```

## Prerequisites

1. **Google Cloud Account** with billing enabled
2. **GCP Project** created
3. **Terraform** >= 1.6.0 installed
4. **gcloud CLI** configured with credentials
5. **Service Account** with necessary permissions

### Required Permissions

The service account needs:
- Cloud Run Admin
- Cloud Build Editor
- Service Account User
- Storage Admin (for Container Registry)

### Setup gcloud

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud auth application-default login
```

## Configuration

### Variables

Edit `terraform.tfvars` or set via environment variables:

```hcl
project_id   = "your-gcp-project-id"
region       = "us-central1"
environment  = "production"
app_name     = "tesla-telemetry"

# Cloud Run scaling
min_instances = 0
max_instances = 10
cpu_limit     = "1000m"
memory_limit  = "512Mi"
```

### Environment Variables

Cloud Run service environment variables (set in `main.tf`):
- `ENVIRONMENT` - Deployment environment
- `PORT` - Server port (8080)
- `ENABLE_SUPABASE` - Enable Supabase integration
- `ENABLE_LOCAL_DB` - Enable local database (false for production)

Add Supabase credentials via Secret Manager (recommended):
```bash
gcloud secrets create supabase-url --data-file=- <<< "https://your-project.supabase.co"
gcloud secrets create supabase-key --data-file=- <<< "your-service-key"
```

Then reference in Terraform:
```hcl
env_vars = {
  SUPABASE_URL = "secret:supabase-url:latest"
  SUPABASE_SERVICE_KEY = "secret:supabase-key:latest"
}
```

## Usage

### Initialize Terraform

```bash
cd terraform
terraform init
```

### Plan Changes

```bash
terraform plan
```

Review the planned changes before applying.

### Apply Configuration

```bash
terraform apply
```

Type `yes` to confirm and create resources.

### Destroy Infrastructure

```bash
terraform destroy
```

⚠️ **Warning:** This will delete all resources!

## Modules

### Cloud Run Module

Deploys the backend service to Cloud Run.

**Features:**
- Serverless auto-scaling
- Health checks (startup and liveness probes)
- Public access (IAM policy)
- Environment variables configuration
- Resource limits (CPU, memory)
- WebSocket timeout (3600s for long-lived connections)

**Outputs:**
- `service_url` - Public URL of the service
- `service_name` - Name of the Cloud Run service

### VPC Module

Creates a VPC network and subnet (optional for basic deployments).

**Features:**
- Custom network with subnet
- Regional subnet configuration
- Can be used for VPC connector to Cloud Run

## CI/CD Pipeline

### Cloud Build Trigger

Automatically deploys on push to `main` branch:

1. **Build Docker Image**
   - Builds from root Dockerfile
   - Tags with `$COMMIT_SHA` and `latest`

2. **Push to Container Registry**
   - Stores image in GCR
   - Makes it available for Cloud Run

3. **Deploy to Cloud Run**
   - Deploys new revision
   - Routes 100% traffic to new revision

### Manual Deployment

Build and deploy manually:

```bash
# Build image
gcloud builds submit --tag gcr.io/PROJECT_ID/tesla-telemetry-backend

# Deploy to Cloud Run
gcloud run deploy tesla-telemetry-backend \
  --image gcr.io/PROJECT_ID/tesla-telemetry-backend \
  --region us-central1 \
  --platform managed
```

## State Management

### Remote State (Recommended)

For team collaboration, use GCS backend:

1. Create bucket:
```bash
gsutil mb -p PROJECT_ID gs://terraform-state-bucket
```

2. Enable versioning:
```bash
gsutil versioning set on gs://terraform-state-bucket
```

3. Uncomment backend block in `main.tf`:
```hcl
backend "gcs" {
  bucket = "terraform-state-bucket"
  prefix = "terraform/state"
}
```

4. Reinitialize:
```bash
terraform init -migrate-state
```

### Local State

Default (local) state is stored in `terraform.tfstate`. Do not commit this file!

## Outputs

After applying, Terraform outputs:

- `cloud_run_url` - Service URL
- `cloud_run_service` - Service name
- `vpc_network` - VPC network name
- `project_id` - GCP Project ID
- `region` - GCP Region
- `ci_cd_trigger` - Cloud Build trigger name

View outputs:
```bash
terraform output
```

## Cost Estimation

**Cloud Run:**
- Pay per request (free tier: 2 million requests/month)
- CPU and memory usage billing
- Estimated: $5-20/month for low-medium traffic

**Cloud Build:**
- Free tier: 120 build-minutes/day
- $0.003 per build-minute after

**Container Registry:**
- Storage: $0.026/GB/month
- Network egress: $0.12/GB (first 10GB free)

**VPC:**
- Free (no additional charges for basic VPC)

## Security

### Best Practices

1. **Use Secret Manager** for sensitive values (Supabase keys)
2. **Enable VPC** for private networking if needed
3. **Restrict IAM permissions** to minimum required
4. **Enable audit logs** for compliance
5. **Use service accounts** instead of user credentials
6. **Enable Binary Authorization** for container security

### IAM Policies

Cloud Run service is public by default. To restrict:

```hcl
# Remove public access
resource "google_cloud_run_service_iam_member" "authenticated_only" {
  service  = module.cloud_run.service_name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"  # Change to specific service account
}
```

## Troubleshooting

### Terraform Apply Fails

1. Check GCP project permissions
2. Verify APIs are enabled
3. Check quota limits
4. Review error messages in GCP Console

### Cloud Run Deployment Issues

1. Check Docker image builds successfully
2. Verify environment variables are set
3. Check health check endpoints
4. Review Cloud Run logs:
```bash
gcloud run logs read tesla-telemetry-backend --region us-central1
```

### Build Trigger Not Working

1. Verify GitHub connection in Cloud Build
2. Check trigger configuration matches branch name
3. Review build logs in Cloud Build console
4. Ensure repository name matches exactly

## Future Enhancements

- [ ] Multi-region deployment
- [ ] Cloud Load Balancer for global distribution
- [ ] Cloud CDN for static assets
- [ ] Cloud SQL for managed database (alternative to Supabase)
- [ ] Cloud Monitoring and Alerting
- [ ] VPC connector for private networking
- [ ] Cloud Armor for DDoS protection
- [ ] Binary Authorization for container security
- [ ] Custom domain mapping
- [ ] SSL certificate management

