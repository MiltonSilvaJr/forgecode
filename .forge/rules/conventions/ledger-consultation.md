---
title: Consulta ao ledger durável (roadmap & dívida técnica)
applies_to:
  - all
priority: high
last_reviewed: 2026-10-30
based_on: []
---

# Consulta ao ledger — o que fazer a seguir nasce do `LEDGER.md`

## Princípio

O projeto mantém um **ledger durável** (`.forge/ledger/ledger.json`, com a view humana
`.forge/ledger/LEDGER.md`) — o registro que sobrevive entre changes de roadmap, dívida técnica,
bugs conhecidos, follow-ups e ideias de feature. É a fonte canônica de "trabalho conhecido ainda
não feito". Operado por `/forge:ledger` (script `ledger-ops.sh`); ver o comando para a mecânica.

## Regras operacionais

1. **Ao sugerir o próximo trabalho** — sempre que o usuário pedir "o que implementar agora / o que
   falta / sugira o próximo passo", **consulte primeiro** `.forge/ledger/LEDGER.md` (ou
   `ledger-ops.sh list --status open --by-priority`). As entradas `open`/`planned` de maior
   prioridade são os candidatos naturais. Não invente um backlog do zero se o ledger já o tem.

2. **No `/forge:resume`** — o mandato de retomada lê o estado do change ativo **e** os itens de
   maior prioridade do ledger, para que o "Próximo passo lógico" reflita tanto o change em curso
   quanto o roadmap durável.

3. **Promoção a change (elo bidirecional, ciclo fechado)** — quando uma entrada do ledger vira
   trabalho ativo, abra o change **declarando o elo**: `/forge:spec new <id> --type … --from-ledger
   <LDG-NNNN>`. Isso marca a entrada `promoted` (some da lista ativa, não é re-sugerida) **e** grava
   `ledger_origin` no manifest, o que fecha o ciclo **automaticamente e sem depender de memória**:
   - `/forge:archive` → entrada vira `resolved` (entregue ao baseline);
   - `/forge:close --reason abandoned|rejected` → entrada **reaberta** (`open`, volta ao roadmap —
     não foi entregue);
   - `/forge:close --reason delivered-externally` → `resolved`;
   - `superseded` → permanece `promoted` (o sucessor carrega o item).

   Se o change já foi criado sem o flag, ligue manualmente com `/forge:ledger promote <LDG-NNNN>
   --to <change-id>` (mas aí a baixa/reabertura no fim vira manual — prefira `--from-ledger`). O
   `/forge:doctor` sinaliza itens `promoted` cujo change de destino sumiu sem baixa.

4. **Semeadura** — o ledger pode **nascer** com o plano do projeto: módulos, features e decisões de
   arquitetura previstos entram como entradas `roadmap`/`feature-idea` (`/forge:ledger add`). Num
   redesign amplo, as entradas de módulos planejados são o esqueleto do roadmap. (Integração
   automática do pipeline de spec → ledger é evolução futura; hoje a semeadura é explícita.)

5. **Progresso se registra com `note`, e quem fecha é o arquivamento.** Pagamento parcial de uma
   dívida — "fiz a fatia A, a fatia B continua aberta" — entra por `/forge:ledger note <LDG-NNNN>
   --kind progress --text "<o que foi feito, o que sobrou>"`, que acrescenta um bloco datado ao fim
   do `detail` e **não** mexe no `status`. Não use `--status in-progress` como veículo de
   progresso: os leitores do ledger não concordam sobre esse estado (`list --status open` e
   qualquer contagem por `status == open` deixam de ver o item), e um item com dívida em aberto
   sairia do denominador sem ter sido pago — que é fechar por reclassificação silenciosa. O
   `status` terminal é do `resolve`, no arquivamento ou na baixa explícita.

6. **Nunca reescreva um `detail` por cima.** `update --detail` recusa texto que não preserve o
   `detail` corrente, e aponta os dois caminhos: `note` para acrescentar, `--replace-detail` para
   substituir de propósito, com a perda anunciada em bytes. A medição que sustenta um item é o que
   permite decidir sobre ele meses depois; seis blocos já foram perdidos assim neste repositório.

7. **Item envelhece; reverifique antes de agir.** Um item é uma afirmação sobre o código numa data. Antes de agir sobre um item ou sugeri-lo como próximo trabalho, confira se ele está envelhecido (`ledger-ops.sh stale`, a marca `· sem reverificação há <idade>d` do `list`, ou `show <LDG-NNNN>`) e reverifique com `ledger-ops.sh verify <LDG-NNNN> --kind file|commit|test|command --ref ... --observed ... --verdict confirmed|changed` — a única porta que grava `last_verified`, sempre com evidência conferível. Se o item mudou de natureza, não o reescreva: registre o sucessor com `ledger-ops.sh add ... --supersedes <LDG-NNNN>`, que encerra o anterior como `superseded` com elo bidirecional. O sinal de idade é advisory; travar em CI é opt-in (`stale --strict`).

## Fronteira com outros mecanismos (não confundir)

- **Deferral** (`/forge:defer`) — pendência **escopada ao change atual**, **bloqueante** (trava o
  close), **efêmera**. Use quando a pendência é daquele change. Se for descoberta transversal que
  não deve travar, é ledger, não deferral. No close/archive, deferrals `open`/`wont-fix` são
  **colhidos automaticamente** para o ledger (nada se perde).
- **Backlog** (`/forge:backlog`) — derivado de specs **já aprovadas**, gate humano, execução. O
  ledger é upstream disso: captura o que ainda **não** virou spec.
- **ADR** — decisão arquitetural aceita. Uma entrada de ledger pode **originar** um ADR, mas o
  ledger em si não é registro de decisão.

## Não-bloqueante por design

Registrar no ledger **nunca** trava um change, um gate ou um archive. O objetivo é garantia de
memória ("nada se perde"), não enforcement. Bloqueio é papel de deferral/`analyze` (findings
BLOCKER), não do ledger.
