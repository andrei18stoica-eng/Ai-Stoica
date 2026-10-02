# AI Stoica — Cloudflare Free / Performance Max

Această variantă mută backendul AI Stoica pe Cloudflare Workers + D1 + Workers AI.

## Mod Performance Max

Motorul principal este:

```
@cf/nvidia/nemotron-3-120b-a12b
```

Motorul Cloudflare de rezervă este `@cf/openai/gpt-oss-120b`.

Configurarea Performance Max păstrează până la 120 de mesaje recente, aproximativ 600.000 de caractere de context și permite răspunsuri de până la 8.192 tokeni.

Dacă este configurată cheia Cerebras, routerul încearcă mai întâi Cerebras GPT-OSS 120B. Dacă nu poate răspunde sau cota/creditul este epuizat, continuă automat în ordinea:

1. Cloudflare Nemotron 120B
2. Cloudflare GPT-OSS 120B
3. Groq GPT-OSS 120B
4. Gemini

Astfel, Cloudflare rămâne backendul 24/7, iar motoarele AI se pot înlocui automat între ele.

Cheile sunt opționale. Fără ele, AI Stoica funcționează doar pe Workers AI.

## Publicare

1. În Cloudflare Dashboard creează o bază D1 cu numele `ai-stoica`.
2. Copiază Database ID-ul D1.
3. În `wrangler.jsonc`, înlocuiește UUID-ul `00000000-0000-0000-0000-000000000000` cu Database ID-ul real.
4. Din `apps/cloudflare` rulează:

```bash
npm install
npx wrangler login
npm run db:init
npm run deploy
```

La final Cloudflare va afișa un URL de forma:

```
https://ai-stoica.<subdomain>.workers.dev
```

Verifică:

```
https://ai-stoica.<subdomain>.workers.dev/health
```

## Fallback-uri opționale

Nu salva cheile în GitHub. Adaugă-le ca secrete Cloudflare:

```bash
npx wrangler secret put CEREBRAS_API_KEY
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put GEMINI_API_KEY
```

## Conturi și aprobare (de la 0.7.10)

Conturile noi așteaptă aprobarea Owner-ului, ca persoane străine să nu poată folosi cheile AI ale serverului.

1. Aplică migrațiile (obligatoriu înainte de deploy):

```bash
npx wrangler d1 migrations apply ai-stoica --remote
```

2. Setează e-mailul Owner-ului (în Cloudflare → Worker → Settings → Variables, sau ca secret):

```bash
npx wrangler secret put OWNER_EMAIL
```

Owner-ul aprobă sau respinge conturile din aplicația de telefon: meniu → „Conturi și cereri de acces”.
Conturile care existau deja rămân active. Dacă vrei acces instant pentru oricine, setează `OPEN_REGISTRATION=true`.

Autentificarea este limitată la 20 de încercări greșite per IP la 15 minute (`AUTH_ATTEMPTS_PER_15_MIN`).

## Telefon

În build-ul Expo setează:

```env
EXPO_PUBLIC_GATEWAY_URL=https://ai-stoica.<subdomain>.workers.dev
EXPO_PUBLIC_DEFAULT_MODEL=AI Stoica Performance Max
```

Același backend poate fi folosit de iPhone, iPad, Android și Windows.

## Securizare cont Owner

Înainte de primul deploy/configurare a conturilor, setează **ambele** secrete:

```bash
npx wrangler secret put OWNER_EMAIL
npx wrangler secret put OWNER_INITIAL_PASSWORD
```

`OWNER_INITIAL_PASSWORD` trebuie să fie chiar parola cu care se creează și se autentifică Owner-ul. Worker-ul nu mai acordă rolul Owner doar pentru că cineva cunoaște adresa `OWNER_EMAIL`.

Ordinea recomandată pentru producție:

```bash
npx wrangler d1 migrations apply ai-stoica --remote
npx wrangler deploy
```

După deploy, creează contul cu `OWNER_EMAIL` și parola din `OWNER_INITIAL_PASSWORD`.
