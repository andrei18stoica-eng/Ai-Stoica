# Oracle Cloud Always Free — AI Stoica 24/7

Acest ghid pornește AI Stoica Gateway + OmniRoute + Redis + HTTPS pe un VM Oracle Cloud Ubuntu, pentru aplicația desktop. Aplicația de telefon folosește Worker-ul Cloudflare (vezi pasul 8).

## 1. Creează VM-ul

În Oracle Cloud Console creează o instanță Compute cu:

- o formă marcată **Always Free eligible**; pentru ARM, `VM.Standard.A1.Flex` este potrivită;
- Ubuntu;
- public IPv4;
- cheia SSH salvată în siguranță.

OmniRoute publică imagini Docker native pentru `linux/arm64`, deci Ampere A1 poate rula fără emulare.

## 2. Reguli de rețea

În subnet / Security List sau Network Security Group permite:

- TCP 22 doar din IP-ul tău, dacă este posibil;
- TCP 80 din internet;
- TCP 443 din internet.

NU publica în internet:

- 20128 — OmniRoute;
- 8787 — AI Stoica Gateway;
- 6379 — Redis.

Aceste porturi rămân private/loopback prin Docker Compose.

## 3. HTTPS fără domeniu plătit

Poți folosi un hostname gratuit bazat pe IP prin `sslip.io`.

Dacă IP-ul public al VM-ului este, de exemplu, `203.0.113.10`, hostname-ul poate fi:

```
203.0.113.10.sslip.io
```

Acesta rezolvă către IP-ul VM-ului și Caddy poate obține automat un certificat HTTPS.

## 4. Instalează Docker

După conectarea SSH și clonarea repository-ului:

```bash
cd Ai-Stoica
sudo bash apps/cloud/install-ubuntu.sh
```

## 5. Configurează AI Stoica

```bash
cd apps/cloud
cp .env.example .env
openssl rand -hex 32
```

Editează `.env`:

```env
AI_STOICA_DOMAIN=203.0.113.10.sslip.io
AI_STOICA_OWNER_EMAIL=emailul-tau@exemplu.ro
OMNIROUTE_BASE_URL=http://omniroute:20128/v1
OMNIROUTE_API_KEY=
AI_STOICA_DEFAULT_MODEL=
AI_STOICA_SPEECH_MODEL=openai/whisper-1
AI_STOICA_SPEECH_LANGUAGE=ro
AI_STOICA_OPEN_REGISTRATION=false
OMNIROUTE_WS_BRIDGE_SECRET=SECRETUL_GENERAT_MAI_SUS
```

`AI_STOICA_DEFAULT_MODEL` gol înseamnă că Gateway-ul alege modelul; poți pune un id exact din OmniRoute (de exemplu `groq/openai/gpt-oss-120b`). Nu folosi „Ai principal”: selectarea automată este dezactivată și Gateway-ul ar refuza cererile. Celelalte variabile opționale sunt descrise în `.env.example`.

## 6. Pornește serviciile

```bash
bash deploy-oracle.sh
```

Scriptul pornește containerele, verifică starea și testează:

```
https://DOMENIU/health
```

Containerele folosesc `restart: unless-stopped`, deci repornesc automat după reboot.

Creează imediat contul tău cu e-mailul din `AI_STOICA_OWNER_EMAIL`: cât timp `AI_STOICA_OPEN_REGISTRATION=false`, după primul cont nu se mai pot crea altele.

## 7. Configurează OmniRoute

Dashboard-ul OmniRoute rămâne privat. Creează de pe PC un tunel SSH:

```bash
ssh -L 20128:127.0.0.1:20128 ubuntu@IP_SERVER
```

Apoi deschide pe PC:

```
http://127.0.0.1:20128
```

Conectează furnizorii și modelele. În aplicația desktop fiecare utilizator alege manual modelul dintre cele disponibile.

## 8. Aplicația mobilă

Telefonul NU se leagă de acest Gateway: aplicația mobilă folosește Worker-ul Cloudflare (`apps/cloudflare`), care are încărcarea de fișiere, exportul și aprobarea conturilor de care are nevoie. Publică Worker-ul după `apps/cloudflare/README.md`, apoi pune adresa lui în `apps/mobile/eas.json`:

```env
EXPO_PUBLIC_GATEWAY_URL=https://ai-stoica.<subdomain>.workers.dev
EXPO_PUBLIC_DEFAULT_MODEL=AI Stoica Performance Max
```

Detalii în `apps/mobile/README.md`. Același URL este folosit de iPhone, iPad și Android.

## 9. Build iOS

Pentru instalare pe iPhone/iPad este necesară semnarea Apple. După conectarea proiectului la Expo/EAS și Apple Developer (și după ce ai pus adresa Worker-ului în `eas.json`):

```bash
cd apps/mobile
eas build --platform ios --profile preview
```

Pentru TestFlight/App Store:

```bash
eas build --platform ios --profile production
eas submit --platform ios --profile production
```

## 10. Verificare

Pe server:

```bash
cd apps/cloud
docker compose ps
curl https://DOMENIU/health
```

Răspunsul trebuie să indice `ok: true`. Pentru funcționarea completă, câmpul OmniRoute trebuie să devină disponibil după configurarea furnizorilor.
