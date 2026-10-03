# AI Stoica — ghid pentru Claude Code

Claude Code citește acest fișier automat. El conține tot ce trebuie ca o sesiune nouă să lucreze pe proiect fără alt context.

- Imaginea completă a proiectului: `docs/PROIECT_AI_STOICA.md`
- Procedura de publicare a unei versiuni: `docs/PUBLICARE_RELEASE.md`
- Verificări locale: `bash scripts/verifica-local.sh [--install]`

## Ce este

AI Stoica (Stoica Enterprises AI) este o platformă AI proprie, multi-model: chat, proiecte, asistenți, memorie, bibliotecă de fișiere, pluginuri, automatizări, generare de imagini și video, export de documente, conturi cu roluri Owner / User. Clienți: Windows (Electron), web la aistoica.ro (aceeași interfață, servită de `apps/cloud`), aplicație instalabilă gratuită pe iPhone/Android (PWA, din 0.7.14) și aplicația Expo (`apps/mobile`, prin Cloudflare).

GitHub (`andrei18stoica-eng/Ai-Stoica`, privat) este atelierul: cod, versiuni, teste, build, Releases. Producția rulează pe serverul Hetzner. Aplicația nu depinde de GitHub la fiecare mesaj.

Versiune curentă: **0.7.14** (în lucru; pe `main`: 0.7.13, făcută în cowork și îmbinată prin PR #31). 0.7.12 a fost făcută tot în cowork și a intrat odată cu 0.7.13.

## Structura

| Cale | Rol |
|---|---|
| `apps/desktop` | aplicația Windows: Electron (`main.cjs`), serviciul local Express (`local-gateway.cjs`), `lib/` (store, memorie, extragere text, documente, programări, netguard), interfața React + Vite (`renderer/`), testele `scripts/test-*.cjs` |
| `apps/server` | „AI Stoica Cloud” pe Hetzner: Node + PostgreSQL, conturi, aprobare, permisiuni, politică AI, notificări, audit (`migrations/`) |
| `apps/cloud` | server propriu în Docker: același `local-gateway.cjs` ca pe Windows, cu Caddy pentru HTTPS (Dockerfile copiază `apps/desktop/lib`) |
| `apps/cloudflare` | Worker + D1 + R2 pentru aplicația de telefon |
| `apps/mobile` | aplicația Expo (iPhone / Android) |
| `deploy/hetzner` | `docker-compose.yml` (PostgreSQL + API, Caddy în profilul `edge`), `update.sh` |
| `branding/`, `docs/` | logo și documentație |

Folderul `gateway/` (0.4.1) a fost șters în 0.7.11 și nu trebuie să reapară.

## Cum verifici

`bash scripts/verifica-local.sh --install` rulează, în ordine:

1. workflow-urile YAML (chei duplicate);
2. aceeași versiune peste tot;
3. `gateway/` absent;
4. desktop: `node --check`, `npm run build:ui`, toate `scripts/test-*.cjs` (14 teste);
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

## Stare curentă (2026-10-03)

- **0.7.14** (PR #30): versiunea web (aistoica.ro) și aplicația PWA + reparația publicării Windows + lista de modele din PR #29 + acest ghid (PR #28), peste 0.7.13 de pe `main`. Rămâne: verificări verzi, merge, Release `v0.7.14` cu potrivirea `sha512`, apoi pe server DNS-ul `aistoica.ro`, `.env` și `docker compose up -d --build web caddy`.
- Web: `local-gateway.cjs` servește interfața doar când primește `webDir` (`apps/cloud/server.cjs`); fără `webDir` (Windows) comportamentul e neschimbat. `test-web-mode.cjs` și workflow-ul „AI Stoica Web Check” păzesc asta.

- 0.7.11 este pe `main` (PR #27, merge commit `67aedad`), peste baza `7fe0dc2`, unde conflictele cu PR #21–#26 au fost rezolvate.
- După deblocarea GitHub Actions, toate cele 6 verificări de pe `main` au trecut: Build AI Stoica Windows, ZIP complet Windows, Desktop, Server, Cloudflare, Mobile.
- Release-ul `v0.7.11` este publicat (tag pe `67aedad`): `.exe`, `.blockmap`, `latest.yml` și ZIP-ul complet.
- **Reparat în 0.7.14 (de confirmat după publicare; `v0.7.13` a fost publicat fără reparație):** în `v0.7.11`, `.exe` din Release vine din „Build AI Stoica Windows”, dar `latest.yml` și `.blockmap` au fost rescrise de workflow-ul ZIP, care face alt build. `sha512` și dimensiunea din `latest.yml` nu se potrivesc cu `.exe` (verificat), deci actualizarea automată de la 0.7.10 ar fi respinsă. Cauza: ambele workflow-uri urcă `latest.yml` și `.blockmap` cu `--clobber`. Reparația: workflow-ul ZIP urcă doar ZIP-ul, metadata o publică numai „Build AI Stoica Windows”; `apps/desktop/scripts/test-release-workflows.cjs` păzește regula. `v0.7.11` rămâne cu metadata nepotrivită; aplicațiile se mută la 0.7.14 (la nevoie, instalare manuală o dată).
- Deploy-ul pe Hetzner, DNS-ul `api.aistoica.ro` și HTTPS-ul cap-coadă nu sunt verificate din repo.
