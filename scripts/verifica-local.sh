#!/usr/bin/env bash
# Verificări locale înainte de PR. Rulează aceiași pași ca GitHub Actions pentru Desktop, Server și
# Cloudflare, plus verificări care au prins erori reale: chei YAML duplicate în workflow-uri,
# versiuni diferite și folderul gateway/ revenit.
# Nu rulează Mobile (expo), build-ul Windows și Docker: acestea rămân în GitHub Actions.
#
# Folosire: bash scripts/verifica-local.sh [--install]
#   --install  instalează dependențele (npm ci / npm install) în fiecare aplicație înainte de teste
set -u
cd "$(dirname "$0")/.." || exit 1

INSTALL=0
[ "${1:-}" = "--install" ] && INSTALL=1
FAILED=()

run() {
  local name="$1"; shift
  printf '\n== %s\n' "$name"
  if "$@"; then echo "OK   $name"; else echo "FAIL $name"; FAILED+=("$name"); fi
}

check_workflows() {
  python3 - <<'PY'
import glob, sys
try:
    import yaml
except ImportError:
    print("PyYAML lipsește: sar peste verificare (pip install pyyaml)")
    sys.exit(0)

class Loader(yaml.SafeLoader):
    pass

def mapping(loader, node, deep=False):
    seen = set()
    for key_node, _ in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in seen:
            raise ValueError(f"cheie duplicată {key!r} la linia {key_node.start_mark.line + 1}")
        seen.add(key)
    return yaml.SafeLoader.construct_mapping(loader, node, deep)

Loader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, mapping)
bad = 0
for path in sorted(glob.glob(".github/workflows/*.yml")):
    try:
        with open(path, encoding="utf-8") as f:
            yaml.load(f, Loader=Loader)
    except Exception as e:
        bad += 1
        print(f"{path}: {e}")
sys.exit(1 if bad else 0)
PY
}

check_versions() {
  node -e '
const read = (p) => require("./" + p);
const lock = read("apps/desktop/package-lock.json");
const found = {
  "package.json": read("package.json").version,
  "apps/desktop/package.json": read("apps/desktop/package.json").version,
  "apps/desktop/package-lock.json": lock.version,
  "apps/desktop/package-lock.json (packages)": lock.packages[""].version,
  "apps/mobile/package.json": read("apps/mobile/package.json").version,
  "apps/mobile/app.json": read("apps/mobile/app.json").expo.version
};
const versions = new Set(Object.values(found));
if (versions.size !== 1) {
  for (const [file, version] of Object.entries(found)) console.log("  " + file + ": " + version);
  process.exit(1);
}
console.log("versiune " + [...versions][0]);
'
}

check_gateway_removed() {
  if [ -e gateway ]; then echo "folderul gateway/ a fost șters în 0.7.11 și nu trebuie să reapară"; return 1; fi
}

check_desktop() (
  cd apps/desktop || exit 1
  if [ "$INSTALL" = 1 ]; then npm ci --legacy-peer-deps --no-audit --no-fund >/dev/null 2>&1 || { echo "npm ci a eșuat"; exit 1; }; fi
  [ -d node_modules ] || { echo "node_modules lipsește: rulează cu --install"; exit 1; }
  for f in main.cjs preload.cjs local-gateway.cjs lib/*.cjs scripts/*.cjs; do
    node --check "$f" || { echo "sintaxă invalidă: $f"; exit 1; }
  done
  out=$(npm run build:ui 2>&1) || { echo "$out" | tail -20; exit 1; }
  for t in scripts/test-*.cjs; do
    out=$(node "$t" 2>&1) || { echo "eșuat: $t"; echo "$out" | tail -20; exit 1; }
    echo "  ok $t"
  done
)

check_server() (
  cd apps/server || exit 1
  if [ "$INSTALL" = 1 ]; then npm install --no-audit --no-fund >/dev/null 2>&1 || { echo "npm install a eșuat"; exit 1; }; fi
  [ -d node_modules ] || { echo "node_modules lipsește: rulează cu --install"; exit 1; }
  node --check server.cjs && node --check ai-policy.cjs || exit 1
  out=$(npm test 2>&1) || { echo "$out" | tail -20; exit 1; }
)

check_cloudflare() (
  cd apps/cloudflare || exit 1
  if [ "$INSTALL" = 1 ]; then npm install --no-audit --no-fund >/dev/null 2>&1 || { echo "npm install a eșuat"; exit 1; }; fi
  [ -d node_modules ] || { echo "node_modules lipsește: rulează cu --install"; exit 1; }
  out=$(npm test 2>&1) || { echo "$out" | tail -20; exit 1; }
  out=$(npm run check 2>&1) || { echo "$out" | tail -20; exit 1; }
)

run "Workflow-uri YAML (chei duplicate)" check_workflows
run "Aceeași versiune peste tot" check_versions
run "gateway/ absent" check_gateway_removed
run "Desktop (sintaxă, build interfață, teste)" check_desktop
run "Server (apps/server)" check_server
run "Cloudflare Worker (teste + dry-run)" check_cloudflare

printf '\n'
if [ "${#FAILED[@]}" -eq 0 ]; then
  echo "TOATE VERIFICĂRILE LOCALE AU TRECUT"
  echo "Rămân pentru GitHub Actions: Mobile, build Windows, Docker."
  exit 0
fi
echo "VERIFICĂRI EȘUATE:"
printf '  - %s\n' "${FAILED[@]}"
exit 1
