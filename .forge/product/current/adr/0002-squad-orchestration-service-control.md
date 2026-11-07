# 0002. Camada de orquestração multi-sessão como serviço de controle do servidor, com estado operacional em banco e canal pela inbox

- **Status:** accepted
- **Data:** 2026-11-05
- **Decisores:** Milton Antonio da Silva Jr

## Contexto e Problema

A operação real de coordenação de treze sessões paralelas (04/11/2026) existe hoje como um
conjunto de scripts Python/iTerm/Codex externos ao ForgeCode, com registro em JSON escrito à mão,
canal por CLI externo e painel alimentado por um plugin à parte. Era preciso decidir onde essa
camada de orquestração multi-sessão (`squad`) mora no ForgeCode, onde persiste seu estado
operacional e por qual mecanismo entrega mensagens entre sessões.

## Drivers da Decisão

- `conventions/machinery-propagation.md`: estado durável de projeto mora no tronco, não na branch;
  todo worktree veria uma cópia divergente se o registro vivesse em arquivo versionado.
- Atomicidade e índice único de "uma geração ativa" exigem transação com o banco do servidor.
- O ForgeCode já tem primitivas duráveis: sessão, inbox com `delivery: queue|steer`, admissão
  idempotente por `id` e eventos `session.inbox.*`/`session.execution.*`.
- A abertura de "aba" do referencial não tem equivalente no ForgeCode: sessões são criadas pela API
  e consumidas pelo cliente que se conectar.

## Opções Consideradas

1. Script/CLI standalone que orquestra via API pública (espelhar `squad.py`).
2. Persistir registro/checkpoint em arquivos versionados na árvore (`.forge/squad/*.json`).
3. Estado como event sourcing completo sobre o Bus do core.
4. **Serviço de controle no core, com estado operacional em tabelas próprias e canal pela inbox.**
5. Pacote `packages/squad` separado consumindo só HTTP.

## Decisão

Serviço de controle no core (`packages/core/src/squad/**`), exposto por um grupo HTTP experimental
(`/api/experimental/squad/...`, identificadores `experimental.squad.*`) e consumido por um grupo de
CLI (`opencode squad`), com estado operacional em tabelas `squad_*` no banco do servidor e canal de
mensagem pela primitiva de inbox pré-existente (`Session.prompt` com `delivery` e `id` idempotente).
Nada de script de launcher, iTerm, barramento paralelo nem estado em arquivo versionado.

## Consequências

- Positivas: registro/checkpoint/transição ganham transação e índice único parcial de geração ativa;
  mensagens usam a inbox durável com prova de enfileiramento (nunca confirmação falsa de leitura);
  liveness deriva de evidência durável (`time.busy`/`time.idle`/eventos), não de relato de agente.
- Negativas/débitos: acopla o `squad` ao banco do servidor (não é um pacote cliente isolável);
  depende do contrato não-congelado da primitiva de inbox (isolado em um único adapter `SquadChannel`)
  e da superfície de credencial do `subscription-auth` (isolada em `CredentialPresence`, fallback
  `unknown`); a camada fica atrás da flag `squad.enabled` (default `false`) para não mudar o
  comportamento de ninguém.

## Links

- Change de origem: squad-orchestration (design §2.1 DD-01; proposal A1/A2/A6)
- ADR relacionado: 0001 (fila por sessão como primitiva, sem barramento global)
