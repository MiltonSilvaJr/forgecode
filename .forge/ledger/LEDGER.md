# LEDGER — roadmap & dívida técnica do projeto

> Arquivo mestre durável do que **não pode se perder**: roadmap planejado, dívida técnica, bugs
> conhecidos, follow-ups e ideias de feature. Sobrevive entre changes. **Gerado** deterministicamente
> de `.forge/ledger/ledger.json` por `/forge:ledger render` — **não edite as seções à mão** (edições
> vivem no `ledger.json` via `/forge:ledger`); só o bloco "Notas" abaixo é preservado entre gerações.
>
> Fontes: captura automática (harvest de deferrals/findings no close/archive) + curadoria manual
> (`/forge:ledger add`). Consultado por `/forge:resume` e ao sugerir o próximo trabalho
> (`rules/conventions/ledger-consultation.md`). **Não-bloqueante**: registrar aqui nunca trava um change.

**6 itens ativos** · follow-up 6

## Roadmap

_(nenhum)_

## Ideias de feature

_(nenhum)_

## Dívida técnica

_(nenhum)_

## Bugs conhecidos

_(nenhum)_

## Follow-ups

- **LDG-0001** [open] (P1/BLOCKER) — Revisão OpenKanban ignora o change squad-orchestration já implementado · via `squad-orchestration`#openkanban-adversarial-review:CRIT-01
  A revisão adversarial de OpenKanban (2026-11-06) trata a feature de squad como inexistente/hipotética e propõe 21 semanas para construí-la. O change .forge/specs/active/squad-orchestration/ existe com 25 REQ e 40 tasks; feature/squad-orchestration está 205 commits à frente de origin/dev e não merged (merge-base --is-ancestor exit 1). O branch já tem packages/core/src/squad/panel.ts e as rotas panel/liveness/dispatch accept. Correção: reescrever a revisão como delta sobre o change existente, não como greenfield.
- **LDG-0002** [open] (P2/HIGH) — Crítica: debate Ink vs Dioxus da revisão OpenKanban não tem objeto (repo usa OpenTUI/Solid) · via `squad-orchestration`#openkanban-adversarial-review:CRIT-02
  A revisão eleva 'Ink vs Dioxus' a risco HIGH e pede bake-off de performance. packages/tui/package.json:62-64 depende de @opentui/core, @opentui/keymap e @opentui/solid; não há ink, react nem dioxus no TUI. Dioxus é framework Rust/WASM e mudaria a linguagem do runtime. Correção: comparar as superfícies reais (plugin TUI OpenTUI/Solid, página web/desktop, apenas squad panel show), não Ink vs Dioxus.
- **LDG-0003** [open] (P2/HIGH) — Crítica: revisão OpenKanban superdimensiona risco AGPL com doutrina incorreta · via `squad-orchestration`#openkanban-adversarial-review:CRIT-03
  A revisão classifica 'learn + reimplement' como CRITICAL e afirma que reimplementação pode exigir atribuição e que 'conceptual copying' pode acionar a AGPL. Autoral protege expressão, não ideias/arquitetura; reimplementação independente não deve crédito. A revisão também nunca questiona a afirmação oposta do executive summary ('AGPL exigiria disclosure do source'), igualmente sem fonte. Correção: reclassificar como MEDIUM e estreitar a pergunta jurídica para 'a implementação resultante parece derivada?', com counsel antes de distribuir, não antes de ler.
- **LDG-0004** [open] (P2/HIGH) — Crítica: custos e cronogramas da revisão OpenKanban são fabricados e inconsistentes · via `squad-orchestration`#openkanban-adversarial-review:HIGH-01/HIGH-02
  A revisão publica 4 semanas (~$80k se 5 FTE @ $40k/semana), mas 4x5x40k = $800k (ou 4x40k = $160k para o time). O $280k de 14 semanas só fecha com $4k/FTE-semana, taxa sem fonte. O executive summary diz 5 FTE mas 2+1+1+0,5 = 4,5. O roadmap soma 22 FTE-semanas contra 63 disponíveis (4,5 FTE x 14 semanas). A revisão critica o 14 sem estimativa bottom-up e propõe 21 (4+1+6+2+4+4), além de introduzir 16 e 12 semanas sem derivação. Correção: publicar FTE x semanas x taxa com fonte, ou declarar 'não estimável'; estimativa bottom-up ou hipótese explícita.
- **LDG-0005** [open] (P2/HIGH) — Crítica: sprint de validação da revisão OpenKanban não tem amostra, instrumento, métrica nem parada · via `squad-orchestration`#openkanban-adversarial-review:CRIT-04
  A revisão pede 'entrevistar 10-15 usuários' e para se 'não houver dor significativa', mas não define recrutamento, instrumento, métrica primária, limiar nem responsável; e oscila entre 2 semanas (linha 44) e 4 semanas (linhas 498/564/609). Os passos somam ~4,4 semanas. Sem isso o gate não distingue GO de NO-GO. Correção: amostra (n, inclusão, recrutamento), roteiro, métrica (minutos de coordenação, erros/dia), limiar e critério de parada antecipada.
- **LDG-0006** [open] (P3/MEDIUM) — Crítica: revisão OpenKanban erra fatos do upstream e não vê contradição entre irmãos · via `squad-orchestration`#openkanban-adversarial-review:HIGH-03
  A revisão afirma 'no mouse support', mas ARCHITECTURE.md:95-96 trata tea.MouseMsg e CONFIGURATION.md documenta scroll com roda do mouse. Não percebe que evaluation.md:34 diz keybindings customizáveis enquanto docs/CONFIGURATION.md diz 'Custom keybindings coming soon' (technical-analysis.md:446 acerta). Não vê a seção 'OpenCode Integration' do upstream (servidor + opencode attach) nem labels/priority/temas/sidebar. Correção: corrigir 'no mouse', registrar a contradição de keybindings e reconhecer as features omitidas.

## Notas

<!-- FORGE:NARRATIVE:START -->
_(Espaço livre para contexto curado — priorização, sequenciamento, decisões abertas. Preservado
entre gerações do render; a captura automática nunca sobrescreve esta seção.)_
<!-- FORGE:NARRATIVE:END -->
