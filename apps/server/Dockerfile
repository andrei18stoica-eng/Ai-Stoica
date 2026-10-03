FROM node:22-bookworm-slim

WORKDIR /app
COPY apps/server/package.json ./package.json
RUN npm install --omit=dev

COPY apps/server/server.cjs ./server.cjs
COPY apps/server/ai-policy.cjs ./ai-policy.cjs
COPY apps/server/migrations ./migrations

ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0

USER node
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=5s --retries=10 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.cjs"]
