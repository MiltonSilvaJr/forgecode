---
date: 2026-11-06
id: squad-orchestration-adversarial-review
title: Análise Adversarial — squad-orchestration (SDD × código real)
status: review
author: milton
reviewed_target: .forge/specs/active/squad-orchestration/
reviewed_tree: .forge/worktrees/squad-orchestration (branch feature/squad-orchestration, head da634f4185)
severity_summary: "5 BLOCKER, 6 HIGH, 6 MEDIUM"
verdict: "NÃO APTO para archive; apto para review com correções obrigatórias"
tags:
  - adversarial-review
  - sdd
  - squad-orchestration
  - evidence-based
priority: critical
---

# Análise Adversarial — `squad-orchestration`

> **Método.** Não li apenas os documentos: confrontei cada afirmação verificável com o
> repositório e o branch de implementação (`feature/squad-orchestration`, head
> `da634f4185`, worktree `.forge/worktrees/squad-orchestration`). Onde digo "falso" ou
> "não implementado", há comando e saída reproduzíveis citados.
>
> **Postura.** Crítica dura. O objetivo é impedir que um change de 22.609 linhas entre
> no tronco com aparência de aprovado e substância incompleta.

---

## 0. Veredito

| Dimensão | Avaliação |
|---|---|
| Qualidade dos documentos | **Alta** — rastreabilidade, DDs, critérios observáveis |
| Correspondência documento × código | **Parcial** — o design descreve um sistema que não é exatamente o implementado |
| Integridade da verificação | **Comprometida** — verificou árvore suja, de um branch contaminado por outras duas features |
| Completude funcional vs. REQ | **7/25 verificados por código+teste; 1 requisito sem implementação; 1 requisito com teste enfraquecido** |
| Apto a `/forge:archive` | **NÃO** |
| Apto a review humano | **SIM, com bloqueios explícitos** |

**Cinco bloqueadores** impedem a aprovação. Nenhum deles é "estilo": todos são
divergências entre o que a especificação promete e o que o repositório entrega, ou
falhas de integridade do processo de verificação.

---

## 1. BLOCKER

### B1 — O manifesto contradiz a si mesmo e a `tasks.md`

`manifest.yaml`:

```yaml
scale: 2
status: implemented
gates:
  implementation_verified: false
  human_archive_approval: false
archive:
  eligible: false
  reason: "tasks not implemented"
```

`tasks.md`: **40 de 40** tasks marcadas `[X]`.
`verification.yaml`: `status: passed` nos três checks.

Três fontes afirmam coisas incompatíveis:

- `status: implemented` diz "feito";
- `implementation_verified: false` diz "não verificado";
- `archive.reason: "tasks not implemented"` diz "nada foi implementado".

**Por que importa:** qualquer automação do harness (`/forge:status`, fechamento de wave,
`/forge:archive`) decide com base nesses campos. O campo `archive.eligible` está
congelado em `false` com um motivo falso — não porque a implementação falhou, mas
porque ninguém atualizou o manifesto depois da última wave. Isso é **estado derivado
escrito à mão que não acompanha a fonte** — exatamente a classe de erro que o próprio
change se propõe a eliminar (`proposal.md` lição 1: "relato não é prova").

**Evidência:** leitura direta de `manifest.yaml` e contagem `grep -c '^- \[X\] TASK-' → 40`.

---

### B2 — A verificação "passou" numa árvore suja

`evidence/runs/20261106161440-5a0ab439/run-manifest.json`:

```json
"status": "passed",
"head_sha": "da634f41854998027ef4a51a8f355234fb505bd7",
"dirty": true,
"changed_files": [".forge/", ".gitattributes", ".gitignore", "AGENTS.md", "CHANGELOG.md"],
"diff_sha256": "46e431f9..."
```

O run que sustenta `verification.yaml` foi executado com **working tree suja**. Os
arquivos listados são de meta/documentação, mas a afirmação publicada é
"commit `da634f4185` verificado". Um revisor que faça `git checkout da634f4185 && bun
turbo test` **não reproduz necessariamente** o resultado atestado: o que passou foi
`da634f4185 + diff não commitado`.

**Por que importa:** a regra do repositório é explícita — a prova de canal é o job de
CI sobre o commit. A verificação local suja não é essa prova, e o `verification.yaml`
não registra a sujeira.

**Correção mínima:** reexecutar `/forge:verify` sobre árvore limpa, no commit exato, e
registrar `dirty: false` no run-manifest.

---

### B3 — O branch contém duas outras features; a verificação prova a união, não o change

`git diff --name-only origin/dev...HEAD` → **213 arquivos**, **22.609 inserções**, **205
commits**. Desses, **110 arquivos não têm "squad" no nome** e pertencem a outro escopo:

- `packages/core/src/subscription/**` (16 arquivos), `packages/cli/src/queue/**` (9),
  `packages/schema/src/subscription-auth.ts`, `packages/protocol/src/groups/subscription.ts`,
  ~40 testes de `subscription-auth`/`queue`;
- mudanças de TUI alheias ao change: `packages/tui/src/component/spinner-renderable.ts`,
  `packages/tui/test/component/go-upsell-art.test.tsx`.

A causa é o merge de `local-integration` (mencionado nas próprias notas de task, ex.:
TASK-08: "merge a088d4da03"). Consequências concretas:

1. `bun turbo test` no branch prova que **squad + subscription-auth + forgequeue** passam
   juntos — não que `squad` passa isolado.
2. `impact.json` (381 arquivos) mistura os três escopos; a análise de impacto do change
   está inflada e não permite decidir sobre squad sozinho.
3. Reverter `squad` sem reverter as outras duas features exige cirurgia manual.
4. O `manifest.yaml` declara `dependencies.specs: [forgequeue, subscription-auth]` como
   **dependência de contrato**, mas na prática houve **dependência de código** por merge
   direto. Isso contradiz `proposal.md` §4 ("dependência de alinhamento de semântica, não
   de contrato de servidor") e `design.md` §1.3.

**Por que importa:** o change não é revisável como unidade. Um PR de 22k linhas com três
features entrelaçadas é onde bugs de integração se escondem — e o portão de verificação
foi desenhado para uma unidade menor.

---

### B4 — REQ-11 (claim preservado por shutdown) não está implementado no `close`

`requirements.md` REQ-11, critério 2:

> "Claim preservado por shutdown (processo morto no meio do turno) mantém a sessão
> não-quieta até reconciliação por retomada ou interrupção explícita (`interrupt` com
> motivo `user` libera o claim); `close` recusa enquanto isso, sem auto-liberar o claim."

O `close` usa `SquadActivity.isActive` (`packages/core/src/squad/transition.ts:164`):

```ts
if (entry !== sender && (yield* activity.isActive(sessionID))) pendencies.push(...)
```

E `activity.ts:22-29`:

```ts
if (yield* execution.isActive(sessionID)) return true
const info = yield* sessions.get(sessionID)...
return idle === undefined || busy > idle
```

`SessionExecution.isActive` é **process-local**; após restart, ele não enxerga o claim
durável. O claim durável mora em `SessionTable.time_suspended` (comentário em
`packages/core/src/session/sql.ts:72`: "The execution claim timestamp (historical column
name; see SessionStore.claim)"). O único lugar do `squad` que lê essa coluna é
`channel.ts:126`, e é usado **apenas** pelo liveness — nunca pelo `close`.

**Verificação:** `grep -rn "time_suspended" packages/core/test/squad/` → **vazio**. Não
existe teste que exerça o cenário "processo morreu, claim permanece, close deve recusar".

**Consequência:** o cenário exato que o referencial descreve como grave ("sessão morta
que não lê `working` para sempre", `design.md` §2.7) pode ser fechado por `close` como
se estivesse ocioso. O requisito está textualmente satisfeito no design e ausente no
código.

---

### B5 — REQ-19 (fronteira de import) foi violado e o teste foi *enfraquecido* para passar

`requirements.md` REQ-19, critério 1:

> "…nenhum outro módulo do `squad` importa `SessionInbox`, `Session.prompt`, `Credential`
> ou módulo de `forgequeue`/`subscription-auth` diretamente."

Realidade:

- `packages/core/src/squad/activity.ts:6` — `import { Session } from "../session.js"`.
- O teste de fronteira foi **editado para permitir** esse arquivo
  (`packages/core/test/squad/channel.test.ts:105`):

```ts
it.live("only channel.ts, credential.ts and activity.ts reach the session, inbox or credential primitives", ...)
  .filter((file) => file.endsWith(".ts") && file !== "channel.ts" && file !== "credential.ts" && file !== "activity.ts")
```

O título do teste, a allowlist e o requisito divergem entre si. Além disso, `activity.ts`
**não existe no design** (ver H2).

**Por que é bloqueador e não "detalhe":** o requisito foi escrito para isolar o
acoplamento em dois adapters; o código acoplou um terceiro módulo; e o teste que deveria
detectar isso foi relaxado na mesma direção. Esse é o padrão "ajustar o teste ao código"
— o oposto de `testing/regression-red-first.md` e do espírito do próprio change.

**Correção:** ou `activity.ts` deixa de importar `../session.js` (recebendo a informação
de um adapter), ou o requisito é emendado com justificativa registrada e o teste volta a
ser rígido com nomes explícitos vindos da spec.

---

## 2. HIGH

### H1 — A evidência red/green do `/forge:implement` não existe para 33 das 40 tasks

`tasks.md` (cabeçalho):

> "Cada task é atômica (commit de vermelho + commit de implementação) … o Red é provado
> por execução em `/forge:implement` (`red-evidence.sh task …`)."

Realidade:

- `find .forge/specs/active/squad-orchestration/evidence -type f` → **2 arquivos**, ambos
  `run-manifest.json` com `"stage": "verify"`.
- **Nenhum** run-manifest de `implement`.
- Apenas **7** tasks têm a nota `> Red-first: red-evidence.sh … OK task`.
- Há **71** commits "— vermelho" no branch — ou seja, o ritual de commit vermelho
  aconteceu, mas a **evidência de gate** que o harness consome não foi produzida nem
  persistida.

**Por que importa:** `verification.yaml` só prova o estado final. A regra
`testing/regression-red-first.md` exige prova de que o teste falhava antes. Sem os
artefatos de `red-evidence`, essa prova é reconstruída por arqueologia de git — e o
`approvals.yaml` afirma que ela foi delegada ao `/forge:implement`. Delegou-se e não se
coletou o resultado.

---

### H2 — O design descreve 15 módulos; o código tem 27, com 3 órfãos e 1 teste órfão

`design.md` DD-01 lista:

`{index, sql, store, registry, evidence, channel, credential, checkpoint, dispatch, ownership, transition, panel, audit, event}.ts` — 14 nomes (+ `panel/` por §2.9).

Real: `ls packages/core/src/squad/*.ts` → **27**. Módulos presentes no código e ausentes
do design:

- `activity.ts` (32 linhas — o predicado de `close`)
- `guard.ts` (10 linhas — `requireEnabled`)
- `invalid.ts` (8 linhas)

Também órfãos de rastreabilidade:

- teste `packages/core/test/squad/launch-ownership.test.ts` **não é citado por nenhuma
  task** (`grep` em `tasks.md`).
- `launch.ts`, `replace.ts`, `send.ts`, `status.ts`, `plan.ts`, `check.ts`, `block.ts`,
  `broadcast.ts`, `liveness.ts`, `activate.ts` também não estão na lista DD-01 — o design
  simplesmente não inventariou a camada que existe.

**Por que importa:** a tabela §7 (rastreabilidade) aponta REQ → seção de design, e o
design aponta módulos. Com 13 módulos fora do inventário, a rastreabilidade "REQ →
código" é nominal, não real. `activity.ts` é justamente onde está o BLOCKER B4.

---

### H3 — O teste de contrato do canal usa `Layer.mock` e duplica a regra que deveria provar

`packages/core/test/fixture/squad-channel.ts`:

```ts
const layer = Layer.mock(Session.Service, {
  prompt: (input) => Effect.suspend(() => {
    const existing = admitted.get(id)
    if (existing) return Effect.succeed(existing)   // <- reimplementa a idempotência
    ...
  }),
  revert: {} as Session.Interface["revert"],         // <- cast inseguro
})
```

Dois problemas:

1. **Mockar o serviço não prova o contrato.** O teste valida que o *mock* é idempotente,
   não que `Session.prompt` real é. Se a semântica real de admissão por `id` mudar, este
   teste continua verde. Isso contradiz `AGENTS.md` §Testing ("Avoid mocks as much as
   possible… Test actual implementation, do not duplicate logic into tests") e o próprio
   `design.md` §1.3, que trata a idempotência do core como a **premissa** do `SquadChannel`.
2. **`pending()` nunca decresce no fixture.** O mock devolve *todos* os itens admitidos,
   inclusive já entregues (`inbox: (sessionID) => [...admitted.values()].filter(...)`). Como
   REQ-07 (`inbox_pending`) e REQ-11 ("close recusa com `inbox_pending > 0`") dependem de o
   valor **cair** após a entrega, o fixture não consegue representar o caso feliz. O teste
   prova o estado "há pendência", nunca "a pendência foi consumida".

**Consequência:** o mecanismo mais importante do change — "mensagem enfileirada vira prova,
não confirmação de leitura" — está provado contra um dublê escrito pela mesma equipe, com
a mesma regra copiada. É circular.

---

### H4 — `scale: 2` para um change que cria uma capability inteira, com 25 REQ e 40 tasks

`manifest.yaml`: `scale: 2`. `FORGE.md` §2: escala 2 = "requirements + design + tasks";
escala 3 = "+ analyze + story sharding"; escala 4 = "+ FRD/NFRD/TRD/DDD".

Estado real:

- `dev_loop.sharded: false`, **sem** `stories/`.
- **Sem** artefato de `analyze` (`ls …/analyze* → vazio`).
- **Sem** capability no baseline: `.forge/product/current/capabilities/` está **vazio** —
  ou seja, `affected_capabilities: [squad-orchestration]` adiciona uma capability nova.
- 25 REQ, 6 NFR, 10 tabelas, 20 endpoints, 27 módulos, 22.609 linhas.

O change tem o perfil de escala 3–4 e foi conduzido como 2. A justificativa de skip não
está registrada em `quick_plan` (`enabled: false`, `skipped_phases: []`), o que, pela
regra do próprio harness, é **drift**: "Choosing below the suggested risk level records
skipped phases + justification in the manifest."

**Por que importa:** sem `analyze`, ninguém checou consistência entre documentos e
código — e é exatamente essa a classe de erro que B4/B5/H2 materializam. Sem sharding, a
revisão humana de 22k linhas foi substituída por aprovação de documentos.

---

### H5 — O design manda escrever em `product/current/`; o harness proíbe

`design.md` §5, item 7 / TASK-00:

> "ADR … deve ser registrada via `/forge:adr new` (`.forge/product/current/adr/` existe
> vazio…). É a TASK-00 (Wave 0)."

E o arquivo existe: `.forge/product/current/adr/0002-squad-orchestration-service-control.md`.

Mas `AGENTS.md` (gerado de `FORGE.md`) diz:

> "Do not edit `product/current/` — only `/forge:archive` writes there."

O change **escreveu no baseline antes do archive**, e marcou a task como concluída. Ou a
regra do harness está errada, ou a TASK-00 violou a regra. Não há registro de exceção em
`machinery-exceptions.txt`-equivalente nem em `approvals.yaml`.

**Por que importa:** no dia em que `product/current/` passar a ser tratado como verdade
publicada (é o desenho), essa ADR entra no baseline sem passar pelo archive do change que
a originou, e o change fica impossível de arquivar de forma idempotente.

---

### H6 — Branch não integrado, sem PR, com o manifesto afirmando "implemented"

- `git merge-base --is-ancestor feature/squad-orchestration origin/dev` → **não merged**.
- 205 commits à frente de `origin/dev`.
- `status: implemented` no manifesto.
- Nenhuma evidência de PR/review registrada em `approvals.yaml` (as aprovações são de
  `requirements.md`/`design.md`/`tasks.md`, não do código).

Ou seja: "implemented" significa "existe num branch privado", não "entregue". A distinção
importa porque `manifest.yaml` é a fonte que outros agentes leem para decidir o que já
existe no produto.

---

## 3. MEDIUM

### M1 — `close` e `liveness` discordam sobre o que é "execução em curso"

- `liveness` usa `Claim` de `time_suspended` (`channel.ts:123-135`).
- `close` usa `SessionExecution.isActive` + `busy > idle` (`activity.ts`).

Duas noções de "ativo", dois códigos, nenhum teste cruzando as duas. Uma sessão pode
aparecer `presumed_dead` no `status` e ser considerada não-ativa pelo `close`.

### M2 — Leitura de coluna interna via SQL cru, duplicando `SessionStore.claim`

`channel.ts:124-129` faz `select time_suspended from session_v2` direto no `Database`, em
vez de usar `SessionStore.claim` (que o próprio comentário de `sql.ts:72` cita como a
fonte). Se o claim mudar de representação, o `squad` quebra silenciosamente — sem teste
que passe pelo caminho real (ver H3/B4).

### M3 — Duas aprovações humanas desatualizadas por construção

`approvals.yaml` registra as aprovações humanas no commit `75a3c78474`. O código foi até
`da634f4185` (dezenas de commits depois). É aceitável para implementação, mas o design
aprovado não é o design implementado (§H2/B5). O correto é um gate final de
`design_drift` no `/forge:verify` ou uma emenda de design registrada.

### M4 — `panel` executa comando configurado no servidor

`packages/core/src/squad/panel/command.ts` roda `execFile` sem shell, com blocklist de
sintaxe e timeout. A mitigação é boa. O risco residual é arquitetural: `squad.panel.jira_command`
dá ao operador uma superfície de execução de processo dentro do servidor. Hoje é
opt-in e documentado (`design.md` §2.9); vale um limite explícito (allowlist de executáveis)
antes de sair de `experimental`.

### M5 — Limiares de liveness sem calibração

`stale_after = 60min` / `dead_after = 24h` são defaults escolhidos, não medidos. O
documento reconhece ("decisão registrada"), mas não há dado de operação real que sustente
60 minutos. Para um sistema cujo propósito é "medir, não presumir", o próprio limiar é
presumido.

### M6 — Testes citados no design que não existem como descritos

`design.md` §2.11 cita `packages/protocol/test/squad.test.ts` e `packages/server/test/squad.test.ts`
(ambos existem ✓), mas `design.md` §2.11 também afirma que `packages/schema/test/squad.test.ts`
testa "codecs" e que o digest é testado no core — o digest está em
`packages/core/test/squad/digest.test.ts` ✓. Sem achado material aqui; registrado porque o
inventário de testes do design também está incompleto (não lista `close-by`, `cost`,
`session-replace`, `block`, `dispatch-accept`, `launch-ownership`).

---

## 4. O que resistiu ao escrutínio (crédito onde é devido)

Nem tudo é problema. Estas afirmações foram verificadas e **se sustentam**:

1. **Digest canônico.** O exemplo de `design.md` §2.3 confere:
   `sha256` do JSON de fixture = `786d7eb4896706ae559887f05468829c12e45eed0763e4cb3ea3bef925e01498`. Recomputed com `node:crypto`. ✓
2. **10 tabelas + índices parciais.** `sql.ts` declara `squad_generation`, `squad_session`,
   `squad_tree_owner`, `squad_checkpoint`, `squad_transition`, `squad_transition_entry`,
   `squad_dispatch`, `squad_audit`, `squad_idempotency`, `squad_block` — 10, com
   `squad_generation_active_idx`, `squad_tree_owner_active_idx`, `squad_dispatch_orq_idx`,
   `squad_dispatch_seq_idx`. ✓
3. **Redaction de segredo.** `audit.ts:38-47` cobre PEM, `Bearer`, `sk-`, `ghp_`, `AKIA` e
   `"token"`. ✓
4. **`execFile` sem shell + blocklist.** `panel/command.ts`. ✓
5. **Predicado de `close`** (checkpoint íntegro por hash, `inbox_pending`, `--force --reason`,
   exclusão da sessão emissora, `closed_by`) está implementado — exceto o claim (B4). ✓
6. **ADR existe** e descreve a decisão estrutural. ✓ (o problema é onde e quando, H5)
7. **Migration aditiva, sem alterar tabela existente.** ✓
8. **231 `it`s na suíte de `squad` no core**, sem `skip`/`todo`, sem tautologias
   (`grep` por `expect(true)`/`it.skip` → vazio). O volume de teste é real.

---

## 5. Perguntas que a revisão humana deve exigir antes de aprovar

1. O branch de squad será separado de `subscription-auth`/`forgequeue` para revisão e
   merge? **Se não, qual é o plano de rollback de squad isolado?**
2. `close` deve consultar o claim durável (`time_suspended`) ou o requisito REQ-11 será
   emendado? Qual das duas verdades vale?
3. `activity.ts` sai da fronteira ou REQ-19 será emendado? Quem aprovou o relaxamento do
   teste de fronteira?
4. Onde estão as evidências `red-evidence.sh task` das 33 tasks sem nota? Foram coletadas
   e perdidas, ou nunca coletadas?
5. Por que `scale: 2` sem `analyze` e sem `stories` para uma capability nova de 22k
   linhas? Onde está a justificativa de skip exigida pelo harness?
6. A ADR em `product/current/adr/` será revertida para o archive formal, ou o harness
   ganhará uma exceção documentada?
7. O `manifest.yaml` será corrigido (`status`, `implementation_verified`,
   `archive.reason`) por script, não à mão — para não repetir o erro que o change ataca?

---

## 6. Recomendação

**Não arquivar. Não aprovar como está.**

Sequência mínima para destravar:

1. **Corrigir B1** (manifesto derivado das fontes; nunca à mão).
2. **Reexecutar `/forge:verify` limpo** e registrar `dirty: false` (B2).
3. **Decidir o escopo do merge** (B3): branch de squad isolado, ou aceitar formalmente que
   o change é "squad + auth + queue" e renomear/reescalar.
4. **Implementar ou emendar REQ-11** para o claim durável + teste com `time_suspended`
   (B4).
5. **Restaurar a fronteira de REQ-19** ou emendar com justificativa e aprovação (B5).
6. **Coletar a evidência red/green** das 40 tasks ou declarar explicitamente que o
   critério foi relaxado (H1).
7. **Sincronizar `design.md` com os 27 módulos** e a rastreabilidade real (H2).
8. **Trocar o mock do canal por teste de contrato no servidor real** (ou declarar que é
   teste de dublê e reduzir a força da afirmação REQ-19) (H3).
9. **Registrar o skip de `analyze`/`stories`** ou reescalar para 3 (H4).

**Estimativa de retrabalho:** 3–5 dias de correção documental e 2–4 dias de correção de
código (B4/B5/H3), mais o tempo de re-verificação. Muito abaixo do custo de descobrir B4
em produção, com uma geração fechada sobre um processo que na verdade morreu.

---

## 7. Apêndice — reprodução dos achados

```bash
# B1
sed -n '1,70p' .forge/specs/active/squad-orchestration/manifest.yaml
grep -c '^- \[X\] TASK-' .forge/specs/active/squad-orchestration/tasks.md   # 40

# B2
cat .forge/specs/active/squad-orchestration/evidence/runs/*/run-manifest.json | grep -E '"status"|"dirty"|"head_sha"'

# B3
cd .forge/worktrees/squad-orchestration
git diff --stat origin/dev...HEAD | tail -1
git diff --name-only origin/dev...HEAD | grep -vc squad      # 110
git merge-base --is-ancestor HEAD origin/dev && echo merged || echo "not merged"

# B4
grep -n "activity.isActive" packages/core/src/squad/transition.ts
sed -n '20,30p' packages/core/src/squad/activity.ts
grep -rn "time_suspended" packages/core/test/squad/       # vazio
grep -n "time_suspended" packages/core/src/session/sql.ts # claim durável

# B5
grep -n "../session.js" packages/core/src/squad/activity.ts
sed -n '104,117p' packages/core/test/squad/channel.test.ts

# H1
find .forge/specs/active/squad-orchestration/evidence -type f | wc -l   # 2
grep -c "Red-first:" .forge/specs/active/squad-orchestration/tasks.md  # 7

# H2
ls packages/core/src/squad/*.ts | wc -l   # 27
grep -o "packages/core/src/squad/{[^}]*}" .forge/specs/active/squad-orchestration/design.md

# H3
sed -n '1,45p' packages/core/test/fixture/squad-channel.ts

# H4
grep -n "scale:\|sharded\|skipped_phases" .forge/specs/active/squad-orchestration/manifest.yaml
ls .forge/product/current/capabilities/    # vazio
```

---

**Autor:** Milton (agente de IA) · **Data:** 2026-11-06
**Alvo:** `.forge/specs/active/squad-orchestration/` + `feature/squad-orchestration@da634f4185`
**Natureza:** revisão adversarial; não altera o change.
