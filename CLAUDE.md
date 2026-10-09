# AI Stoica — ghid pentru Claude Code

Claude Code citește acest fișier automat. El conține tot ce trebuie ca o sesiune nouă să lucreze pe proiect fără alt context.

- Imaginea completă a proiectului: `docs/PROIECT_AI_STOICA.md`
- Procedura de publicare a unei versiuni: `docs/PUBLICARE_RELEASE.md`
- Verificări locale: `bash scripts/verifica-local.sh [--install]`

## Ce este

AI Stoica (Stoica Enterprises AI) este o platformă AI proprie, multi-model: chat, proiecte, asistenți, memorie, bibliotecă de fișiere, pluginuri, automatizări, generare de imagini și video, export de documente, conturi cu roluri Owner / User. Clienți: Windows (Electron), web la aistoica.ro (aceeași interfață, servită de `apps/cloud`), aplicație instalabilă gratuită pe iPhone/Android (PWA, din 0.7.14) și aplicația Expo (`apps/mobile`, prin Cloudflare).

GitHub (`andrei18stoica-eng/Ai-Stoica`, **public** din 2026-10, deci fără secrete în cod; actualizarea automată Windows citește Releases fără token) este atelierul: cod, versiuni, teste, build, Releases. Producția rulează pe serverul Hetzner. Aplicația nu depinde de GitHub la fiecare mesaj.

Versiune curentă: **0.7.16** (pe `main` din PR #35, merge `ffbebbd`). 0.7.12 și 0.7.13 au fost făcute în cowork.

## Structura

| Cale | Rol |
|---|---|
| `apps/desktop` | aplicația Windows: Electron (`main.cjs`), serviciul local Express (`local-gateway.cjs`), `lib/` (store, memorie, extragere text, documente, programări, netguard), interfața React + Vite (`renderer/`), testele `scripts/test-*.cjs` |
| `apps/server` | „AI Stoica Cloud” pe Hetzner: Node + PostgreSQL, conturi, aprobare, permisiuni, politică AI, notificări, audit (`migrations/`) |
| `apps/cloud` | server propriu în Docker: același `local-gateway.cjs` ca pe Windows, cu Caddy pentru HTTPS (Dockerfile copiază `apps/desktop/lib`) |
| `apps/cloudflare` | Worker + D1 + R2 pentru aplicația de telefon |
| `apps/mobile` | aplicația Expo (iPhone / Android) |
| `deploy/hetzner` | `docker-compose.yml` (PostgreSQL + API, Caddy în profilul `edge`, site + OmniRoute în profilul `web`), `update.sh`, `setup-web.sh` (instalarea site-ului dintr-o comandă) |
| `branding/`, `docs/` | logo și documentație |

Folderul `gateway/` (0.4.1) a fost șters în 0.7.11 și nu trebuie să reapară.

## Cum verifici

`bash scripts/verifica-local.sh --install` rulează, în ordine:

1. workflow-urile YAML (chei duplicate);
2. aceeași versiune peste tot;
3. `gateway/` absent;
4. desktop: `node --check`, `npm run build:ui`, toate `scripts/test-*.cjs` (27 de teste);
5. server: `npm test`;
6. Cloudflare: `npm test` și `npm run check`.

Nu rulează local: Mobile (`expo-doctor`, `expo export`), build-ul Windows și Docker. Acestea rămân în GitHub Actions.

## Reguli

- Nu lucrezi direct pe `main`: ramură → PR → verificări → merge. Merge cu merge commit, nu squash.
- Merge doar cu toate verificările verzi. Excepție: Owner-ul cere explicit altfel (de exemplu când Actions e blocat); atunci scrii în PR că verificările n-au rulat.
- Fără force-push pe `main`. Fără secrete în fișiere (chei, tokenuri, `.env`); `.env.example` conține doar placeholdere. Nu modifica secretele repository-ului.
- Un patch sau un ZIP vine cu o bază proprie. Compară cu `git log origin/main` înainte să-l aplici. Dacă baza diferă, nu înlocui arborele `main` și nu aplica orbește (vezi `docs/PUBLICARE_RELEASE.md`).
- Versiunea trebuie să fie identică în: `package.json` (rădăcină), `apps/desktop/package.json`, `apps/desktop/package-lock.json` (două locuri), `apps/mobile/package.json`, `apps/mobile/app.json`. `apps/desktop/scripts/test-audit-fixes.cjs` verifică și el versiunea.
- `test-audit-fixes.cjs` caută șiruri în cod. Când redenumești o funcție, actualizează testul.
- Un fișier nou din `apps/desktop/lib/` ajunge și în imaginea `apps/cloud`; o dependență nouă trebuie adăugată și în `apps/cloud/package.json`.

## Owner pe fiecare backend (mecanisme diferite)

| Backend | Variabile |
|---|---|
| Cloudflare Worker | `OWNER_EMAIL` + `OWNER_SETUP_CODE` (creare și resetare Owner) |
| `apps/server` (Hetzner) | `OWNER_EMAIL` + `OWNER_INITIAL_PASSWORD` (opțional, la prima pornire) |
| `apps/cloud` | `AI_STOICA_OWNER_EMAIL` |
| Windows (local) | Setări → Cont și date → „Email Owner pe acest PC” |

## Capcane cunoscute

- „GitHub verde” nu înseamnă „aplicația merge”: au existat ecrane negre cu CI verde. Verifică și runtime-ul.
- Codul din GitHub nu e codul de pe server: la deploy rulează `deploy/hetzner/update.sh` și verifică `/health`.
- Joburi care pică în câteva secunde, fără pași: citește adnotarea check-run-ului. Pe 2026-10-03 era „spending limit / plată eșuată”. Vezi secțiunea despre facturare din `docs/PUBLICARE_RELEASE.md`.
- `ai-stoica-windows-zip.yml` publică în Release când e pornit manual (`workflow_dispatch`) și la push pe `main`; pe PR doar construiește.
- După fiecare Release compară `sha512` al `.exe` cu cel din `latest.yml` (comenzile sunt în `docs/PUBLICARE_RELEASE.md`). Fără potrivire, actualizarea automată nu funcționează.
- Un workflow cu aceeași cheie de două ori (de exemplu `concurrency:`) e invalid și nu pornește deloc.
- Scripturile de pe server nu scriu în fișiere fixe din `/tmp`: un fișier lăsat acolo de alt utilizator (o rulare ca `aistoica`) nu poate fi suprascris nici de root pe Ubuntu (`fs.protected_regular`). Așa a picat `update.sh` pe 2026-10-05 („line 38: Permission denied”); `test-hetzner-setup.cjs` păzește regula.

## Stare curentă (2026-10-04)

- **0.7.16** (pe `main`, PR #35): modelul ales răspunde, fără trecere ascunsă la API-urile directe (`directFallbackAllowed`, `chosenModelFailure` în `local-gateway.cjs`; „Rezervă automată” = `chatFallbackOnFailure`, pe server `AI_STOICA_CHAT_FALLBACK`); fără model → prima combinație OmniRoute (`defaultOmniModel`); un model `groq/…` etc. care nu e în OmniRoute merge direct la acel API (`isDirectModel`, `directOnly`); automatizările urmează aceeași regulă. Modelele din abonamentele personale ale Owner-ului (`PERSONAL_PROVIDERS`: codex, chatgpt-web, gemini-web, claude-code, gemini-cli…) sunt doar pentru Owner (`personalAllowed`, `requirePersonalAccess`); condițiile furnizorilor interzic partajarea contului, deci un abonament plătit pentru alții se face doar prin API-uri. Poze/Video: ordinea din `mediaSteps` — modelul din Setări, modelul legat per cont (`media-prefs.json`, resetat când se schimbă setările de imagine/video), abonamentul (`subscriptionMedia`: codex, chatgpt-web, gemini-web; video: veoaifree-web), API-urile directe, restul; `byCooldown` pe toată lista. Ecuații: `lib/math.cjs` (temml, MIT → MathML → OMML, inserat în DOCX după build), chat: `renderer/src/mathText.mjs` + `math.jsx` (temml încărcat la nevoie). Vizualizare fișiere: `renderer/src/viewer.jsx`, ruta `GET /api/library/:id/preview`, `frame-src ... blob:`. PDF: `lib/pdftext.cjs` (pdf-lib + ToUnicode), folosit de `extract.cjs` cu decodorul limitat al acestuia (`decodeStream`) și după `pdfLibSafe` (fluxurile ObjStm/XRef verificate întâi), ca un „PDF bomb” să nu umple memoria. Actualizare cu un buton: Owner-ul, pe site (Setări), cere actualizarea; site-ul doar scrie `request` în folderul comun (`AI_STOICA_UPDATE_DIR`, pe server `/var/lib/ai-stoica-update` → `/update` în container), iar serviciul systemd de pe server (`deploy/hetzner/install-updater.sh`, instalat de `update.sh`) rulează `update-runner.sh` → `update.sh` și scrie `status.json` / `available.json`; timer-ul orar instalează singur doar cu fișierul `auto`. Teste: `test-0716-choice-media.cjs`, `test-0716-math.cjs`, `test-0716-server-update.cjs`, `test-0716-providers.cjs`, `test-0716-web-settings.cjs`. Code AI Stoica: `pages/Code.jsx`, `GET /api/code`, `POST /api/code/session` (asistentul „AI Stoica Code”, `codeAssistant`); permisiunea `code` e opt-in (`normalizePermissions`, `apps/server` `code: false`, Owner `true`); Owner-ul vede `cx/` (Codex) și `cc/` (Claude Code) din abonamente, un cont cu `code` doar `openai/` și `anthropic/` prin API; test `test-0716-code.cjs`. Redenumire: `PATCH /api/library/:id` (păstrează extensia, scoate caracterele interzise, schimbă și numele din conversații) și `FileName` în `viewer.jsx` (evenimentul `ai-stoica:file-renamed`). Setări pe web (Owner): `lib/serversettings.cjs` păstrează în `<DATA_DIR>/server-settings.json` (0600) doar ce diferă de `.env` și are prioritate; rutele `GET/PUT /api/server/settings` (doar Owner, doar cu `serverSettings` dat de `apps/cloud/server.cjs`); interfața folosește aceeași fereastră Setări (`WEB_SETTINGS` în `main.jsx`); emailul Owner, înregistrarea și adresele serviciilor rămân în `.env`. Furnizori: „Furnizori folosiți” (`blockedProviders`, implicit `cerebras`; pe server `AI_STOICA_BLOCKED_PROVIDERS`) scoate un furnizor din listă, din rută și din rezervă (`providerFamily`, `modelBlocked`); Grok (xAI, `XAI_API_KEY` / `xaiApiKey`) pentru chat, poze (`grok-imagine-image`) și video (`grok-imagine-video`); poze Gemini (`geminiImageModel`), video OpenAI Sora (`openAiVideoModel`, `sora-2`). Poze/Video „Făcute de” (`imageProviders` / `videoProviders`, implicit `gemini`, gol = toți; pe server `AI_STOICA_IMAGE_PROVIDERS` / `AI_STOICA_VIDEO_PROVIDERS`, trecute de ambele `docker-compose.yml` cu `${VAR-gemini}`): `mediaProviders`, `mediaFamily`, `mediaProviderAllowed` filtrează API-urile directe, modelele OmniRoute și modelul cerut explicit; `mediaOnlyHint` spune ce lipsește (cheia Gemini, costul); Nano Banana: `NANO_BANANA_MODELS`, Veo: `VEO_MODELS` (un nume necunoscut, 404, e sărit); test `test-0716-gemini-media.cjs`. „Testează cheile” (`/api/providers/test`) întreabă și prima combinație plus câte un model Gemini/Grok/OpenAI/Claude din OmniRoute (`omni.checks`), ca un 401 să arate dacă e cheia OmniRoute sau contul furnizorului; `expiredConnections` scoate din răspunsul OmniRoute conturile cu login expirat („[codex] … authentication expired”), afișate într-un rând „Reconectează în OmniRoute” (`omni.expired`) și în eroarea din chat; `noCredit` deosebește „fără credit” (OpenAI `insufficient_quota`) de limita zilnică. Poza/video cerute în chat (detectate de `renderer/src/mediaIntent.mjs`, `requestedMediaGeneration`) sau cu butonul trimit modelul ales (`via`); `mediaConfigFor` face ca un model Gemini / OpenAI (inclusiv `cx/`) / Grok să genereze prin compania lui (abonamentul din OmniRoute întâi, apoi API-ul), iar combinațiile și modelele fără poze (Claude…) folosesc „Făcute de”; test `test-0716-chat-media.cjs`. Constatat pe server (2026-10-05): cheia OmniRoute e bună, dar loginurile importate de pe PC (Codex, Grok CLI, GitHub Copilot, Claude Code) au expirat. Conturile non-Owner (2026-10-09): `apps/server/ai-policy.cjs` cunoaște prefixele OmniRoute (gratuite: `FREE_PROVIDERS`, inclusiv OpenRouter `:free` și serviciile fără cont `KEYLESS_PREFIXES`; plătite: `PAID_PROVIDERS`; abonamente personale: `PERSONAL_PREFIXES`, doar Owner); aceleași liste în `local-gateway.cjs` (`isPersonalModel`; OmniRoute `github` = Copilot, AI Stoica `github/…` = GitHub Models), păzite de `test-0716-shared-access.cjs`. API-urile directe merg și pentru celelalte conturi (`freeDirectAllowed`, `directCandidatesFor`, decise de aceeași politică); `directApisAllowed` rămâne „toate API-urile + Testează cheile + poze directe” (Owner). Celelalte conturi văd și modelele nepermise: `/api/models` întoarce `locked` (`{id, reason}`, din `modelDecisions`), lista le arată cu lacăt (`ModelPicker`, `lockedModels`), iar folosirea lor dă 403 „«X» nu îți este permis de Owner. <motiv>” (`notPermitted`). Combinațiile OmniRoute nu spun ce conțin: pentru alte conturi doar cele din `sharedCombos` (Setări → API-uri AI → „Combinații pentru toate conturile”, `SharedCombos` în `main.jsx`; pe server `AI_STOICA_SHARED_COMBOS`). Lista de chat: `chatCapable` scoate modelele OmniRoute cu `type` image/video/audio/embedding/rerank/moderation/music, `requireChatModel` refuză clar un astfel de model în chat și automatizări; în Windows lista primită înlocuiește cache-ul (cache doar cu `omniUnavailable`); test `test-0716-chat-models.cjs`. Interfața: skill-urile de design din `.claude/skills` (surse și licențe în `.claude/skills-licenses/README.md`); câmpul de mesaj are uneltele pe un rând (`composerTools`), exportul e meniul „Descarcă” (`exportMenu`), `:hover` doar sub `@media (hover:hover) and (pointer:fine)`.
- **Site-ul aistoica.ro e pornit** (2026-10-04, confirmat de Owner prin capturi de pe server, nu verificat din mediul lui Claude): DNS A, certificat Let's Encrypt prin Caddy, OmniRoute pe server cu baza importată de pe PC și cheia `site-aistoica`. Rămân pentru Owner: ștergerea cheii vechi importate din API Manager (server), schimbarea parolelor/cheilor expuse în poze și chat.
- **0.7.15** (PR #32, merge `744ecdd`, Release `v0.7.15` cu `.exe`, `latest.yml`, `.blockmap` din același run): „Copiază cheile pentru server” în Windows (`lib/serverenv.cjs`, IPC `server-env:copy`; Setările arată cheile doar mascat) și instalarea pe server dintr-o comandă, `deploy/hetzner/setup-web.sh`; `test-hetzner-setup.cjs` le păzește pe amândouă.
- **0.7.14** e pe `main` (PR #30, merge `52f3148`); toate cele 6 verificări de pe `main` au trecut. Release-ul `v0.7.14` are `.exe`, `latest.yml` și `.blockmap` urcate de același run „Build AI Stoica Windows”, iar ZIP-ul separat, deci reparația publicării a funcționat. `sha512` nu a fost comparat byte cu byte (repo privat).
- Mediul cloud al lui Claude nu ajunge la serverul Hetzner (portul 22 blocat) și nici la `aistoica.ro` prin proxy: pașii pe server îi face Owner-ul (consola Hetzner sau SSH cu cheia `~/.ssh/aistoica` de pe PC).
- **Serverul `ai-stoica-prod`** (Ubuntu 26.04, 178.104.117.42), aflat pe 2026-10-04: `/opt/ai-stoica` aparține utilizatorului `aistoica`; remote-ul e `github-ai-stoica:andrei18stoica-eng/Ai-Stoica.git` (alias SSH cu cheia de deploy din `~aistoica/.ssh`), deci `git` merge doar ca `aistoica` (`sudo -u aistoica git -C /opt/ai-stoica pull`; `update.sh` face asta singur). `/etc/ssh/sshd_config.d/99-aistoica-hardening.conf` avea `PermitRootLogin no`; Owner-ul l-a schimbat în `prohibit-password` (root doar cu cheie). Există `deploy/hetzner/.env-broken` (copie veche, ignorată de git). API-ul răspunde (`"database":"ok"`).
- Nu scrie cheia OmniRoute a Owner-ului nicăieri în repo; ea stă doar în `deploy/hetzner/.env` pe server. A fost trimisă în chat, deci trebuie înlocuită după instalare.
- OmniRoute 3.8 cere cheie de client pe `/v1/*` (401 fără ea): `/health` raportează `omniNeedsKey`; combinațiile se recunosc după `owned_by: "combo"`. Watchdog-ul Windows e în `lib/omniwatch.cjs` (testat de `test-omniwatch.cjs`). Furnizorii fără credite (402/quota) sunt mutați la coada listei 1 oră (`providerCooldown` în `local-gateway.cjs`).
- Web: `local-gateway.cjs` servește interfața doar când primește `webDir` (`apps/cloud/server.cjs`); fără `webDir` (Windows) comportamentul e neschimbat. `test-web-mode.cjs` și workflow-ul „AI Stoica Web Check” păzesc asta.

- 0.7.11 este pe `main` (PR #27, merge commit `67aedad`), peste baza `7fe0dc2`, unde conflictele cu PR #21–#26 au fost rezolvate.
- După deblocarea GitHub Actions, toate cele 6 verificări de pe `main` au trecut: Build AI Stoica Windows, ZIP complet Windows, Desktop, Server, Cloudflare, Mobile.
- Release-ul `v0.7.11` este publicat (tag pe `67aedad`): `.exe`, `.blockmap`, `latest.yml` și ZIP-ul complet.
- **Reparat în 0.7.14 (confirmat la publicarea `v0.7.14`; `v0.7.13` a fost publicat fără reparație):** în `v0.7.11`, `.exe` din Release vine din „Build AI Stoica Windows”, dar `latest.yml` și `.blockmap` au fost rescrise de workflow-ul ZIP, care face alt build. `sha512` și dimensiunea din `latest.yml` nu se potrivesc cu `.exe` (verificat), deci actualizarea automată de la 0.7.10 ar fi respinsă. Cauza: ambele workflow-uri urcă `latest.yml` și `.blockmap` cu `--clobber`. Reparația: workflow-ul ZIP urcă doar ZIP-ul, metadata o publică numai „Build AI Stoica Windows”; `apps/desktop/scripts/test-release-workflows.cjs` păzește regula. `v0.7.11` rămâne cu metadata nepotrivită; aplicațiile se mută la 0.7.14 (la nevoie, instalare manuală o dată).
- Deploy-ul pe Hetzner, DNS-ul `api.aistoica.ro` și HTTPS-ul cap-coadă nu sunt verificate din repo.
