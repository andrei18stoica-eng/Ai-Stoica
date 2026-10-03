# AI Stoica v0.7.14 — verificare

Verificări automate în GitHub Actions:

- **AI Stoica Desktop Check** (la fiecare modificare): sintaxă pentru toate fișierele aplicației Windows, build interfață (Vite) și toate testele din `apps/desktop/scripts/test-*.cjs`:
  - `test-modules.cjs` – baza de date locală, memoria, citirea documentelor;
  - `test-ai-access-enforcement.cjs` – permisiuni AI pentru conturi normale;
  - `test-media-generation.cjs` – imagini/video și „Doar gratuit”;
  - `test-infrastructure-regressions.cjs` – pluginuri directe și regresii;
  - `test-owner-tools.cjs` – unelte Owner;
  - `test-local-mode.cjs` – mod local fără Cloud, blocarea site-urilor străine, sesiuni;
  - `test-document-export.cjs` – export PDF, Word, PowerPoint, Excel și celelalte formate;
  - `test-0711-regressions.cjs` – reparațiile 0.7.11: automatizări și fus orar, blocarea adreselor interne, fișiere foarte mari, caractere de control, sume în Excel, CSV, memorie, erori JSON, permisiuni și Owner, deconectare, imagini din Bibliotecă, conturi și limite de autentificare.
  - `test-0712-models.cjs` – toate modelele providerilor configurați și combinațiile OmniRoute apar în listă și pot fi folosite; modelele vechi implicite se actualizează.
  - `test-0713-gateway.cjs` – Scheduled (istoric, duplicare), pluginuri după nume, memorie între conversații, Design (generare, versiuni, previzualizare cu token), Pollinations fără cheie, mesajul pentru video, întrebările de clarificare;
  - `test-web-mode.cjs` – versiunea web și aplicația de telefon (PWA): interfața servită la „/”, politica de securitate a paginii, cache, propria adresă acceptată, alte site-uri refuzate, aplicația Windows neschimbată, manifestul și iconițele;
  - `test-0711-upgrade.cjs` – trecerea de la 0.7.10: pluginuri din rețeaua locală pe PC, limita de autentificare per email, primul login Cloud păstrează contul și conversațiile locale.
- **Build AI Stoica Windows**: aceleași teste pe Windows, apoi installerul + `latest.yml` + `.blockmap` în Releases.
- **AI Stoica Server Check**: `apps/server` (politica AI și contractul HTTP) + Docker.
- **Check AI Stoica Cloudflare**: `npm test` (scenarii cu bază D1 simulată) + `wrangler deploy --dry-run`.
- **Check AI Stoica Mobile**: `expo-doctor` și export iOS/Android.

Verificat suplimentar înainte de publicare (în afara GitHub): interfața 0.7.11 rulată într-un browser real cu serviciul local 0.7.11 — 44 de verificări (întrebări fără fișier, butoanele Imagine/Video, imagini din Bibliotecă, permisiuni, Owner, Escape, linkuri, automatizări, setări).

De verificat manual pe Windows după instalare: pornirea din tray, microfonul, notificările automatizărilor și actualizarea automată de la 0.7.11 la următoarea versiune.
