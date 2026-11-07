#!/usr/bin/env bash
# Smoke runner for adapter declarations (§15) — executes smoke_tests.command of each ACTIVE
# adapter (those listed in forge.yaml harness.adapters; pass --all to smoke every declaration),
# plus a global foreign-path check over generated targets (no adapter may carry paths from
# another machine/project).
# Output: one line per adapter + final "OK" (exit 0) or "FAIL (...)" (exit 1).
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
fail=0

ALL=0
[ "${1:-}" = "--all" ] && ALL=1

# active set from forge.yaml (the adapters actually materialized in this repo)
active="$(awk '/^  adapters:/{g=1;next} g&&/^    - /{print $2;next} g{exit}' "$ROOT/.forge/forge.yaml" 2>/dev/null)"
is_active() { printf '%s\n' "$active" | grep -qx "$1"; }

for decl in "$ROOT"/.forge/adapters/*.yaml; do
  case "$decl" in *.lock.yaml) continue ;; esac
  name="$(basename "$decl" .yaml)"
  if [ "$ALL" -eq 0 ] && ! is_active "$name"; then continue; fi
  total=0
  ok_count=0
  while IFS= read -r line; do
    case "$line" in
      *'command: '*)
        cmd="${line#*command: }"
        cmd="${cmd#\"}"
        cmd="${cmd%\"}"
        cmd="${cmd//\\\"/\"}"
        total=$((total + 1))
        if (cd "$ROOT" && bash -c "$cmd") >/dev/null 2>&1; then
          ok_count=$((ok_count + 1))
        else
          echo "FAIL adapter $name smoke: $cmd"
          fail=1
        fi
        ;;
    esac
  done < "$decl"
  [ "$ok_count" -eq "$total" ] && echo "OK adapter $name ($ok_count/$total smokes)"
done

# foreign-path check: generated targets must not embed absolute paths from other machines
foreign=0
for lock in "$ROOT"/.forge/adapters/*.lock.yaml; do
  [ -f "$lock" ] || continue
  while IFS= read -r dest; do
    [ -n "$dest" ] && [ -f "$ROOT/$dest" ] || continue
    if grep -q '/Users/' "$ROOT/$dest" 2>/dev/null; then
      echo "FAIL foreign absolute path in generated target: $dest"
      foreign=$((foreign + 1))
    fi
  done <<EOF_DESTS
$(awk '/^  - dest: /{print $3}' "$lock")
EOF_DESTS
done
[ "$foreign" -eq 0 ] && echo "OK no foreign paths in generated targets"

[ "$fail" -eq 0 ] && [ "$foreign" -eq 0 ] && echo "OK" && exit 0
echo "FAIL (smokes=$fail foreign=$foreign)"
exit 1
