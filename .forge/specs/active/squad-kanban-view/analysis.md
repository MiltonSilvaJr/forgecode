# Analysis — squad-kanban-view

> **Natureza deste arquivo.** Revisão adversarial manual (2026-11-06), feita com o change em
> `proposed`. **Não** é a execução de `/forge:analyze`, cuja pré-condição é `tasks-ready`
> (`.forge/commands/specs/analyze.md`); essa execução continua pendente e é a condição E7 do gate de
> entrada (`design.md` §1.3). A versão anterior deste arquivo se apresentava como "Artefato de
> `/forge:analyze`" e afirmava que não havia impacto calculável; ambas as afirmações foram corrigidas
> (KV-H10, KV-M11). O parecer completo, com evidência por achado, está em `pre-approval.md`.

## Status: PASS (condicional ao aceite de risco do operador)

Motivo: KV-B01 permanece como risco ACEITO pelo operador (decisão DA-09, design.md §8.1):
implementar agora em branch isolada baseada em `feature/squad-orchestration` e rebasear sobre
`origin/dev` quando o base mergear. A condição de entrada E1/E2 segue registrada como débito de
integração, não como bloqueio de execução. As demais decisões de produto (DA-01..DA-08) foram
fechadas pelo operador em §8.1. Os defeitos de documento encontrados foram corrigidos nos artefatos.

## Achados

| ID | Severidade (BLOCKER/HIGH/MEDIUM) | Tipo (coverage/conflict/drift/risk) | Onde | Recomendação |
|---|---|---|---|---|
| KV-B01 | BLOCKER (aceito) | risk | manifest, design §1.3 | Aceite pelo operador (DA-09): branch isolada sobre `feature/squad-orchestration` + rebase pós-merge. Débito de integração registrado, execução autorizada |
| KV-B02 | BLOCKER (corrigido) | drift | tasks.md (todas) | Corrigido: convenção de stub no vermelho, padrões no formato real do `bun test` 1.4.4, guarda de escrita separada do Red |
| KV-H01 | HIGH | drift | design §4.1/§4.2, requirements | Corrigido: o client devolve `SquadPanelDocument`/`SquadLivenessReport` codificados (ms), já desembrulhados de `data` |
| KV-H02 | HIGH | drift | REQ-08, TASK-03 | Corrigido: `location` é `Location.Ref` (`{ directory }`), não string |
| KV-H03 | HIGH | drift | REQ-02, REQ-07, DD-05, TASK-06 | Corrigido: cliente de teste com as operações reais de `experimental.squad`, não `post/patch/put/delete` |
| KV-H04 | HIGH | coverage | NFR-01, TASK-09 | Corrigido: contar renderables montados, não títulos no frame |
| KV-H05 | HIGH | conflict | REQ-07 crit. 1 × TASK-11 × manifest | Corrigido: lista de paths permitidos e `affected_paths` alinhados |
| KV-H06 | HIGH | conflict | DD-08 × `packages/tui/AGENTS.md` | Citação corrigida; conflito com o registro de experimentos aberto (DA-01) |
| KV-H07 | HIGH | conflict | proposal §3 × base REQ-17/README | README entra em REQ-10; requisito do baseline aberto (DA-08) |
| KV-H08 | HIGH | drift | REQ-01 crit. 3, REQ-03 crit. 3/4 | Semântica corrigida; produto aberto (DA-03, DA-04) |
| KV-H09 | HIGH | coverage | REQ-06, proposal §2 item 6 | Corrigido: `409` e "nenhuma geração ativa" com critério |
| KV-H10 | HIGH | drift | analysis.md | Texto corrigido; `/forge:analyze` pendente (E7) |
| KV-M01 | MEDIUM | coverage | requirements checklist × tasks × traceability × design §7 | Corrigido |
| KV-M02 | MEDIUM | coverage | critérios sem task | Corrigido |
| KV-M03 | MEDIUM | coverage | DD-03 sem REQ | Corrigido (REQ-04 crit. 5) |
| KV-M04 | MEDIUM | conflict | REQ-02 crit. 3 × DD-08 | Corrigido |
| KV-M05 | MEDIUM | conflict | DD-07 × AGENTS.md "TUI Theme Tokens" | Corrigido |
| KV-M06 | MEDIUM | drift | REQ-05, DD-04 | Relógio injetado e semântica de `atualizadoEm` corrigidos; DA-05 aberto |
| KV-M07 | MEDIUM | risk | DD-04, R10 | Custo de `panel` por card registrado; DA-07 aberto |
| KV-M08 | MEDIUM | conflict | classificação de dados | Corrigido |
| KV-M09 | MEDIUM | risk | proposal §1, design §3 | Valor sobre `panel show` não medido; DA-02 aberto |
| KV-M10 | MEDIUM | coverage | critérios adjetivos | Corrigido |
| KV-M11 | MEDIUM | risk | impact.json | Gerado por `impact.sh` (rc 0), mas o grafo não contém o base; E8 exige regenerar |

## Pendências operacionais (não bloqueiam o artefato)

- Achados do change base observados aqui (não editados): `progressa` sempre `false` (`panel.ts:70,73,99`);
  `kanban.json` classificado `public` embora carregue `titulo = dispatch.scope`, classificado
  `sensitive` no próprio base; manifesto do base ainda `implemented` com gates `true` (B1) —
  destino: ledger (`/forge:ledger`).
- Drift de nome de branch entre `FORGE.md` §3.4, `rules/conventions/git-worktree.md` §6 e
  `AGENTS.md` — destino: ledger.

## Síntese (2-3 linhas)

O desenho (projeção somente leitura de duas rotas existentes) é coerente e pequeno, mas o change
descrevia o contrato do client errado, não tinha vermelhos executáveis e prometia testes que passariam
antes da implementação; isso foi corrigido. Continuam abertos o bloqueio de dependência e oito
decisões de produto.

## Revisão

Revisor: subagente adversarial (Claude Opus 5.5) | Transcrito por: o mesmo subagente (revisão manual; não substitui `/forge:analyze`)
