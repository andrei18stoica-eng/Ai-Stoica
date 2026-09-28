# AI Stoica — Hetzner Production

Production foundation for Ubuntu 26.04 LTS + Docker.

## Default stack

- PostgreSQL 17
- AI Stoica Server
- Caddy is optional until a real domain is configured
- API is bound to 127.0.0.1:8787 and is not directly exposed to the internet

## First start

From the repository root:

```bash
cd deploy/hetzner
cp .env.example .env
```

Set a strong random `POSTGRES_PASSWORD` in `.env`. Do not commit `.env`.

Start the private stack:

```bash
docker compose up -d --build postgres api
docker compose ps
curl http://127.0.0.1:8787/health
```

## Owner

`OWNER_EMAIL` is promoted to `owner + active`.
All other new accounts are created as `user + pending`.

## AI policy

The database starts with paid AI disabled.
Catalog entries include free providers (Cerebras, Gemini, Groq, Cloudflare AI, OpenRouter) and optional paid combinations including GPT + Claude.
Paid combinations remain unavailable until the Owner explicitly enables paid AI.

## HTTPS

After DNS is configured:

```bash
docker compose --profile edge up -d
```

Caddy terminates HTTPS and proxies to the private API.

## Security

Do not expose PostgreSQL port 5432.
Do not expose API port 8787 directly.
Secrets stay only in `.env` on the server.
