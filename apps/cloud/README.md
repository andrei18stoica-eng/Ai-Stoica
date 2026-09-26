# AI Stoica Cloud — rulare 24/7

Acest director mută partea care trebuie să funcționeze permanent de pe PC pe un server:

- AI Stoica Gateway
- conturile și conversațiile
- memoria
- biblioteca locală a Gateway-ului
- pluginurile
- automatizările
- OmniRoute
- Redis pentru OmniRoute
- HTTPS prin Caddy

## Arhitectură

Windows / telefon → HTTPS → AI Stoica Gateway → OmniRoute → modele

OmniRoute nu este expus public. Porturile 20128 și 8787 sunt publicate doar pe loopback-ul serverului; Caddy este singurul serviciu public pe 80/443.

## Server Ubuntu

1. Clonează repository-ul.
2. Rulează `sudo bash apps/cloud/install-ubuntu.sh`.
3. Intră în `apps/cloud`.
4. Copiază `.env.example` în `.env`.
5. Setează `AI_STOICA_DOMAIN` la un hostname care indică spre IP-ul serverului.
6. Setează un `OMNIROUTE_WS_BRIDGE_SECRET` lung și aleator.
7. Rulează:
   `docker compose up -d --build`

## Configurarea OmniRoute

Dashboard-ul OmniRoute rămâne privat. De pe calculator deschide un tunel SSH către server:

`ssh -L 20128:127.0.0.1:20128 root@IP_SERVER`

Apoi deschide local `http://127.0.0.1:20128`, conectează furnizorii și configurează modelele/combos.

Dacă endpoint-ul OmniRoute cere cheie API, setează cheia în `OMNIROUTE_API_KEY` din `.env` și repornește:
`docker compose up -d`

## Desktop

În AI Stoica → Setări → AI & OmniRoute, câmpul **Gateway AI Stoica** poate fi schimbat din
`http://127.0.0.1:8787`
în
`https://domeniul-tău`.

După această schimbare, desktop-ul folosește Gateway-ul permanent.

## Persistență

Volumele Docker păstrează datele după restart:
- `ai-stoica-data`
- `omniroute-data`
- `omniroute-redis-data`
- `caddy-data`

Containerele au `restart: unless-stopped`, deci serviciile revin automat după reboot-ul serverului.

## Important

Nu publica direct portul OmniRoute 20128 și nu publica Redis 6379 pe internet.
Păstrează secretele numai în fișierul `.env` de pe server; nu le comite în GitHub.
