# Minikube Setup Guide

Complete guide for setting up the Tesla Telemetry System on Minikube.

## Prerequisites

- Minikube installed
- kubectl installed
- Docker installed
- Helm 3 installed (optional, for Helm deployment)

## Step 1: Start Minikube

```bash
# Start minikube with sufficient resources
minikube start --memory=4096 --cpus=4

# Enable required addons
minikube addons enable ingress
minikube addons enable metrics-server

# Verify cluster is running
kubectl cluster-info
```

## Step 2: Build Docker Images

```bash
# Set Docker to use minikube's Docker daemon
eval $(minikube docker-env)

# Build backend image
docker build -t tesla-telemetry-backend:latest .

# Build logger image (same image, different entrypoint)
docker build -t tesla-telemetry-logger:latest .

# Build frontend image (if separate)
# cd frontend_dashboard
# docker build -t tesla-telemetry-frontend:latest .
```

## Step 3: Create Secrets

### Option 1: From .env File (Recommended)

```bash
# Make sure you have a .env file in the project root with:
# SUPABASE_URL=https://your-project.supabase.co
# SUPABASE_SERVICE_KEY=your-service-role-key

# Create secret from .env file
./k8s/secrets/create-from-env.sh

# Verify secret
kubectl get secret telemetry-secrets
```

### Option 2: Manual Creation

```bash
# Create secret manually
kubectl create secret generic telemetry-secrets \
  --from-literal=SUPABASE_URL=your-supabase-url \
  --from-literal=SUPABASE_SERVICE_KEY=your-service-key

# Verify secret
kubectl get secret telemetry-secrets
```

## Step 4: Deploy Using Helm (Recommended)

```bash
# Navigate to Helm chart directory
cd helm/tesla-telemetry

# Update dependencies (if using Bitnami Kafka chart)
# helm dependency update

# Install the chart
helm install tesla-telemetry . \
  --set secrets.supabaseUrl=your-url \
  --set secrets.supabaseServiceKey=your-key

# Check deployment status
helm status tesla-telemetry
kubectl get pods
```

## Step 5: Deploy Using Raw Manifests (Alternative)

If not using Helm, deploy manifests in order:

```bash
# 1. Zookeeper
kubectl apply -f k8s/zookeeper/

# 2. Wait for Zookeeper
kubectl wait --for=condition=ready pod -l app=zookeeper --timeout=300s

# 3. Kafka
kubectl apply -f k8s/kafka/

# 4. Wait for Kafka
kubectl wait --for=condition=ready pod -l app=kafka --timeout=300s

# 5. Initialize Kafka topic
kubectl apply -f k8s/kafka/topic-init-job.yaml
kubectl wait --for=condition=complete job/kafka-topic-init --timeout=60s

# 6. ConfigMaps and Secrets
kubectl apply -f k8s/configmaps/
# Secrets should already be created in Step 3

# 7. Shared PVC
kubectl apply -f k8s/pvc-shared.yaml

# 8. Server
kubectl apply -f k8s/server/

# 9. Logger
kubectl apply -f k8s/logger/

# 10. Frontend
kubectl apply -f k8s/frontend/
```

## Step 6: Access the Application

### Option 1: Port Forwarding

```bash
# Server
kubectl port-forward service/telemetry-server 8001:8080

# Frontend
kubectl port-forward service/telemetry-frontend 3000:3000
```

Access:
- Frontend: http://localhost:3000
- Server API: http://localhost:8001

### Option 2: Ingress (if configured)

```bash
# Get minikube IP
minikube ip

# Add to /etc/hosts (Linux/Mac) or C:\Windows\System32\drivers\etc\hosts (Windows)
# <minikube-ip> telemetry.local

# Access via ingress
curl http://telemetry.local
```

## Step 7: Verify Deployment

```bash
# Check all pods are running
kubectl get pods

# Check services
kubectl get services

# Check HPA
kubectl get hpa

# View logs
kubectl logs -l app=telemetry-server
kubectl logs -l app=telemetry-logger
```

## Step 8: Test Kafka

```bash
# List Kafka topics
kubectl exec -it kafka-0 -- kafka-topics --list --bootstrap-server localhost:9093

# Check consumer groups
kubectl exec -it kafka-0 -- kafka-consumer-groups --bootstrap-server localhost:9093 --list

# View consumer lag
kubectl exec -it kafka-0 -- kafka-consumer-groups --bootstrap-server localhost:9093 \
  --describe --group telemetry-processors
```

## Troubleshooting

### Pods Not Starting

```bash
# Check pod status
kubectl describe pod <pod-name>

# Check events
kubectl get events --sort-by='.lastTimestamp'

# Check logs
kubectl logs <pod-name>
```

### Kafka Connection Issues

```bash
# Verify Kafka is accessible
kubectl exec -it kafka-0 -- kafka-broker-api-versions --bootstrap-server localhost:9093

# Check Kafka logs
kubectl logs kafka-0
```

### Storage Issues

```bash
# Check PVCs
kubectl get pvc

# Check storage class
kubectl get storageclass
```

## Cleanup

```bash
# If using Helm
helm uninstall tesla-telemetry

# If using raw manifests
kubectl delete -f k8s/

# Stop minikube
minikube stop
```

## Next Steps

- Monitor HPA scaling: `kubectl get hpa -w`
- Scale manually: `kubectl scale deployment telemetry-server --replicas=5`
- View metrics: `kubectl top pods`

