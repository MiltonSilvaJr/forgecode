---
description: Converte um diagrama Mermaid (flowchart, .md ou .mmd) em .drawio (mxGraph) editável visualmente no draw.io/diagrams.net — nós, shapes, subgraphs aninhados como containers, edges com rótulos e grupos. Handoff editável; o Mermaid (texto, versionável) é a fonte e o .drawio é a edição visual.
argument-hint: "<arquivo.md|.mmd> [--out <arquivo.drawio>]"
---

# /forge:mermaid-to-drawio — Mermaid → draw.io editável

Argumentos: `$ARGUMENTS` (arquivo Mermaid + `--out` opcional).

## Caminho preferencial — MCP draw.io

Se o MCP `drawio` estiver disponível na sessão (tools `open_drawio_mermaid` /
`open_drawio_xml`), use-o primeiro: `open_drawio_mermaid` com o conteúdo da fonte abre o
diagrama direto no editor draw.io (conversão oficial, layout automático) para o humano
revisar e salvar o `.drawio`. Para exportar PNG/SVG/PDF editáveis, use o plugin
`/drawio:drawio` (draw.io Desktop CLI com `--embed-diagram`). Política completa em
`.forge/rules/conventions/diagram-tooling.md`.

## Fallback determinista (zero-dep, offline/CI)

```bash
bash .forge/scripts/mermaid-to-drawio.sh docs/diagrams/editable/infra.md
# gera docs/diagrams/editable/infra.drawio — abra no draw.io para editar visualmente
```

## Notas

- Suporta o subconjunto de flowchart usado pelos diagramas do Forge: shapes (`["..."]`,
  `(["..."])`, `[("...")]`, `{{"..."}}`), subgraphs aninhados (→ containers), edges
  `-->`/`-.->`/`==>` com rótulos, grupos `&`, cadeias, `classDef`/`class`, `linkStyle`.
- O layout usa **Graphviz `dot`** quando disponível (posicionamento limpo, sem sobreposição); sem o `dot`, cai para um layout simples em colunas. Em ambos os casos, refine no draw.io.
- Determinista, zero-dep. O `.drawio` é XML versionável (diff revisável em PR).
- O script continua sendo o conversor canônico dos gates do Forge — o MCP é a via
  interativa de elaboração/manutenção, não substitui o fallback em CI.
