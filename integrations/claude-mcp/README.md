# AI Stoica MCP bridge (all OmniRoute models)

Small remote Streamable HTTP MCP server, hosted as an **independent Docker container** beside AI Stoica. It never reads or changes the Web site's Owner settings.

## Tools
- list_ai_stoica_models: enumerate the **live** /v1/models catalogue, showing likely chat models and other categories.
- ask_ai_stoica: route one standalone text prompt to a chosen currently-listed chat model through /v1/chat/completions.

All providers in the OmniRoute catalogue are discoverable, including any added later. Model listing **does not guarantee** a valid provider login, a usable chat completion or a free service. Non-chat models (embedding, TTS, image, video, etc.) need other MCP tools. Paid models may incur usage charges.

## Authentication and security
- Store a dedicated OmniRoute API key in /etc/ai-stoica/mcp.env on Hetzner; never paste it in chat or GitHub.
- Generate an **independent**, random MCP_CLIENT_TOKEN with openssl rand -hex 32. Claude sends **Authorization: Bearer <MCP_CLIENT_TOKEN>** to the public /mcp endpoint.
- Never expose Docker's port 3010 or OmniRoute's 20128 publicly; Caddy serves MCP over HTTPS on port 443.
- Input size, token output, rate limiting and live model validation are enabled by default.
- This token grants access to *all allowed models*, potentially including paid ones. Configure MCP_EXCLUDED_MODELS to deny expensive models if necessary.
- If a key was pasted in a chat, revoke/rotate it before production use.

## Production setup
1. Review this PR and verify CI. Merge to main only after approval; use the established AI Stoica deploy procedure to update the server.
2. Add DNS A for mcp.aistoica.ro pointing to the Hetzner VPS.
3. Set up the private env file once on the Hetzner **host**:

       install -d -m 700 /etc/ai-stoica
       umask 077
       read -r -s -p 'Dedicated OmniRoute MCP key: ' MCP_KEY; echo
       printf 'OMNIROUTE_API_KEY=%s\n' "$MCP_KEY" > /etc/ai-stoica/mcp.env
       unset MCP_KEY
       printf 'MCP_CLIENT_TOKEN=%s\n' "$(openssl rand -hex 32)" >> /etc/ai-stoica/mcp.env
       printf 'MCP_EXCLUDED_MODELS=\n' >> /etc/ai-stoica/mcp.env
       chmod 600 /etc/ai-stoica/mcp.env

4. From /opt/ai-stoica/deploy/hetzner:

       docker compose -f docker-compose.yml -f claude-mcp.override.yml up -d --build --no-deps ai-stoica-mcp
       docker compose -f docker-compose.yml -f claude-mcp.override.yml ps ai-stoica-mcp
       docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile
       docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile

5. Verify HTTPS and authentication without exposing tokens:

       curl -sS -o /dev/null -w 'health HTTP %{http_code}\n' https://mcp.aistoica.ro/healthz
       curl -sS -o /dev/null -w 'without token HTTP %{http_code}\n' -X POST https://mcp.aistoica.ro/mcp

   Expected 200 on /healthz and 401 on unauthenticated /mcp.

6. On claude.ai, navigate Customize > Connectors > Add > Custom > Web. URL: https://mcp.aistoica.ro/mcp. Set Request headers > Authorization to Bearer <MCP_CLIENT_TOKEN>. **Use only the independent MCP token here, never the OmniRoute key.**

Claude Code Web sessions can vary in which account-level connectors are enabled; test from the specific Claude Code environment rather than assuming a connector enabled in normal Claude Chat automatically works there. Routing an external model's answer through MCP does not eliminate the Claude session's own token usage.
