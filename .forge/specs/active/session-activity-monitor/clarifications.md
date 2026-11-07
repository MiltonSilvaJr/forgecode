# Clarificações — session-activity-monitor

> Registro de pendências de elicitação, não de respostas. Nenhum gate decidido, nenhuma chamada approval-log. AskUserQuestion e ferramenta de spawn independente não estão disponíveis nesta sessão; encaminhar à sessão-pai. Não fabricar Approve/Block nem autonomous/human.

## Q01 — NEEDS CLARIFICATION: identidade e geração
Pergunta prioritária a apresentar **sozinha**: qual política de apresentação aplicar aos títulos legados de origem desconhecida e à regeneração explicitamente solicitada após nome atribuído?

Proposta para escolha: A) desconhecido/gerado mostra UID no monitor e título anterior em detalhe; nome atribuído explícito mostra nome, e regenerar produz gerado/UID; B) legado preserva título na apresentação com rótulo origem desconhecida e UID acessível, novos gerados mostram UID; C) revisão humana/migração assistida antes de ocultar qualquer título legado. Nenhuma opção escolhida. Pedir depois confirmação se nome explicitamente criado por API/ferramenta conta como atribuição explícita, sem rotular autoria humana.

Evidência: Renamed só title (`packages/schema/src/session-event.ts:92-100`); Core rename e generator publicam o mesmo fato (`session/session.ts:71-74`, `title.ts:143-151`); TUI `/rename` vazio chama geração (`routes/session/index.tsx:1053-1066`). Não é possível deduzir autoria manual retrospectivamente pelo título. CA-01.3 e DD-02 não fecham até resposta real.

Refinamento factual da mesma pergunta, sem escolha inferida: o plugin Goal deriva título de objetivo (`packages/core/src/plugin/goal.ts:403-410`) via mesmo host.update que atende session_rename. CLI pode derivar título de texto (`packages/cli/src/run/run.ts:144-151`). Decidir o que conta como atribuição explícita, não presumir que todos esses updates sejam manuais.

## Q02 — NEEDS CLARIFICATION: normas versus arquitetura brownfield
Após Q01, conduzir uma decisão por vez, com opções aplicar norma de maior autoridade / abrir ou atualizar ADR ou override formal / bloquear. **Não** considerar este texto uma exceção.

CONFLITO
- decisão: enquadrar extensão de contratos/projeções existentes e TUI sem migração de stack.
- posição A: rules locais genéricas exigem API versionada `/api/v1`, contratos externos próprios, React/design-system/CSS e proíbem UID cru; matriz de dados orienta Postgres/Mongo, integração interna orienta gRPC/broker/AsyncAPI e exceção por ADR; observabilidade obriga três pilares.
- posição B: PRD exige UID completo e OpenTUI existente; AGENTS/Schema orientam contratos atuais `/api`, clientes gerados, eventos mínimos e extensão experimental; código Session usa SQLite/projeções e SSE sem broker. Novo serviço e alteração de stack estão fora de escopo.
- fontes: `.forge/rules/{frontend/design-system,architecture/api-and-contracts,architecture/internal-grpc-communication,architecture/observability,data/data-governance}.md`; `AGENTS.md:71-74,89-101,242-250,269-278`; `packages/schema/AGENTS.md`; `packages/core/src/session/sql.ts`; `specs/v2/event-stream-architecture.md`.
- precedência: constitution > baseline/ADRs aceitos > rules > contexto. Código brownfield prova comportamento, não concede dispensa normativa. ADR local da fila não resolve esta questão.
- opções: escopo e precedência aplicáveis explicitados por humano/ADR; não reescrever harness, produto/current ou outras specs nesta execução. Persistência nova fica condicionada, sem DDL nem task executável autorizada na parte conflitante.
- registro: resposta real vai a approvals.yaml pelo fluxo competente; nenhuma registrada aqui.

Também ratificar política de custo prévio (USD fracionário, não billing novo) sem alterar precisão para centavos por uma rule genérica: UI atual já usa Money.USD. Não introduzir arredondamento contábil ou corrigir storage de dinheiro neste change.

## Decisões propostas para gates, não perguntas bloqueantes inventadas
- Scale 3 justificado pela régua real; nenhuma exigência inventada de stack/owner ou FRD em scale 3.
- Filhos diretos, shells só sessão atual/origem comprovada, effort indisponível salvo prova, resumo junto e sem total de família são escolhas técnicas permitidas pelo resumo PRD; humanos podem revisar nos gates.
- Porcentagens a uma casa, estado/tempo e budgets estão especificados/testáveis; precisam ratificação, não remoção artificial de marcadores para passar validate-spec.

## Gates e ordem verdadeira
Status permanece proposed. requirements_reviewed/design_reviewed/tasks_reviewed/implementation_verified/human_archive_approval=false; approvals=[]; nenhuma decisão automática. Design/tasks são rascunhos condicionais antecipados. Pré-condições formais de design/tasks/analyze não foram cumpridas. Não executar spec-transition, approval-log, shard, implement, archive nesta sessão. Review independente/até três iterações só pode ocorrer quando houver ferramenta e histórico versionado autorizado; autoinspeção não equivale a validator externo.
