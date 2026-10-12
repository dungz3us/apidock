# Build context: repository root.
#   docker build -f docker/Dockerfile -t apidock .
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/apidock ./packages/apidock
COPY packages/ui ./packages/ui
RUN pnpm install --frozen-lockfile --filter apidock... --filter @apidock/ui
RUN pnpm --filter @apidock/ui build && pnpm --filter apidock build && pnpm --filter apidock deploy --prod /out
# express is an optional peer — ensure the standalone server has it
RUN cd /out && (node -e "require('express')" 2>/dev/null || pnpm add express@5.2.1)

FROM node:24-alpine
ENV NODE_ENV=production \
    APIDOCK_DATA_DIR=/data
WORKDIR /app
COPY --from=build /out ./
RUN addgroup -S apidock && adduser -S apidock -G apidock && mkdir -p /data && chown apidock:apidock /data
USER apidock
VOLUME /data
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:4000/healthz >/dev/null 2>&1 || exit 1
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["serve", "--spec", "/data/openapi.yaml", "--port", "4000"]
