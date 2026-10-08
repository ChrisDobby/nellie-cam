#!/usr/bin/env bash
# Builds the viewer app with the deployed NellieCamStack's settings and deploys it (NellieCamWebStack).
# The settings are built into the app, so NellieCamStack must be deployed first.
#
# Usage: ./scripts/deploy-app.sh
# Run from aws/, with admin AWS credentials, in the same region as the deployed NellieCamStack.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../../app" && pwd)"

output() {
  aws cloudformation describe-stacks --stack-name NellieCamStack \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

user_pool_id=$(output UserPoolId)

# Next.js reads .env.production.local when building, ahead of .env.local (used for local dev).
# None of these are secrets; they end up in the browser bundle.
cat > "$APP_DIR/.env.production.local" <<EOF
NEXT_PUBLIC_AWS_REGION=${user_pool_id%%_*}
NEXT_PUBLIC_USER_POOL_ID=$user_pool_id
NEXT_PUBLIC_USER_POOL_CLIENT_ID=$(output UserPoolClientId)
NEXT_PUBLIC_IDENTITY_POOL_ID=$(output IdentityPoolId)
NEXT_PUBLIC_IOT_ENDPOINT=$(aws iot describe-endpoint --endpoint-type iot:Data-ATS --query endpointAddress --output text)
NEXT_PUBLIC_STREAM_NAME=$(output StreamName)
NEXT_PUBLIC_THING_NAME=$(output ThingName)
EOF

(cd "$APP_DIR" && npm ci && npx open-next build)

npx cdk deploy NellieCamWebStack
