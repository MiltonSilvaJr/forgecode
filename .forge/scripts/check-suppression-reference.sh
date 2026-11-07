#!/usr/bin/env bash
# forge check-suppression-reference (REQ-03/REQ-04, change adopt-ub-mode-practices): reprova
# supressão de compilador/linter (@ts-ignore, @ts-expect-error, @ts-nocheck, eslint-disable*,
# # noqa, # type: ignore) sem referência rastreável (LDG-NNNN/ADR-NNNN/ISSUE-NNN/issue #NNN/
# closes #NNN/fixes #NNN) nas LINHAS ADICIONADAS do diff — nunca o arquivo inteiro. Código
# gerado/vendorizado (*_pb2.py, *.pb.ts, *_grpc_pb.*, cabeçalho @generated/DO NOT EDIT nas
# primeiras 5 linhas) e todo .forge/** da RAIZ do repositório (um nível, nunca recursivo por
# nome) ficam fora do escopo — design §2.2.
#
# Usage:
#   check-suppression-reference.sh --staged               (/forge:ship, antes do commit)
#   check-suppression-reference.sh --range <base>...<head> (hook pre-push, base já resolvida)
set -euo pipefail
command -v node >/dev/null 2>&1 || { echo "FAIL (node >= 20 required)"; exit 2; }
command -v git  >/dev/null 2>&1 || { echo "FAIL (git ausente)"; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$ROOT" ] || { echo "FAIL (não é um repositório git)"; exit 2; }

MODE=""
RANGE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --staged) MODE="staged"; shift ;;
    --range) MODE="range"; RANGE="${2:-}"; shift 2 ;;
    *) echo "FAIL (flag desconhecida: $1 — use --staged ou --range <base>...<head>)"; exit 2 ;;
  esac
done
[ -n "$MODE" ] || { echo "FAIL (usage: --staged | --range <base>...<head>)"; exit 2; }

ZERO_SHA="0000000000000000000000000000000000000000"
# Mesma cadeia de resolução de base de _redfirst_resolve_base/_docs_resolve_base
# (template/.forge/hooks/git/lib/check-red-first.sh): remote_sha (se não for zero) →
# origin/develop → origin/HEAD → origin/main → commit raiz.
_resolve_base() { # _resolve_base <local_sha> <remote_sha>
  local local_sha="$1" remote_sha="$2" default_ref candidate base
  if [ "$remote_sha" != "$ZERO_SHA" ]; then printf '%s\n' "$remote_sha"; return 0; fi
  default_ref="$(git -C "$ROOT" symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null || true)"
  default_ref="${default_ref#refs/remotes/}"
  for candidate in "origin/develop" "$default_ref" "origin/main"; do
    [ -n "$candidate" ] || continue
    if base="$(git -C "$ROOT" merge-base "$local_sha" "$candidate" 2>/dev/null)" && [ -n "$base" ]; then
      printf '%s\n' "$base"; return 0
    fi
  done
  git -C "$ROOT" rev-list --max-parents=0 "$local_sha" 2>/dev/null | tail -1
}

EMPTY_TREE_SHA="4b825dc642cb6eb9a060e54bf8d69288fbee4904" # árvore vazia (git), hash fixo e universal
_diff_base() { # _diff_base <root> <base> <head> — base==head (1º commit do repo, raiz=base
  # resolvida) não é range válido para 'git diff a...a'; usa a árvore vazia para diffar o
  # commit inteiro como adição, nunca pula a checagem do primeiro commit publicado.
  local root="$1" base="$2" head="$3"
  if [ "$(git -C "$root" rev-parse --verify --quiet "$base^{commit}" 2>/dev/null)" = "$(git -C "$root" rev-parse --verify --quiet "$head^{commit}" 2>/dev/null)" ]; then
    printf '%s\n' "$EMPTY_TREE_SHA"
  else
    printf '%s\n' "$base"
  fi
}

EXTS=(-- '*.js' '*.jsx' '*.mjs' '*.cjs' '*.ts' '*.tsx' '*.py')
DIFF_FILE="$(mktemp "${TMPDIR:-/tmp}/forge-suppression-diff.XXXXXX")"
trap 'rm -f "$DIFF_FILE"' EXIT

if [ "$MODE" = "staged" ]; then
  HEAD_SHA="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)"
  [ -n "$HEAD_SHA" ] || { echo "FAIL (sem HEAD — repositório sem commit algum)"; exit 1; }
  BASE="$(_resolve_base "$HEAD_SHA" "$ZERO_SHA")"
  [ -n "$BASE" ] || { echo "FAIL (base não resolvida — sem origin/develop, origin/HEAD, origin/main nem commit raiz)"; exit 1; }
  DBASE="$(_diff_base "$ROOT" "$BASE" "$HEAD_SHA")"
  if [ "$DBASE" = "$EMPTY_TREE_SHA" ]; then DRANGE=("$DBASE" "HEAD"); else DRANGE=("$DBASE...HEAD"); fi
  if ! git -C "$ROOT" diff "${DRANGE[@]}" "${EXTS[@]}" >> "$DIFF_FILE" 2>"$DIFF_FILE.err"; then
    echo "FAIL (git diff '${DRANGE[*]}' saiu com erro: $(cat "$DIFF_FILE.err"))"; exit 1
  fi
  if ! git -C "$ROOT" diff --cached "${EXTS[@]}" >> "$DIFF_FILE" 2>"$DIFF_FILE.err"; then
    echo "FAIL (git diff --cached saiu com erro: $(cat "$DIFF_FILE.err"))"; exit 1
  fi
else
  case "$RANGE" in
    *"..."*) BASE="${RANGE%%...*}"; HEAD_REF="${RANGE##*...}" ;;
    *) echo "FAIL (--range precisa do formato <base>...<head>)"; exit 2 ;;
  esac
  [ -n "$BASE" ] && [ -n "$HEAD_REF" ] || { echo "FAIL (--range com base ou head vazio)"; exit 2; }
  DBASE="$(_diff_base "$ROOT" "$BASE" "$HEAD_REF")"
  if [ "$DBASE" = "$EMPTY_TREE_SHA" ]; then DRANGE=("$DBASE" "$HEAD_REF"); else DRANGE=("$DBASE...$HEAD_REF"); fi
  if ! git -C "$ROOT" diff "${DRANGE[@]}" "${EXTS[@]}" >> "$DIFF_FILE" 2>"$DIFF_FILE.err"; then
    echo "FAIL (git diff '${DRANGE[*]}' saiu com erro: $(cat "$DIFF_FILE.err"))"; exit 1
  fi
fi
rm -f "$DIFF_FILE.err"

EXCLUDE_FILE="$ROOT/.forge/suppression-scan-exclude.txt"
[ -f "$EXCLUDE_FILE" ] || EXCLUDE_FILE=""

node --input-type=module -e '
const fs = await import("node:fs");
const path = await import("node:path");
const diffPath = process.argv[1];
const root = process.argv[2];
const excludeFile = process.argv[3];

const text = fs.readFileSync(diffPath, "utf8");
const lines = text.split(/\r?\n/);

// ---- parse do diff unificado: por arquivo, lista de linhas ADICIONADAS com nº na árvore nova.
const files = []; // { path, added: [{num, text}] }
let cur = null, newLine = 0;
for (const l of lines) {
  let m = l.match(/^\+\+\+ b\/(.+)$/);
  if (m) { cur = { path: m[1], added: [] }; files.push(cur); continue; }
  if (l.startsWith("--- ")) continue;
  m = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (m) { newLine = parseInt(m[1], 10); continue; }
  if (!cur) continue;
  if (l.startsWith("+++") || l.startsWith("---")) continue;
  if (l.startsWith("+")) { cur.added.push({ num: newLine, text: l.slice(1) }); newLine++; continue; }
  if (l.startsWith("-")) continue; // linha removida, não consome contador da árvore nova
  if (l.startsWith(" ") || l === "") { newLine++; continue; }
}

// ---- exclusão: código gerado/vendorizado, .forge/** da raiz, exclusão extensível do consumidor.
const GEN_BASENAME_RE = [/_pb2\.py$/, /\.pb\.ts$/, /_grpc_pb\./];
function isForgeRoot(p) { return p === ".forge" || p.startsWith(".forge/"); }
function isGeneratedPath(p) { return GEN_BASENAME_RE.some((re) => re.test(p)); }
function hasGeneratedHeader(p) {
  try {
    const abs = path.join(root, p);
    const content = fs.readFileSync(abs, "utf8");
    const head = content.split(/\r?\n/).slice(0, 5).join("\n");
    return /@generated|DO NOT EDIT/i.test(head);
  } catch { return false; }
}
function globToRegExp(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*").replace(/\?/g, ".");
  return new RegExp("^" + esc + "$");
}
// .forge/suppression-scan-exclude.txt (extensível PELO CONSUMIDOR, mesmo padrão de
// .forge/empty-universe-allowlist.txt): path glob por linha, com "# motivo: <justificativa>"
// OBRIGATÓRIO — uma linha sem motivo reprova por integridade (isenção anônima é exatamente
// por onde esse tipo de arquivo é esvaziado na prática).
let consumerGlobs = [];
if (excludeFile) {
  let raw;
  try { raw = fs.readFileSync(excludeFile, "utf8").split(/\r?\n/); } catch { raw = []; }
  for (const l of raw) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^(.*?)\s+#\s*motivo:\s*(\S.*)$/);
    if (!m || !m[1].trim()) {
      console.log(`FAIL (.forge/suppression-scan-exclude.txt: linha sem "<glob>  # motivo: <justificativa>" — "${t}")`);
      process.exit(1);
    }
    consumerGlobs.push(globToRegExp(m[1].trim()));
  }
}
function isExcluded(p) {
  if (isForgeRoot(p)) return true;
  if (isGeneratedPath(p)) return true;
  if (hasGeneratedHeader(p)) return true;
  if (consumerGlobs.some((re) => re.test(p))) return true;
  return false;
}

// ---- gramática de referência válida (design §2.2).
const REF_RE = /(LDG|ADR|ISSUE)-\d+/i;
const HASH_RE = /(^|[^A-Za-z0-9])(issue|closes|fixes|ver)\s*#\d+([^A-Za-z0-9]|$)/i;
function hasValidReference(line) { return REF_RE.test(line) || HASH_RE.test(line); }

// ---- marcadores de supressão (JS/TS + Python).
const SUPPRESSION_RE = /@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable(?:-next-line|-line)?|#\s*noqa|#\s*type:\s*ignore/i;

const violations = [];
let examined = 0;
for (const f of files) {
  if (isExcluded(f.path)) continue;
  if (f.added.length > 0) examined++;
  for (const a of f.added) {
    if (SUPPRESSION_RE.test(a.text) && !hasValidReference(a.text)) {
      violations.push(`${f.path}:${a.num} — supressão sem referência rastreável: ${a.text.trim()}`);
    }
  }
}

if (violations.length > 0) {
  for (const v of violations) console.log(`FAIL ${v}`);
  process.exit(1);
}
console.log(`OK — ${examined} arquivo(s) examinado(s), 0 supressão(ões) sem referência`);
process.exit(0);
' "$DIFF_FILE" "$ROOT" "$EXCLUDE_FILE"
