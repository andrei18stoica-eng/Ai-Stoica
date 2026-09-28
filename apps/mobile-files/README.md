# AI Stoica Files & GitHub

Aplicație separată de AI Stoica pentru lucru cu fișiere și repository GitHub.

## Funcții

- atașare imagini, PDF, DOCX, CSV, TXT și fișiere de cod;
- fișierele sunt stocate în Cloudflare R2;
- PDF/DOCX/imagini sunt convertite automat în text prin Workers AI Markdown Conversion;
- răspunsurile AI pot fi copiate;
- răspunsurile pot fi exportate în PDF sau DOCX;
- generare imagini și salvare în biblioteca de fișiere;
- GitHub Solve: citește un fișier din repository, propune corecția și o aplică numai după confirmarea utilizatorului.

## Resurse Cloudflare necesare

1. D1 database pentru AI Stoica.
2. R2 bucket cu numele:
   `ai-stoica-files-2026-001`
3. Worker cu binding-urile din `apps/cloudflare/wrangler.jsonc`.

După crearea bazei D1, înlocuiește placeholderul `database_id` din `apps/cloudflare/wrangler.jsonc`.

Rulează migrațiile:

```bash
cd apps/cloudflare
npm install
npx wrangler d1 migrations apply <NUMELE_BAZEI_D1> --remote
```

## Secrete Cloudflare

Cerebras:

```bash
npx wrangler secret put CEREBRAS_API_KEY
```

GitHub, opțional:

```bash
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put GITHUB_ALLOWED_EMAIL
```

Folosește pentru `GITHUB_TOKEN` un token GitHub cu acces numai la repository-ul necesar și cu permisiuni Contents Read/Write.

`GITHUB_ALLOWED_EMAIL` trebuie să fie emailul contului AI Stoica căruia îi permiți accesul la funcțiile GitHub. Dacă această valoare lipsește, funcțiile GitHub sunt blocate.

Fallback-uri AI opționale:

```bash
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put GEMINI_API_KEY
```

## Aplicația mobilă

Aplicația separată este în:

```
apps/mobile-files
```

Identificatori:
- iOS: `ro.stoica.aistoica.files`
- Android: `ro.stoica.aistoica.files`

Variabile:

```env
EXPO_PUBLIC_GATEWAY_URL=https://ai-stoica.<subdomain>.workers.dev
EXPO_PUBLIC_DEFAULT_MODEL=AI Stoica Performance Max
```
