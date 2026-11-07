---
description: Gera scaffold de diagrama de infraestrutura a partir do docker-compose em três formatos — infra.py (render com ícones via Graphviz, mingrammer/diagrams), infra.md (Mermaid editável) e infra.drawio (draw.io editável visual). Clusters por tipo, ícones reais. Scaffold para refino humano (rede e PCI não vêm do compose).
argument-hint: "[--out <dir>]"
---

# /forge:infra-diagram — diagram-as-code da infraestrutura

Argumentos: `$ARGUMENTS` (`--out <dir>`, default `docs/diagrams`).

## Protocolo

1. Gere o scaffold a partir do compose:
   ```bash
   bash .forge/scripts/infra-scan.sh --out docs/diagrams
   ```
   Cria TRÊS artefatos: `infra.py` (render com ícones via Graphviz), `infra.md` (**Mermaid
   editável**) e `infra.drawio` (**draw.io editável visual** — abra direto no diagrams.net).

2. **Refine à mão** — o compose não tem topologia de rede, zonas de confiança nem escopo de
   compliance. Ajuste arestas, adicione `Cluster`s de zona (DMZ/CDE/interno) e rótulos.
   Com o MCP `drawio` disponível, abra o refino visual direto no editor:
   `open_drawio_mermaid` com o conteúdo de `infra.md`, ou `open_drawio_xml` com o
   `infra.drawio` (use `routing: "libavoid"` quando disponível para conectores limpos).
   Para shapes reais (AWS/K8s/rede), a tool `search_shapes` retorna o style string exato —
   mas ela existe só no **MCP App Server hosted** (`mcp.draw.io`), não no tool server local;
   use-a apenas para descobrir styles genéricos, nunca enviando conteúdo do diagrama.
   Política: `.forge/rules/conventions/diagram-tooling.md`.

3. Renderize (requer `graphviz` + `pip install diagrams`):
   ```bash
   cd docs/diagrams && python3 infra.py     # gera infra.png
   ```

## Para PCI DSS

Use o mesmo approach para os diagramas exigidos: **Req 1.2.3** (rede + segmentação do CDE) e
**Req 1.2.4** (fluxo de dados de conta). Esses são modelos escritos à mão (o escopo do CDE é
decisão do QSA) — versione os `.py` para revisar o diff em PR. Evidência exportada
(PNG/PDF) via plugin `/drawio:drawio` com `--embed-diagram` — o arquivo permanece editável.
**Não** envie diagramas de escopo PCI ao endpoint hosted `mcp.draw.io` — a regra normativa
(e o porquê) está em `.forge/rules/conventions/diagram-tooling.md` § Restrições.

## Regras

- O scaffold é ponto de partida, não verdade final: rede/PCI exigem refino humano.
- Versione os `.py` (não os `.png`) — o diff fica revisável.
