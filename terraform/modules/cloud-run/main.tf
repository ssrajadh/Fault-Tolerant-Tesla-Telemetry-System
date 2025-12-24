# Cloud Run module - Deploys the telemetry backend service

variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
}

variable "service_name" {
  description = "Cloud Run service name"
  type        = string
}

variable "image" {
  description = "Container image URL"
  type        = string
  default     = "gcr.io/tesla-telemetry-481502/tesla-telemetry-backend:latest"
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "min_instances" {
  description = "Minimum number of instances"
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Maximum number of instances"
  type        = number
  default     = 10
}

variable "cpu_limit" {
  description = "CPU limit"
  type        = string
  default     = "1000m"
}

variable "memory_limit" {
  description = "Memory limit"
  type        = string
  default     = "512Mi"
}

variable "env_vars" {
  description = "Environment variables"
  type        = map(string)
  default     = {}
}

# Cloud Run Service
resource "google_cloud_run_v2_service" "telemetry_backend" {
  name     = var.service_name
  location = var.region
  
  template {
    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }
    
    containers {
      image = var.image
      
      ports {
        container_port = 8080
      }
      
      resources {
        limits = {
          cpu    = var.cpu_limit
          memory = var.memory_limit
        }
        cpu_idle = true
      }
      
      dynamic "env" {
        for_each = var.env_vars
        content {
          name  = env.key
          value = env.value
        }
      }
      
      # Health check
      startup_probe {
        http_get {
          path = "/"
          port = 8080
        }
        initial_delay_seconds = 10
        timeout_seconds       = 3
        period_seconds        = 10
        failure_threshold     = 3
      }
      
      liveness_probe {
        http_get {
          path = "/status"
          port = 8080
        }
        initial_delay_seconds = 30
        timeout_seconds       = 5
        period_seconds        = 30
        failure_threshold     = 3
      }
    }
    
    # Timeout for WebSocket connections
    timeout = "3600s"
    
    labels = {
      environment = var.environment
      app         = "tesla-telemetry"
    }
  }
  
  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

# IAM policy to allow unauthenticated access
resource "google_cloud_run_service_iam_member" "public_access" {
  service  = google_cloud_run_v2_service.telemetry_backend.name
  location = google_cloud_run_v2_service.telemetry_backend.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# Outputs
output "service_url" {
  description = "URL of the Cloud Run service"
  value       = google_cloud_run_v2_service.telemetry_backend.uri
}

output "service_name" {
  description = "Name of the Cloud Run service"
  value       = google_cloud_run_v2_service.telemetry_backend.name
}
