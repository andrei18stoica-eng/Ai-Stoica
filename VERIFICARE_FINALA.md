# AI Stoica v0.4.1 — verificare finală

Pachet repository-ready pentru GitHub.

Include:
- Windows Electron + installer NSIS;
- interfață neagră profesională după conceptul AI Stoica;
- logo-ul aprobat Stoica Enterprises AI;
- cont cu email și parolă;
- proiecte, asistenți și istoric grupat;
- răspunsuri Markdown și streaming;
- fișiere / imagini compatibile cu modelele multimodale;
- dictare vocală unde Chromium/Windows o permite;
- OmniRoute `Ai principal` cu watchdog și repornire automată;
- rulare în system tray și pornire automată cu Windows;
- aplicație mobilă Expo pentru iPhone/iPad/Android;
- workflow Windows GitHub Actions;
- workflow EAS iOS / Expo OTA;
- Gateway separat pentru sincronizare viitoare între dispozitive.

Notă: contul desktop este local pe PC până când Gateway-ul este publicat pe HTTPS. Pentru App Store și sincronizare reală între dispozitive, Gateway-ul trebuie găzduit permanent pe un server HTTPS.

- Corecție OmniRoute: comanda de server folosită automat este `omniroute.cmd serve` (nu `launch`).
- Logo-ul Stoica Enterprises AI este inclus în interfața desktop, mobile și iconițele aplicației.
