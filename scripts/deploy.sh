#!/usr/bin/env bash
# Deploy the built Monster League Arcade bundle to Azure Static Web Apps.
#
# Usage: scripts/deploy.sh [review|production]
#
# The deployment token is read from Azure into a process-local variable and
# exported only for the swa child process. It is never echoed, written to disk,
# committed, or persisted in the SWA CLI keychain (--no-use-keychain).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENVIRONMENT="${1:-review}"
case "$ENVIRONMENT" in
  review|production) ;;
  *)
    echo "usage: $0 [review|production]" >&2
    exit 2
    ;;
esac

SWA_APP_NAME="${SWA_APP_NAME:-monster-league-arcade}"
SWA_RESOURCE_GROUP="${SWA_RESOURCE_GROUP:-nekoc}"

echo "==> Preflight: npm run check"
npm run check

echo "==> Preflight: clean working tree"
if [[ -n "$(git status --porcelain)" ]]; then
  echo " refusing to deploy from a dirty tree:" >&2
  git status --short >&2
  exit 1
fi

# production deploys are only permitted from an approved/merged main commit.
if [[ "$ENVIRONMENT" == "production" ]]; then
  branch="$(git rev-parse --abbrev-ref HEAD)"
  if [[ "$branch" != "main" ]]; then
    echo " refusing production deploy from branch '$branch' (main only)" >&2
    exit 1
  fi
  if [[ -n "$(git status --porcelain origin/main..HEAD)" ]]; then
    echo " refusing production deploy: local main is not aligned with origin/main" >&2
    exit 1
  fi
  git fetch --quiet origin main
  if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
    echo " refusing production deploy: HEAD is not origin/main" >&2
    exit 1
  fi
fi

# swa expects its config file inside the output location; copy it into dist
# without touching the tracked source config. Config is intentionally copied
# on every deploy so the deployed routing/security headers match the repo.
cp apps/arcade-hub/public/staticwebapp.config.json dist/staticwebapp.config.json

echo "==> Fetching SWA deployment token (in memory only)"
token="$(az staticwebapp secrets list \
  --name "$SWA_APP_NAME" \
  --resource-group "$SWA_RESOURCE_GROUP" \
  --query 'properties.apiKey' -o tsv)"
if [[ -z "$token" || "$token" == "None" ]]; then
  echo " could not obtain deployment token for $SWA_APP_NAME" >&2
  exit 1
fi

if [[ "$ENVIRONMENT" == "review" ]]; then
  host="$(az staticwebapp environment list \
    --name "$SWA_APP_NAME" --resource-group "$SWA_RESOURCE_GROUP" \
    --query "[?name=='review'].hostname" -o tsv)"
else
  host="$(az staticwebapp show \
    --name "$SWA_APP_NAME" \
    --resource-group "$SWA_RESOURCE_GROUP" \
    --query defaultHostname -o tsv)"
fi
[[ -n "$host" ]] || { echo " could not resolve SWA hostname" >&2; exit 1; }
if [[ "$host" != http* ]]; then host="https://$host"; fi

echo "==> Deploying dist/ to $host ($ENVIRONMENT)"
# --no-use-keychain prevents the token being persisted outside this process.
SWA_CLI_DEPLOYMENT_TOKEN="$token" npx --yes @azure/static-web-apps-cli deploy \
  --output-location ./dist \
  --swa-config-location ./dist \
  --env "$ENVIRONMENT" \
  --no-use-keychain >/dev/null
unset token

echo "==> Verifying deployment at $host"
node scripts/verify-deployment.mjs "$host"

echo "==> Deployed $ENVIRONMENT to $host"
