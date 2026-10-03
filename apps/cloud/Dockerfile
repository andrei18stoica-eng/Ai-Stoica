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

RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=15s --timeout=5s --retries=10 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.cjs"]
