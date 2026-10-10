# Skill-uri de design (terți)

Skill-urile din `.claude/skills/` sunt copiate neschimbat din proiectele de mai jos, la cererea Owner-ului (2026-10-05). Orice sesiune Claude Code pe acest repo le are la dispoziție când lucrează la interfață.

| Sursă | Commit | Licență | Ce am luat |
|---|---|---|---|
| [emilkowalski/skills](https://github.com/emilkowalski/skills) | `e8a175d` | MIT (`emilkowalski-skills-MIT.txt`) | animate, animate-expo, animation-vocabulary, apple-design, break-ui, emil-design-eng, find-animation-opportunities, improve-animations, mobile-native, pick-ui-library, prototype, review-animations. Fără `write-swift` și `ask-sonner` (proiectul nu are Swift și nu folosește Sonner). |
| [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | `ece38d9` | Apache-2.0 (`impeccable-Apache-2.0.txt`, `impeccable-NOTICE.md`) | `impeccable`: `SKILL.md` și `reference/`. Fără `scripts/` (descarcă și rulează un program) și fără hook-urile din `.claude/settings.json`. Skill-ul merge și așa, citind direct `PRODUCT.md` / `DESIGN.md`. Varianta completă se instalează local cu `npx impeccable install`. |
| [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | `ce26fc2` | MIT (`taste-skill-MIT.txt`) | `design-taste-frontend` (din `skills/taste-skill`) și `redesign-existing-projects` (din `skills/redesign-skill`). |

## Skill-uri proprii

| Skill | Ce face |
|---|---|
| `context-budget-optimizer` | Găsește părțile relevante dintr-un cod mare sau dintr-un log lung fără să citească fișiere întregi: `scripts/context_pack.py` (Python standard, doar citire) dă fragmente clasate, cu numere de linie și cu cheile ascunse. Pornit de la un skill trimis de Owner (2026-10-09), reparat și testat: `python3 .claude/skills/context-budget-optimizer/scripts/test_context_pack.py`. |

Verificarea interfeței din 0.7.16 (telefon, mișcare, aspectul câmpului de mesaj) a folosit aceste skill-uri. Reparațiile sunt notate în comentariul din `apps/desktop/renderer/src/styles.css`.
