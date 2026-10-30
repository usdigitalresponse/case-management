# Production image (docker-compose.prod.yml). Local development uses the
# bind-mounted dev server in docker-compose.yml instead.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# migrate.js resolves ./migrations relative to the working directory.
COPY migrations ./migrations
# Owned by node, so the documents volume mounted here is writable.
RUN mkdir -p /var/lib/case-management/documents && chown node:node /var/lib/case-management/documents
USER node
EXPOSE 3000
# Migrations are idempotent, so every start applies any new ones; seeding
# stays an explicit, destructive step (see README "Deploy").
CMD ["sh", "-c", "node dist/src/db/migrate.js && exec node dist/src/app.js"]
