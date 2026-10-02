# AI Stoica v0.7.10 — verificare

Verificări automate (rulate de GitHub Actions → „AI Stoica Desktop Check” la fiecare modificare):

- sintaxă pentru toate fișierele aplicației Windows;
- baza de date locală, memoria și citirea documentelor (`scripts/test-modules.cjs`);
- permisiuni AI pentru conturi normale (`test-ai-access-enforcement.cjs`);
- generare imagini/video și protecția „Doar gratuit” (`test-media-generation.cjs`);
- regresii infrastructură, pluginuri directe (`test-infrastructure-regressions.cjs`);
- unelte Owner și fallback Cerebras → Groq (`test-owner-tools.cjs`);
- mod local fără Cloud, test chei, blocarea site-urilor străine, citirea fișierelor încărcate, expirarea sesiunilor, păstrarea sesiunii la căderea Cloud (`test-local-mode.cjs`);
- export PDF, Word, PowerPoint, Excel și celelalte formate (`test-document-export.cjs`);
- build interfață (Vite).

De verificat manual pe Windows după instalare: pornirea din tray, microfonul, notificările automatizărilor și actualizarea automată (necesită Releases publice pe GitHub).
