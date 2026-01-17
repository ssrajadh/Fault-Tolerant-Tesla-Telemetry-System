#!/bin/bash
# Update Helm values.yaml from .env file
# Usage: ./update-values-from-env.sh [.env-file-path]

set -e

ENV_FILE="${1:-../../.env}"
VALUES_FILE="values.yaml"

echo "Updating Helm values.yaml from .env file..."
echo "Env file: $ENV_FILE"
echo "Values file: $VALUES_FILE"
echo ""

# Check if .env file exists
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: .env file not found at $ENV_FILE"
    exit 1
fi

# Read values from .env file
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

# Update values.yaml using sed or yq (if available)
if command -v yq &> /dev/null; then
    # Use yq if available (more robust)
    yq eval ".secrets.supabaseUrl = \"$SUPABASE_URL\"" -i "$VALUES_FILE"
    yq eval ".secrets.supabaseServiceKey = \"$SUPABASE_SERVICE_KEY\"" -i "$VALUES_FILE"
    echo "✓ Updated values.yaml using yq"
else
    # Fallback to sed (less robust but works)
    # Escape special characters for sed
    SUPABASE_URL_ESC=$(echo "$SUPABASE_URL" | sed 's/[[\.*^$()+?{|]/\\&/g')
    SUPABASE_SERVICE_KEY_ESC=$(echo "$SUPABASE_SERVICE_KEY" | sed 's/[[\.*^$()+?{|]/\\&/g')
    
    # Update values.yaml
    sed -i "s|supabaseUrl:.*|supabaseUrl: \"$SUPABASE_URL_ESC\"|" "$VALUES_FILE"
    sed -i "s|supabaseServiceKey:.*|supabaseServiceKey: \"$SUPABASE_SERVICE_KEY_ESC\"|" "$VALUES_FILE"
    echo "✓ Updated values.yaml using sed"
    echo "  Note: For better results, install yq: https://github.com/mikefarah/yq"
fi

echo ""
echo "✓ Helm values.yaml updated with secrets from .env"
echo ""
echo "You can now deploy with:"
echo "  helm install tesla-telemetry ."
echo ""
echo "⚠️  Warning: values.yaml now contains secrets. Do not commit this file!"

