# AI Stoica — ghid pentru Claude Code

Claude Code citește acest fișier automat. El conține tot ce trebuie ca o sesiune nouă să lucreze pe proiect fără alt context.

- Imaginea completă a proiectului: `docs/PROIECT_AI_STOICA.md`
- Procedura de publicare a unei versiuni: `docs/PUBLICARE_RELEASE.md`
- Verificări locale: `bash scripts/verifica-local.sh [--install]`

## Ce este

AI Stoica (Stoica Enterprises AI) este o platformă AI proprie, multi-model: chat, proiecte, asistenți, memorie, bibliotecă de fișiere, pluginuri, automatizări, generare de imagini și video, export de documente, conturi cu roluri Owner / User. Clienți: Windows (Electron) și telefon (Expo); PWA pentru iPhone este planificat, dar nu există încă în repo.

GitHub (`andrei18stoica-eng/Ai-Stoica`, privat) este atelierul: cod, versiuni, teste, build, Releases. Producția rulează pe serverul Hetzner. Aplicația nu depinde de GitHub la fiecare mesaj.

Versiune curentă: **0.7.11**.

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
4. desktop: `node --check`, `npm run build:ui`, toate `scripts/test-*.cjs` (10 teste);
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
- `ai-stoica-windows-zip.yml` publică în Release când e pornit manual (`workflow_dispatch`); pe PR doar construiește.
- Un workflow cu aceeași cheie de două ori (de exemplu `concurrency:`) e invalid și nu pornește deloc.

## Stare curentă (2026-10-03)

- 0.7.11 este pe `main` (PR #27, merge commit `67aedad`), peste baza `7fe0dc2`, unde conflictele cu PR #21–#26 au fost rezolvate.
- Verificările CI **nu au rulat** pe acest cod: joburile erau blocate de facturare. Local au trecut toate testele desktop, serverul, Worker-ul și build-ul interfeței.
- Release-ul `v0.7.11` **nu există încă**. Trebuie rulat „Build AI Stoica Windows” pe `main` după deblocarea Actions, apoi re-rulate toate verificările pe `main`.
- Deploy-ul pe Hetzner, DNS-ul `api.aistoica.ro` și HTTPS-ul cap-coadă nu sunt verificate din repo.
