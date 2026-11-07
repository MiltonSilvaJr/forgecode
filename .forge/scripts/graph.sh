#!/usr/bin/env bash
# forge graph (W4.1) — dispatcher for the code graph (engine: native, ADR 0001).
# Subcommands:
#   build         (re)build .forge/graph/graph.json from the repo (deterministic, zero tokens)
#   update        rebuild only if structural fingerprints changed; cosmetic-only edits are a no-op
#   validate      run forge validate graph (§19.5)
#   query <term>  grep the graph for nodes/edges matching a term (cheap lookup before reading files)
#   path <a> <b>  show whether an import path exists from node a to node b (BFS over resolved edges)
# Usage: graph.sh <subcommand> [args]   (FORGE_ROOT overrides the repo root)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${FORGE_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
GRAPH="$ROOT/.forge/graph/graph.json"
command -v node >/dev/null 2>&1 || { echo "FAIL (node >= 20 required)"; exit 1; }

cmd="${1:-}"; shift || true
case "$cmd" in
  build)
    node "$SCRIPT_DIR/lib/graph-build.mjs" "$ROOT" ;;
  update)
    if [ ! -f "$GRAPH" ]; then node "$SCRIPT_DIR/lib/graph-build.mjs" "$ROOT"; exit $?; fi
    before="$(node -e 'const fs=require("fs");const p=process.argv[1];try{process.stdout.write(fs.readFileSync(p,"utf8"))}catch{}' "$ROOT/.forge/graph/cache/fingerprints.json" | shasum -a 256)"
    node "$SCRIPT_DIR/lib/graph-build.mjs" "$ROOT" >/dev/null
    after="$(shasum -a 256 < "$ROOT/.forge/graph/cache/fingerprints.json")"
    if [ "$before" = "$after" ]; then echo "OK graph up to date (no structural change — zero tokens)";
    else echo "OK graph updated (structural change detected)"; fi ;;
  validate)
    node "$SCRIPT_DIR/lib/validate-graph.mjs" "$GRAPH" "$ROOT" ;;
  query)
    [ -f "$GRAPH" ] || { echo "FAIL (no graph — run: graph.sh build)"; exit 1; }
    term="${1:-}"; [ -n "$term" ] || { echo "FAIL (usage: graph.sh query <term>)"; exit 1; }
    node -e '
      const g=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const t=process.argv[2].toLowerCase();
      const n=g.nodes.filter(x=>x.id.toLowerCase().includes(t));
      const e=g.edges.filter(x=>x.from.toLowerCase().includes(t)||x.to.toLowerCase().includes(t));
      console.log(`nodes (${n.length}):`);n.slice(0,20).forEach(x=>console.log(`  ${x.id} [${x.lang}/${x.layer}] loc=${x.loc}`));
      console.log(`edges (${e.length}):`);e.slice(0,20).forEach(x=>console.log(`  ${x.from} -> ${x.to} (${x.kind}${x.resolved?"":" unresolved"})`));
    ' "$GRAPH" "$term" ;;
  path)
    [ -f "$GRAPH" ] || { echo "FAIL (no graph — run: graph.sh build)"; exit 1; }
    a="${1:-}"; b="${2:-}"; [ -n "$a" ] && [ -n "$b" ] || { echo "FAIL (usage: graph.sh path <from> <to>)"; exit 1; }
    node -e '
      const g=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const [a,b]=[process.argv[2],process.argv[3]];
      const adj=new Map();for(const e of g.edges){if(!e.resolved)continue;if(!adj.has(e.from))adj.set(e.from,[]);adj.get(e.from).push(e.to);}
      const q=[[a]],seen=new Set([a]);
      while(q.length){const p=q.shift();const last=p[p.length-1];if(last===b){console.log("PATH: "+p.join(" -> "));process.exit(0);}
        for(const n of (adj.get(last)||[]))if(!seen.has(n)){seen.add(n);q.push([...p,n]);}}
      console.log("NO PATH (no resolved import chain "+a+" -> "+b+")");
    ' "$GRAPH" "$a" "$b" ;;
  deps)
    [ -f "$GRAPH" ] || { echo "FAIL (no graph — run: graph.sh build)"; exit 1; }
    node "$SCRIPT_DIR/lib/graph-deps.mjs" "$ROOT" "$@" ;;
  symbols)
    node "$SCRIPT_DIR/lib/graph-symbols.mjs" "$ROOT" ;;
  mdl)
    [ -f "$GRAPH" ] || { echo "FAIL (no graph — run: graph.sh build)"; exit 1; }
    node "$SCRIPT_DIR/lib/mdl-gen.mjs" "$ROOT" "$@" ;;
  *)
    echo "FAIL (usage: graph.sh build|update|validate|query <term>|path <a> <b>|deps [--module <m>] [--by-project] [--json]|symbols|mdl [--service <s>])"; exit 1 ;;
esac
