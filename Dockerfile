# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile --filter @auththread/server...
RUN pnpm --filter @auththread/server bundle

FROM node:24-alpine AS runtime
LABEL org.opencontainers.image.title="auththread" \
      org.opencontainers.image.description="Auth journey stitching server" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/ben-pick/auththread"
RUN addgroup -g 10001 -S auththread && adduser -u 10001 -S auththread -G auththread
RUN mkdir -p /var/lib/auththread && chown -R auththread:auththread /var/lib/auththread
WORKDIR /app
COPY --from=build /app/apps/server/dist/server.mjs ./server.mjs
COPY LICENSE ./LICENSE
USER auththread
ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=2s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
CMD ["node", "server.mjs"]
