FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node integrations/claude-mcp/server.mjs ./server.mjs
USER node
ENV PORT=3010 HOST=0.0.0.0
EXPOSE 3010
CMD ["node", "server.mjs"]
