---
name: impact-scan
description: Executa análise de impacto reversa sobre o grafo de dependências do projeto — quais módulos são transitivamente alcançados a partir dos arquivos do change. Promovida do script lib/impact-scan.mjs (W4.2). Obrigatória em scale >= 3 antes do archive quando o change toca código.
---

# Impact Scan (§17.7)

Skill de análise de impacto — wrapper do script determinista `lib/impact-scan.mjs`.

## Protocolo

### Quando usar

- Obrigatória: scale ≥ 3 + change toca código + grafo construído (`/forge:codegraph` já rodado).
- Recomendada: antes de qualquer deploy em change que altere contratos/interfaces.

### Execução

```bash
# A partir dos affected_paths do manifest ou de uma lista explícita
node .forge/scripts/lib/impact-scan.mjs \
  --change <change-id> \
  --graph .forge/graph/graph.json \
  [--files "src/auth/jwt.ts,src/auth/index.ts"]
```

O script escreve `.forge/specs/active/<change-id>/impact.json` com:
- `affected_files`: arquivo tocado → todos os arquivos que o importam (reachability reversa)
- `graph_fingerprint`: fingerprint do grafo usado (para freshness check)
- `summary`: contagem de módulos afetados

### Saída da skill

```
Impact scan: 3 arquivos tocados → 7 módulos afetados.
Módulos de alto risco: src/middleware/ (3 importadores), src/api/routes/ (2 importadores).
impact.json gravado — freshness OK.
```

Uma linha de summary + módulos de alto risco (>= 2 importadores) + confirmação de gravação.

### Freshness

O `validate-archive` (pré-flight §13.2) verifica que `impact.json.graph_fingerprint` bate com o grafo atual. Se o grafo foi atualizado depois do scan, re-rode a skill antes do archive.

## Regras

- Se o grafo não existir: informe que `/forge:codegraph` precisa ser rodado primeiro.
- Não reconstrua o grafo nesta skill — apenas consuma-o.
- Output bruto em `/tmp/impact-scan.log`; reporte apenas o summary no chat (§17.6).
