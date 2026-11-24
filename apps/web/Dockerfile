# Build context is the repo root (the web app imports the domain and stats packages).
FROM node:24-alpine AS build
WORKDIR /app
COPY . .
# Optional: if certs/extra-ca.pem exists (a proxy root CA), npm trusts it for this step. Otherwise no effect.
RUN if [ -f certs/extra-ca.pem ]; then export NODE_EXTRA_CA_CERTS=/app/certs/extra-ca.pem; fi \
 && npm ci \
 && npm run build -w @agent-evals/web

# Static files from nginx. /api/ goes to the API service, with the prefix removed (see nginx.conf).
FROM nginx:alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
