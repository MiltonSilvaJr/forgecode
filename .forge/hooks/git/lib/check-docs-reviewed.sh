#!/usr/bin/env bash
# check-docs-reviewed.sh — Forge pre-push (§20.4) hard gate: user-facing changes must
# touch README.md and CHANGELOG.md in the same push range. No escape hatch (by design —
# the decision is locked: hard require, not a warning). Sourced by pre-push, but also
# runnable standalone for testing: reads pre-push stdin (`<local ref> <local sha>
# <remote ref> <remote sha>` per line) and applies the check per ref.
set -u

REPO="${REPO:-}"
[ -n "$REPO" ] || REPO="$(git rev-parse --show-toplevel 2>/dev/null)"
ZERO_SHA="0000000000000000000000000000000000000000"

_docs_resolve_base() {  # _docs_resolve_base <local_sha> <remote_sha>
  local local_sha="$1" remote_sha="$2" default_ref base

  if [ "$remote_sha" != "$ZERO_SHA" ]; then
    printf '%s\n' "$remote_sha"
    return 0
  fi

  # New branch — diff against the repo's default branch when we can resolve one.
  default_ref="$(git -C "$REPO" symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null || true)"
  default_ref="${default_ref#refs/remotes/}"

  # develop-first: a org trabalha sobre develop; origin/HEAD do GitHub costuma apontar main,
  # o que alargaria o range no primeiro push de uma branch nova.
  for candidate in "origin/develop" "$default_ref" "origin/main"; do
    [ -n "$candidate" ] || continue
    if base="$(git -C "$REPO" merge-base "$local_sha" "$candidate" 2>/dev/null)" && [ -n "$base" ]; then
      printf '%s\n' "$base"
      return 0
    fi
  done

  # Nothing resolvable (e.g. no origin remote in a test fixture) — fall back to the
  # range's root commit so the diff still makes sense.
  git -C "$REPO" rev-list --max-parents=0 "$local_sha" 2>/dev/null | tail -1
}

_docs_is_user_facing() {  # _docs_is_user_facing <base> <local_sha>
  local base="$1" local_sha="$2" range types file

  range="$base..$local_sha"

  types="$(git -C "$REPO" log --format=%s "$range" 2>/dev/null | \
    grep -E -o '^(feat|fix|perf|refactor|docs|chore|test|build|ci|style|revert)(\([^)]*\))?!?:' | \
    sed -E 's/^([a-z]+).*/\1/')"

  if printf '%s\n' "$types" | grep -qE '^(feat|fix|perf)$'; then
    return 0
  fi

  while IFS= read -r file; do
    [ -n "$file" ] || continue
    case "$file" in
      README.md|CHANGELOG.md) continue ;;
      *.md) continue ;;
      docs/*) continue ;;
      .gitignore|LICENSE) continue ;;
      *.yml|*.yaml) continue ;;
      # Lockfiles gerados nunca são mudança user-facing (bump de deps não pede README/CHANGELOG).
      # Isto é refino de classificação, não válvula de escape: código-fonte real continua exigindo docs.
      package-lock.json|pnpm-lock.yaml|yarn.lock|*.lock) continue ;;
      # Maquinaria do harness (sincronizada por `forge update`/sync-adapters), não código do
      # projeto: um commit `chore(forge): atualiza harness` não deve exigir README/CHANGELOG do
      # produto — a governança dessas mudanças é o próprio release do forge-harness, não este repo.
      .forge/*|.claude/*|.agents/*|.cursor/*|.kiro/*|AGENTS.md|CLAUDE.md|QWEN.md|GEMINI.md) continue ;;
    esac
    return 0
  done < <(git -C "$REPO" diff --name-only "$range" 2>/dev/null)

  return 1
}

check_docs_reviewed() {
  local line local_ref local_sha remote_ref remote_sha base files failed=0

  while IFS=' ' read -r local_ref local_sha remote_ref remote_sha; do
    [ -n "${local_ref:-}" ] || continue
    # Deleting a ref (local sha all-zero) — nothing to check.
    [ "${local_sha:-}" != "$ZERO_SHA" ] || continue

    base="$(_docs_resolve_base "$local_sha" "${remote_sha:-$ZERO_SHA}")"
    [ -n "$base" ] || continue

    if ! _docs_is_user_facing "$base" "$local_sha"; then
      continue
    fi

    files="$(git -C "$REPO" diff --name-only "$base..$local_sha" 2>/dev/null)"

    has_readme=0
    has_changelog=0
    printf '%s\n' "$files" | grep -qx 'README.md' && has_readme=1
    printf '%s\n' "$files" | grep -qx 'CHANGELOG.md' && has_changelog=1

    if [ "$has_readme" -eq 0 ] || [ "$has_changelog" -eq 0 ]; then
      {
        echo "pre-push BLOQUEADO: mudança user-facing em '$local_ref' sem documentação revisada."
        [ "$has_readme" -eq 0 ] && echo "  faltando: README.md (nenhuma alteração no diff $base..$local_sha)"
        [ "$has_changelog" -eq 0 ] && echo "  faltando: CHANGELOG.md (nenhuma alteração no diff $base..$local_sha)"
        echo "  Toda mudança de código (feat/fix/perf ou qualquer arquivo fora de docs/*.md) exige README.md e CHANGELOG.md atualizados no mesmo push. Sem exceção."
      } >&2
      failed=1
    fi
  done

  [ "$failed" -eq 0 ]
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  check_docs_reviewed
  exit $?
fi
