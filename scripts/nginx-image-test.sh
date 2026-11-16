#!/usr/bin/env bash
# Verifies the patient-web image: Host with port, X-Forwarded-For replaced,
# only /api/auth/ and /api/me/ proxied, /dashboard blocked, /healthz and runtime-config.
set -euo pipefail

IMAGE=${IMAGE:-patient-web:test}
STUB_PORT=${STUB_PORT:-18091}
WEB_PORT=${WEB_PORT:-18083}
STUB_NAME=patient-web-stub-$$
WEB_NAME=patient-web-under-test-$$
NET=patient-web-test-$$
ROOT=$(cd "$(dirname "$0")/.." && pwd)

cleanup() {
  docker rm -f "$WEB_NAME" "$STUB_NAME" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$NET" >/dev/null

docker run -d --name "$STUB_NAME" --network "$NET" -p "${STUB_PORT}:8080" \
  -v "$ROOT/scripts/nginx-probe-stub.py:/app/stub.py:ro" \
  python:3.12-alpine python /app/stub.py

for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${STUB_PORT}/__hits" >/dev/null 2>&1; then break; fi
  sleep 0.5
done

docker run -d --name "$WEB_NAME" --network "$NET" -p "${WEB_PORT}:8080" \
  -e API_UPSTREAM="http://${STUB_NAME}:8080" \
  -e CLINIC_PHONE="+7 900 000-00-00" \
  "$IMAGE"

for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${WEB_PORT}/healthz" 2>/dev/null | grep -q ok; then break; fi
  sleep 0.5
done

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

echo "nginx-image-test OK"
