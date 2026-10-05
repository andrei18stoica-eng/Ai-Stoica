# AI Stoica 0.7.16 — Stoica Enterprises AI

Asistent AI pentru Windows, web (aistoica.ro) și telefon cu chat, proiecte, asistenți, memorie, bibliotecă de fișiere, pluginuri, automatizări, generare de imagini și video, export PDF/Word/PowerPoint/Excel și panou de Owner.

## Noutăți 0.7.16 — modelul ales răspunde, poze prin ChatGPT, ecuații în Word

- **Răspunde modelul pe care îl alegi.** Până acum, când modelul ales (de exemplu o combinație OmniRoute) nu răspundea, AI Stoica trecea pe ascuns la Cerebras sau Groq, iar răspunsurile slabe păreau ale modelului ales. Acum, dacă modelul ales nu răspunde, apare mesajul lui de eroare și poți alege alt model. Cine vrea totuși trecerea automată o pornește din **Setări → API-uri AI → „Rezervă automată”** (pe server: `AI_STOICA_CHAT_FALLBACK=true`).
  - Fără model ales, răspunde prima ta combinație OmniRoute („Ai principal”), nu un API direct.
  - Un model al API-urilor directe ales din listă (de exemplu `groq/…`) răspunde direct prin acel API, chiar și cu OmniRoute oprit, și doar el.
  - Automatizările (Scheduled) urmează aceeași regulă.
  - Lista de modele nu mai rămâne blocată pe un model ales automat cât timp OmniRoute era oprit.
- **Poze prin abonamentul ChatGPT.** Butonul **Poză** încearcă, în ordine: modelul de imagine ales în Setări (dacă ai ales unul), modelul legat de contul tău, modelele din abonamentul tău conectate în OmniRoute (Codex / ChatGPT Web, Gemini Web), apoi API-urile directe și celelalte modele. Un furnizor fără credite trece la coada listei. Modelul care a reușit **rămâne legat** pentru contul tău și e folosit primul data viitoare; dacă pică, trece la următorul, care devine cel legat. Schimbarea setărilor de imagine din Setări pornește din nou alegerea. La fel pentru **Video**, unde modelele web gratuite din OmniRoute (VEO 3.1, Seedance) merg și cu „Doar gratuit”. Claude nu poate genera imagini sau video (Anthropic nu oferă așa ceva); pozele vin din ChatGPT (gpt-image prin Codex).
- **Abonamentele tale personale rămân ale tale.** Modelele care rulează pe conturile tale conectate în OmniRoute prin login sau cookie (ChatGPT / Codex, Gemini, Claude Code) le folosește doar contul Owner. Celelalte conturi de pe site nu le văd și nu le pot alege: condițiile OpenAI, Anthropic și Google interzic folosirea unui cont de către alte persoane. Pentru combinațiile tale OmniRoute („Ai principal”), dă celorlalte conturi din panoul Owner o combinație fără astfel de furnizori.
- **Ecuații matematice ca în Word.** AI-ul scrie formulele în LaTeX, chatul le afișează ca formule, iar fișierele Word (DOCX) le conțin ca **ecuații Microsoft Word reale** (Inserare → Ecuație), editabile: fracții, radicali, puteri și indici, sume, integrale, limite, funcții, matrice, sisteme de ecuații, ecuații aliniate la „=”.
- **Deschizi fișierele fără să le descarci:** poze, video, audio, PDF, Word, PowerPoint, Excel și text se deschid în aplicație (Bibliotecă → „Deschide”, sau din conversație). Pe telefoanele unde browserul nu arată PDF-uri, apare textul PDF-ului.
- **PDF-urile cu diacritice se citesc.** PDF-urile făcute de Word, de browsere sau de AI Stoica, cu fonturi pentru ș, ț, ă, nu dădeau niciun text (sau dădeau caractere fără sens), deci AI-ul nu le putea folosi. Acum sunt citite prin tabelele de caractere ale fonturilor, cu aceleași limite de dezarhivare ca înainte (un PDF mic „umflat” la sute de MB nu blochează serverul).
- **Code AI Stoica** (meniul lateral → Instrumente): alegi un model de cod și pornești o conversație de programare cu asistentul „AI Stoica Code”. Owner-ul are **Codex** și **Claude Code** din abonamentele lui conectate în OmniRoute, plus OpenAI și Claude prin API. Alt cont vede butonul doar dacă Owner-ul îi dă acces: **Control Center → contul → „Code AI Stoica”**. Contul acela folosește doar API-urile OpenAI / Claude, plătite pe consum, nu abonamentele Owner-ului, pentru că condițiile ChatGPT și Claude nu permit împărțirea contului.
- **Redenumești fișierele.** În Bibliotecă (previzualizare) și în fereastra care deschide o poză, un video sau un document, apeși creionul de lângă nume. Fără extensie, extensia veche rămâne (de exemplu „Raport final” devine „Raport final.docx”). Numele nou apare și în conversațiile unde e folosit fișierul, iar la descărcare fișierul are noul nume.
- **Toate setările și pe site (Owner).** Pe aistoica.ro, contul Owner deschide **Setări** și are aceleași secțiuni ca în Windows: AI & OmniRoute, API-uri AI (chei, furnizori folosiți, rezervă automată), Poze, Video, Voce. Ce salvezi se păstrează pe server (`server-settings.json` în volumul de date, nu în GitHub), are prioritate față de `.env` și se aplică imediat, pentru toate conturile. Cheile se văd doar mascat. Emailul Owner, înregistrarea conturilor și adresele serviciilor rămân în `.env`. Ca video-urile plătite (Gemini Veo, Sora, Grok) să meargă pe site: Setări → Video → Protecție costuri → „Permite provideri cu plată”.
- **Cerebras e oprit; tu alegi furnizorii.** Setări → API-uri AI → **Furnizori folosiți în chat**: bifezi OpenAI, Claude, Gemini, Grok… Un furnizor debifat nu mai apare în listă și nu răspunde, nici ca rezervă (pe server: `AI_STOICA_BLOCKED_PROVIDERS`). Cerebras pornește debifat. Combinațiile OmniRoute („Ai principal”) rămân; ce modele conțin le alegi în panoul OmniRoute.
- **Grok (xAI)** pentru chat, poze (Grok Imagine) și video (Grok Imagine Video), cu o cheie xAI (`XAI_API_KEY` pe server). **Poze prin Gemini** („Nano Banana”, cheia Gemini) și **video prin OpenAI Sora** (cheia OpenAI). Sunt plătite pe consum, deci pornesc doar cu „Permite provideri cu plată” la Poze / Video.
- **Poze doar cu Gemini (Nano Banana), video doar cu Gemini (Veo).** Setări → Poze / Video → **„Făcute de”**: implicit „Doar Gemini”, cu modelul ales acolo (Nano Banana 2, Nano Banana Pro, Nano Banana; Veo 3.1 Fast, Veo 3.1, Veo 3 Fast). Pollinations, Cloudflare, OpenRouter, ChatGPT, Grok și ceilalți nu mai sunt chemați. Gemini merge prin cheia Gemini (Setări → API-uri AI) sau prin Gemini conectat în OmniRoute; prin cheie e plătit, deci cere „Permite provideri cu plată”. Dacă Gemini nu poate face poza, eroarea spune ce lipsește. Pe server: `AI_STOICA_IMAGE_PROVIDERS` / `AI_STOICA_VIDEO_PROVIDERS` (implicit `gemini`; gol = toți).
- **Poza o face modelul pe care îl întrebi.** Scrii în chat „fă-mi o poză cu…”, „vreau un video cu…” sau „poți să-mi faci o imagine…?” și AI Stoica face fișierul. Dacă ai ales un model ChatGPT/OpenAI, Gemini sau Grok, poza (sau videoclipul) o face compania lui: întâi abonamentul conectat în OmniRoute (Codex pentru ChatGPT, Gemini Web pentru Gemini; fără API), apoi API-ul ei (GPT Image / Sora, Nano Banana / Veo, Grok Imagine). Cu o combinație („Ai principal”) sau cu un model care nu face poze (Claude, Groq…) se folosește Setări → Poze / Video → „Făcute de”.
- **„Testează cheile” verifică și OmniRoute pe bucăți.** Setări → API-uri AI → Testează cheile: arată dacă cheia OmniRoute e bună, apoi pune o întrebare scurtă primei combinații și câte unui model Gemini, Grok, OpenAI și Claude din OmniRoute. Așa vezi dacă un 401 vine de la cheie sau de la contul unui furnizor (care trebuie reconectat în OmniRoute → Providers). Eroarea din chat spune la fel cine a refuzat.
- **Aspect nou, verificat cu skill-urile de design** (emilkowalski/skills, impeccable, taste-skill; sunt în `.claude/skills`):
  - **Câmpul de mesaj:** textul sus, uneltele pe un singur rând dedesubt: ➕ (încarcă poze / video / audio / orice fișier, Bibliotecă, căutare web, Deep Research), **Poză**, **Video**, **Gândire** (pornit = răspuns atent, oprit = Rapid), apoi microfonul și trimiterea.
  - **Sub răspuns:** un singur buton **Descarcă** (PDF, Word, PowerPoint) în loc de trei etichete.
  - **Cine a răspuns de fapt:** dacă alegi combinația „Ai principal”, iar OmniRoute o trimite la alt model, eticheta de sub răspuns arată „Ai principal → modelul care a răspuns”.
  - **Meniul lateral:** toate uneltele arată la fel, iar numele secțiunilor nu mai sunt cu majuscule. Butoanele au o singură culoare, fără gradient.
  - **Telefon:** fără zoom când apeși pe câmpul de mesaj (iPhone), fără flash la atingere și fără efecte de hover rămase după atingere. Meniul lateral alunecă lin. Conținutul nu mai intră sub notch sau sub bara de jos, iar pe Android tastatura nu mai acoperă câmpul. Cardul „Convertește în aplicație” stă pe rândul lui și nu mai acoperă conversația.
  - **Codul** are o bară cu limbajul și „Copiază”, care nu mai stă peste cod. Numerele din tabele nu se mai rup pe telefon.
  - **„Mișcare redusă”** din sistem e respectată (fără alunecări).
- **Verificat cu procedura pluginului „code-review” (Anthropic):** cinci recenzii independente pe tot codul 0.7.16; problemele găsite (modelele API directe alese din listă, limitele PDF, ordinea modelului de imagine din Setări, spații în textul PDF, bold în jurul formulelor, sume ca „5$/lună”) sunt reparate și au teste.
- **Actualizare cu un buton.** Pe site (contul Owner): **Setări → „Actualizează site-ul acum”**. Serverul descarcă ultima versiune de pe GitHub, reconstruiește site-ul (1–5 minute), iar pagina se reîncarcă singură. Bifa **„Actualizare automată a site-ului”** face ca serverul să verifice o dată pe oră și să instaleze singur versiunea nouă. Site-ul doar cere actualizarea; o rulează un serviciu de pe server (`deploy/hetzner/install-updater.sh`, instalat automat de `update.sh`). **Aplicația Windows** se actualizează singură la pornire (Setări → General → „Caută actualizări acum”), din GitHub Releases.
- **Butonul „Convertește AI Stoica în aplicație pe telefon”**, cu logo și nume, apare pe site (pagina de autentificare și în aplicație, până îl închizi). Pe Android instalează direct; pe iPhone arată pașii din Safari. Aplicația instalată se numește „AI Stoica” și pornește cu ecranul cu logo.

## Noutăți 0.7.15 — totul pe serverul Hetzner, mereu online

- **Windows → Setări → API-uri AI → „Copiază cheile pentru server”:** Setările arată cheile salvate doar mascat („••••”), așa că nu puteau fi copiate pentru server. Butonul le copiază pe toate (inclusiv cheia OmniRoute) în formatul cerut de server, fără să le arate pe ecran; clipboard-ul se golește după 2 minute.
- **Instalarea pe server dintr-o singură comandă:** `sudo bash /opt/ai-stoica/deploy/hetzner/setup-web.sh` face pașii pentru aistoica.ro: copie de siguranță a `.env`, verifică DNS-ul și memoria (oferă swap pe serverele mici), pornește profilurile `edge,web`, generează secretele OmniRoute, primește cheile lipite din Windows, pornește OmniRoute, explică importul bazei de pe PC, verifică cheia OmniRoute, construiește site-ul și verifică `/health` și HTTPS. Se poate rula din nou fără să strice nimic.
- Aplicația Windows poate folosi direct serverul: **Setări → AI & OmniRoute → Adresa serviciului AI Stoica: `https://aistoica.ro`**, deci merge și când OmniRoute de pe PC e oprit.

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

### OmniRoute reparat (verificat cu OmniRoute 3.8.51 real)

- **Cauza principală:** OmniRoute 3.8 refuză cererile fără **cheie API de client** (răspunde 401), iar AI Stoica arăta doar „OmniRoute oprit” și o listă goală. Acum bara de sus spune **„OmniRoute cere cheie API”**, iar mesajul explică unde se creează cheia (vezi „OmniRoute pe Windows” mai jos).
- **Combinațiile** („Ai principal”, `auto/best-coding` etc.) sunt recunoscute după marcajul OmniRoute (`owned_by: combo`) și apar primele în listă. Toate modelele, gratuite și plătite, apar pentru Owner.
- **Setări → API-uri AI → „Testează cheile”** verifică și OmniRoute: câte modele și combinații are sau ce lipsește.
- Când o combinație eșuează, mesajul spune ce furnizor din ea a picat și de ce. (Din 0.7.16, chatul trece la API-urile directe doar cu „Rezervă automată” pornită.)
- **Online nonstop pe Windows:** watchdog-ul repornește OmniRoute și când procesul rămâne blocat (portul deschis, dar fără răspuns 90 de secunde). Spune clar dacă OmniRoute nu e instalat și nu mai pornește un OmniRoute local când adresa lui e pe server. „Repornește OmniRoute” din tray îl repornește cu adevărat.

### Imagini, video și chat: trecere automată când se termină creditele

- Când un furnizor răspunde că nu mai are credite (402, „insufficient credits”, „quota”), AI Stoica trece imediat la următorul. **Ține minte o oră** că a rămas fără credite, așa că următoarele imagini merg direct la ceilalți (la limită de viteză, 429: 2 minute). Rămâne totuși ultimul în listă, deci o cerere nu pică doar din cauza asta.
- La fel pentru video și pentru chatul pe API-uri directe.

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

Pași după actualizare: vezi „Pași pentru Owner după 0.7.16” mai jos.

## OmniRoute pe Windows (cheia API)

OmniRoute 3.8 nu mai răspunde fără cheie de client. O singură dată:

1. Deschide panoul OmniRoute: http://127.0.0.1:20128 → **API Manager** → **Create API Key** și copiază cheia (`sk-…`).
2. AI Stoica → **Setări → AI & OmniRoute → Cheie API OmniRoute**: lipește cheia și salvează.
3. **Setări → API-uri AI → „Testează cheile”**: rândul OmniRoute trebuie să arate câte modele și combinații are.
4. Ca să apară și modelele plătite, în OmniRoute → Settings dezactivează „Hide paid models”, dacă e pornit.

## Site-ul aistoica.ro (versiunea web și aplicația de telefon)

Pe serverul Hetzner (`/opt/ai-stoica`), o singură dată. **Cel mai simplu (0.7.15):** după DNS (pasul 1), rulează

```bash
sudo bash /opt/ai-stoica/deploy/hetzner/update.sh && sudo bash /opt/ai-stoica/deploy/hetzner/setup-web.sh
```

și răspunde la întrebări; cheile le copiezi din Windows cu **Setări → API-uri AI → „Copiază cheile pentru server”** și le lipești când scriptul le cere. Pașii de mai jos sunt ce face scriptul, pentru cine vrea să-i facă de mână:

1. **DNS:** la firma unde e cumpărat domeniul, adaugă o înregistrare **A** pentru `aistoica.ro` cu IP-ul serverului (același ca la `api.aistoica.ro`). Opțional, și `www.aistoica.ro`.
2. În `deploy/hetzner/.env`: `AI_STOICA_WEB_DOMAIN=aistoica.ro`, `COMPOSE_PROFILES=edge,web`, un `OMNIROUTE_WS_BRIDGE_SECRET` aleator și **aceleași chei ca în aplicația Windows** (Setări → API-uri AI) — atunci site-ul are aceleași modele: Cerebras, Groq, Gemini, Mistral, NVIDIA, GitHub Models, Cloudflare, Cohere, Hugging Face, plus cheile pentru imagini și video. Cheile stau doar în `.env` pe server.
3. **OmniRoute** pornește odată cu site-ul (pune și `OMNIROUTE_INITIAL_PASSWORD` în `.env`). Ca să ai aceleași combinații ca pe Windows („Ai principal” etc.), deschide-i panoul printr-un tunel SSH (`ssh -L 20129:127.0.0.1:20128 root@IP_SERVER`, apoi http://127.0.0.1:20129) și conectează aceiași furnizori.
   - **Aceleași furnizori și combinații ca pe PC:** pe PC, în panoul OmniRoute → **Settings → System & Storage → Export Database** (fișier `.sqlite`). Pe server, prin tunel, intră în panou și alege **Import Database** cu fișierul. Am testat: combinațiile, cheile API ale OmniRoute și parola de admin trec pe server. Dacă un furnizor arată eroare după import, pune-i din nou cheia în OmniRoute.
   - **Cheia API:** după import merge aceeași cheie ca pe PC; altfel creeaz-o în **API Manager**. Pune-o în `.env` la `OMNIROUTE_API_KEY`, fără ea site-ul nu vede OmniRoute.
4. `cd /opt/ai-stoica/deploy/hetzner && docker compose up -d --build web caddy`, apoi `curl http://127.0.0.1:8788/health`.
5. Deschide https://aistoica.ro, creează contul (sau intră cu contul Owner) și aprobă din panoul Owner conturile noi.

La actualizări, `sudo bash /opt/ai-stoica/deploy/hetzner/update.sh` reconstruiește și site-ul. Dacă folderul aparține altui utilizator (pe serverul de producție: `aistoica`, cu cheia de acces la GitHub), `update.sh` rulează `git` ca acel utilizator.

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
| `lib/math.cjs` | formulele LaTeX devin ecuații Word (Office Math) |
| `lib/pdftext.cjs` | textul PDF-urilor prin tabelele de caractere ale fonturilor |
| `renderer/src/serverUpdate.jsx` | „Actualizează site-ul” pentru Owner (serviciul de pe server: `deploy/hetzner/update-runner.sh`, `install-updater.sh`) |
| `lib/schedule.cjs` | calculul orei următoarei rulări pentru automatizări (cu fus orar) |
| `lib/netguard.cjs` | blochează accesul pluginurilor la adrese interne |
| `lib/providers.cjs` | modelele gratuite ale fiecărui provider și paginile de unde se iau cheile |
| `renderer/src/main.jsx` | interfața |
| `scripts/test-*.cjs` | teste rulate automat de GitHub la fiecare modificare |

## Pași pentru Owner după 0.7.16

1. **Cloudflare (aplicația de telefon):** în `apps/cloudflare` rulează migrările (`npx wrangler d1 migrations apply ai-stoica --remote`, include `0005`), setează secretele `OWNER_EMAIL` și `OWNER_SETUP_CODE`, publică Worker-ul și creează imediat contul Owner (cu codul de configurare). Detalii în `apps/cloudflare/README.md`.
2. **Telefon:** în `apps/mobile/eas.json` înlocuiește `https://ai-stoica.SUBDOMENIUL-TAU.workers.dev` cu adresa Worker-ului tău (sau folosește `eas env:create`), apoi pornește „Build AI Stoica Mobile with EAS”.
3. **Server Hetzner:** în `.env` păstrează `OWNER_EMAIL` și `OWNER_INITIAL_PASSWORD`; la actualizare rulează `deploy/hetzner/update.sh`.
4. **Windows:** după ce apare release-ul v0.7.16 (cu `latest.yml`), aplicațiile cu „Actualizări automate” pornite se actualizează singure la următoarea pornire. Release-urile v0.7.11 și v0.7.13 au fost publicate fără reparația de publicare: dacă aplicația nu se actualizează, instalează 0.7.16 o dată de mână, de aici înainte actualizările vin singure.
5. **Site-ul aistoica.ro:** DNS-ul, apoi `sudo bash deploy/hetzner/setup-web.sh` (vezi „Site-ul aistoica.ro” mai sus).
6. **Windows pe server:** Setări → AI & OmniRoute → Adresa serviciului AI Stoica: `https://aistoica.ro`, apoi intri cu contul de pe server.
7. **Site-ul la 0.7.16:** pe server, **o singură dată**, `sudo bash /opt/ai-stoica/deploy/hetzner/update.sh`, apoi încă o dată aceeași comandă: a doua rulare instalează butonul „Actualizează site-ul”. De aici înainte actualizezi din aplicație (Setări), fără consolă.
8. **Poze prin abonamentul ChatGPT pe site:** în panoul OmniRoute de pe server (prin tunel), la furnizori, conectează **Codex** (autentificare cu contul ChatGPT). Opțional, în `deploy/hetzner/.env`: `AI_STOICA_IMAGE_MODEL=codex/gpt-5.6-sol`, apoi `update.sh`.

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
