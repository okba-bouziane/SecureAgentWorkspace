#!/bin/sh
# Prepares the writable state under /data (ephemeral on a Space) and starts every process under supervisord.
set -e

export PUBLIC_URL="${PUBLIC_URL:-https://${SPACE_HOST:-okba-bouziane-secureagentworkspace.hf.space}}"
export LLM_API_KEY="${LLM_API_KEY:-}"

# Postgres: local only, trust auth on loopback, created on first start.
if [ ! -s /data/pg/PG_VERSION ]; then
  initdb -D /data/pg -U saw --auth=trust --encoding=UTF8 >/dev/null
  cat >> /data/pg/postgresql.conf <<CONF
listen_addresses = '127.0.0.1'
unix_socket_directories = '/tmp'
shared_buffers = 128MB
max_connections = 60
CONF
fi
mkdir -p /data/redis

# Keycloak: realm for this public URL, random admin password that is never published.
mkdir -p /opt/keycloak/data/import
sed "s#__PUBLIC_URL__#${PUBLIC_URL}#g" /app/realm.template.json > /opt/keycloak/data/import/realm.json
export KC_BOOTSTRAP_ADMIN_USERNAME=kcadmin
KC_BOOTSTRAP_ADMIN_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
export KC_BOOTSTRAP_ADMIN_PASSWORD
export JAVA_OPTS_KC_HEAP="-Xms64m -Xmx512m"

# Shared application settings (supervisord children inherit them).
export OIDC_ISSUER="${PUBLIC_URL}/auth/realms/securemcp"
export OIDC_JWKS_URL="http://127.0.0.1:8080/auth/realms/securemcp/protocol/openid-connect/certs"
export OIDC_AUDIENCE=mcp-server
export WEB_ORIGIN="${PUBLIC_URL}"
export DATABASE_URL="postgres://saw@127.0.0.1:5432/saw"
export REDIS_URL="redis://127.0.0.1:6379"
export MCP_URL="http://127.0.0.1:3000/mcp"
export LLM_BASE_URL="${LLM_BASE_URL:-https://api.groq.com/openai/v1}"
export LLM_MODEL="${LLM_MODEL:-openai/gpt-oss-20b}"
export LLM_REASONING_EFFORT="${LLM_REASONING_EFFORT:-low}"
# Demo protection: per-user rate limit plus daily caps, so the shared free LLM quota cannot be burned.
export CHAT_RATE_LIMIT="${CHAT_RATE_LIMIT:-4}"
export CHAT_RATE_WINDOW_SECONDS="${CHAT_RATE_WINDOW_SECONDS:-60}"
export DAILY_RUN_CAP_GLOBAL="${DAILY_RUN_CAP_GLOBAL:-60}"
export DAILY_RUN_CAP_PER_USER="${DAILY_RUN_CAP_PER_USER:-12}"
export INGEST_CONCURRENCY=1
export SEED_DIR=/app/api/seed

exec supervisord -n -c /app/supervisord.conf
