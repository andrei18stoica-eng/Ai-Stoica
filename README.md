# AI Stoica 0.7.10 — Stoica Enterprises AI

Asistent AI pentru Windows (plus aplicație mobilă) cu chat, proiecte, asistenți, memorie, bibliotecă de fișiere, pluginuri, automatizări, generare de imagini și video, export PDF/Word/PowerPoint/Excel și panou de Owner.

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
| `renderer/src/main.jsx` | interfața |
| `scripts/test-*.cjs` | teste rulate automat de GitHub la fiecare modificare |

Notă: `package-lock.json` lipsește încă. Pentru build-uri identice, generează-l o dată în `apps/desktop` (instalarea pachetelor cu npm) și urcă fișierul rezultat.

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

Pe Windows, aplicația pornește un **Gateway local** la `http://127.0.0.1:8787`. Conturile și conversațiile sunt salvate local pe PC. Același cod de Gateway din folderul `gateway/` poate fi publicat ulterior pe un server HTTPS pentru sincronizare Windows + iPhone/iPad/Android din orice rețea.

Pentru sincronizare reală între dispozitive, Gateway-ul trebuie să fie disponibil permanent la o adresă HTTPS. Nu expune direct porturile 8787 sau 20128 pe internet.

## Windows — build GitHub Actions

1. Înlocuiește fișierele repository-ului GitHub cu această versiune.
2. Verifică existența `.github/workflows/windows-build.yml`.
3. Intră la **Actions → Build AI Stoica Windows**.
4. Workflow-ul pornește automat după push pe `main`; sau folosește **Run workflow**.
5. La final descarcă artifact-ul Windows din pagina workflow-ului.
6. Rulează `AI_Stoica_Setup_<versiune>_x64.exe`.

## Prima pornire

1. Creează un cont cu email și parolă.
2. Intră la **Setări**.
3. Base URL: `http://127.0.0.1:20128/v1`
4. Introdu cheia API OmniRoute.
5. Model/combo: `Ai principal`
6. Lasă active **Pornește OmniRoute automat** și **Pornește AI Stoica cu Windows**.

AI Stoica rămâne în tray când închizi fereastra și verifică periodic dacă OmniRoute funcționează.

## iPhone / Android

Aplicația mobilă are autentificare prin email și folosește `EXPO_PUBLIC_GATEWAY_URL`. Pentru teste pe telefon trebuie să setezi URL-ul unui Gateway AI Stoica accesibil telefonului. Pentru App Store, recomandarea este Gateway HTTPS găzduit permanent.

Exemplu `.env` mobil:

```env
EXPO_PUBLIC_GATEWAY_URL=https://gateway.exemplu.ro
EXPO_PUBLIC_DEFAULT_MODEL=Ai principal
```

## Gateway separat

Folderul `gateway/` conține serverul pentru autentificare, conversații, proiecte, asistenți și proxy OmniRoute. Configurează variabilele din `.env.example`. Pentru publicare pe internet folosește HTTPS, firewall și stocare persistentă; înainte de utilizare publică se recomandă trecerea bazei JSON la PostgreSQL.


## Logo oficial

Fișierul aprobat **Stoica Enterprises AI** este inclus exact în `branding/stoica-enterprises-ai-logo.png`, folosit în ecranul de autentificare și în aplicație. Iconițele Windows/iOS/Android sunt derivate din emblema S a aceluiași logo.


## Configurare iOS / App Store

Pachetul mobil este inclus, dar publicarea în App Store nu poate conține dinainte identificatorul proiectului Expo sau acreditările Apple ale contului tău. La prima configurare se rulează `eas init`, apoi se adaugă secretul `EXPO_TOKEN` în GitHub și se configurează contul Apple Developer. Aceste valori sunt personale și nu trebuie incluse în ZIP sau în repository.

## Pornire automată OmniRoute

La deschiderea aplicației, AI Stoica verifică portul `20128`. Dacă OmniRoute nu rulează, pornește în fundal `omniroute.cmd serve`, fără fereastră PowerShell. Watchdog-ul verifică apoi periodic serviciul și încearcă să îl repornească dacă se oprește.
