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

Windows → HTTPS → AI Stoica Gateway → OmniRoute → modele

Aplicația de telefon (iPhone, iPad, Android) folosește Worker-ul Cloudflare din `apps/cloudflare`, nu acest Gateway (vezi `apps/mobile/README.md`).

OmniRoute nu este expus public. Porturile 20128 și 8787 sunt publicate doar pe loopback-ul serverului; Caddy este singurul serviciu public pe 80/443.

## Server Ubuntu

1. Clonează repository-ul.
2. Rulează `sudo bash apps/cloud/install-ubuntu.sh`.
3. Intră în `apps/cloud`.
4. Copiază `.env.example` în `.env`.
5. Setează `AI_STOICA_DOMAIN` la un hostname care indică spre IP-ul serverului.
6. Setează `AI_STOICA_OWNER_EMAIL` la e-mailul tău: contul cu acest e-mail este Owner (GitHub Solve, rulare de cod, test server).
7. Setează un `OMNIROUTE_WS_BRIDGE_SECRET` lung și aleator (`openssl rand -hex 32`).
8. Rulează `bash deploy-oracle.sh` (sau `docker compose up -d --build`).

Creează imediat după pornire contul tău (cu e-mailul Owner): cât timp `AI_STOICA_OPEN_REGISTRATION=false`, după primul cont nu se mai pot crea altele.

## Model implicit

`AI_STOICA_DEFAULT_MODEL` este modelul folosit când aplicația nu trimite unul. Pune un id exact din OmniRoute (de exemplu `groq/openai/gpt-oss-120b`) sau lasă-l gol ca Gateway-ul să aleagă. Gol înseamnă prima ta combinație OmniRoute (de exemplu „Ai principal”); numele „Ai principal” / „AI Stoica” scrise aici sunt ignorate, cu același efect.

## Configurarea OmniRoute

Dashboard-ul OmniRoute rămâne privat. De pe calculator deschide un tunel SSH către server (pe Oracle utilizatorul implicit este `ubuntu`):

`ssh -L 20129:127.0.0.1:20128 ubuntu@IP_SERVER`

Apoi deschide local `http://127.0.0.1:20129` (20129, ca să nu se bată cu un OmniRoute pornit pe PC la 20128), conectează furnizorii și configurează modelele/combos.

Imaginea Docker OmniRoute 3.8 cere cheie API de client (`REQUIRE_API_KEY=true`): fără ea răspunde 401 și AI Stoica arată „OmniRoute cere cheie API”. Creeaz-o în panou → **API Manager** → **Create API Key** (parola panoului: `OMNIROUTE_INITIAL_PASSWORD`), pune-o în `OMNIROUTE_API_KEY` din `.env` și repornește:
`docker compose up -d`

Pentru o versiune fixă OmniRoute setează `OMNIROUTE_VERSION` (de exemplu `3.8.51`); `latest` urmează automat ultima versiune stabilă publicată.

## Desktop

În AI Stoica → Setări → AI & OmniRoute, câmpul **Gateway AI Stoica** poate fi schimbat din
`http://127.0.0.1:8787`
în
`https://domeniul-tău`.

După această schimbare, desktop-ul folosește Gateway-ul permanent.

Opțional, `AI_STOICA_CLOUD_API_URL` leagă Gateway-ul de serverul Hetzner (`deploy/hetzner`) pentru conturi aprobate de Owner și permisiuni pe cont.

## Persistență

Volumele Docker păstrează datele după restart:
- `ai-stoica-data`
- `omniroute-data`
- `omniroute-redis-data`
- `caddy-data`

Gateway-ul rulează ca utilizatorul neprivilegiat `node`; serviciul `data-permissions` îi dă volumul `ai-stoica-data` la fiecare pornire (necesar o singură dată pentru volumele create de versiunile care rulau ca root).

Containerele au `restart: unless-stopped`, deci serviciile revin automat după reboot-ul serverului.

## Important

Nu publica direct portul OmniRoute 20128 și nu publica Redis 6379 pe internet.
Păstrează secretele numai în fișierul `.env` de pe server; nu le comite în GitHub.

## Oracle Cloud

Pentru instalarea 24/7 pe Oracle Cloud, inclusiv varianta Always Free și HTTPS fără domeniu plătit, urmează [ORACLE_SETUP.md](./ORACLE_SETUP.md).
