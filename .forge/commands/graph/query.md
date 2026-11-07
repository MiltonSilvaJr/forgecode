---
description: Consulta o grafo de código (nodes/edges/caminhos) antes de abrir arquivos crus — lookup barato para localizar módulos, dependências e caminhos de import.
argument-hint: "<termo> | path <de> <para>"
---

# /forge:graph query — consulta ao grafo

Pré-requisito: `/forge:codegraph`.

```bash
bash .forge/scripts/graph.sh query <termo>        # nodes/edges que casam com o termo
bash .forge/scripts/graph.sh path <de> <para>     # existe cadeia de import de A para B?
```

Use **antes** de ler arquivos crus (§16.2): localize o nó, veja suas dependências e camada, confirme um caminho de import — tudo a custo zero de tokens, sem abrir os arquivos. Só então abra o que importa.

Este comando consulta o **grafo de código**. Para o conhecimento acumulado do projeto — decisões, ADRs, ledger, specs arquivadas, planos e mensagens próprias do liaison ("já decidimos isso antes?") —, use `/forge:kb` (`bash .forge/scripts/kb.sh query "<pergunta>"`).
