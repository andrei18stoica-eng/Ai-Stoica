FROM node:22-bookworm-slim

WORKDIR /app
COPY apps/server/package.json ./package.json
RUN npm install --omit=dev

COPY apps/server/server.cjs ./server.cjs
COPY apps/server/migrations ./migrations

ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0

EXPOSE 8787
CMD ["node", "server.cjs"]
