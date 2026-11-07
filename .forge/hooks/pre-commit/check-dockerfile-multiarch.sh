#!/usr/bin/env bash
# Valida que todo Dockerfile staged está conforme a multi-arch (ADR 0036 / docker-multi-arch.md):
#   - declara `# syntax=docker/dockerfile:1.7` (ou superior) na 1ª linha
#   - declara `ARG TARGETARCH` em algum estágio de build
#   - usa `--platform=$BUILDPLATFORM` em pelo menos um estágio
#   - NÃO tem `FROM --platform=linux/amd64|arm64` hardcoded (deve ser variável)
#
# Uso:
#   - sem argumentos: valida os Dockerfiles staged (git diff --cached)
#   - com argumentos: valida os caminhos informados (útil para CI / execução manual)
set -euo pipefail

fail=0

collect_targets() {
  if [ "$#" -gt 0 ]; then
    printf '%s\n' "$@"
    return
  fi
  git diff --cached --name-only --diff-filter=ACMR 2>/dev/null \
    | grep -E '(^|/)Dockerfile([.-].*)?$' || true
}

check_file() {
  local file="$1"
  [ -f "$file" ] || return 0

  local errors=()

  # 1ª linha: diretiva syntax do BuildKit 1.7+
  if ! head -n 1 "$file" | grep -Eq '^#\s*syntax=docker/dockerfile:1\.(7|[89]|[1-9][0-9])'; then
    errors+=("falta '# syntax=docker/dockerfile:1.7' (ou superior) na 1ª linha")
  fi

  # ARG TARGETARCH presente
  if ! grep -Eq '^\s*ARG\s+TARGETARCH' "$file"; then
    errors+=("falta 'ARG TARGETARCH' no estágio de build")
  fi

  # --platform=$BUILDPLATFORM em algum estágio
  if ! grep -Eq 'FROM\s+--platform=\$\{?BUILDPLATFORM\}?' "$file"; then
    errors+=("nenhum estágio usa 'FROM --platform=\$BUILDPLATFORM'")
  fi

  # Plataforma hardcoded é proibida (anula a multi-arch)
  if grep -Eq 'FROM\s+--platform=linux/(amd64|arm64)' "$file"; then
    errors+=("'--platform=linux/...' hardcoded é proibido — use \$BUILDPLATFORM/\$TARGETPLATFORM")
  fi

  if [ "${#errors[@]}" -gt 0 ]; then
    echo "✖ $file" >&2
    for e in "${errors[@]}"; do echo "    - $e" >&2; done
    fail=1
  else
    echo "✔ $file"
  fi
}

# Lê os alvos linha a linha (portável p/ bash 3.2 do macOS — sem `mapfile`).
checked=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  check_file "$f"
  checked=1
done < <(collect_targets "$@")

if [ "$checked" -eq 0 ]; then
  exit 0
fi

if [ "$fail" -ne 0 ]; then
  echo "" >&2
  echo "Dockerfile fora da conformidade multi-arch (ADR 0036). Corrija antes do commit." >&2
  exit 1
fi
