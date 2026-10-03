# AI Stoica v0.7.13 — verificare

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
  - `test-0711-upgrade.cjs` – trecerea de la 0.7.10: pluginuri din rețeaua locală pe PC, limita de autentificare per email, primul login Cloud păstrează contul și conversațiile locale.
  - `test-release-workflows.cjs` – doar „Build AI Stoica Windows” publică `latest.yml` și `.blockmap` (la fel ca `.exe`), workflow-ul ZIP publică doar ZIP-ul.
- **Build AI Stoica Windows**: aceleași teste pe Windows, apoi installerul + `latest.yml` + `.blockmap` în Releases.
- **AI Stoica Server Check**: `apps/server` (politica AI și contractul HTTP) + Docker.
- **Check AI Stoica Cloudflare**: `npm test` (scenarii cu bază D1 simulată) + `wrangler deploy --dry-run`.
- **Check AI Stoica Mobile**: `expo-doctor` și export iOS/Android.

Verificat suplimentar pe 0.7.11 (în afara GitHub): interfața rulată într-un browser real cu serviciul local 0.7.11 — 44 de verificări (întrebări fără fișier, butoanele Imagine/Video, imagini din Bibliotecă, permisiuni, Owner, Escape, linkuri, automatizări, setări).

De verificat manual pe Windows după instalare: pornirea din tray, microfonul, notificările automatizărilor și actualizarea automată de la 0.7.11 la 0.7.13 (prima cu `latest.yml` care trebuie să se potrivească cu `.exe`; compară `sha512` după publicare, vezi `docs/PUBLICARE_RELEASE.md`).
