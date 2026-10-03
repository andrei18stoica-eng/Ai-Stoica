# AI Stoica — situația completă a proiectului

Document de bază, scris la 2026-10-03, după ce 0.7.11 a ajuns pe `main`. Pornește de la descrierea Owner-ului și o corectează acolo unde repo-ul spune altceva. Pentru lucrul zilnic cu Claude Code vezi `CLAUDE.md`; pentru publicare, `docs/PUBLICARE_RELEASE.md`.

## Cum se citesc stările

| Semn | Înseamnă |
|---|---|
| **În cod + teste** | există în repo și îl acoperă un test automat |
| **În cod** | există în repo, fără test automat (se verifică manual) |
| **Declarat** | spus de Owner din sesiuni anterioare; nu poate fi verificat din repo |
| **Lipsește** | cerut sau decis, dar nu există în repo |

„Verde în GitHub” nu înseamnă „funcționează în producție”: au existat ecrane negre cu CI verde. De aceea fiecare afirmație de mai jos are o stare.

## 1. Ce vrem să construim

O platformă AI proprie, sub identitatea Stoica Enterprises AI, în care utilizatorul intră într-un singur loc și nu merge separat la ChatGPT, Gemini, Claude sau Groq. AI Stoica alege furnizorul și modelul prin rutare și arată răspunsul într-o singură interfață, cu conversații, istoric, atașamente, memorie, bibliotecă, pluginuri, automatizări, generare de imagini și video, conturi și sincronizare.

Clienți țintă: Windows, telefon (iPhone/Android), orice browser. Pentru iPhone s-a ales PWA (Safari → Add to Home Screen), ca să nu fie nevoie de abonament Apple Developer.

## 2. Arhitectura

```
Utilizator → clienți (Windows / telefon / PWA) → backend AI Stoica → rutare modele (OmniRoute sau chei directe) → furnizori AI → răspuns
```

Alături de rutare, backend-ul ține autentificarea, conversațiile, memoria, fișierele și biblioteca.

```
GitHub (cod, versiuni, teste, build, Releases)
      │
      ▼
Hetzner (API + PostgreSQL + Caddy) ── aistoica.ro / api.aistoica.ro ── utilizator
```

GitHub nu este AI Stoica: după instalare, serverul are propria copie a codului și nu cere GitHub la fiecare mesaj. Totuși repo-ul rămâne: fără istoric nu poți vedea ce s-a schimbat între 0.7.11 și 0.7.12.

## 3. Repo-ul

`andrei18stoica-eng/Ai-Stoica` (privat). Structura și regulile de lucru sunt în `CLAUDE.md`. Se lucrează doar prin ramură → PR → verificări → merge; nu direct pe `main`.

## 4. Versiunile și starea 0.7.11

- Seria 0.6.x: funcții AI și media. 0.7.10 a fost finalizată la commitul `e205278`.
- După `e205278`, `main` a primit PR #19–#26 (lock-ul desktop, protecția ramurii, audituri desktop/core, actualizare automată Windows, mobile și cloud, Cloudflare, generare explicită de fișiere, paginare conversații), ajungând la `7fe0dc2`.
- Patch-ul 0.7.11 fusese făcut pe `e205278` și nu se aplica curat. A fost rebazat pe `7fe0dc2`: unde 0.7.11 și PR #21–#26 rezolvau aceeași problemă s-a luat varianta 0.7.11; din `main` au rămas cititorul Access, stocarea conversațiilor în fișiere separate, secretul opțional `EXPO_PUBLIC_GATEWAY_URL` și `package-lock.json`.
- **Rezultat:** PR #27, merge commit `67aedad` pe `main`.
- **Neverificat:** verificările din GitHub n-au rulat (joburi blocate de facturare). Local au trecut cele 10 teste desktop, serverul, Worker-ul și build-ul interfeței. Mobile și build-ul Windows nu au rulat nicăieri.
- **Lipsește:** Release-ul `v0.7.11` (installer + `latest.yml` + `.blockmap`).

Schimbare față de Cloudflare 0.7.10: Owner-ul Worker-ului se creează și se resetează cu `OWNER_SETUP_CODE`, nu cu `OWNER_INITIAL_PASSWORD`.

## 5. Infrastructura de producție

Totul din această secțiune este **declarat**; repo-ul conține doar configurația (`deploy/hetzner`), nu starea serverului.

- Server Hetzner, proiect `ai-stoica-prod`, instalare în `/opt/ai-stoica`. Ales în locul variantelor gratuite (Oracle Always Free) pentru funcționare 24/7 predictibilă.
- Domeniu `aistoica.ro`; API la `api.aistoica.ro`, care rezolva către `178.104.117.42`.
- Docker: PostgreSQL (healthy), API reconstruit (healthy), Caddy pornit. PostgreSQL ține datele persistente; API-ul ține logica; Caddy expune HTTPS.
- Copia de pe server era în urma repo-ului cu ~145 de commit-uri (de la `d76c24f`) și a fost actualizată prin fast-forward: codul din GitHub nu e automat codul de pe server.
- **De verificat cap-coadă:** HTTPS și accesul public final, nu doar rezoluția DNS.

Configurația din repo: PostgreSQL 17 + API legat doar la `127.0.0.1:8787`, Caddy în profilul `edge`, migrări automate la pornire, `update.sh` care refuză checkout-uri modificate. Portul 5432 și 8787 nu se expun direct.

## 6. Conturi, roluri, costuri

**În cod + teste.** Conturi cu email și parolă, roluri Owner și User, aprobare manuală pentru conturi noi, sesiuni persistente (expiră după 30 de zile, se reînnoiesc la deschidere), deconectare reală, limite la încercările de autentificare.

Controlul costurilor: modelele plătite nu trebuie să poată fi consumate liber de toate conturile. Politica din `apps/server/ai-policy.cjs` pornește cu AI plătit dezactivat. Furnizori gratuiți: Cerebras, Gemini, Groq, Cloudflare AI. Plătiți: OpenAI, Anthropic, OpenRouter (acesta poate factura per cerere). Combinațiile plătite (de exemplu GPT + Claude) rămân indisponibile până le activează Owner-ul. Panoul Owner controlează permisiunile (automatizări, pluginuri, încărcare fișiere, documente, Deep Research, web, GitHub, imagini, video).

Ultima verificare declarată: rolurile Owner/User existau și contul Owner era activ.

## 7. Rutare AI și furnizori

- OmniRoute rutează cererile între modele și poate încerca următoarea rută dacă prima nu răspunde. Configurația de fallback discutată (istoric, nu garanție pentru producția de acum): Cerebras GPT-OSS 120B → Cloudflare Nemotron 120B → Cloudflare GPT-OSS 120B → Groq GPT-OSS 120B → Gemini.
- Din 0.7.10 contul de pe PC funcționează și fără OmniRoute, direct cu cheile gratuite configurate (Gemini, Groq, Cerebras, Cloudflare). Setări → API-uri AI → „Testează cheile” verifică fiecare API.
- Furnizori vizați: OpenAI, Gemini, Claude, Groq, Cerebras, Cloudflare AI, OpenRouter, posibil Grok.
- Un abonament (de exemplu ChatGPT Plus) nu dă o cheie API: cheile se creează separat și se pun în configurația securizată a serviciului, niciodată în repo.
- Numele „Ai principal” / „AI Stoica” nu mai sunt modele reale în 0.7.11 (selectarea automată e dezactivată): gateway-ul le înlocuiește cu modelul implicit configurat, iar GitHub Solve și automatizările cer un model ales explicit.

## 8. Funcții

| Funcție | Stare | Note |
|---|---|---|
| Chat, proiecte, asistenți, istoric | În cod + teste | grupare Azi / Ieri / 7 zile / 30 de zile; listă „Arhivate”; redenumire și ștergere proiecte/asistenți |
| Memorie persistentă | În cod + teste | diferită de istoric; înțelege forme românești, caută după sens când există cheie Gemini/Cloudflare; **nu** e echivalentă cu memoria ChatGPT și are nevoie de testare în producție |
| Bibliotecă de fișiere | În cod + teste | text extras din Word, PowerPoint, Excel, PDF cu text, OpenDocument, Access (`.mdb`/`.accdb`) și text/cod |
| Încărcare fișiere mari | În cod | limita se administrează pe server (memorie, spațiu, HTTP); Worker-ul folosește `AI_STOICA_FILE_MAX_MB` |
| Export PDF/DOCX/PPTX/XLSX/CSV/JSON/HTML etc. | În cod + teste | fișierul se face doar la comandă („Fă-mi un PDF cu…”) |
| Generare imagini | În cod + teste | buton propriu; rezultatul merge în Bibliotecă; furnizorii reali (OpenAI, OpenRouter, Pollinations) cer cheie configurată și nu sunt testați în CI |
| Generare video | În cod + teste | buton propriu; implicit 4 s, 720p, 16:9; jobul se urmărește și rezultatul MP4 se descarcă; același comentariu despre furnizori |
| Pluginuri, `@plugin`, OAuth | În cod + teste parțiale | blocare adrese interne testată; fluxurile OAuth cu servicii reale nu sunt testate |
| Automatizări, `@auto` | În cod + teste parțiale | calculul programărilor, fusul orar și validarea sunt testate; scheduler-ul pe server în scenarii reale **trebuie verificat manual** |
| Butonul Stop | În cod | anulează și cererea către furnizor |
| Dictare vocală / microfon | În cod | doar verificare manuală; depinde de Chromium/Windows |
| Selector de modele, indicator de gândire, Copy/Paste, revenire la ultimul mesaj | În cod, **de confirmat în aplicație** | cerute de Owner în ciclurile 0.6.x–0.7.x; interfața 0.7.11 a fost verificată manual în browser (44 de verificări, vezi `VERIFICARE_FINALA.md`), nu în CI |
| Aplicație Windows (Electron, tray, auto-update) | În cod + teste | actualizarea automată cere `latest.yml` + `.blockmap` în Release; de verificat manual la instalare |
| Aplicație telefon (Expo) | În cod | se conectează la Worker-ul Cloudflare; verificată doar de workflow-ul Mobile, care n-a rulat pe 0.7.11 |
| PWA / web pentru iPhone | **Lipsește** | decizia e luată, dar în repo nu există manifest, service worker sau frontend servit de `apps/server` |
| Cloud Cloudflare (D1/R2) | În cod + teste | folosit de aplicația de telefon; Owner a decis să mute părți spre Hetzner, deci schemele Cloudflare istorice nu sunt arhitectura finală |

## 9. Fluxuri

**Conversație:** utilizatorul se autentifică → clientul recunoaște contul și rolul → scrie, vorbește sau atașează un fișier → backend-ul verifică drepturile → cererea intră în rutare → furnizorul încearcă modelul, iar la nevoie următoarea rută → răspunsul revine în interfață → conversația și informațiile persistente sunt salvate de serviciile aplicației.

**Media:** cerere imagine/video (buton) → rută media → API → job → rezultat → fișier → afișare și Bibliotecă.

## 10. Ce e confirmat și ce nu

**Confirmat (din repo și teste locale, 2026-10-03):** codul 0.7.11 pe `main`; testele desktop, serverul, Worker-ul și build-ul interfeței trec local; versiune identică în toate fișierele.

**Declarat, neverificat din repo:** serverul Hetzner și deploy-ul din `/opt/ai-stoica`, containerele healthy, DNS-ul `api.aistoica.ro`, rolurile și contul Owner, configurația OmniRoute de pe producție, cheile API configurate.

**Neconfirmat:** CI-ul pe 0.7.11 (n-a rulat), build-ul Windows și Release-ul, verificarea Mobile, HTTPS cap-coadă, memoria și automatizările în producție, PWA.

Nu se poate afirma „0.7.11 e terminat și toate funcțiile merg perfect”.

## 11. Ordinea de lucru

Nu se adaugă funcții noi până nu e stabilă baza:

1. Deblocarea GitHub Actions (facturare / spațiu de artifacte; vezi `docs/PUBLICARE_RELEASE.md`).
2. Re-rularea tuturor verificărilor pe `main` și build-ul Windows → Release `v0.7.11`.
3. Verificarea efectivă a aplicației: pornire din tray, microfon, automatizări, actualizare automată de la 0.7.10.
4. HTTPS cap-coadă pe `api.aistoica.ro` și deploy-ul 0.7.11 pe Hetzner (`update.sh`, apoi `/health`).
5. PWA pentru iPhone.
6. Abia apoi funcții noi, într-o versiune următoare, cu aceeași procedură.
