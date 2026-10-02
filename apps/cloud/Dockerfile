FROM node:22-bookworm-slim

WORKDIR /app

COPY apps/cloud/package.json ./package.json
RUN npm install --omit=dev --legacy-peer-deps

COPY apps/desktop/local-gateway.cjs ./local-gateway.cjs
COPY apps/desktop/lib ./lib
COPY apps/cloud/server.cjs ./server.cjs

ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0
ENV DATA_DIR=/data

EXPOSE 8787
VOLUME ["/data"]

CMD ["node", "server.cjs"]
