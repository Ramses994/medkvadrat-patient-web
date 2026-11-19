#!/usr/bin/env bash
# Verifies the patient-web image: Host with port, X-Forwarded-For replaced,
# only /api/auth/ and /api/me/ proxied, /dashboard blocked, /healthz and runtime-config.
# Also TLS: optional mount of tls.crt/tls.key, PUBLIC_ORIGIN redirect, HSTS, key permissions.
set -euo pipefail

IMAGE=${IMAGE:-patient-web:test}
STUB_PORT=${STUB_PORT:-18091}
WEB_PORT=${WEB_PORT:-18083}
WEB_TLS_PORT=${WEB_TLS_PORT:-18443}
STUB_NAME=patient-web-stub-$$
WEB_NAME=patient-web-under-test-$$
NET=patient-web-test-$$
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TLS_DIR=
TLS_BAD=

cleanup() {
  docker rm -f "$WEB_NAME" "$STUB_NAME" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  if [ -n "${TLS_DIR:-}" ] && [ -d "$TLS_DIR" ]; then rm -rf "$TLS_DIR"; fi
  if [ -n "${TLS_BAD:-}" ] && [ -d "$TLS_BAD" ]; then rm -rf "$TLS_BAD"; fi
}
trap cleanup EXIT

wait_http_ok() {
  local url=$1
  for _ in $(seq 1 40); do
    if curl -fsS "$url" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "timeout waiting for $url" >&2
  return 1
}

wait_healthz() {
  local port=$1
  for _ in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:${port}/healthz" 2>/dev/null | grep -q ok; then return 0; fi
    sleep 0.5
  done
  echo "timeout waiting for healthz on ${port}" >&2
  return 1
}

docker network create "$NET" >/dev/null

docker run -d --name "$STUB_NAME" --network "$NET" -p "${STUB_PORT}:8080" \
  -v "$ROOT/scripts/nginx-probe-stub.py:/app/stub.py:ro" \
  python:3.12-alpine python /app/stub.py

wait_http_ok "http://127.0.0.1:${STUB_PORT}/__hits"

# --- HTTP-only (no TLS files): current behaviour ---
docker run -d --name "$WEB_NAME" --network "$NET" -p "${WEB_PORT}:8080" \
  -e API_UPSTREAM="http://${STUB_NAME}:8080" \
  -e CLINIC_PHONE="+7 900 000-00-00" \
  "$IMAGE"

wait_healthz "$WEB_PORT"

curl -fsS "http://127.0.0.1:${WEB_PORT}/healthz" | grep -q ok

phone=$(curl -fsS "http://127.0.0.1:${WEB_PORT}/runtime-config.json")
echo "$phone" | grep -q '+7 900 000-00-00'

hits_before=$(curl -fsS "http://127.0.0.1:${STUB_PORT}/__hits" | sed -n 's/.*"hits"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p')

resp=$(curl -fsS \
  -H "X-LK-Client: web" \
  -H "X-Forwarded-For: 203.0.113.9" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{}' \
  "http://127.0.0.1:${WEB_PORT}/api/auth/otp/request")
echo "$resp"
echo "$resp" | grep -Eq "\"host\"[[:space:]]*:[[:space:]]*\"127\\.0\\.0\\.1:${WEB_PORT}\""
if echo "$resp" | grep -q '203.0.113.9'; then
  echo "client X-Forwarded-For leaked to upstream: $resp" >&2
  exit 1
fi
echo "$resp" | grep -Eq '"xff"[[:space:]]*:[[:space:]]*"[^"]+"'

# /api/me/ must reach the stub too.
curl -fsS -H "Authorization: Bearer test" "http://127.0.0.1:${WEB_PORT}/api/me/profile" >/dev/null

hits_after_allowed=$(curl -fsS "http://127.0.0.1:${STUB_PORT}/__hits" | sed -n 's/.*"hits"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p')
allowed=$((hits_after_allowed - hits_before))
if [ "$allowed" -lt 2 ]; then
  echo "expected /api/auth and /api/me to hit stub, got $allowed new hits" >&2
  exit 1
fi

# Blocked paths: nginx 404 and no upstream call.
hits_before_block=$hits_after_allowed
for path in \
  /api/patients/search \
  /api/reminders/due \
  /api/catalog/doctors \
  /api/health \
  /api/internal/bot-consents
do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${WEB_PORT}${path}")
  if [ "$code" != "404" ]; then
    echo "expected 404 for ${path}, got ${code}" >&2
    exit 1
  fi
done

hits_after_block=$(curl -fsS "http://127.0.0.1:${STUB_PORT}/__hits" | sed -n 's/.*"hits"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p')
if [ "$hits_after_block" != "$hits_before_block" ]; then
  echo "blocked /api/ paths reached the stub: before=$hits_before_block after=$hits_after_block" >&2
  exit 1
fi

code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${WEB_PORT}/dashboard")
test "$code" = "404"

docker rm -f "$WEB_NAME" >/dev/null

# --- Cert without key: container must fail to start ---
TLS_BAD=$(mktemp -d)
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$TLS_BAD/discard.key" -out "$TLS_BAD/tls.crt" \
  -days 1 -subj "/CN=lk.example.test" >/dev/null 2>&1
rm -f "$TLS_BAD/discard.key"
chmod 644 "$TLS_BAD/tls.crt"

docker run -d --name "$WEB_NAME" --network "$NET" \
  -v "$TLS_BAD:/etc/nginx/tls:ro" \
  -e API_UPSTREAM="http://${STUB_NAME}:8080" \
  -e PUBLIC_ORIGIN="https://lk.example.test" \
  "$IMAGE" >/dev/null
missing_key_ok=0
for _ in $(seq 1 20); do
  running=$(docker inspect -f '{{.State.Running}}' "$WEB_NAME" 2>/dev/null || echo false)
  if [ "$running" != "true" ]; then missing_key_ok=1; break; fi
  sleep 0.5
done
docker logs "$WEB_NAME" > /tmp/patient-web-tls-missing-key.log 2>&1 || true
docker rm -f "$WEB_NAME" >/dev/null 2>&1 || true
if [ "$missing_key_ok" -ne 1 ]; then
  echo "expected container to fail when cert exists without key (still running)" >&2
  cat /tmp/patient-web-tls-missing-key.log >&2
  exit 1
fi
if ! grep -qiE 'key missing|TLS key' /tmp/patient-web-tls-missing-key.log; then
  echo "expected clear error about missing key, got:" >&2
  cat /tmp/patient-web-tls-missing-key.log >&2
  exit 1
fi
rm -rf "$TLS_BAD"
TLS_BAD=

# --- HTTPS with self-signed cert for lk.example.test ---
TLS_DIR=$(mktemp -d)
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$TLS_DIR/tls.key" -out "$TLS_DIR/tls.crt" \
  -days 1 -subj "/CN=lk.example.test" >/dev/null 2>&1
# nginx uid/gid 101 in nginxinc/nginx-unprivileged
chown 101:101 "$TLS_DIR/tls.crt" "$TLS_DIR/tls.key"
chmod 644 "$TLS_DIR/tls.crt"
chmod 600 "$TLS_DIR/tls.key"

docker run -d --name "$WEB_NAME" --network "$NET" \
  -p "${WEB_PORT}:8080" -p "${WEB_TLS_PORT}:8443" \
  -v "$TLS_DIR:/etc/nginx/tls:ro" \
  -e API_UPSTREAM="http://${STUB_NAME}:8080" \
  -e CLINIC_PHONE="+7 900 000-00-00" \
  -e PUBLIC_ORIGIN="https://lk.example.test" \
  "$IMAGE"

wait_healthz "$WEB_PORT"

# HTTP: healthz 200; everything else 301 to PUBLIC_ORIGIN
curl -fsS "http://127.0.0.1:${WEB_PORT}/healthz" | grep -q ok
redir=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "http://127.0.0.1:${WEB_PORT}/some/path")
echo "$redir" | grep -q '^301 '
echo "$redir" | grep -F 'https://lk.example.test/some/path'

# HTTPS: page, security headers + HSTS
hdrs=$(curl -ksI "https://127.0.0.1:${WEB_TLS_PORT}/")
echo "$hdrs" | grep -qi 'strict-transport-security: max-age=300'
echo "$hdrs" | grep -qi 'x-content-type-options: nosniff'
echo "$hdrs" | grep -qi 'content-security-policy:'
page=$(curl -ksS "https://127.0.0.1:${WEB_TLS_PORT}/")
echo "$page" | grep -qi '<html'

# HTTPS proxies /api/auth/ and /api/me/ with original Host
hits_before_tls=$(curl -fsS "http://127.0.0.1:${STUB_PORT}/__hits" | sed -n 's/.*"hits"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p')
resp_tls=$(curl -ksS \
  -H "X-LK-Client: web" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{}' \
  "https://127.0.0.1:${WEB_TLS_PORT}/api/auth/otp/request")
echo "$resp_tls"
echo "$resp_tls" | grep -Eq "\"host\"[[:space:]]*:[[:space:]]*\"127\\.0\\.0\\.1:${WEB_TLS_PORT}\""
curl -ksS -H "Authorization: Bearer test" "https://127.0.0.1:${WEB_TLS_PORT}/api/me/profile" >/dev/null
hits_after_tls=$(curl -fsS "http://127.0.0.1:${STUB_PORT}/__hits" | sed -n 's/.*"hits"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p')
tls_allowed=$((hits_after_tls - hits_before_tls))
if [ "$tls_allowed" -lt 2 ]; then
  echo "expected HTTPS /api/auth and /api/me to hit stub, got $tls_allowed new hits" >&2
  exit 1
fi

docker rm -f "$WEB_NAME" >/dev/null

# --- Key owned by root:root mode 600: clear permission failure ---
chown root:root "$TLS_DIR/tls.key"
chmod 600 "$TLS_DIR/tls.key"
docker run -d --name "$WEB_NAME" --network "$NET" \
  -v "$TLS_DIR:/etc/nginx/tls:ro" \
  -e API_UPSTREAM="http://${STUB_NAME}:8080" \
  -e PUBLIC_ORIGIN="https://lk.example.test" \
  "$IMAGE" >/dev/null
perms_ok=0
for _ in $(seq 1 20); do
  running=$(docker inspect -f '{{.State.Running}}' "$WEB_NAME" 2>/dev/null || echo false)
  if [ "$running" != "true" ]; then perms_ok=1; break; fi
  sleep 0.5
done
docker logs "$WEB_NAME" > /tmp/patient-web-tls-perms.log 2>&1 || true
docker rm -f "$WEB_NAME" >/dev/null 2>&1 || true
if [ "$perms_ok" -ne 1 ]; then
  echo "expected container to fail when TLS key is root:root mode 600 (still running)" >&2
  cat /tmp/patient-web-tls-perms.log >&2
  exit 1
fi
if ! grep -qiE 'not readable|permission|uid 101' /tmp/patient-web-tls-perms.log; then
  echo "expected clear permission error for TLS key, got:" >&2
  cat /tmp/patient-web-tls-perms.log >&2
  exit 1
fi

# Restore readable key ownership for cleanup clarity
chown 101:101 "$TLS_DIR/tls.key" 2>/dev/null || true

echo "nginx-image-test OK"
