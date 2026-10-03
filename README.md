# AI Stoica 0.7.14 — Stoica Enterprises AI

Asistent AI pentru Windows, web (aistoica.ro) și telefon cu chat, proiecte, asistenți, memorie, bibliotecă de fișiere, pluginuri, automatizări, generare de imagini și video, export PDF/Word/PowerPoint/Excel și panou de Owner.

## Noutăți 0.7.14 — AI Stoica pe web și ca aplicație pe telefon (gratuit)

- **Site-ul aistoica.ro:** aceeași interfață ca aplicația Windows (chat, proiecte, Bibliotecă, Design, Scheduled, pluginuri, memorie), direct în browser, pe orice calculator sau telefon.
- **Aplicație pe iPhone și Android, gratuită**, fără App Store și fără Google Play: se instalează din browser și se deschide pe tot ecranul, cu iconița AI Stoica.
  - **iPhone / iPad:** deschide aistoica.ro în Safari → butonul Distribuie → „Adaugă pe ecranul principal”.
  - **Android:** deschide aistoica.ro în Chrome → „Instalează aplicația” (butonul apare și în pagina de autentificare).
  - **Calculator:** în Chrome / Edge, iconița de instalare din bara de adrese.
- Conturile sunt aceleași ca în aplicația Windows în modul Cloud (serverul Hetzner, cu aprobarea Owner-ului).
- Aplicația se actualizează singură: interfața vine mereu de pe server, deci o versiune nouă apare la următoarea deschidere.
- Serverul: serviciul `web` din `deploy/hetzner` (imaginea `apps/cloud`, care construiește și interfața). Pașii sunt în „Site-ul aistoica.ro” mai jos.
- **Actualizarea automată Windows reparată:** în Release, `latest.yml` și `.blockmap` vin din același build ca `.exe` (workflow-ul ZIP nu le mai rescrie). Testul `test-release-workflows.cjs` păzește regula.
- **Lista de modele** păstrează ultima listă OmniRoute reușită când OmniRoute nu răspunde, iar selectorul arată câte modele a ascuns Owner-ul.
- **Pentru dezvoltare:** `CLAUDE.md`, `docs/PROIECT_AI_STOICA.md`, `docs/PUBLICARE_RELEASE.md` și `scripts/verifica-local.sh`.

## Noutăți 0.7.13

- **Scheduled** (fostele Automatizări): listă ca la Claude, program scris în cuvinte, detalii cu istoricul rulărilor, Rulează acum, Editează, Duplică, Șterge.
- **Pluginuri**: tab-urile Instalate / Director / Creează plugin; când scrii numele unui plugin activ în chat (sau @nume), AI Stoica îl folosește.
- **Memorie între conversații** (automată, se poate opri): când pomenești un subiect într-un chat nou, AI Stoica găsește ce ați discutat în celelalte conversații.
- **Bibliotecă** refăcută: filtre Documente / Poze / Video / Audio / Design, căutare, sortare, previzualizare, trage-și-lasă.
- **Design**: descrii un site, un afiș, o prezentare, un CV…, AI Stoica face macheta HTML, o vezi pe desktop/tabletă/telefon, o modifici în versiuni și o descarci.
- Butoanele **Poză** și **Video**; pozele merg și fără nicio cheie (Pollinations fără cheie). Pentru video e nevoie de o cheie: nu există un API video gratuit.
- **Întrebări de clarificare** cu variante de răspuns pe care dai click, ca la Claude (se pot opri din Setări sau Memorie).
- Verificare de suprapuneri la 980×680, 1280×800, 1440×900 și 1920×1080; reparate: bara laterală strânsă, bannerul de actualizare, notificările peste dialoguri.

## Noutăți 0.7.12

- **Toate modelele, într-o singură listă:** fiecare provider configurat aduce toate modelele lui gratuite (Groq, Cerebras, Gemini, Mistral, NVIDIA, GitHub Models, Cloudflare, Cohere, Hugging Face), iar lista de sus le grupează pe provideri.
- **Combinațiile OmniRoute** („Ai principal” și orice altă combinație) apar primele în listă și pot fi alese direct.
- **Setări → API-uri AI:** fiecare provider are butonul „Ia cheia gratuită”, care deschide pagina unde se creează cheia. Câmpurile de modele acceptă liste separate prin virgulă.
- Modelele vechi implicite se actualizează singure. Modelul NVIDIA `meta/llama-3.3-70b-instruct` nu mai există la NVIDIA și a fost înlocuit.

## Noutăți 0.7.11 (reparații)

- **Imagine și Video au butoane proprii** lângă „Rapid/Gândire”. O întrebare obișnuită („Creează un script pentru un video de TikTok”) primește răspuns text, nu mai pornește generarea.
- **Întrebările despre formate primesc răspuns, nu fișier.** Fișierul se face doar la comandă („Fă-mi un PDF cu…”), iar textul rămâne vizibil deasupra lui.
- **Actualizarea automată funcționează:** release-ul conține acum și `latest.yml` și `.blockmap`. Setări → General → „Caută actualizări acum”.
- **Conversațiile cu poze nu se mai blochează:** pozele rămân în Bibliotecă, iar conversația păstrează doar trimiterea la ele.
- **Permisiunile din panoul Owner se aplică toate** (automatizări, pluginuri, încărcare fișiere, documente, Deep Research, web, GitHub, imagini, video), și în aplicație, și în serviciul local.
- **Owner pe PC:** Setări → Cont și date → „Email Owner pe acest PC”. Codul rulează doar din butonul „Rulează”, nu automat.
- **Automatizări sigure:** zilele și orele sunt verificate, se calculează în fusul tău orar, „Rulează acum” nu mai strică programarea.
- **Linkurile** din răspunsuri se deschid în browser, nu în fereastra aplicației.
- **Interfață:** Escape închide ferestrele, listă „Arhivate”, redenumire/ștergere proiecte și asistenți, poți schimba conversația cât timp AI-ul răspunde, mesaje de eroare clare în română, confirmări înainte de ștergere.
- **Fișiere:** PDF-urile și documentele foarte mari nu mai pot bloca aplicația; CSV-urile din contabilitate (Windows-1250) se citesc corect; Excel păstrează sumele românești („1.500,50”).
- **Securitate:** pluginurile nu mai pot accesa adrese interne; sesiunea se închide real la „Deconectare”; limită la încercările de autentificare; cheile pluginurilor sunt criptate.
- **Telefon (Cloudflare):** butoane PDF/DOCX/PPTX, defilare automată, butonul Înapoi pe Android, tastatura nu mai acoperă câmpul de scris; Worker-ul are migrarea `0005`, cod de configurare Owner (`OWNER_SETUP_CODE`) și deconectare reală.
- **Server Hetzner și `apps/cloud`:** erori JSON corecte, parole cu orice caractere în baza de date, Owner prin `AI_STOICA_OWNER_EMAIL`, containere care nu mai rulează ca root.

Pași după actualizare: vezi „Pași pentru Owner după 0.7.14” mai jos.

## Site-ul aistoica.ro (versiunea web și aplicația de telefon)

Pe serverul Hetzner (`/opt/ai-stoica`), o singură dată:

1. **DNS:** la firma unde e cumpărat domeniul, adaugă o înregistrare **A** pentru `aistoica.ro` cu IP-ul serverului (același ca la `api.aistoica.ro`). Opțional, și `www.aistoica.ro`.
2. În `deploy/hetzner/.env`: `AI_STOICA_WEB_DOMAIN=aistoica.ro`, `COMPOSE_PROFILES=edge,web`, un `OMNIROUTE_WS_BRIDGE_SECRET` aleator și **aceleași chei ca în aplicația Windows** (Setări → API-uri AI) — atunci site-ul are aceleași modele: Cerebras, Groq, Gemini, Mistral, NVIDIA, GitHub Models, Cloudflare, Cohere, Hugging Face, plus cheile pentru imagini și video. Cheile stau doar în `.env` pe server.
3. **OmniRoute** pornește odată cu site-ul. Ca să ai aceleași combinații ca pe Windows („Ai principal” etc.), deschide-i panoul printr-un tunel SSH (`ssh -L 20128:127.0.0.1:20128 root@IP_SERVER`, apoi http://127.0.0.1:20128) și conectează aceiași furnizori.
4. `cd /opt/ai-stoica/deploy/hetzner && docker compose up -d --build web caddy`, apoi `curl http://127.0.0.1:8788/health`.
5. Deschide https://aistoica.ro, creează contul (sau intră cu contul Owner) și aprobă din panoul Owner conturile noi.

La actualizări, `sudo bash /opt/ai-stoica/deploy/hetzner/update.sh` reconstruiește și site-ul.

## Noutăți 0.7.10

- **Funcționează fără server Cloud:** contul de pe PC folosește direct cheile gratuite configurate (Gemini, Groq, Cerebras, Cloudflare etc.), chiar dacă OmniRoute nu rulează. Rularea de cod și accesul SSH rămân doar pentru Owner.
- **Ghid la prima pornire:** cheie Gemini gratuită în 3 pași.
- **Setări → API-uri AI → „Testează cheile”:** verifică fiecare API și spune clar ce nu merge (cheie greșită, model inexistent, limită atinsă).
- **Biblioteca este citită de AI:** textul din Word, PowerPoint, Excel, PDF (cu text, nu scanat), OpenDocument și fișiere text/cod este extras automat la încărcare.
- **Memorie mai inteligentă:** înțelege formele cuvintelor românești și, când există o cheie Gemini sau Cloudflare, caută după sens.
- **Date mai sigure:** salvările simultane nu se mai suprascriu, fiecare salvare păstrează o copie `ai-stoica-data.json.bak`, iar un fișier deteriorat nu mai șterge datele.
- **Securitate:** sesiunile locale expiră după 30 de zile (se reînnoiesc la fiecare deschidere); serviciul local acceptă cereri doar de la fereastra AI Stoica.
- **Stop oprește și AI-ul:** cererea către provider este anulată, nu mai consumă tokeni în fundal.
- **Conturi normale:** nu mai sunt deconectate când serverul Cloud nu răspunde câteva secunde; nu pot modifica cheile API ale PC-ului când Cloud este activ.
- **Automatizări:** trec pe API-urile gratuite când OmniRoute este oprit; o automatizare „o singură dată” care eșuează se oprește după 3 încercări.
- Toate erorile butoanelor sunt afișate pe ecran.

## Structura aplicației Windows (`apps/desktop`)

| Fișier | Rol |
|---|---|
| `main.cjs` | fereastra Electron, tray, setări, actualizări |
| `local-gateway.cjs` | serviciul local: conturi, chat, imagini, video, pluginuri, automatizări |
| `lib/store.cjs` | baza de date locală (cache comun, backup, protecție la corupere) |
| `lib/memory.cjs` | memorie: ce se reține și căutarea relevantă |
| `lib/extract.cjs` | citirea textului din fișierele din Bibliotecă |
| `lib/documents.cjs` | export PDF, Word, PowerPoint, Excel, CSV, JSON, HTML etc. |
| `lib/schedule.cjs` | calculul orei următoarei rulări pentru automatizări (cu fus orar) |
| `lib/netguard.cjs` | blochează accesul pluginurilor la adrese interne |
| `lib/providers.cjs` | modelele gratuite ale fiecărui provider și paginile de unde se iau cheile |
| `renderer/src/main.jsx` | interfața |
| `scripts/test-*.cjs` | teste rulate automat de GitHub la fiecare modificare |

## Pași pentru Owner după 0.7.14

1. **Cloudflare (aplicația de telefon):** în `apps/cloudflare` rulează migrările (`npx wrangler d1 migrations apply ai-stoica --remote`, include `0005`), setează secretele `OWNER_EMAIL` și `OWNER_SETUP_CODE`, publică Worker-ul și creează imediat contul Owner (cu codul de configurare). Detalii în `apps/cloudflare/README.md`.
2. **Telefon:** în `apps/mobile/eas.json` înlocuiește `https://ai-stoica.SUBDOMENIUL-TAU.workers.dev` cu adresa Worker-ului tău (sau folosește `eas env:create`), apoi pornește „Build AI Stoica Mobile with EAS”.
3. **Server Hetzner:** în `.env` păstrează `OWNER_EMAIL` și `OWNER_INITIAL_PASSWORD`; la actualizare rulează `deploy/hetzner/update.sh`.
4. **Windows:** după ce apare release-ul v0.7.14 (cu `latest.yml`), aplicațiile cu „Actualizări automate” pornite se actualizează singure la următoarea pornire. Release-urile v0.7.11 și v0.7.13 au fost publicate fără reparația de mai sus: dacă aplicația nu se actualizează, instalează 0.7.14 o dată de mână, de aici înainte actualizările vin singure.
5. **Site-ul aistoica.ro:** vezi „Site-ul aistoica.ro” mai sus (DNS, `.env`, `docker compose up -d --build web caddy`).

---

## Istoric: 0.4.1

Versiunea 0.4.1 reproiectează AI Stoica după conceptul de interfață definit pentru aplicație: bară laterală cu proiecte/asistenți/istoric, antet cu model și distribuire, conversație centrată, composer cu fișiere + microfon, răspunsuri Markdown și streaming, design negru profesional și cont cu email.

## Ce este nou

- Identitate vizuală **Stoica Enterprises AI** pe fundal negru profesional.
- **Cont cu email + parolă** (autentificare și creare cont).
- Conversații salvate pe serverul local AI Stoica, separat pentru fiecare cont.
- Proiecte și asistenți personalizați.
- Istoric grupat: Azi / Ieri / Ultimele 7 zile / Ultimele 30 de zile.
- Răspunsuri transmise în streaming când OmniRoute suportă streaming.
- Markdown, liste, tabele și blocuri de cod.
- Acțiuni sub răspuns: copiere, apreciere, neapreciere, regenerare.
- Atașare imagini și fișiere text; imaginile sunt trimise către modele multimodale compatibile.
- Dictare vocală când motorul Chromium/Windows o permite.
- AI Stoica pornește cu Windows și rămâne în system tray.
- **Watchdog OmniRoute:** dacă portul OmniRoute nu răspunde, AI Stoica încearcă automat să ruleze `omniroute.cmd serve`.
- Cheia OmniRoute rămâne în configurația locală și este criptată prin Electron `safeStorage` când Windows permite.

## Important despre cont și sincronizare

Pe Windows, aplicația pornește un **Gateway local** la `http://127.0.0.1:8787`. Conturile și conversațiile sunt salvate local pe PC. Pentru sincronizare între PC-uri folosește serverul Hetzner (`apps/server` + `deploy/hetzner`); telefonul folosește Worker-ul Cloudflare (`apps/cloudflare`).

Pentru sincronizare reală între dispozitive, Gateway-ul trebuie să fie disponibil permanent la o adresă HTTPS. Nu expune direct porturile 8787 sau 20128 pe internet.

## Windows — build GitHub Actions

1. Înlocuiește fișierele repository-ului GitHub cu această versiune.
2. Verifică existența `.github/workflows/windows-build.yml`.
3. Intră la **Actions → Build AI Stoica Windows**.
4. Workflow-ul pornește automat după push pe `main`; sau folosește **Run workflow**.
5. La final installerul apare în **Releases** (cu `latest.yml` pentru actualizarea automată).
6. Rulează `AI_Stoica_Setup_<versiune>_x64.exe`.

## Prima pornire

1. Creează un cont cu email și parolă.
2. Intră la **Setări**.
3. Cel mai simplu: urmează ghidul de la prima pornire și pune o cheie Gemini gratuită (Setări → API-uri AI → „Testează cheile”).
4. Opțional, cu OmniRoute: Base URL `http://127.0.0.1:20128/v1`, cheia API OmniRoute și modelul ales din listă.
5. Pentru drepturi de Owner pe acest PC: Setări → Cont și date → „Email Owner pe acest PC”, apoi deconectează-te și intră din nou.
6. Lasă active **Pornește OmniRoute automat** și **Pornește AI Stoica cu Windows** dacă vrei să ruleze în fundal.

AI Stoica rămâne în tray când închizi fereastra și verifică periodic dacă OmniRoute funcționează.

## iPhone / Android

Aplicația mobilă are autentificare prin email și se conectează la Worker-ul Cloudflare (`apps/cloudflare`). Adresa vine din `EXPO_PUBLIC_GATEWAY_URL`: pentru build-urile EAS se pune în `apps/mobile/eas.json` (sau cu `eas env:create`), nu în secretele GitHub, pentru că EAS construiește pe serverele Expo.

Exemplu `.env` pentru teste locale cu Expo:

```env
EXPO_PUBLIC_GATEWAY_URL=https://ai-stoica.SUBDOMENIUL-TAU.workers.dev
EXPO_PUBLIC_DEFAULT_MODEL=AI Stoica Performance Max
```

## Server propriu (Docker)

Vechiul folder `gateway/` (versiunea 0.4.1, fără limitări de securitate) a fost scos în 0.7.11. Pentru un server propriu folosește `apps/cloud` (același serviciu ca în aplicația Windows, în Docker, cu HTTPS prin Caddy) — vezi `apps/cloud/README.md`.


## Logo oficial

Fișierul aprobat **Stoica Enterprises AI** este inclus exact în `branding/stoica-enterprises-ai-logo.png`, folosit în ecranul de autentificare și în aplicație. Iconițele Windows/iOS/Android sunt derivate din emblema S a aceluiași logo.


## Configurare iOS / App Store

Pachetul mobil este inclus, dar publicarea în App Store nu poate conține dinainte identificatorul proiectului Expo sau acreditările Apple ale contului tău. La prima configurare se rulează `eas init`, apoi se adaugă secretul `EXPO_TOKEN` în GitHub și se configurează contul Apple Developer. Aceste valori sunt personale și nu trebuie incluse în ZIP sau în repository.

## Pornire automată OmniRoute

La deschiderea aplicației, AI Stoica verifică portul `20128`. Dacă OmniRoute nu rulează, pornește în fundal `omniroute.cmd serve`, fără fereastră PowerShell. Watchdog-ul verifică apoi periodic serviciul și încearcă să îl repornească dacă se oprește.
