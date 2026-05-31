FROM oven/bun:1.3.13-slim AS build
WORKDIR /app

COPY package.json tsconfig.json tsconfig.base.json ./
COPY agent/api/package.json agent/api/package.json
COPY agent/web/package.json agent/web/package.json
COPY agent/electrobun/package.json agent/electrobun/package.json
COPY bun.lock ./
RUN bun install --frozen-lockfile

COPY agent/api agent/api
COPY agent/web agent/web
COPY agent/electrobun agent/electrobun
COPY agent/drizzle agent/drizzle
COPY agent/drizzle.config.ts agent/drizzle.config.ts
COPY scripts/worker.js scripts/worker.js
COPY scripts/esa.edge.js scripts/esa.edge.js
COPY scripts/encrypt-url.js scripts/encrypt-url.js
RUN bun run build:agent-web

FROM oven/bun:1.3.13-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
  LC_AGENT_NODE_ENV=production \
  LC_AGENT_PORT=3100 \
  LC_AGENT_WEB_DIST_DIR=/app/agent/web/dist \
  LC_AGENT_MIGRATIONS_DIR=/app/agent/drizzle \
  LC_AGENT_DATABASE_URL=/data/agent.sqlite

COPY --from=build /app/package.json /app/tsconfig.json /app/tsconfig.base.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/agent/api agent/api
COPY --from=build /app/agent/web/dist agent/web/dist
COPY --from=build /app/agent/drizzle agent/drizzle
COPY --from=build /app/agent/drizzle.config.ts agent/drizzle.config.ts

RUN mkdir -p /data

EXPOSE 3100
CMD ["bun", "run", "agent/api/src/index.ts"]
