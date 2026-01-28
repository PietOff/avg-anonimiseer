#!/bin/bash

# Configuration Helper: Update the Backend URL in frontend/mistral.js

if [ -z "$1" ]; then
  echo "❌ Error: Missing URL."
  echo "Usage: ./set_backend_url.sh <YOUR_RENDER_URL>"
  echo "Example: ./set_backend_url.sh https://avg-backend.onrender.com/api/analyze"
  exit 1
fi

NEW_URL="$1"

# Check if the URL looks valid (basic check)
if [[ "$NEW_URL" != http* ]]; then
    echo "⚠️ Warning: URL does not start with http:// or https://"
fi

echo "🔄 Updating frontend/mistral.js..."

# Use sed to replace the content (MacOS compatible)
# We look for "BACKEND_URL: '...'," pattern
# We use | as delimiter to avoid escaping slashes in URL
sed -i '' "s|BACKEND_URL: '.*'|BACKEND_URL: '$NEW_URL'|g" frontend/mistral.js

echo "✅ Success! Backend URL set to: $NEW_URL"
echo "👉 Don't forget to push: git add . && git commit -m 'Update API URL' && git push"
