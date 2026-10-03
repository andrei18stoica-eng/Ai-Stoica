# Stage 1: the web interface (the same React app as on Windows), built with Vite.
# --ignore-scripts skips Electron's binary download: only Vite and React are needed here.
FROM node:22-bookworm-slim AS web
WORKDIR /build
COPY apps/desktop/package.json apps/desktop/package-lock.json ./
RUN npm ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund
COPY apps/desktop/vite.config.mjs ./vite.config.mjs
COPY apps/desktop/renderer ./renderer
RUN npx vite build --config vite.config.mjs

# Stage 2: the AI Stoica service, which also serves the web interface and the installable phone app (PWA) at "/".
FROM node:22-bookworm-slim

WORKDIR /app

COPY apps/cloud/package.json ./package.json
RUN npm install --omit=dev --legacy-peer-deps

COPY apps/desktop/local-gateway.cjs ./local-gateway.cjs
COPY apps/desktop/lib ./lib
COPY apps/cloud/server.cjs ./server.cjs
COPY --from=web /build/dist ./web

ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0
ENV DATA_DIR=/data

RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=15s --timeout=5s --retries=10 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.cjs"]
