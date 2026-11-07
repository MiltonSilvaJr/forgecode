#!/usr/bin/env bash
# Entry point para gerar o plugin Claude Code "forge" a partir de .forge/commands/**.
# Bash wrapper → Node lib (no build step, no dependencies). Requires Node >= 20.
#
# O Claude Code (>= 2.x) descontinuou o namespace via subdiretório em .claude/commands/;
# /forge:<cmd> só funciona quando os comandos vêm de um PLUGIN (name: forge). Este script
# materializa esse plugin a partir da MESMA fonte (.forge/commands/**) que alimenta os adapters.
#
# Uso:
#   build-plugin.sh                      # → ~/.claude/skills/forge (skills-dir, auto-load)
#   build-plugin.sh --out <dir>          # destino alternativo (ex.: para --plugin-dir)
#   build-plugin.sh --version <x>        # sobrescreve a versão do manifesto
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"   # .forge/scripts → raiz do projeto

command -v node >/dev/null 2>&1 || { echo "FAIL (node >= 20 required)"; exit 1; }

exec node "$SCRIPT_DIR/lib/plugin-build.mjs" --root "$ROOT" "$@"
