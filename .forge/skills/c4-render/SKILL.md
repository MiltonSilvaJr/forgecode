---
name: c4-render
description: Gera ou cura diagramas C4 (Mermaid) e o overview.html a partir do grafo de código do Forge, respeitando a convenção de labels (sem pontos, sem em-dash). Use quando o usuário pede um mapa visual da arquitetura, um C4, ou o overview navegável do projeto.
---

# C4 Render

Entrada estreita, saída estreita (§17.7): você produz diagramas C4 navegáveis a partir do grafo de código já construído — não relê o repositório.

## Quando usar

- O usuário pede um diagrama de arquitetura, um C4 (Context/Container/Component), ou "o overview" do projeto.
- Após `/forge:design` (greenfield) ou ao tocar módulos (feature).

## Protocolo

1. Garanta o grafo: `bash .forge/scripts/graph.sh build` (ou `update`).
2. Gere tudo de forma determinista: `bash .forge/scripts/c4.sh` → `.forge/graph/c4/*.mmd` + `.forge/graph/overview.html`.
3. Reporte o que foi gerado e onde abrir o `overview.html`. Não cole o HTML nem o Mermaid inteiro no chat (§17.6) — aponte os arquivos.

## Convenção de labels (inegociável)

Labels Mermaid **nunca** contêm pontos (`.`) nem em-dash (`—`/`–`) — quebram o parser/legibilidade. O gerador sanitiza; se você editar um `.mmd` à mão, mantenha: `money.ts` → `money ts`, `—` → `-`.

## Limites

- Estrutura vem do grafo (determinista). Semântica (atores externos reais, rótulos de domínio) é curadoria humana/agente sobre os `.mmd` — não invente relações que o grafo não tem.
- O `overview.html` usa Mermaid via CDN; é artefato de visualização (fora do commit), não código de produção.
