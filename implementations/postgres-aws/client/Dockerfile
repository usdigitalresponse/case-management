# Production image (docker-compose.prod.yml): the built client served by
# Caddy, which also proxies the API and handles HTTPS. Local development
# uses the Vite dev server in docker-compose.yml instead.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
