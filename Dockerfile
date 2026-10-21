# FA Management System as a container (any cloud: Azure App Service / Container Apps,
# AWS ECS / App Runner, DigitalOcean App Platform, Kubernetes ...).
# The image holds no settings: pass them as environment variables (see server/.env.example).
#   docker build -t fa-management:1.1.0 .
#   docker run -p 3100:3100 --env-file production.env fa-management:1.1.0

# 1. build the screens
FROM node:22-alpine AS screens
WORKDIR /src/client
COPY client/package*.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
ENV GENERATE_SOURCEMAP=false
RUN npm run build

# 2. the application
FROM node:22-alpine
# pg_dump for backups taken by the app (Year-End Archive)
RUN apk add --no-cache postgresql16-client tzdata
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server/ ./
COPY database/ /app/database/
COPY version.json RELEASE_NOTES.md /app/
COPY --from=screens /src/client/build /app/client/build
ENV NODE_ENV=production PORT=3100 CLIENT_BUILD_DIR=/app/client/build BACKUP_DIR=/app/backups PG_DUMP_PATH=/usr/bin/pg_dump
RUN mkdir -p /app/backups uploads && chown -R node:node /app
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3100/api/health || exit 1
# apply database changes (add-only), then start
CMD ["sh", "-c", "node scripts/migrate.js && node server.js"]
