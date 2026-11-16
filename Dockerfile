# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html ./
COPY public ./public
COPY src ./src
COPY tsconfig.json tsconfig.node.json vite.config.ts ./
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
USER root
RUN apk add --no-cache wget
COPY nginx/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker-entrypoint.sh /docker-entrypoint.d/40-patient-web.sh
RUN chmod +x /docker-entrypoint.d/40-patient-web.sh
COPY --from=build /app/dist /usr/share/nginx/html
# Placeholder overwritten at container start from CLINIC_PHONE.
RUN printf '%s\n' '{"clinic_phone":""}' > /usr/share/nginx/html/runtime-config.json \
  && chown -R nginx:nginx /usr/share/nginx/html
USER nginx
ENV API_UPSTREAM=http://127.0.0.1:8080 \
    CLINIC_PHONE= \
    NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx/conf.d
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
