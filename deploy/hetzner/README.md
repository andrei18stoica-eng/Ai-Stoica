# AI Stoica — Hetzner Production

Production foundation for Ubuntu 26.04 LTS + Docker. This is the "AI Stoica Cloud" API used by the desktop app in cloud mode (accounts, approval, permissions, AI policy, notifications, audit).

## Default stack

- PostgreSQL 17
- AI Stoica Server
- Caddy is optional until a real domain is configured
- API is bound to 127.0.0.1:8787 and is not directly exposed to the internet

## First start

Clone the repository to `/opt/ai-stoica` (the path `update.sh` expects):

```bash
sudo git clone https://github.com/andrei18stoica-eng/Ai-Stoica.git /opt/ai-stoica
cd /opt/ai-stoica/deploy/hetzner
cp .env.example .env
```

Set a strong random `POSTGRES_PASSWORD` in `.env` (for example the output of `openssl rand -hex 32`). Any character works except `$`, which Docker Compose would interpret. The API receives the database credentials as separate `PG*` variables, so no URL encoding is needed. Do not commit `.env`.

Start the private stack:

```bash
docker compose up -d --build postgres api
docker compose ps
curl http://127.0.0.1:8787/health
```

Database migrations (`apps/server/migrations/*.sql`) run automatically at start-up, once each, and are recorded in the `schema_migrations` table.

## Updates

```bash
sudo bash /opt/ai-stoica/deploy/hetzner/update.sh
```

The script refuses to run when the checkout has local changes, pulls `main`, rebuilds the API and waits for `/health`.

## Owner

`OWNER_EMAIL` is promoted to `owner + active`. If you change `OWNER_EMAIL`, the previous Owner account becomes a normal account at the next start and can be blocked.
All other new accounts are created as `user + pending`.

Recommended: set `OWNER_INITIAL_PASSWORD` (8+ characters, ideally 16+ random) in `.env`. On first start the server creates
the Owner account itself and the public registration form refuses the Owner e-mail, so nobody else can
claim it. You can remove the variable after the first start.

## Limits

- Failed sign-ins: `AUTH_ATTEMPTS_PER_15_MIN` per IP (default 20).
- New accounts (access requests): `REGISTRATIONS_PER_HOUR` per IP (default 10), successful ones included.
- Other requests: `RATE_LIMIT_PER_MINUTE` per IP (default 120); session checks (`/auth/me`) have their own `AUTH_ME_PER_MINUTE` (default 600).
- Passwords: at least 8 characters for every account.
- `TRUST_PROXY_HOPS`: number of reverse proxies in front of the API (1 = Caddy, 2 = Cloudflare proxy + Caddy). It decides which client IP the limits and the audit log see.

Login notifications are sent at most once per hour per account; notifications older than 90 days (or beyond the newest 500 per account) are deleted automatically.

## AI policy

The database starts with paid AI disabled.
Free providers: Cerebras, Gemini, Groq, Cloudflare AI. Paid providers: OpenAI, Anthropic and OpenRouter (OpenRouter can bill per request, so it is off for normal accounts until the Owner allows it).
Paid combinations, including GPT + Claude, remain unavailable until the Owner explicitly enables paid AI.

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
The API container runs as the unprivileged `node` user.

## Web: aistoica.ro and the free phone app (PWA)

The `web` service (profile `web`) runs the AI Stoica service with the web interface (image `apps/cloud`, which also builds the React interface). Its accounts, approval and permissions come from the `api` service, so they are the same accounts as the Windows app in cloud mode. Caddy serves it at `AI_STOICA_WEB_DOMAIN` with HTTPS.

**Guided setup (0.7.15):** after the DNS record below, `sudo bash /opt/ai-stoica/deploy/hetzner/setup-web.sh` does steps 2–3 and the OmniRoute part: it backs `.env` up, checks DNS and memory (offers a 2 GB swap file on small servers), turns on `edge,web`, generates the OmniRoute secrets, takes the keys pasted from the Windows app (Settings → API-uri AI → "Copiază cheile pentru server"), starts OmniRoute, explains the database import, checks the OmniRoute key, builds the site and checks `/health` and HTTPS. Running it again keeps every value.

1. DNS: an **A** record for `aistoica.ro` pointing to this server (the same IP as `api.aistoica.ro`).
2. In `.env`: `AI_STOICA_WEB_DOMAIN=aistoica.ro`, `COMPOSE_PROFILES=edge,web`, a random `OMNIROUTE_WS_BRIDGE_SECRET` (`openssl rand -hex 32`) and the same AI keys as in the Windows app (Settings → API-uri AI): the web version then lists the same models. Free: Cerebras, Groq, Gemini, Mistral, NVIDIA, GitHub Models (`AI_STOICA_GITHUB_TOKEN`), Cloudflare, Cohere, Hugging Face (`HF_TOKEN`); images and video: Pollinations, fal, Replicate, Together, Stability.
3. Start it:

```bash
docker compose up -d --build web caddy
curl http://127.0.0.1:8788/health
```

The `web` profile also starts OmniRoute (and its Redis), so the OmniRoute combinations ("Ai principal" and the others) are on the web too. Its dashboard stays private: from your PC run `ssh -L 20129:127.0.0.1:20128 root@SERVER_IP`, open `http://127.0.0.1:20129` and sign in with `OMNIROUTE_INITIAL_PASSWORD`.

- **Same providers and combinations as on the PC:** on the PC's OmniRoute, Settings → System & Storage → **Export Database** (`.sqlite`); on the server's dashboard, **Import Database**. Tested with OmniRoute 3.8.51: combinations, OmniRoute API keys and the admin password move over. If a provider reports an error afterwards, enter its key again in OmniRoute.
- **Client API key (required):** the OmniRoute image answers `401` on `/v1/*` without one. After the import the PC's key works; otherwise create one in **API Manager**. Put it in `OMNIROUTE_API_KEY` and run `docker compose up -d web`.
- To list paid models too, turn off "Hide paid models" in OmniRoute's Settings.

The web service is bound to `127.0.0.1:8788` only; Caddy is the public entry point. Its data (conversations, Library, memory) is in the `web-data` volume. `update.sh` rebuilds it whenever the `web` profile is active.

On phones the site installs as an app for free: Safari → Share → "Add to Home Screen" on iPhone, Chrome → "Install app" on Android.
