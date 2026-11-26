#!/usr/bin/env bash
set -euo pipefail

# Local dogfood setup for a real Auth0 tenant.
#
#   ./scripts/dogfood-auth0.sh
#   ./scripts/dogfood-auth0.sh --config-only
#
# Values are created once in ~/.auththread/dogfood.{json,env}. The env file is
# mode 600 and is only used by this script. Re-running the script reuses the
# existing config without printing the secrets again.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
config_dir="${AUTHTHREAD_CONFIG_DIR:-$HOME/.auththread}"
config_file="$config_dir/dogfood.json"
env_file="$config_dir/dogfood.env"
db_file="$config_dir/state.db"
config_only=false

if [ "${1:-}" = "--config-only" ]; then
  config_only=true
fi

mkdir -p "$config_dir"
umask 077

if [ -f "$env_file" ]; then
  # shellcheck disable=SC1090
  source "$env_file"
fi

if [ -f "$config_file" ] && [ -f "$env_file" ]; then
  echo "Using existing config: $config_file"
else
  if [ -z "${AUTH0_DOMAIN:-}" ]; then
    read -r -p "Auth0 tenant domain (for example acme.eu.auth0.com): " AUTH0_DOMAIN
  fi
  : "${AUTH0_DOMAIN:?AUTH0_DOMAIN is required}"

  AUTH0_DOMAIN="${AUTH0_DOMAIN#https://}"
  AUTH0_DOMAIN="${AUTH0_DOMAIN%%/*}"
  AUTHTHREAD_TENANT="${AUTHTHREAD_TENANT:-dogfood}"
  AUTHTHREAD_KEY="${AUTHTHREAD_KEY:-$(openssl rand -hex 32)}"
  AUTHTHREAD_SALT="${AUTHTHREAD_SALT:-$(openssl rand -hex 32)}"
  AUTHTHREAD_FEED_SECRET="${AUTHTHREAD_FEED_SECRET:-$(openssl rand -hex 32)}"

  cat > "$env_file" <<EOF
AUTH0_DOMAIN=$AUTH0_DOMAIN
AUTHTHREAD_TENANT=$AUTHTHREAD_TENANT
AUTHTHREAD_KEY=$AUTHTHREAD_KEY
AUTHTHREAD_SALT=$AUTHTHREAD_SALT
AUTHTHREAD_FEED_SECRET=$AUTHTHREAD_FEED_SECRET
EOF
  chmod 600 "$env_file"

  cat > "$config_file" <<JSON
{
  "tenants": [
    {
      "tenant": "$AUTHTHREAD_TENANT",
      "provider": "auth0",
      "apiKey": "$AUTHTHREAD_KEY",
      "salt": "$AUTHTHREAD_SALT",
      "providerSettings": {
        "feedSecret": "$AUTHTHREAD_FEED_SECRET",
        "domain": "$AUTH0_DOMAIN"
      }
    }
  ]
}
JSON
  chmod 600 "$config_file"

  echo
  echo "Created: $config_file"
  echo "Created: $env_file"
  echo
  echo "Use these in Auth0:"
  echo "  tenant:      $AUTHTHREAD_TENANT"
  echo "  API key:     $AUTHTHREAD_KEY"
  echo "  feed secret: $AUTHTHREAD_FEED_SECRET"
  echo
  echo "The salt stays server-side."
fi

echo "config: $config_file"
echo "sqlite: $db_file"

if [ "$config_only" = true ]; then
  exit 0
fi

cd "$repo_root"

echo "building..."
mise exec -- pnpm build
mise exec -- pnpm --filter @auththread/server bundle

echo "starting on :8787"
echo "in another terminal: cloudflared tunnel --url http://localhost:8787"
echo

AUTHTHREAD_CONFIG="$config_file" \
AUTHTHREAD_DB="$db_file" \
AUTHTHREAD_QUIET_MS=10000 \
AUTHTHREAD_SAMPLE_SUCCESS=1 \
mise exec -- node apps/server/dist/server.mjs
