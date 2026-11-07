# Tasks — session-activity-monitor

> Plano condicionado, nenhuma implementação iniciada ou task concluída. `[!]` = bloqueada nesta fase: gates e Red comportamental ainda não observados. Não interpretar rascunho como tasks-ready. Toda DD citada pertence ao design de session-activity-monitor. Paths existentes foram conferidos localmente/por git ls-tree; novos marcados **propostos**, não entregues. Não foi feito fetch, portanto frescor remoto permanece pendente.

## Contrato de execução e evidência
- TASK-01 é documental: não requer Red de código; DoD é resposta humana real/versionamento autorizado, não simulação. Não executá-la autonomamente.
- As demais tasks funcionais seguem TDD: criar o teste no caminho proposto, executar via runner do package na base ainda sem mudança funcional e **copiar a asserção real** como Padrão de falha; só depois implementar. Nenhum teste novo existe nesta fase; file-not-found/build-error não é Red comportamental. Não foram escritos regex supostos nem falsas saídas vermelhas/verdes. Esta pendência impede aprovação do plano de execução completo pelas regras de tasks.md.
- Antes da task de código: revalidar branch/HEAD/origin e obter worktree autorizado, coordenar arquivos gerados/migration com outros changes, cargar AGENTS do package. Não criar branch na raiz suja; não alterar peers.
- Comandos abaixo usam cwd indicado; `cd` faz parte do comando quando precisa. Testes nunca da raiz. Core usa `bun run script/test.ts`; TUI `bun test --timeout 30000`; Client `--timeout 5000`. Fonte: package.json e skills. Testes propostos são comandos futuros executáveis **após criação do alvo**, não evidência de execução atual.
- Padrão de falha de toda task funcional: **pendente de captura comportamental real na base**, sem waiver concedido. Cada teste usa mensagem de asserção própria e controle negativo na matriz abaixo; validar regex no motor Red antes do gate. Não fazer record/replay enquanto não houver caso comportamental observado. Feature não é renomeada bugfix para inventar slots de Red.

## Wave 1 — Decisões e fronteira aprovada
- [!] TASK-01 — Resolver identidade/normas e fechar pré-condições documentais (rastreia: REQ-01, REQ-15, design §1 e §2.2; paths: `.forge/specs/active/session-activity-monitor/`; depende: —)
  - Somente documental: Q01/Q02, ratificação de requirements, validator independente e gates verdadeiros. Não alterar ADR/baseline fora desta pasta; humano/pai coordena eventual ADR separadamente.
  - Teste (comando): `bash .forge/scripts/validate-spec.sh session-activity-monitor` (cwd raiz); positivo após decisões reais/sem marcadores materiais; controle negativo em memória deve detectar Q01 ainda aberta.
  - DoD: validação documental + registros reais e autorização de ambiente; Red de código não aplicável por ser decisão humana/documentação. Saída atual do check, não garantia de pré-condição, em evidence.md.
  - Canal: humano/sessão-pai, não CI automático. Não declarar [X] por aprovação técnica.

## Wave 2 — Proveniência de identidade
- [!] TASK-02 — Expandir origem factual do título e compatibilidade (rastreia: REQ-01, REQ-15, design §2.2 e §4; paths: `packages/schema/src/session.ts`, `packages/schema/src/session-event.ts`, `packages/core/src/session/session.ts`, `packages/core/src/session/title.ts`, `packages/core/src/session/projector.ts`, `packages/core/src/session/info.ts`, `packages/core/src/session/sql.ts`, `packages/core/src/plugin/host.ts`, `packages/core/src/plugin/goal.ts`, `packages/core/src/tool/plugin/opencode.ts`, `packages/core/src/database/migration/`, `packages/core/src/database/migration.gen.ts`, `packages/core/test/session-title.test.ts`, `packages/core/test/session-projector.test.ts`, `packages/schema/test/session-activity.test.ts`; depende: TASK-01)
  - Novo teste schema **proposto**; migration sem nome/ordinal reservado ainda. Criar/origem explícita/gerada/unknown, fork/import e corrida generator/manual; inventariar todos escritores/leitores da fonte antes do corte. Incluir Goal/CLI derivado versus ferramenta de atribuição; update genérico sem origem não prova manual. App/CLI consumidores existentes devem funcionar sem alterar sua UI; qualquer alteração pública plugin detectada no inventário reabre contrato/paths e gate antes de código.
  - Engine existente SQLite, expansão nullable, sem rewrite/backfill inferencial, rollback funcional flag off; provar antiga aplicação ignora novos dados. Lock/custo de migration devem ser medidos no DB real descartável; repetir mecanismo oficial não pode duplicar efeito.
  - Teste (comando): `cd packages/core && bun run script/test.ts test/session-title.test.ts test/session-projector.test.ts`; contrato adicional `cd packages/schema && bun test test/session-activity.test.ts` após alvo proposto.
  - Padrão de falha: pendente de captura real. DoD: T01/T02/T03/T27, CA-01.1..3, CA-15.1..2; gatilho negativo título igual não prova origem.
  - Canal: `.github/workflows/check-test.yml` unit por tasks Turbo dos packages; não declarar migration segura sem integração real.

## Wave 3 — Uso/contexto com presença
- [!] TASK-03 — Preservar presença/escopo de uso e observação de contexto (rastreia: REQ-05, REQ-06, REQ-07, REQ-08, REQ-15, design §2.3 e §2.4; paths: `packages/core/src/session/usage.ts`, `packages/core/src/session/runner/step.ts`, `packages/core/src/session/title.ts`, `packages/core/src/session/compaction.ts`, `packages/core/src/session/projector.ts`, `packages/core/src/session/info.ts`, `packages/core/src/session/sql.ts`, `packages/schema/src/session.ts`, `packages/schema/src/session-event.ts`, `packages/schema/src/session-message.ts`, `packages/core/src/database/migration/`, `packages/core/src/database/migration.gen.ts`, `packages/core/test/session-usage.test.ts`, `packages/core/test/session-projector.test.ts`; depende: TASK-02)
  - Inventariar mappers existentes e fronteira `AI.Usage` (sem alterar AI runtime indiscriminadamente): single vs multi-iteration/contextTokens, inclusivo/exclusivo, missing/breakdown. Providers não provados ficam indisponíveis; não fixar tabela variante→effort presumida.
  - Preservar contratos legados/contabilidade e acrescentar fatos mínimos experimentais antes de safe(). Projeção inclui known/partial/unknown persistente; replay/restart não apaga legado desconhecido; não duplicar compaction.
  - Teste (comando): `cd packages/core && bun run script/test.ts test/session-usage.test.ts test/session-projector.test.ts test/session-compaction.test.ts`; fonte AI replay sem chaves: `cd packages/ai && bun test --timeout 30000 test/schema.test.ts`.
  - Padrão de falha: pendente de captura real. DoD T04..T10/T27; mutantes I+O+cache/reasoning falham numericamente; ausência≠0. Migration cobre mesmos requisitos operacionais da TASK-02; número só após reserva coordenada.
  - Canal: unit Core/AI/Schema do workflow check-test; integração SQLite no Core, nunca mock da projeção.

## Wave 4 — Contrato público e geração
- [!] TASK-04 — Conectar schema/projeção/Protocol/Server/gerador (rastreia: REQ-01, REQ-06, REQ-07, REQ-08, REQ-13, REQ-15, REQ-16, design §4; paths: `packages/protocol/src/groups/session.ts`, `packages/server/src/handlers/session.ts`, `packages/schema/src/session.ts`, `packages/schema/src/session-event.ts`, `packages/protocol/test/session-activity.test.ts`, `packages/server/test/session-activity.test.ts`, `packages/client/src/promise/generated/`, `packages/client/src/effect/generated/`, `packages/client/src/effect/api/api.ts`; depende: TASK-03)
  - Testes novos **propostos**; campos experimentais opcionais nas rotas existentes, fonte/origem não controlada pelo cliente, auth e public wire sem metadados sensíveis. Nenhum endpoint/broker novo. Conferir watermark de leitura/evento ou protocolo dirty/refetch testável.
  - Teste (comando): `cd packages/protocol && bun test test/session-activity.test.ts test/experimental-identifiers.test.ts`; `cd packages/server && bun test test/session-activity.test.ts`; geração `cd packages/client && bun run generate`.
  - Padrão de falha: pendente de captura real. DoD T22/T23/T27, contrato opcional/omissão/old-server e new-server+old-client; evidência observabilidade boundary ou pendência explícita segundo Q02. Não editar gerados à mão.
  - Canal: unit protocol/server/client no check-test; checar gerador nos scripts existentes e schema real, não comparar e sobrescrever intencionalmente versionado sem inspeção.

## Wave 5 — Reconciliação e relações
- [!] TASK-05 — Reconciliar atividade/usage com geração e frescor (rastreia: REQ-08, REQ-13, design §2.7; paths: `packages/client/src/solid/data.ts`, `packages/client/src/solid/connection.ts`, `packages/client/test/solid-data.test.ts`, `packages/client/test/session-activity.test.ts`; depende: TASK-04)
  - Novo teste **proposto**; preservar conexão única, overlay por chave para snapshot/terminal/usage absoluto, invalidar em gap/desconexão/overflow, refresh com geração. Não trocar todo sync do Client nem adicionar timer por entidade.
  - Teste (comando): `cd packages/client && bun test --timeout 5000 test/solid-data.test.ts test/session-activity.test.ts`.
  - Padrão de falha: pendente de captura real. DoD T11/T12/T13/T14/T24, inclusive snapshot atrasado, evento duplicado, falha parcial de fontes. Eventos/reads liberados por Deferred, sem sleeps nem aumentar frames para esperar rede.
  - Canal: unit client no check-test.
## Wave 6 — Inventários correlacionados
- [!] TASK-06 — Correlacionar filhos diretos e shells por origem (rastreia: REQ-10, REQ-11, REQ-12, REQ-16, design §2.6; paths: `packages/client/src/solid/data.ts`, `packages/client/test/solid-data.test.ts`, `packages/client/test/session-activity.test.ts`; depende: TASK-05)
  - Páginas parentID/completeness e inventário shell/origem, sem família global ou PID descendants. Sanitização do resumo será consumida por monitor; location anterior após move só com associação provada.
  - Teste (comando): `cd packages/client && bun test --timeout 5000 test/solid-data.test.ts test/session-activity.test.ts`.
  - Padrão de falha: pendente de captura real. DoD T15/T16/T17/T18/T24. Controle negativo irmão, sessão errada/location errada/parent ausente/ID duplicado.
  - Canal: unit client. **Serializar TASK-05 e TASK-06** apesar da wave por paths compartilhados; não executar em paralelo.

## Wave 7 — Modelo de apresentação comum
- [!] TASK-07 — Derivar estado/identidade/modelo/tempo/contexto/uso (rastreia: REQ-01, REQ-04, REQ-05, REQ-06, REQ-07, REQ-08, REQ-09, REQ-12, design §2.1..2.7; paths: `packages/tui/src/util/session-activity.ts`, `packages/tui/src/util/session.ts`, `packages/tui/test/util/session-activity.test.ts`, `packages/client/src/solid/usage.ts`, `packages/client/test/solid-usage.test.ts`; depende: TASK-05, TASK-06)
  - Módulo/teste session-activity **propostos**. Fallback indisponível, precedência step versus seleção, tipo conhecido/unknown, contexto com epoch, tempo terminal e ticker injetável, contagens sem inventar cobertura.
  - Teste (comando): `cd packages/tui && bun test --timeout 30000 test/util/session-activity.test.ts test/util/session.test.ts`; `cd packages/client && bun test --timeout 5000 test/solid-usage.test.ts`.
  - Padrão de falha: pendente de captura real. DoD T04..T10/T15/T19/T25/T26; PBT seed fixa/shrinking para idempotência/dedup e não-negatividade/porcentagens, verificando gerador.
  - Canal: unit tui/client. Não alterar helper público usado pelo App sem teste compartilhado; preferir adaptação exclusiva no novo monitor.

## Wave 8 — Ativação experimental
- [!] TASK-08 — Registrar experimento e gate compartilhado (rastreia: REQ-02, REQ-15, design §1, §2.1 e §5; paths: `packages/tui/src/component/dialog-experiments.tsx`, `packages/tui/src/config/index.tsx`, `packages/tui/test/session-activity-monitor.test.tsx`; depende: TASK-07)
  - Teste **proposto**. Registry/consumo config TUI boolean, false por ausência, persistência por mecanismo existente. Nenhuma edição em config servidor só por nome semelhante.
  - Teste (comando): `cd packages/tui && bun test --timeout 30000 test/session-activity-monitor.test.tsx`.
  - Padrão de falha: pendente de captura real. DoD T20/T21; incluir experimentos preexistentes em on/off e cleanup.
  - Canal: unit tui.

## Wave 9 — Painel de produção
- [!] TASK-09 — MAIN AGENT e identidade experimental na lateral (rastreia: REQ-01, REQ-03, REQ-04, REQ-05, REQ-06, REQ-07, REQ-08, REQ-09, REQ-14, design §2.1 e §2.8; paths: `packages/tui/src/routes/session/sidebar.tsx`, `packages/tui/src/feature-plugins/sidebar/context.tsx`, `packages/tui/src/feature-plugins/sidebar/activity.tsx`, `packages/tui/test/session-activity-monitor.test.tsx`; depende: TASK-08)
  - activity.tsx **proposto**. Produção reutilizada na story, sem cópia visual. Preservar Context flag off, custo família explicitado, MCP/todo/limits/footer e slots externos.
  - Teste (comando): `cd packages/tui && bun test --timeout 30000 test/session-activity-monitor.test.tsx test/session-panel.test.tsx`.
  - Padrão de falha: pendente de captura real. DoD T01/T03/T19/T20/T21/T25/T26; loading/vazio/erro/state/sem fonte e identidade completa acessível.
  - Canal: unit tui.

## Wave 10 — Entidades e saída segura
- [!] TASK-10 — Listas e navegação sem controle de execução (rastreia: REQ-10, REQ-11, REQ-14, REQ-16, design §2.6 e §2.8; paths: `packages/tui/src/feature-plugins/sidebar/activity.tsx`, `packages/tui/src/routes/session/composer/subagents-tab.tsx`, `packages/tui/src/routes/session/composer/shell-tab.tsx`, `packages/tui/src/component/dialog-shell-output.tsx`, `packages/tui/test/session-activity-monitor.test.tsx`, `packages/tui/test/component/dialog-shell-output.test.tsx`; depende: TASK-09)
  - Não mudar alcance das abas antigas sem rótulo/decisão; ações de monitor têm alvo ID/location estável, Enter/mouse/Escape, nenhum remove/interrupt. Viewer existente pode precisar só testes, não mudança funcional.
  - Teste (comando): `cd packages/tui && bun test --timeout 30000 test/session-activity-monitor.test.tsx test/component/dialog-shell-output.test.tsx test/session-group-navigation.test.tsx`.
  - Padrão de falha: pendente de captura real. DoD T15..T18/T23/T24, sanitize antes de truncar e não carregar output até clicar; erro not-found recuperável.
  - Canal: unit tui; shell real e retenção continuam tests Core/Server existentes.

## Wave 11 — Resumo junto ao prompt
- [!] TASK-11 — Contagens comuns em linha compacta (rastreia: REQ-02, REQ-03, REQ-12, REQ-13, REQ-14, design §2.1 e §2.8; paths: `packages/tui/src/routes/session/composer/index.tsx`, `packages/tui/src/component/prompt/index.tsx`, `packages/tui/src/routes/session/index.tsx`, `packages/tui/test/session-activity-monitor.test.tsx`; depende: TASK-10)
  - Montar UMA das superfícies propostas em design §2.1 conforme geometria; preservar prompt/queued dock/forms/permissions. Contadores não mudam altura, sem token agregado da família, stale/partial explícitos, acesso às mesmas listas com sidebar oculta.
  - Teste (comando): `cd packages/tui && bun test --timeout 30000 test/session-activity-monitor.test.tsx test/session-submit-scroll.test.tsx test/session-wheel-focus.test.tsx`.
  - Padrão de falha: pendente de captura real. DoD T12/T20/T24/T25; 9→10→100 sem reflow e sem fetch duplicado por segunda superfície.
  - Canal: unit tui.

## Wave 12 — Limites e experiência real
- [!] TASK-12 — Cobrir limites/RTL/teclado/tema e vazamentos (rastreia: REQ-13, REQ-14, REQ-16, NFR-01, NFR-02, NFR-03, NFR-06; paths: `packages/tui/test/session-activity-monitor.test.tsx`, `packages/tui/test/session-mount-budget.test.tsx`, `packages/tui/src/feature-plugins/sidebar/activity.tsx`; depende: TASK-11)
  - Teste (comando): `cd packages/tui && bun test --timeout 30000 test/session-activity-monitor.test.tsx test/session-mount-budget.test.tsx --rerun-each 10`.
  - Padrão de falha: pendente de captura real. DoD T24/T25/T26/T28; ManualClock, renderer não iniciado para lógica; whole app apenas fiação; mockInput kittyKeyboard; await sinal antes de frame, cleanup com await using. Nenhum sleep/timer por item.
  - Canal: unit tui Linux/Windows; verificar agendamento real Turbo do package em CI. Medir montagens/requests/listeners, não tempo de máquina.
- [!] TASK-13 — Story do componente real e ensaio narrow/wide (rastreia: REQ-02, REQ-03, REQ-14, NFR-05, design §2.8; paths: `packages/tui/src/feature-plugins/system/storybook/session-activity.tsx`, `packages/tui/src/feature-plugins/system/storybook/index.tsx`, `packages/tui/test/session-activity-monitor.test.tsx`; depende: TASK-12)
  - Story session-activity **proposta**. Fixtures de estado/fonte/qualidade/modelo/itens, atalhos documentados no StoryFooter, reset, sem prompt/shell real. Reusar produção, não mock visual.
  - Teste (comando): `OPENCODE_STORY=session-activity bun run dev:live` no worktree autorizado; exercício manual em 44×12/140×40 + resize; automatizado `cd packages/tui && bun test --timeout 30000 test/session-activity-monitor.test.tsx`.
  - DoD T20/T25/T26: registrar frames/interações reais; story sem par Red/Green é artefato exploratório, não evidência de sucesso funcional. Não executar agora nem anexar à sessão viva do usuário sem autorização operacional.
  - Canal: story manual + integração unit tui; não há job automático que prove sozinho a story interativa.

## Wave 13 — Contrato final e documentação
- [!] TASK-14 — Ensaiar migração/contratos e regressão integrada (rastreia: REQ-01, REQ-06, REQ-07, REQ-08, REQ-09, REQ-13, REQ-15, REQ-16, NFR-04, NFR-05; paths: `packages/core/test/session-projector.test.ts`, `packages/protocol/test/session-activity.test.ts`, `packages/server/test/session-activity.test.ts`, `packages/client/test/session-activity.test.ts`, `packages/tui/test/session-activity-monitor.test.tsx`; depende: TASK-13)
  - Teste (comando): `bun run check` (raiz, verificação estática, não suite de testes); suites focadas TASK-02..12 de seus packages, mais `cd packages/core && bun run script/test.ts test/session-execution.test.ts test/session-revert.test.ts test/session-shell.test.ts test/tool-subagent.test.ts`.
  - DoD T01..T28, gates de observabilidade/contrato resolvidos conforme Q02, dados legados reais em DB descartável e compatibilidade antiga/nova. Controle negativo quebrar uma fonte de uso/ownership e exigir falha específica, não build error. Testar corte de snapshot pelo contrato real, não fixture arbitrária.
  - Canal: check-test unit + check canônico. Só declarar aprovação técnica com saída real. Nenhuma autorização de merge/deploy.
- [!] TASK-15 — Documentar semânticas/limitações e preparar verify (rastreia: REQ-01, REQ-02, REQ-06, REQ-07, REQ-08, REQ-09, REQ-10, REQ-11, REQ-12, REQ-15, design §5; paths: `specs/v2/session-activity-monitor.md`, `.forge/specs/active/session-activity-monitor/`; depende: TASK-14)
  - Spec de produto **proposta**; não escrever product/current. Explicar opt-in, UID/legado, fonte/precisão do contexto, diferença tokens/custo, presença parcial, tempo, filhos diretos e shell scope, reconexão. Preencher evidência real no verify, não nesta análise.
  - Teste (comando): `bash .forge/scripts/validate-spec.sh session-activity-monitor` (raiz) e revisão dos exemplos contra comandos/contratos reais.
  - DoD documental, sem par Red/Green; validação deve recusar cenário/ID órfão. Canal: verify humano + harness. Sharding/analyze/impacto são pré-condições do início do código, não tarefas adiadas até aqui.

## Matriz de critérios e testes planejados
> São casos planejados, **não executados**. Mensagens de falha/registros Red só após teste existir; controles negativos listam mutação plausível que deve falhar. Cada conjunto CA é explicitamente coberto.

| Caso | Critérios | Positivo / limites | Controle negativo / mutante | Tasks |
|---|---|---|---|---|
| T01 | CA-01.1..3 | default/gerado/manual/legado, títulos iguais e UID completo | classificar gerado como manual por texto | TASK-02, TASK-09 |
| T02 | CA-01.2..3 | /rename nome/vazio, diálogo/lista/App/API/tool/create, Goal/CLI derivado, erro/cancelar | marcar update genérico/geração como manual ou overwrite manual concorrente | TASK-02, TASK-04 |
| T03 | CA-01.3, CA-15.1..2 | legacy replay/import/fork/move, títulos preservados | backfill regex/title mudou | TASK-02, TASK-14 |
| T04 | CA-07.1..3 | fresh80+read15+write5; visible24+reason6 → 100/30/130 | I inclusivo100 + cache20 =120, total150; O inclusivo30+reason6=36 total136; ambos156 | TASK-03, TASK-07 |
| T05 | CA-08.1..3 | usage undefined/parcial/zero explícito/invalid/inclusivo sem breakdown | safe(undefined)=0 confirmado ou getter visível0 como presença | TASK-03, TASK-07 |
| T06 | CA-07.2..3 | title+steps+compaction uma vez, fork/revert/restart | somar espelho Compaction.Ended, UsageUpdated como delta | TASK-03, TASK-05 |
| T07 | CA-06.1..2 | contextTokens final versus input acumulado multi-iteração; C nominal | somar todas iterações como janela | TASK-03, TASK-07 |
| T08 | CA-06.2, NFR-04 | 12345/200000=6,1725%→6,2/93,8; 210000=105/0; C0/undefined | dividir por zero, esconder overflow ou arredondar antes somar | TASK-07 |
| T09 | CA-06.1, CA-06.3 | compaction/revert/model swap/instructions/epoch e ausência de novo step | contexto antigo confirmado com capacidade nova ou compactor como main | TASK-03, TASK-07 |
| T10 | CA-04.1..2, CA-05.1..2 | running supera old outcome; idle sem outcome unknown; efetivo/selecionado | idle=succeeded, fallback build, variant high=effort | TASK-07, TASK-09 |
| T11 | CA-13.1..2 | snapshot/evento terminal em ordens alternadas | snapshot antigo ressuscita ativo ou sobrescreve usage | TASK-05 |
| T12 | CA-12.1, CA-13.1..2 | reconnect duplicado, gaps e loading parcial em painel/resumo | stale tratado fresco ou contagem duplica | TASK-05, TASK-11 |
| T13 | CA-13.1..2 | A→B, mesma location e locations diferentes, replies atrasadas | reply A escreve tela B | TASK-05 |
| T14 | CA-08.1, CA-13.2 | servidor antigo/campo ausente, fonte falha e resync | undefined gera zero e remove aviso stale | TASK-04, TASK-05 |
| T15 | CA-10.1..2, CA-12.1 | root/filha/neto/irmão/órfão, 251 filhos/páginas | usar família raiz, contar principal, paginação incompleta como total | TASK-06, TASK-07, TASK-10 |
| T16 | CA-11.1..3 | múltiplas sessões/shells, move, origem anterior comprovada | metadata outra sessão ou location trocada | TASK-06, TASK-10 |
| T17 | CA-11.1, CA-16.1, NFR-06 | comando composto/env/URL/token/ANSI, título malicioso | primeira linha/truncar antes remover argumentos | TASK-06, TASK-10 |
| T18 | CA-11.2..3 | diálogo preso ID/location, shell exit/deleted/output unavailable | seleção muda alvo, auto-fetch output ou remove/kill | TASK-10 |
| T19 | CA-09.1..2 | busy1000,idle6500→5s; ativoagora4300→3s; resume/shutdown/skew | tempo desde created ou idle anterior<busy | TASK-07, TASK-09 |
| T20 | CA-02.1..2, CA-03.1, CA-12.2 | flag off/on/persist/reload e outros experimentos | off ainda assina/ticka, remove registry | TASK-08, TASK-09, TASK-11 |
| T21 | CA-03.1..2 | MCP/todo/limits/footer/custo e plugin externo intactos | duplicar Context, perder slot/custo | TASK-08, TASK-09 |
| T22 | CA-15.1..2 | wire antigo/novo, opcionais omitidos, experimental gerado | campo obrigatório, quebra manifest ou gera manualmente | TASK-04, TASK-14 |
| T23 | CA-11.2, CA-16.2 | ID/localização permitido e negado, sem permissão | output de outra origem, controle de execução no monitor | TASK-04, TASK-10, TASK-14 |
| T24 | CA-10.2, CA-13.2, NFR-01 | troca/cleanup100x, zero listeners extras ao desmontar | timer por linha/subscription vazando | TASK-05, TASK-06, TASK-10, TASK-12 |
| T25 | CA-12.2, CA-14.1..2, NFR-02..03 | 44×12/80×24/140×40, resize, hidden,0/1/1000,9→10→100 | >50 montagens expansões ou reflow editor | TASK-11, TASK-12, TASK-13 |
| T26 | CA-14.2..3 | mouse/Enter/Escape, claro/escuro/custom, RTL/misto/Unicode | cor única para status, hue cru, ID invertido/foco perdido | TASK-07, TASK-12, TASK-13 |
| T27 | CA-07.2, CA-08.2, CA-15.1..2 | migration DB real antiga/replay/restart/coberturaunknown persistida | novo step apaga legado unknown, migração reescreve title/totals | TASK-02, TASK-03, TASK-14 |
| T28 | NFR-04..06, CA-16.1..2 | fixture integrada eventos+snapshot→Client→produção TUI | stub lógico paralelo passa enquanto produção falha | TASK-12, TASK-14 |

## Rastreabilidade
| REQ / Design § | Tasks |
|---|---|
| REQ-01 / §2.2 | TASK-01, TASK-02, TASK-04, TASK-07, TASK-09, TASK-15 |
| REQ-02 / §2.1 | TASK-08, TASK-11, TASK-13, TASK-15 |
| REQ-03 / §2.1 | TASK-09, TASK-11, TASK-13 |
| REQ-04 / §2.5 | TASK-07, TASK-09 |
| REQ-05 / §2.5 | TASK-03, TASK-07, TASK-09 |
| REQ-06 / §2.4 | TASK-03, TASK-04, TASK-07, TASK-09, TASK-14, TASK-15 |
| REQ-07 / §2.3 | TASK-03, TASK-04, TASK-07, TASK-09, TASK-14, TASK-15 |
| REQ-08 / §2.3 | TASK-03, TASK-04, TASK-05, TASK-07, TASK-09, TASK-14, TASK-15 |
| REQ-09 / §2.5 | TASK-07, TASK-09, TASK-14, TASK-15 |
| REQ-10 / §2.6 | TASK-06, TASK-10, TASK-15 |
| REQ-11 / §2.6 | TASK-06, TASK-10, TASK-15 |
| REQ-12 / §2.8 | TASK-06, TASK-07, TASK-11, TASK-15 |
| REQ-13 / §2.7 | TASK-04, TASK-05, TASK-11, TASK-12, TASK-14 |
| REQ-14 / §2.8 | TASK-09, TASK-10, TASK-11, TASK-12, TASK-13 |
| REQ-15 / §4..5 | TASK-01, TASK-02, TASK-03, TASK-04, TASK-08, TASK-14, TASK-15 |
| REQ-16 / §2.6 | TASK-04, TASK-06, TASK-10, TASK-12, TASK-14 |
| NFR-01..06 | TASK-07, TASK-11, TASK-12, TASK-13, TASK-14 |
