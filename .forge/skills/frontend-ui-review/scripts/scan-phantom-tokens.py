#!/usr/bin/env python3
# scan-phantom-tokens.py <tokens.css> <src_dir> [allowlist_csv]
# Lista tokens CSS referenciados (var(--x)) mas nunca definidos (--x:) — "tokens fantasma".
# Diferença de conjuntos: referenciados − definidos − allowlist. Exit 1 se houver algum.
# Gate mais importante da skill frontend-ui-review: o fantasma "funciona" em light e vira
# buraco no dark; a caça visual nunca acha todos, o scan acha o universo e é reproduzível em CI.
import re
import sys
import pathlib


def main() -> int:
    if len(sys.argv) < 3:
        print("uso: scan-phantom-tokens.py <tokens.css> <src_dir> [allowlist_csv]")
        return 2

    tokens_path = pathlib.Path(sys.argv[1])
    src = pathlib.Path(sys.argv[2])
    allow = set(sys.argv[3].split(",")) if len(sys.argv) > 3 and sys.argv[3] else set()

    if not tokens_path.is_file():
        print(f"FAIL: arquivo de tokens não encontrado: {tokens_path}")
        return 2
    if not src.exists():
        print(f"FAIL: src_dir não encontrado: {src}")
        return 2

    # tokens DEFINIDOS: '--x:' no início de uma declaração. Custom properties são
    # case-sensitive — aceitar maiúsculas e underscore (--gap-Large, --fontSize).
    defined = set(re.findall(r"(--[A-Za-z0-9_-]+)\s*:", tokens_path.read_text(errors="ignore")))

    # tokens REFERENCIADOS: var(--x) em qualquer fonte de UI
    referenced: dict[str, set[str]] = {}
    exts = (".css", ".scss", ".sass", ".less", ".tsx", ".ts", ".jsx", ".js", ".vue", ".svelte")
    for p in src.rglob("*"):
        if p.is_file() and p.suffix in exts:
            for m in re.findall(r"var\(\s*(--[A-Za-z0-9_-]+)", p.read_text(errors="ignore")):
                referenced.setdefault(m, set()).add(str(p))

    phantom = {t: files for t, files in referenced.items() if t not in defined and t not in allow}

    for t in sorted(phantom):
        print(f"PHANTOM {t}  ({len(phantom[t])} arquivo(s))")
        for f in sorted(phantom[t])[:8]:
            print("   ", f)

    print(f"\n{'FAIL' if phantom else 'OK'} phantom-tokens: {len(phantom)} não definido(s)")
    return 1 if phantom else 0


if __name__ == "__main__":
    sys.exit(main())
