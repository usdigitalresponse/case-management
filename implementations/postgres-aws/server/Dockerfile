# Production image (docker-compose.prod.yml). Local development uses the
# bind-mounted dev server in docker-compose.yml instead.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# migrate.js resolves ./migrations relative to the working directory.
COPY migrations ./migrations
USER node
EXPOSE 3000
# Migrations are idempotent, so every start applies any new ones; seeding
# stays an explicit, destructive step (see README "Deploy").
CMD ["sh", "-c", "node dist/src/db/migrate.js && exec node dist/src/app.js"]
