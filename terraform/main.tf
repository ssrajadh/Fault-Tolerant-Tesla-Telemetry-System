# Main Terraform configuration for Tesla Telemetry System
# Single unified configuration for infrastructure provisioning

terraform {
  required_version = ">= 1.6.0"
  
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
  
  # Backend for state management (uncomment after creating bucket)
  # backend "gcs" {
  #   bucket = "tesla-telemetry-terraform-state"
  #   prefix = "terraform/state"
  # }
}

# Variables
variable "project_id" {
  description = "GCP Project ID"
  type        = string
  default     = "tesla-telemetry-481502"
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}

variable "app_name" {
  description = "Application name"
  type        = string
  default     = "tesla-telemetry"
}

# Cloud Run configuration
variable "min_instances" {
  description = "Minimum number of Cloud Run instances"
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Maximum number of Cloud Run instances"
  type        = number
  default     = 10
}

variable "cpu_limit" {
  description = "CPU limit per instance"
  type        = string
  default     = "1000m"
}

variable "memory_limit" {
  description = "Memory limit per instance"
  type        = string
  default     = "512Mi"
}

# Provider configuration
provider "google" {
  project = var.project_id
  region  = var.region
}

# Enable required APIs
resource "google_project_service" "required_apis" {
  for_each = toset([
    "run.googleapis.com",                # Cloud Run
    "cloudbuild.googleapis.com",         # Cloud Build
    "containerregistry.googleapis.com",  # Container Registry
    "compute.googleapis.com",            # VPC
    "secretmanager.googleapis.com",      # Secret Manager
  ])
  
  service            = each.value
  disable_on_destroy = false
}

# VPC Network (optional, for advanced networking)
module "vpc" {
  source = "./modules/vpc"
  
  project_id   = var.project_id
  region       = var.region
  network_name = "${var.app_name}-vpc"
  subnet_cidr  = "10.0.0.0/24"
  
  depends_on = [google_project_service.required_apis]
}

# Cloud Run Service
module "cloud_run" {
  source = "./modules/cloud-run"
  
  project_id   = var.project_id
  region       = var.region
  service_name = "${var.app_name}-backend"
  environment  = var.environment
  
  min_instances = var.min_instances
  max_instances = var.max_instances
  cpu_limit     = var.cpu_limit
  memory_limit  = var.memory_limit
  
  env_vars = {
    ENVIRONMENT       = var.environment
    PORT              = "8080"
    ENABLE_SUPABASE   = "true"
    ENABLE_LOCAL_DB   = "false"
  }
  
  depends_on = [google_project_service.required_apis]
}

# Cloud Build Trigger for CI/CD
resource "google_cloudbuild_trigger" "deploy_trigger" {
  name        = "${var.app_name}-deploy"
  description = "Deploy to Cloud Run on main branch push"
  
  github {
    owner = "ssrajadh"
    name  = "Fault-Tolerant-Tesla-Telemetry-System"
    push {
      branch = "^main$"
    }
  }
  
  build {
    step {
      name = "gcr.io/cloud-builders/docker"
      args = [
        "build",
        "-t", "gcr.io/${var.project_id}/${var.app_name}-backend:$COMMIT_SHA",
        "-t", "gcr.io/${var.project_id}/${var.app_name}-backend:latest",
        "."
      ]
    }
    
    step {
      name = "gcr.io/cloud-builders/docker"
      args = [
        "push",
        "gcr.io/${var.project_id}/${var.app_name}-backend:$COMMIT_SHA"
      ]
    }
    
    step {
      name = "gcr.io/cloud-builders/gcloud"
      args = [
        "run", "deploy", module.cloud_run.service_name,
        "--image", "gcr.io/${var.project_id}/${var.app_name}-backend:$COMMIT_SHA",
        "--region", var.region,
        "--platform", "managed"
      ]
    }
    
    images = [
      "gcr.io/${var.project_id}/${var.app_name}-backend:$COMMIT_SHA",
      "gcr.io/${var.project_id}/${var.app_name}-backend:latest"
    ]
  }
  
  depends_on = [google_project_service.required_apis]
}

# Outputs
output "cloud_run_url" {
  description = "URL of the deployed Cloud Run service"
  value       = module.cloud_run.service_url
}

output "cloud_run_service" {
  description = "Cloud Run service name"
  value       = module.cloud_run.service_name
}

output "vpc_network" {
  description = "VPC network name"
  value       = module.vpc.network_name
}

output "project_id" {
  description = "GCP Project ID"
  value       = var.project_id
}

output "region" {
  description = "GCP Region"
  value       = var.region
}

output "ci_cd_trigger" {
  description = "Cloud Build trigger name"
  value       = google_cloudbuild_trigger.deploy_trigger.name
}
