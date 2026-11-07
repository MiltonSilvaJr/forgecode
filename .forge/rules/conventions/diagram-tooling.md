---
title: Tooling de Diagramas (draw.io MCP)
applies_to:
  - all
priority: medium
based_on: []
last_reviewed: 2026-07-06
---

# Tooling de Diagramas — draw.io MCP + fallback determinista

## Princípio

Diagramas têm **duas camadas**: a fonte textual versionável (Mermaid `.md`/`.mmd`, `infra.py`)
e a camada de elaboração/edição visual (`.drawio` / editor draw.io). A fonte textual é a
verdade — o diff é revisável em PR. O draw.io é onde humanos elaboram, refinam e mantêm o
desenho visual (topologia de rede, zonas PCI, layout).

## Ordem de preferência das ferramentas

Ao **elaborar ou manter** um diagrama, use nesta ordem:

1. **MCP draw.io** (server `drawio`, pacote `@drawio/mcp`) — quando as tools
   `open_drawio_mermaid`, `open_drawio_xml` ou `open_drawio_csv` estiverem disponíveis na
   sessão. Abrem o diagrama direto no editor draw.io para o humano revisar/editar.
   Use `open_drawio_mermaid` para handoff a partir da fonte Mermaid do Forge; `open_drawio_xml`
   para diagramas mxGraph elaborados (arquitetura AWS/K8s, rede, PCI — com `routing: "libavoid"`
   quando disponível para conectores limpos); `open_drawio_csv` para dados tabulares
   (org charts, inventários).
2. **Plugin Claude Code `drawio@drawio`** (skill `/drawio:drawio`, repo `jgraph/drawio-mcp`) —
   para **gerar arquivos `.drawio` nativos** no repositório e exportar PNG/SVG/PDF via
   draw.io Desktop CLI com `--embed-diagram` (o export continua editável no draw.io).
3. **Fallback determinista** — `bash .forge/scripts/mermaid-to-drawio.sh` (zero-dep, offline).
   Único caminho garantido em CI e em máquinas sem o MCP/plugin; continua sendo o conversor
   canônico dos gates do Forge.

Sem MCP e sem plugin disponíveis, siga direto para o fallback — nunca bloqueie a tarefa
esperando tooling opcional.

## Manutenção de diagramas existentes

- **Fonte Mermaid mudou** → regenere o `.drawio` (MCP `open_drawio_mermaid` para revisão
  visual, ou script de fallback para o artefato versionado).
- **Refino visual** (rede, zonas de confiança, escopo PCI) → edite o `.drawio` no draw.io;
  ele passa a ser o artefato mantido daquele diagrama (registre isso no cabeçalho do Mermaid
  de origem para evitar regeneração cega por cima do refino humano).
- Exports (`.png`/`.svg`/`.pdf`) **sempre com XML embutido** (`--embed-diagram`) — o arquivo
  exportado permanece editável e serve de evidência (ex.: PCI Req 1.2.3/1.2.4).

## Restrições

- Convenção de labels vale em qualquer camada: **sem pontos dentro de labels, sem em-dash**
  (ver `context.md` e gate do `/forge:c4`).
- Dados não saem da máquina: o MCP tool server transporta o diagrama no `#fragment` da URL
  (não vai ao servidor) e o plugin exporta via CLI local. **Não** use o endpoint hosted
  `https://mcp.draw.io/mcp` para conteúdo sensível/regulado (ele envia o diagrama ao servidor
  do draw.io — e o Claude Code não renderiza MCP Apps inline de qualquer forma).
- Artefatos gerados (`.forge/graph/c4/`, `overview.html`) continuam fora do commit;
  `.drawio` curados à mão em `docs/diagrams/` são versionados.

## Setup (por máquina, escopo user)

```bash
claude mcp add --scope user drawio -- npx -y @drawio/mcp
claude plugin marketplace add jgraph/drawio-mcp
claude plugin install drawio@drawio
# export PNG/SVG/PDF requer o draw.io Desktop no PATH (ex.: wrapper em /opt/homebrew/bin/drawio)
```

## Referências

- [drawio-mcp (jgraph)](https://github.com/jgraph/drawio-mcp)
- [/forge:mermaid-to-drawio](../../commands/docs/mermaid-to-drawio.md)
- [/forge:infra-diagram](../../commands/docs/infra-diagram.md)
