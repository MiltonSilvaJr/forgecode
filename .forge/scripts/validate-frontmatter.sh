#!/usr/bin/env bash
# Deterministic frontmatter validator (§19.4 — ported from an internal frontmatter validator,
# anticipated to W1.1 per docs/plans/01 v1.1; W3.1 consolidates it into the validator suite).
# Limits from the open Agent Skills spec:
#   - SKILL.md: frontmatter REQUIRED; name ≤ 64 chars, lowercase+hyphens; description ≤ 1024
#     chars and no XML tags; body ideally < 500 lines (warning, not failure).
#   - Other .md files WITH frontmatter (agents/commands): name ≤ 64, description ≤ 1024,
#     no XML tags in description. Files without frontmatter are skipped (except SKILL.md).
# Usage: validate-frontmatter.sh [--strict-xml] <file-or-dir> [...]
# Output: one VIOLATION/WARN line per finding; final line "OK" (exit 0) or "FAIL (n)" (exit 1).
#
# XML tags in description: the open Agent Skills spec forbids them, but the frozen template
# (compat contract C2/C4) ships 13 legacy descriptions using <example> blocks for triggering.
# Rewriting them would change behavior, so by default this is a WARN (debt tracked in
# docs/plans/01 — sanitize in MVP5 when the eval harness can measure triggering impact).
# Pass --strict-xml to make it a VIOLATION (W3.1 suite / post-cleanup usage).
set -u

STRICT_XML=0
if [ "${1:-}" = "--strict-xml" ]; then STRICT_XML=1; shift; fi

fail=0
warn=0

frontmatter() { awk 'NR==1{next} /^---[[:space:]]*$/{exit} {print}' "$1"; }

field_block() {  # field_block <field> <<< "$fm" — value incl. folded continuation lines
  awk -v key="$1" '
    $0 ~ "^"key":" { grab=1; sub("^"key":[[:space:]]*", ""); print; next }
    grab && /^[A-Za-z0-9_-]+:/ { exit }
    grab { sub(/^[[:space:]]+/, ""); print }
  '
}

check_file() {
  local f="$1" base fm name desc body_lines is_skill=0
  base="$(basename "$f")"
  [ "$base" = "SKILL.md" ] && is_skill=1

  if [ "$(head -1 "$f")" != "---" ]; then
    if [ "$is_skill" -eq 1 ]; then
      echo "VIOLATION $f: SKILL.md requires YAML frontmatter"
      fail=$((fail + 1))
    fi
    return
  fi

  fm="$(frontmatter "$f")"
  name="$(printf '%s\n' "$fm" | field_block name | head -1)"
  desc="$(printf '%s\n' "$fm" | field_block description | tr '\n' ' ')"
  title="$(printf '%s\n' "$fm" | field_block title | head -1)"

  if [ "$is_skill" -eq 1 ] && [ -z "$name" ]; then
    echo "VIOLATION $f: missing name"; fail=$((fail + 1))
  fi
  # agents/skills/commands are triggered by `description` and must declare it
  # (Agent Skills spec / W3.1). Rules use a different frontmatter schema
  # (`title:`/`applies_to:`/`priority:`) — they are read as context, not
  # triggered, so `title` without `description` is valid.
  if [ -z "$desc" ] && [ -z "$title" ]; then
    echo "VIOLATION $f: missing description"; fail=$((fail + 1))
  fi
  if [ -n "$name" ]; then
    if [ "${#name}" -gt 64 ]; then
      echo "VIOLATION $f: name exceeds 64 chars (${#name})"; fail=$((fail + 1))
    fi
    if [ "$is_skill" -eq 1 ] && ! printf '%s' "$name" | grep -Eq '^[a-z0-9][a-z0-9-]*$'; then
      echo "VIOLATION $f: skill name must be lowercase letters/digits/hyphens"; fail=$((fail + 1))
    fi
  fi
  if [ -n "$desc" ]; then
    if [ "${#desc}" -gt 1024 ]; then
      echo "VIOLATION $f: description exceeds 1024 chars (${#desc})"; fail=$((fail + 1))
    fi
    if printf '%s' "$desc" | grep -Eq '<[A-Za-z][^>]*>'; then
      if [ "$STRICT_XML" -eq 1 ]; then
        echo "VIOLATION $f: description contains XML tags"; fail=$((fail + 1))
      else
        echo "WARN $f: description contains XML tags (legacy, frozen by compat contract)"; warn=$((warn + 1))
      fi
    fi
  elif [ "$is_skill" -eq 1 ]; then
    echo "VIOLATION $f: missing description"; fail=$((fail + 1))
  fi

  if [ "$is_skill" -eq 1 ]; then
    body_lines=$(wc -l < "$f" | tr -d ' ')
    if [ "$body_lines" -gt 500 ]; then
      echo "WARN $f: body has $body_lines lines (ideal < 500)"; warn=$((warn + 1))
    fi
  fi
}

for target in "$@"; do
  if [ -d "$target" ]; then
    while IFS= read -r -d '' f; do check_file "$f"; done \
      < <(find "$target" -type f -name '*.md' ! -name 'README.md' -print0)
  elif [ -f "$target" ]; then
    check_file "$target"
  else
    echo "VIOLATION $target: not found"; fail=$((fail + 1))
  fi
done

if [ "$fail" -gt 0 ]; then
  echo "FAIL ($fail violations, $warn warnings)"
  exit 1
fi
echo "OK ($warn warnings)"
