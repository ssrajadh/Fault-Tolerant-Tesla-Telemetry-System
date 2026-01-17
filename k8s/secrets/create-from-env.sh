#!/bin/bash
# Create Kubernetes secrets from .env file
# Usage: ./create-from-env.sh [.env-file-path] [namespace]

set -e

ENV_FILE="${1:-.env}"
NAMESPACE="${2:-default}"
SECRET_NAME="telemetry-secrets"

echo "Creating Kubernetes secret from .env file..."
echo "Env file: $ENV_FILE"
echo "Namespace: $NAMESPACE"
echo "Secret name: $SECRET_NAME"
echo ""

# Check if .env file exists
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: .env file not found at $ENV_FILE"
    echo "Please create a .env file with:"
    echo "  SUPABASE_URL=your-url"
    echo "  SUPABASE_SERVICE_KEY=your-key"
    exit 1
fi

# Read values from .env file
# Handle both SUPABASE_URL and SUPABASE_SERVICE_KEY
SUPABASE_URL=$(grep -E "^SUPABASE_URL=" "$ENV_FILE" | cut -d '=' -f2- | sed 's/^"//;s/"$//' | xargs)
SUPABASE_SERVICE_KEY=$(grep -E "^SUPABASE_SERVICE_KEY=" "$ENV_FILE" | cut -d '=' -f2- | sed 's/^"//;s/"$//' | xargs)

# Also check for SUPABASE_KEY (alternative name)
if [ -z "$SUPABASE_SERVICE_KEY" ]; then
    SUPABASE_SERVICE_KEY=$(grep -E "^SUPABASE_KEY=" "$ENV_FILE" | cut -d '=' -f2- | sed 's/^"//;s/"$//' | xargs)
fi

# Validate required values
if [ -z "$SUPABASE_URL" ]; then
    echo "Error: SUPABASE_URL not found in $ENV_FILE"
    exit 1
fi

if [ -z "$SUPABASE_SERVICE_KEY" ]; then
    echo "Error: SUPABASE_SERVICE_KEY not found in $ENV_FILE"
    exit 1
fi

# Check if namespace exists, create if not
if ! kubectl get namespace "$NAMESPACE" &>/dev/null; then
    echo "Creating namespace: $NAMESPACE"
    kubectl create namespace "$NAMESPACE"
fi

# Check if secret already exists
if kubectl get secret "$SECRET_NAME" -n "$NAMESPACE" &>/dev/null; then
    echo "Secret $SECRET_NAME already exists. Updating..."
    kubectl delete secret "$SECRET_NAME" -n "$NAMESPACE"
fi

# Create secret
kubectl create secret generic "$SECRET_NAME" \
    --from-literal=SUPABASE_URL="$SUPABASE_URL" \
    --from-literal=SUPABASE_SERVICE_KEY="$SUPABASE_SERVICE_KEY" \
    -n "$NAMESPACE"

echo ""
echo "✓ Secret '$SECRET_NAME' created/updated in namespace '$NAMESPACE'"
echo ""
echo "To verify:"
echo "  kubectl get secret $SECRET_NAME -n $NAMESPACE"
echo "  kubectl describe secret $SECRET_NAME -n $NAMESPACE"

