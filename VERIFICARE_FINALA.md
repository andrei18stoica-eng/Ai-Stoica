# AI Stoica v0.7.16 — verificare

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
  - `test-0714-omniroute-media.cjs` – OmniRoute 3.8: cheia API cerută (mesaj clar, „OmniRoute cere cheie API”), combinațiile marcate `owned_by: combo`, modelele plătite și gratuite în listă, „Testează cheile” cu OmniRoute, chat printr-o combinație; un furnizor de imagini fără credite (402) e sărit la următoarea imagine;
  - `test-omniwatch.cjs` – watchdog-ul OmniRoute: pornește un OmniRoute oprit, repornește unul blocat după 3 verificări, nu atinge un OmniRoute de pe server, spune când nu e instalat, nu pornește două copii;
  - `test-web-mode.cjs` – versiunea web și aplicația de telefon (PWA): interfața servită la „/”, politica de securitate a paginii, cache, propria adresă acceptată, alte site-uri refuzate, aplicația Windows neschimbată, manifestul și iconițele;
  - `test-0711-upgrade.cjs` – trecerea de la 0.7.10: pluginuri din rețeaua locală pe PC, limita de autentificare per email, primul login Cloud păstrează contul și conversațiile locale.
  - `test-release-workflows.cjs` – doar „Build AI Stoica Windows” publică `latest.yml` și `.blockmap` (la fel ca `.exe`), workflow-ul ZIP publică doar ZIP-ul.
  - `test-0716-choice-media.cjs` – modelul ales răspunde (fără trecere ascunsă la Cerebras/Groq, nici la streaming), „Rezervă automată” o permite, fără model răspunde combinația principală, pozele încearcă întâi abonamentul ChatGPT (Codex), modelul care a reușit rămâne legat per cont, video web gratuit cu „Doar gratuit”, deschiderea unui Word fără descărcare (doar pentru contul lui);
  - `test-0716-math.cjs` – LaTeX → ecuații Word (fracții, radicali, sume, integrale, funcții, matrice, ecuații aliniate), banii și codul rămân text, LaTeX greșit rămâne scris, XML valid în DOCX, aceleași reguli pentru formulele din chat, textul PDF-urilor cu diacritice și tabelele ToUnicode;
  - `test-0716-server-update.cjs` – „Actualizează site-ul”: doar Owner-ul vede secțiunea și poate cere actualizarea (o cerere o dată, nu în timpul altei actualizări), actualizarea automată se pornește și se oprește; `update-runner.sh` cu un repo git simulat (găsește versiunea nouă, o instalează doar cu actualizarea automată pornită, raportează o actualizare eșuată cu log-ul ei); `install-updater.sh` cu systemd simulat (unitățile rulează scriptul fix, folderul aparține utilizatorului site-ului, a doua rulare nu schimbă nimic);
  - `test-hetzner-setup.cjs` – „Copiază cheile pentru server” (toate cheile Windows, sub numele citite de server, fără să ajungă în interfață) și `deploy/hetzner/setup-web.sh` rulat cu Docker, rețea și DNS simulate: păstrează valorile din `.env`, salvează exact cheile lipite și le refuză pe cele necunoscute, nu dublează rânduri, cere din nou o cheie OmniRoute refuzată, explică DNS-ul lipsă, creează `.env` pe un server nou.
- **Build AI Stoica Windows**: aceleași teste pe Windows, apoi installerul + `latest.yml` + `.blockmap` în Releases.
- **AI Stoica Server Check**: `apps/server` (politica AI și contractul HTTP) + Docker.
- **Check AI Stoica Cloudflare**: `npm test` (scenarii cu bază D1 simulată) + `wrangler deploy --dry-run`.
- **Check AI Stoica Mobile**: `expo-doctor` și export iOS/Android.

Verificat suplimentar pe 0.7.16 (în afara GitHub): interfața web rulată în Chromium cu serviciul 0.7.16 și un OmniRoute simulat — formulele din chat apar ca formule (banii și codul rămân text), butonul „Convertește AI Stoica în aplicație pe telefon” apare pe pagina de autentificare și în aplicație, iar Word, poze și PDF se deschid în aplicație, fără erori în consolă; un DOCX cu ecuații deschis în LibreOffice arată ecuațiile.

Verificat suplimentar pe 0.7.11 (în afara GitHub): interfața rulată într-un browser real cu serviciul local 0.7.11 — 44 de verificări (întrebări fără fișier, butoanele Imagine/Video, imagini din Bibliotecă, permisiuni, Owner, Escape, linkuri, automatizări, setări).

De verificat manual pe Windows după instalare: pornirea din tray, microfonul, notificările automatizărilor și actualizarea automată de la 0.7.11 la 0.7.13 (prima cu `latest.yml` care trebuie să se potrivească cu `.exe`; compară `sha512` după publicare, vezi `docs/PUBLICARE_RELEASE.md`).
