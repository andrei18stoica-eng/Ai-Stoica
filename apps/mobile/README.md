# AI Stoica Mobile — iPhone, iPad și Android

Aplicația mobilă folosește Expo/React Native și același cod pentru iOS și Android.

## Backend

Telefonul se conectează la Worker-ul Cloudflare din `apps/cloudflare` (conturi, conversații, fișiere, export PDF/DOCX/PPTX, imagini, GitHub Solve). Publică mai întâi Worker-ul după `apps/cloudflare/README.md`.

Gateway-ul Docker din `apps/cloud` (Oracle/VPS) este pentru aplicația desktop; telefonul nu se configurează către el.

## Adresa serverului în build

`EXPO_PUBLIC_GATEWAY_URL` este inclusă în aplicație în momentul build-ului. Build-urile EAS rulează pe serverele Expo și NU văd variabilele din terminalul tău sau din GitHub Actions, iar fișierul `.env` nu este urcat (este în `.gitignore`).

Alege una dintre variante:

1. În `eas.json`, la fiecare profil (`preview`, `production`), înlocuiește `https://ai-stoica.SUBDOMENIUL-TAU.workers.dev` cu adresa reală a Worker-ului.
2. Sau păstrează `eas.json` și creează variabila în EAS:

```bash
eas env:create --name EXPO_PUBLIC_GATEWAY_URL --value https://ai-stoica.<subdomain>.workers.dev --environment preview --environment production --visibility plaintext
```

   apoi șterge cheia `EXPO_PUBLIC_GATEWAY_URL` din `env` în `eas.json`, ca adresa să fie definită într-un singur loc.

Dacă adresa lipsește sau a rămas cea de exemplu, aplicația afișează pe ecranul de autentificare ce trebuie corectat.

Pentru rulare locală (`npx expo start`), copiază `.env.example` în `.env` și completează adresa.

## Contul Owner

În „Cont nou”, Owner-ul completează și câmpul „Cod Owner” cu valoarea secretului `OWNER_SETUP_CODE` din Cloudflare. Ceilalți utilizatori lasă câmpul gol; conturile lor așteaptă aprobarea Owner-ului din meniu → „Conturi și cereri de acces”.

## Utilizare

- „Răspuns ca: PDF / DOCX / PPTX” creează un fișier din următorul răspuns (o singură dată); butoanele de sub fiecare răspuns exportă un răspuns existent.
- Butonul ▧ generează o imagine din textul scris.
- Apasă lung pe o conversație din meniu pentru a o șterge; trage în jos lista pentru reîmprospătare.

## Verificare locală

```bash
npm install --legacy-peer-deps
npm run doctor
npm run export:ios
npm run export:android
```

## Build iPhone / iPad

Pentru un build semnat instalabil pe dispozitive Apple este necesar un cont Apple Developer și proiectul trebuie legat la un cont Expo/EAS.

```bash
eas init
eas build --platform ios --profile preview
```

Pentru App Store/TestFlight:

```bash
eas build --platform ios --profile production
eas submit --platform ios --profile production
```

Numărul build-ului este ținut de EAS (`cli.appVersionSource: "remote"`), deci crește corect și când build-ul pornește din GitHub Actions. Actualizările OTA (`expo-updates`) sunt oprite; pentru ele rulează `eas update:configure`.

Repository-ul include și workflow-ul GitHub Actions **Build AI Stoica Mobile with EAS**, care are nevoie de secretul `EXPO_TOKEN`. Adresa serverului vine din `eas.json` sau din variabilele EAS (vezi mai sus).

Nu salva tokenuri Apple, Expo sau chei de AI în repository.

## Build Android

```bash
eas build --platform android --profile preview
```

sau profilul `production` pentru distribuția finală.
