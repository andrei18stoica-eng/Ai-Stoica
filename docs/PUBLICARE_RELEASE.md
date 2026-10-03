# Cum se publică o versiune AI Stoica

Procedura de mai jos a fost folosită pentru 0.7.11 și funcționează pentru orice versiune viitoare. Înlocuiește `<V>` cu numărul versiunii (de exemplu `0.7.12`).

Flux: patch → aplicare controlată → verificări locale → ramură → PR → verificări automate → merge → build Windows → Release → raport.

## 1. Verifică baza

```bash
git fetch origin
git log --oneline -5 origin/main
```

Orice patch sau ZIP a fost făcut peste un commit anume. Pentru 0.7.11 baza era `e205278`, dar `main` ajunsese la `7fe0dc2` (PR #19–#26). Compară baza livrată cu `origin/main`:

- **Aceeași bază sau doar schimbări irelevante:** continuă.
- **Bază diferită:** cere un patch regenerat peste `origin/main` (varianta preferată). Dacă nu se poate, fă un merge real:
  1. creează un commit cu starea livrată pe baza ei originală (`git worktree add --detach <dir> <baza>`, copiezi conținutul, commit);
  2. `git merge --no-commit` în ramura bazată pe `main`;
  3. rezolvă fiecare conflict știind ce a vrut fiecare parte: unde ambele rezolvă aceeași problemă, ia varianta mai nouă și actualizează testele; ce lipsește din una dintre părți se readuce explicit;
  4. scrie în PR ce ai luat de unde.
- **Nu înlocui arborele `main` cu un ZIP:** ștergi muncă din PR-urile intermediare fără să ai intenția asta.

## 2. Ramură și aplicare

```bash
git checkout -b release/ai-stoica-<V> origin/main     # sau ramura desemnată sesiunii
git apply --index <fisier.patch>                      # dacă refuză: git apply --3way
```

Nu modifica manual codul patch-ului în afara rezolvării conflictelor. Ștergerile (de exemplu `git rm -r gateway`) se fac separat dacă patch-ul nu le conține.

## 3. Versiunea

Aceeași în `package.json`, `apps/desktop/package.json`, `apps/desktop/package-lock.json` (două locuri: `version` de sus și `packages[""].version`), `apps/mobile/package.json`, `apps/mobile/app.json`, plus asertarea din `apps/desktop/scripts/test-audit-fixes.cjs`. Lock-ul se editează doar la aceste două câmpuri; dacă s-au schimbat dependențe, regenerează-l cu `npm install --package-lock-only --legacy-peer-deps`.

## 4. Verificări locale

```bash
bash scripts/verifica-local.sh --install
```

Toate trebuie să treacă. Scriptul acoperă YAML-ul workflow-urilor, versiunile, desktop (sintaxă, build interfață, toate testele), server și Cloudflare. Mobile (`expo-doctor`, `expo export`), build-ul Windows și Docker rulează doar în GitHub.

## 5. Commit, push, PR

Mesaj de commit și titlu PR: „AI Stoica <V> — <rezumat>”. Fără secrete în fișiere. PR către `main`.

## 6. Verificările din GitHub

Toate cinci trebuie să fie verzi:

| Nume în GitHub | Ce face |
|---|---|
| AI Stoica Desktop Check | sintaxă, build interfață, toate testele desktop |
| AI Stoica Server Check | `apps/server` + Docker |
| Check AI Stoica Cloudflare | `npm test` + `wrangler deploy --dry-run` |
| Check AI Stoica Mobile | `expo-doctor` + export iOS și Android |
| AI Stoica - ZIP complet Windows (job `build-zip`) | testele pe Windows + build + ZIP; pe PR nu publică |

- Dacă una nu pornește singură, o poți porni cu `workflow_dispatch` pe ramura PR-ului. **Atenție:** `ai-stoica-windows-zip.yml` publică în Release la pornire manuală, nu doar la PR.
- Dacă pică ceva, **nu face merge**: arată-i utilizatorului pasul și log-ul.
- Dacă jobul pică în câteva secunde, fără pași: vezi secțiunea „Joburi blocate de facturare”.

## 7. Merge

Doar cu verificările verzi: merge commit (nu squash), apoi șterge ramura. Fără force-push pe `main`.

## 8. Release

Pe `main` pornește „Build AI Stoica Windows”. Verifică Release-ul `v<V>`:

```bash
gh release view v<V> --json assets --jq '.assets[].name'
```

Trebuie să conțină `AI_Stoica_Setup_<V>_x64.exe`, `latest.yml` și `AI_Stoica_Setup_<V>_x64.exe.blockmap`. Fără `latest.yml` și `.blockmap`, actualizarea automată nu ajunge la utilizatori. Workflow-ul ZIP mai adaugă `AI_Stoica_Windows_<V>_COMPLET.zip`.

## 9. Restul infrastructurii (separat de GitHub)

- **Hetzner:** `sudo bash /opt/ai-stoica/deploy/hetzner/update.sh`, apoi `curl http://127.0.0.1:8787/health`.
- **Cloudflare:** migrările și deploy-ul din `apps/cloudflare/README.md`.
- **Telefon:** workflow-ul „Build AI Stoica Mobile with EAS”.

## 10. Raport

În română, utilizatorului: link spre PR, rezultatul verificărilor, link spre Release.

## Joburi blocate de facturare

**Semn:** toate joburile pică în 2–5 secunde, fără pași, fără log (404), cu `runner_id: 0`. Citește motivul:

```bash
gh api repos/andrei18stoica-eng/Ai-Stoica/check-runs/<id>/annotations --jq '.[].message'
```

Pe 2026-10-03 mesajul era: „The job was not started because recent account payments have failed or your spending limit needs to be increased.” Nu se rezolvă din cod; proprietarul verifică *GitHub → Settings → Billing & plans*.

**Spațiul consumat de artifacte** poate fi una dintre cauze. Atunci erau 68 de artifacte, ~15,8 GB (50 dintre ele erau copii `AI-Stoica-Windows` de ~232 MB din 26–27 septembrie). Limita gratuită pentru repo-uri private este mult mai mică. Installerele rămân în Releases, care nu consumă din această limită.

```bash
R=andrei18stoica-eng/Ai-Stoica
# listă (id, nume, MB)
gh api "repos/$R/actions/artifacts?per_page=100" --paginate \
  --jq '.artifacts[] | select(.expired==false) | [.id,.name,(.size_in_bytes/1048576|floor)] | @tsv'
# ștergere (ireversibilă): un artifact
gh api -X DELETE "repos/$R/actions/artifacts/<id>"
```

Pe 2026-10-03 s-au șters 67 de artifacte și a rămas unul (0.7.10). Joburile tot nu porneau imediat după, deci cauza exactă n-a putut fi confirmată din API: pagina Billing e vizibilă doar proprietarului, iar GitHub poate recalcula consumul în câteva ore. Ca să nu se acumuleze din nou, workflow-urile păstrează artifactele 7 zile (`retention-days: 7`).

## Reguli

- Fără secrete în fișiere și fără modificarea secretelor repository-ului.
- Fără force-push pe `main`.
- Merge doar cu verificările verzi, în afara cazului în care Owner-ul cere explicit altfel; atunci scrii în PR că verificările n-au rulat.
