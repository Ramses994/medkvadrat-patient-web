#!/bin/sh
# Writes clinic phone for the SPA without inline scripts (CSP stays strict).
set -eu
phone=${CLINIC_PHONE:-}
# Escape for JSON string.
escaped=$(printf '%s' "$phone" | sed 's/\\/\\\\/g; s/"/\\"/g')
printf '{"clinic_phone":"%s"}\n' "$escaped" > /usr/share/nginx/html/runtime-config.json
