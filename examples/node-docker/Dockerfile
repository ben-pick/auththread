FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY examples ./examples
RUN pnpm install --frozen-lockfile

FROM node:24-alpine
WORKDIR /app
RUN corepack enable
COPY --from=build /app ./
ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=2s CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
CMD ["node", "examples/node-docker/src/main.ts"]
