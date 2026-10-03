# AI Stoica — Cloudflare Free / Performance Max

Această variantă mută backendul AI Stoica pe Cloudflare Workers + D1 + R2 + Workers AI. Este backendul recomandat pentru aplicația de telefon (iPhone, iPad, Android).

## Mod Performance Max

Motorul principal este `@cf/nvidia/nemotron-3-120b-a12b`, iar motorul Cloudflare de rezervă este `@cf/openai/gpt-oss-120b`.

Configurarea păstrează până la 120 de mesaje recente, aproximativ 300.000 de caractere de context (cât încape în fereastra modelelor GPT-OSS de 131.000 de tokeni) și răspunsuri de până la 8.192 tokeni.

Dacă este configurată cheia Cerebras, routerul încearcă mai întâi Cerebras GPT-OSS 120B. Dacă nu poate răspunde, continuă automat în ordinea:

1. Cloudflare Nemotron 120B
2. Cloudflare GPT-OSS 120B
3. Groq GPT-OSS 120B
4. Gemini

Cheile sunt opționale. Fără ele, AI Stoica funcționează doar pe Workers AI. Owner-ul poate opri pentru fiecare cont oricare dintre motoare.

## Publicare

1. În Cloudflare Dashboard creează o bază D1 cu numele `ai-stoica` și copiază Database ID-ul.
2. În `wrangler.jsonc`, înlocuiește UUID-ul `00000000-0000-0000-0000-000000000000` cu Database ID-ul real.
3. Din `apps/cloudflare` rulează:

```bash
npm install
npx wrangler login
npx wrangler r2 bucket create ai-stoica-files-2026-001
npm run db:init
npx wrangler secret put OWNER_EMAIL
npx wrangler secret put OWNER_SETUP_CODE
npm run deploy
```

`npm run db:init` aplică toate migrațiile (inclusiv `0005_hardening.sql`). Rulează-l înainte de fiecare deploy al unei versiuni noi: Worker-ul folosește coloanele adăugate de migrații.

La final Cloudflare afișează un URL de forma `https://ai-stoica.<subdomain>.workers.dev`. Verifică `https://ai-stoica.<subdomain>.workers.dev/health`.

Worker-ul are și un cron zilnic (`triggers.crons` în `wrangler.jsonc`) care șterge sesiunile expirate și contoarele vechi de încercări de autentificare.

## Secrete și variabile

Setează-le ca secrete (`npx wrangler secret put NUME`), nu ca variabile în Dashboard. `wrangler.jsonc` are `keep_vars: true`, deci variabilele puse în Dashboard nu mai sunt șterse la deploy, dar secretele rămân varianta recomandată.

| Nume | Obligatoriu | Rol |
| --- | --- | --- |
| `OWNER_EMAIL` | da | E-mailul contului Owner. Fără el nu există Owner și nimeni nu poate aproba conturi. |
| `OWNER_SETUP_CODE` | da | Cod secret (minimum 16 caractere aleatoare) cerut la crearea contului Owner și la resetarea parolelor. |
| `OPEN_REGISTRATION` | nu | `true` = conturile noi sunt active imediat, fără aprobare. |
| `AUTH_ATTEMPTS_PER_15_MIN` | nu | Câte încercări (autentificări greșite + conturi noi) sunt permise per IP la 15 minute. Implicit 20. |
| `CEREBRAS_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY` | nu | Motoare AI suplimentare. |
| `GITHUB_TOKEN` | nu | Token GitHub cu drept de scriere în `GITHUB_REPO`, pentru GitHub Solve. |
| `GITHUB_ALLOWED_EMAIL` | nu | Un cont, în afară de Owner, care poate folosi GitHub Solve. |

## Contul Owner

1. Setează `OWNER_EMAIL` și `OWNER_SETUP_CODE` (vezi mai sus).
2. În aplicația de telefon alege „Cont nou”, scrie e-mailul Owner, parola și codul din `OWNER_SETUP_CODE` în câmpul „Cod Owner”.
3. După ce contul Owner există, e-mailul Owner nu mai poate fi înregistrat din nou.

Un cont vechi (dinainte de 0.7.9) cu e-mailul Owner devine Owner la prima autentificare, dacă este activ. Un cont „în așteptare” cu e-mailul Owner rămâne în așteptare: Owner-ul real își resetează parola cu codul de configurare (vezi mai jos), iar contul devine Owner.

Dacă schimbi `OWNER_EMAIL`, contul vechi pierde drepturile de Owner și poate fi blocat din lista de conturi.

## Conturi și aprobare

Conturile noi așteaptă aprobarea Owner-ului, ca persoane străine să nu poată folosi cheile AI ale serverului. Owner-ul aprobă, respinge sau blochează conturile din aplicația de telefon (meniu → „Conturi și cereri de acces”) sau din Control Center-ul aplicației desktop, unde poate opri și funcții pe cont (imagini, documente, încărcare fișiere, GitHub, motoare AI).

Conturile care existau înainte de 0.7.9 rămân active.

## Resetarea parolei

Parolele noi folosesc PBKDF2 cu 100.000 de iterații (maximul acceptat de Cloudflare Workers). Conturile vechi sunt trecute automat pe noul format la prima autentificare. Dacă Cloudflare refuză formatul vechi, autentificarea afișează un mesaj care cere resetarea parolei:

```bash
curl -X POST https://ai-stoica.<subdomain>.workers.dev/auth/reset-password \
  -H "content-type: application/json" \
  -d '{"email":"cont@exemplu.ro","password":"ParolaNoua123","setupCode":"<OWNER_SETUP_CODE>"}'
```

Resetarea închide toate sesiunile contului. Funcționează și pentru contul Owner.

## Ce nu există în varianta Cloudflare

Pluginurile, automatizările, rularea de cod, testul SSH, căutarea web, transcrierea, generarea video, jurnalul de audit și setarea AI plătit răspund cu 501 și mesajul „Funcția nu este disponibilă în AI Stoica Cloud (Cloudflare)”. Folosește aplicația desktop sau serverul Hetzner pentru ele. Proiectele, asistenții, memoria, biblioteca, exportul PDF/DOCX/PPTX/MD/TXT, imaginile și GitHub Solve funcționează.

## Teste

```bash
npm install
npm test
```

Testul rulează Worker-ul pe o bază D1 simulată (Node 22.5+, `node:sqlite`).

## Telefon

În build-ul Expo setează (vezi `apps/mobile/README.md`):

```env
EXPO_PUBLIC_GATEWAY_URL=https://ai-stoica.<subdomain>.workers.dev
EXPO_PUBLIC_DEFAULT_MODEL=AI Stoica Performance Max
```

Același backend poate fi folosit de iPhone, iPad, Android și Windows.

## Securizare cont Owner

Contul Owner se creează și parola se resetează doar cu codul secret `OWNER_SETUP_CODE`; adresa `OWNER_EMAIL` singură nu acordă rolul Owner. Setează ambele secrete înainte de a crea conturi (vezi mai sus):

```bash
npx wrangler secret put OWNER_EMAIL
npx wrangler secret put OWNER_SETUP_CODE
```

Ordinea recomandată pentru producție:

```bash
npx wrangler d1 migrations apply ai-stoica --remote
npx wrangler deploy
```

După deploy, creează contul Owner din aplicație, cu parola dorită și codul din `OWNER_SETUP_CODE` în câmpul „Cod Owner”.
