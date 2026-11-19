#!/bin/sh
# Selects nginx template by TLS file presence; writes clinic phone for the SPA.
# Runs before 20-envsubst-on-templates.sh (name 18-*). Never logs the TLS key.
set -eu

TLS_CRT=/etc/nginx/tls/tls.crt
TLS_KEY=/etc/nginx/tls/tls.key
SRC_HTTP=/etc/nginx/templates-src/http.conf.template
SRC_HTTPS=/etc/nginx/templates-src/https.conf.template
OUT_TEMPLATE=/etc/nginx/templates/default.conf.template

crt_present=0
key_present=0
[ -f "$TLS_CRT" ] && crt_present=1
[ -f "$TLS_KEY" ] && key_present=1

if [ "$crt_present" -eq 1 ] && [ "$key_present" -eq 0 ]; then
  echo "patient-web: TLS cert found at $TLS_CRT but key missing at $TLS_KEY" >&2
  exit 1
fi
if [ "$crt_present" -eq 0 ] && [ "$key_present" -eq 1 ]; then
  echo "patient-web: TLS key found at $TLS_KEY but cert missing at $TLS_CRT" >&2
  exit 1
fi

if [ "$crt_present" -eq 1 ] && [ "$key_present" -eq 1 ]; then
  origin=${PUBLIC_ORIGIN:-}
  if [ -z "$origin" ]; then
    echo "patient-web: PUBLIC_ORIGIN is required when TLS files are mounted (e.g. https://lk.example.test)" >&2
    exit 1
  fi
  # nginx (uid 101) must read the key; root:root mode 600 fails here with a clear message.
  if [ ! -r "$TLS_KEY" ]; then
    echo "patient-web: TLS key at $TLS_KEY is not readable by uid $(id -u) (expect owner 101:101 and mode 600)" >&2
    exit 1
  fi
  if [ ! -r "$TLS_CRT" ]; then
    echo "patient-web: TLS cert at $TLS_CRT is not readable by uid $(id -u)" >&2
    exit 1
  fi
  echo "patient-web: HTTPS enabled (listen 8443 ssl); HTTP 8080 redirects to PUBLIC_ORIGIN except /healthz"
  cp "$SRC_HTTPS" "$OUT_TEMPLATE"
else
  echo "patient-web: HTTPS disabled (no TLS files); HTTP only on 8080"
  cp "$SRC_HTTP" "$OUT_TEMPLATE"
fi

phone=${CLINIC_PHONE:-}
# Escape for JSON string.
escaped=$(printf '%s' "$phone" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf '{"clinic_phone":"%s"}\n' "$escaped" > /usr/share/nginx/html/runtime-config.json
