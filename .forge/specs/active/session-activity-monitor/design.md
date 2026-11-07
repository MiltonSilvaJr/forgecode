# Design — session-activity-monitor

> Rascunho técnico condicionado a Q01/Q02. Não aprovado para desenvolvimento. Todas as DD deste arquivo têm escopo `session-activity-monitor`; não são ADRs globais. `evidence.md` separa fatos e hipóteses. Nenhum código foi implementado.

## 1. Contexto e restrições
- Base concreta, divergência de origin/dev e árvore suja: evidence §1. Specs/governança locais não estão no commit medido. Fontes de código lidas são as de HEAD; não projetar mudanças da worktree squad sobre esta base.
- Schema é contrato browser-safe; Core possui runtime/projeções; Protocol expõe HttpApi; Server liga serviços; Client não importa Core/Server. Gerados vêm de `packages/client` (`AGENTS.md:71-74`, packages/schema/AGENTS.md).
- Experimento da TUI é chave do registro de `packages/tui/src/component/dialog-experiments.tsx`, consumida em `useConfig().data.experimental`, não flag servidor homônima. Framework permanente.
- Estado SessionExecution é process-global, SessionRunner/location-scoped; monitor é observador, não segundo scheduler/loop de ferramentas/claim de execução. Inbox/enqueue não é execução iniciada. Eventos duráveis mínimos, projeção derivada rica.
- Não há identidade manual nem qualidade do uso recuperáveis de title/tokens sozinhos. `AI.Usage.contextTokens` existe mas se perde em SessionUsage (evidence E03/E06/E08). Contexto não será rotulado "real atual confirmado" por causa de soma de tokens.
- **Normas levantadas por superfície:** constitution; AGENTS raiz/TUI/Schema/AI; `.forge/rules/conventions/{language-policy,conflict-handling,git-worktree,naming,code-style,no-summary-files}.md`; `.forge/rules/testing/{tdd,property-based-testing,change-test-contract,quality-gates}.md`; `.forge/rules/data/{data-governance,schema-evolution}.md`; `.forge/rules/architecture/{api-and-contracts,internal-grpc-communication,observability,security-and-secrets}.md`; `.forge/rules/frontend/design-system.md`. Convenções concretas TUI/Schema são compatíveis; UI derivada não exige React/DOM. Entretanto rule genérica sem filtro manda React/tokens CSS/nega UID, API `/api/v1` e eventos PastTense/AsyncAPI/broker, e escolha de store Mongo/Postgres divergem de contrato brownfield. Não declarar automaticamente que AGENTS vence constitution/rule: **Q02 bloqueia adoção da alternativa persistida** até decisão sobre aplicação/exceção/ADR. Não mudar esses arquivos nesta tarefa.
- ADR local 0001-session-queue-primitive é accepted no filesystem, não alcançável em origin/dev na busca executada; preserva fila e não autoriza monitor ou migrations. Nenhuma escrita em baseline. Manifests locais dos outros changes foram lidos para colisões; branch squad não contém `.forge` versionada em `git ls-tree`, logo suas aprovações não foram comprovadas por `git show`.
- Capability dispatcher: capabilities.active=[], nenhum pack carregado/ativado. Skills effect/tui-tests/unit-tests/rtl/data-relational/data-streaming informam plano, não sobrepõem regras.

## 2. Decisão técnica
<a id="21-dd-01"></a>
### 2.1 DD-01 — Uma projeção, duas superfícies
Propor módulo TUI puro `src/util/session-activity.ts` para selecionar os mesmos dados tipados para lateral e resumo. Dados de conexão/sync pertencem ao Client, não ao componente. Propor componente de produção `feature-plugins/sidebar/activity.tsx`, montado condicionalmente no plugin Context existente para não duplicar ordem/slots. Sidebar muda só sua identidade experimental; custo mantém método atual e explicita família na raiz; outros plugins não mudam. Resumo em slot `session.composer.top` (route `index.tsx:1597`) ou `prompt.footer.status` (`component/prompt/index.tsx:1901-1902`), escolher no ensaio geométrico sem duplicar render. Preferência: linha no composer.top com altura 1 previsível, fora do editor, acessível mesmo sidebar oculta. Não trocar a aba antiga de família por filhos silenciosamente: monitor possui seleção própria e navega à sessão; abas existentes preservadas.

Snapshot de leitura proposto: `{ sessionID, location, generation, title, main, children, shells, coverage, freshness }`. `main` referencia identidade/agente/modelo, execução, uso próprio e contexto. Cada medição tem `quality: confirmed|estimated|unavailable`, `completeness: complete|partial|unknown`, `freshness: fresh|stale|loading`, `observedAt?`, `source?`. Valor ausente não vira 0. Qualidade não é inventada pelo frontend a partir de um número legado.

<a id="22-dd-02"></a>
### 2.2 DD-02 — Proveniência do título
**Alternativa condicionada a Q01/Q02:** conservar `title` sem mudanças semânticas; acrescentar origem factual tipada no namespace experimental de Session.Info e dos fatos Created/Renamed. Origens propostas: `explicit`, `generated`, `unknown`; default/sem título é derivável sem forjar autoria. Não chamar explicit de human. Escritores a migrar: criação pública/SDK com title, rename Core/API, generator SessionTitle, import/fork, event replay, ferramenta `session_rename`, interfaces App/TUI. Fronteira que conhece a ação define origem, nunca confiar em input cliente para atestar humano.

Guardar projeção nullable de origem para leitura/restart; eventos antigos sem origem projetam unknown. Não classificar histórico por regex, evento Renamed ou metadados do próprio título. Fork deriva título atual com sufixo, mas sua origem não é nome explicitamente atribuído à nova sessão; unknown/derivado não conta manual. Import sem campo validado fica unknown. Título legado não é reescrito; política de apresentação só após Q01. Geração concorrente não pode substituir rename explícito sem intenção atual: manter proteção de sequência existente e teste de corrida. Regeneração explícita (`/rename` vazio e API title vazio) precisa decisão Q01, não remover função em nome do monitor.

Inventário adicional confirmado: `tool/plugin/opencode.ts:119-135` implementa session_rename via ctx.session.update; `plugin/host.ts:594-601` encaminha update para rename; `plugin/goal.ts:403-410` também deriva um título do objetivo pela mesma API; `cli/src/run/run.ts:144-151` pode derivar do primeiro texto quando title é vazio; App renomeia por update (`app/src/shell/titlebar/project-session-row.tsx:48-60`, `tab-strip.tsx:159-168`); lista TUI abre diálogo (`component/dialog-session-list.tsx:289-292`). Portanto, **não marcar todo update de plugin como explicit/human**: origem ausente continua unknown; intenção explícita só quando a fronteira confiável consegue afirmá-la. TASK-02 detalha fiação interna necessária após Q01 sem impor novo campo público de autoria humana. Se alguma marca exigisse API pública de plugin, expansão opcional precisa contrato/teste próprio, nunca mudar assinatura sem declarar.

<a id="23-dd-03"></a>
### 2.3 DD-03 — Uso cumulativo com ausência preservada
Categorias antigas de TokenUsage são disjuntas: input=fresh, output=visible, reasoning separado, cache.read/write separados. Para rótulos inclusivos do monitor: `entrada=input+cache.read+cache.write`, `saída=output+reasoning`, `total=entrada+saída`. Mostrar detalhes de cache/raciocínio, não adicioná-los outra vez ao total. Cálculos com inteiros exatos validados; valor inválido degrada qualidade sem alterar contador legado. Não usar billing/cost como prova de tokens presentes; cost zero explícito é respeitado pelo Core atual.

`session.tokens`/`session.cost` atuais são autoridade dos totais próprios de fatos contabilizados. Incluem uso auxiliar title/compaction via UsageRecorded; o espelho Compaction.Ended não é somado. Root cost() atual agrega família e fica separado do uso próprio. Fork inicia contadores próprios zero; revert não estorna gasto. Não reconstruir acumulado a partir do transcript paginado.

Preservar proveniência ANTES de `safe(undefined)→0`: expansão experimental tipada em fronteira SessionUsage.record, step end/fail e uso auxiliar; registrar categorias conhecidas, fonte, cobertura dos fatos (quantidade de fatos sem uso/parciais), totals conhecidos e contador/epoch de legado desconhecido. Ausência de categorias não pode desaparecer por soma de subtotais. Não tratar `visibleOutputTokens` getter=0 como presença se outputTokens não informado. Uso inclusivo informado sem breakdown pode confirmar I/O/T inclusivos, mantendo cache/reasoning indisponíveis; não exigir breakdown impossível. Relações derivadas só quando ambos operandos conhecidos e provider semântico comprovado; nada de deduzir 0 por ausência.

Persistência/projeção proposta acrescenta campos opcionais/nullable, mantém números legados intactos. Eventos guardam fatos mínimos de uso/presença/contexto, não totais cumulativos duplicados; read model dobra esses fatos e expõe estado completo. Rejeitar alternativa de marcar todo legado confirmado. Na transição, legado permanece cobertura unknown mesmo após novo step conhecido: pode-se mostrar total registrado legado com aviso e subtotal posterior confirmado, nunca promovê-lo integralmente. Reinício/replay deve produzir mesma cobertura. Não guardar providerMetadata bruta nem inferir tarifa. Esquema final/DDL só após Q02.

<a id="24-dd-04"></a>
### 2.4 DD-04 — Contexto medido e validade
Definição primária: **última ocupação de entrada observada na iteração final do MAIN AGENT**, em tokens de provider, não acumulado de cobrança. `AI.Usage.contextTokens`, quando efetivamente fornecido com semântica comprovada, pode confirmar essa observação passada; não afirma memória atual/tokenizer do próximo request. Não adicionar toda saída/raciocínio ao contexto se provider não garante que permaneçam no próximo input. Em mappers single-iteration com semântica provada, input inclusivo do último step é medição de entrada; multi-iteration que agrega entradas não é ocupação. Caso sem prova, proxy legado input+output+reasoning+cache é só estimado, com legenda, ou indisponível.

Persistir apenas observação mínima: tokens, fonte, modelo/provider/variante medidos, messageID/context epoch ou corte, instante do fato; capacidade vem do catálogo do MESMO modelo na location correta e é rotulada nominal. Nunca tokenizar prompts no frontend ou transferir contexto completo para medir. `contextTokens` só está mapeado em poucos protocolos na busca E08; não prometer todos os providers. TASK-03 inventaria casos single/multi e deixa desconhecidos indisponíveis. A perda no Core exige fiação, não só nova UI.

Invalidar `current` em compaction.started/ended, revert, alteração modelo/agente/instruções/context epoch, nova execução e mudança de location; a observação passada pode ficar visível defasada. Depois de compaction ainda não houve request MAIN AGENT: uso do compactor não conta. Capacidade nova só se liga à nova medição. Reconexão preserva fonte/instante, mas frescor aguarda sync; evento de texto/tool não autoriza alegar ocupação atual exata. Percentuais/limites conforme CA-06.2. Não confundir `limit.output` com `limit.context`.

<a id="25-dd-05"></a>
### 2.5 DD-05 — Estado, modelo, duração
Precedência: atividade running reconciliada → ativo; sem atividade e outcome da execução mais recente com idle≥busy → succeeded/concluído,failed/falhou,interrupted/interrompido; demais → desconhecido. Durante desconexão, conservar última observação rotulada desatualizada, não sucesso. Shutdown é sinal de interrupção/recovery, sem declarar conclusão funcional; o Client hoje retorna cedo para shutdown, então testar essa lacuna explicitamente.

Agente/modelo do Step.Started em execução, depois último step confirmado, depois seleção Session.Info com rótulo selecionado; não resolver defaults adivinhando agente. Mudança de seleção não modifica modelo do step em curso. Sem referência: indisponível. Variante literal do Ref, incluindo unknown; effort indisponível na principal, a menos que TASK-03 ache mapeamento verificável do request final. Não interpretar nome da variante como esforço.

Duração da execução mais recente desde time.busy até time.idle terminal, não por message/text begin. Reconnect usa busy do servidor; monotonic clock local só anima intervalo a partir da âncora observada, sem promessa de correção exata de clock skew entre hosts. Na ausência de server-now/offset comprovado, tempo ativo é estimado com relógio local; duração terminal por timestamps do servidor é confirmada quando intervalo válido. Não contar intervalo de desligamento como tempo ativo após recovery; Session.Info documenta novo busy no restart. Freeze durante stale/terminal. Um ticker compartilhado e descartável só quando há item ativo visível, injetável em testes.

<a id="26-dd-06"></a>
### 2.6 DD-06 — Relações e shells
Filhos diretos: consultar todas as páginas por parentID atual via recursos Client existentes; índice local incompleto não vira total exato. Map por ID, ordenação estável (created,id), detecta órfãos/ciclos para não caminhar recursivamente sem limite. Família inteira atual sobe à raiz (evidence E10), incompatível com lista da sessão selecionada: não reutilizar sessionFamily() para essa lista. Descendentes podem ser evolução, sem criar squad.

Shell origem: metadata.sessionID e location do inventário real (shell atual não traz location no schema; Client a acrescenta). Mesmo ID com location divergente não é substituído. Move pode deixar shell na location anterior: incluir somente quando associação histórica é comprovada e origem autorizada; se só há location atual carregada, explicitar cobertura parcial, não buscar todo disco/process tree. Só sessão atual na principal; filhos SO e shells de descendentes não prometidos. Mudança futura exige cadeia verificável, paging e segurança. `listBySession` atual busca todas locations carregadas mas só sessionID; seleção nova deve validar origem/geração antes de expor/navegar.

Resumo do comando não é primeira linha livre (o existente shell-tab faz isso): preferir allowlist de executável conhecido sem nenhum argumento/env/path; erro de parsing ou comando composto → Comando shell + ID. Título/descrição também são texto não confiável; sanitizar ANSI/controle, limitar células, não interpretar markup/links. Não prometer regex universal de segredo. Visualizador atual já prende ID/location e limita buffer a 64 KiB; abre só sob ação explícita. Seu polling 1s já existe enquanto aberto; **não adicionar polling de inventário** nem remover viewer para fingir zero polling global. Nenhuma nova ação kill/interrupt é entregue; ações antigas fora do painel não são ampliadas.

<a id="27-dd-07"></a>
### 2.7 DD-07 — Sincronização sem falsa consistência
Reusar conexão única SSE (scope global, locations no evento) e `createData`, estendendo seu controle por chave; não assinatura por item. Subscribe antes de iniciar reads. Cada load recebe geração da conexão + sessionID + location + sequência conhecida. Snapshot vivo não é atomicamente cortado hoje: enquanto há corrida, buffer de eventos relevantes e rerun se dirty; somente aceitar como fresco quando leitura válida e buffer ordenado aplicado sem lacuna. Duráveis usam agregado/seq e descartam duplicata; gap ou feed overflow pede resync, não inventa replay do feed volátil. Efêmero `usage.updated` é absoluto, sem seq de uso hoje: se correndo com snapshot, marcar dirty/refetch até reconciliação; considerar transportar watermark na expansão experimental para evitar indefinição. Decisão de corte final exige teste de contrato TASK-04/TASK-05, não usar timestamp como ordem total entre agregados.

Conjuntos de shells têm eventos efêmeros; hydrate inventory e sobrepor created/exited/deleted recebidos durante read, com geração; gaps invalidam conjunto. Status ativo já tem overlay durante session.active (E12), não prova que todos os recursos têm esse overlay. A troca A→B mantém caches separados e respostas A podem atualizar apenas cache A se geração válida, nunca tela B. Completeness/freshness por fonte; snapshot parcial não apaga evento terminal novo nem ressuscita item excluído. Revalidar após reconnect e cancelar commits tardios no unmount/flag off. Sem atomicidade comprovada, sinalizar stale; requisito não promete exactly-once no SSE.

<a id="28-dd-08"></a>
### 2.8 DD-08 — UI e limites
MAIN AGENT compacto com expansão de detalhes; filhos/shells em viewport rolável, seleção por ID e máximo proposto 50 linhas montadas. Em 44×12 não montar lateral forçada; resumo de uma linha abre detalhes por ações Keymap e mouse (comandos novos a registrar/testar, não bindings mágicos). Entrada/permissão tem prioridade, reduzir detalhes e nunca altura editável por crescimento de dígitos. UID completo acessível por detalhe/cópia existente, não truncar irrecuperavelmente. Painel lateral física direita segue PRD. Estados feedback; ações action; demais text/base/muted e formfield para seleção conforme tokens. Custom fallback/light/dark quando novo papel necessário.

OpenTUI não é DOM: `bdi`, CSS logical e axe não são assumidos disponíveis. Aplicar habilidade RTL por ensaio de ordem de células, teclado e mixed text; manter ID/provider/modelo em sequência LTR legível e nome no comportamento do renderer, sem caracteres de controle arbitrários vindos da fonte. Limitações reais de bidi precisam registro, não alegar a11y web completa.

## 3. Alternativas consideradas
| Alternativa | Prós | Contras | Por que não |
|---|---|---|---|
| Só renderizar campos existentes | escopo pequeno | origem/presença já perdidas; contexto proxy | não cumpre P01/P05/P06 sem indisponibilidade honesta |
| Expansão aditiva nos fatos/read models existentes | restart/replay e consumidores tipados | requer fiação/migration/contratos/Q02 | proposta condicionada, não autorizada |
| Sidecar/novo serviço/polling/dashboard | agrega fora TUI | privacidade/custo/novo lifecycle | fora de escopo |
| Usar família global e somar tudo | reutiliza aba | inclui irmãos/raiz e cobertura incompleta | sessão incorreta; filhos diretos preferidos |
| Título customizado = manual por regex | sem migration | gerado/importado indistinguíveis | inventa proveniência |
| Renomear todo legado | simples UI | apaga dados e títulos legítimos | proibido |
| Somar tokens brutos inclusivos + cache/reasoning | simples | dupla contagem | rejeitado; mutantes numéricos tasks |
| Contexto exato via tokenizer frontend | parece preciso | não reproduz request/provider, transfere conteúdo | não prometer exatidão |

<a id="contracts"></a>
## 4. Contratos e integrações afetados
- Proposta `Session.Info.experimental.activity` opcional contendo origem título, uso com presença/cobertura e última observação de contexto. Shape final é task de contrato, não nome exportado consolidado aqui. Estado de conexão/frescor é Client-local; não persistir connected.
- Expandir Created/Renamed/Step.Ended/Failed/UsageRecorded com fatos experimentais opcionais; Step.Started já possui agent/model/start. Envelope público só campos browser-safe. Eventos duráveis existentes versionados segundo mecanismo do Bus, com decoder/replay antigo; se adição opcional mantiver versão, teste deve provar omissão e identidade, não alterar versão sem necessidade. Nunca duplicar totals deriváveis em evento durável.
- Rotas existentes `GET /api/session/:sessionID`, `PATCH /api/session/:sessionID`, `GET /api/event`, shell list/get/output. Protocol seleciona PublicSessionInfo por campos; Server conecta novo shape. Qualquer endpoint novo futuro exige `/api/experimental/...`, identifier experimental, mas não está proposto agora.
- New server + old client ignora adicionais; old server + new client usa indisponível/legado e título segundo Q01. Atualizar codegen Promise/Effect via `bun run generate` no client; preservar aliases se API pública movida (não há movimento planejado).
- Testar round-trip wire/durable, import/fork/move, snapshots com/sem experimental, valores unknown de provider/variante. Sem dependência runtime Client→Core.
- **Inventário de mudança de fonte:** escritores título `session/session.ts:71-74`, `title.ts:143-151`, Created/Fork/Import; leitores `info.ts:16`, projector:981, Client:807-818, Sidebar:33-48, TUI rename, demais App/SDK; efeito evento preservado. Uso: SessionUsage→step/title/compaction→projector→Info/UsageUpdated→Client. TASK-02/TASK-03 precisam enumerar todos os callsites antes do corte; inventário atual é amostra rastreada, não prova de exaustividade.
- Compatibilidade de identidade cobre clientes App/CLI existentes sem exigir mudanças visuais nesses packages; nomes atribuídos por terceiros são ação de API, não autoria humana. O conjunto definitivo de escritores classificados vem da decisão Q01; assinaturas públicas de plugin permanecem intactas até contrato explícito aprovado.

<a id="rollout"></a>
## 5. Plano de migração / rollout
1. Resolver Q01/Q02/gates e confirmar base real isolada; sem commitar/alterar outros changes. Reservar nome de migration por histórico + registros/worktrees antes de fixar número (ainda não reservado).
2. Se autorizada, expansão SQLite nullable para proveniência/observações e projeções, sem modificar título/contadores antigos. DDL dono `packages/core/src/session/sql.ts` e `database/migration`; não criar store secundário. Sem backfill inferencial; legado unknown. Replay deve reconstruir novos campos ausentes como unknown.
3. Deploy/lançamento não executado aqui: novos produtores/consumidores aditivos, clientes regenerados, flag TUI off default; ativação por usuário Experiments. Docs explicam qualidade/limitações/tempo/família.
4. Testar migration em DB descartável real antigo com títulos manuais/gerados iguais, zero explícito, missing usage, fork e counters. Medir impacto/locks, reiniciar e reexecutar mecanismo oficial de migrations, não DDL manual. Expansão compatível com versão antiga; não remover coluna na volta. Rollback funcional flag off preserva dados; compatibilidade de binary rollback precisa teste antes de autorizar. Nenhuma fase contract destrutiva proposta.

<a id="risks"></a>
## 6. Riscos e mitigação
| Risco | Probabilidade | Impacto | Mitigação / detecção |
|---|---|---|---|
| título sem origem / generator após manual | alta (fonte atual indistinta) | identidade incorreta | unknown/Q01, teste corrida, sem overwrite |
| falta vira zero | alta (safe atual) | falsa precisão | presença antes normalização; legado unknown, teste partial |
| contexto de múltiplas iterações acumulado | real em mapper Anthropic | ocupação falsa | contextTokens final, fonte/corte, indisponível |
| snapshot sobrescreve evento / reconnect | real em Client | contadores/estado errados | generation/watermark/overlay, testes determinísticos |
| família/locations misturadas | real no reuso ingênuo | vazamento/atribuição errada | parentID direto/origem shell/testes negativos |
| comando/título carrega segredo/ANSI | plausível | exposição no terminal | comando sem args, sanitização, fixtures negativas |
| muitos itens/tickers | plausível | lentidão/reflow | budget de montagens, ticker único, cleanup |
| normas genéricas incompatíveis | confirmado nos textos locais | gates/arquitetura ilegítimos | Q02 bloqueante; não inventar exceção |
| base subscription-auth não é dev | confirmado | plano aplicado em árvore errada | revalidar refs antes código; coordenação sem tocar peers |

## 7. Rastreabilidade
| REQ | Seção do design que o atende |
|---|---|
| REQ-01 | §2.2, §4, §5 |
| REQ-02 | §1, §2.1, §5 |
| REQ-03 | §2.1, §2.8 |
| REQ-04 | §2.5 |
| REQ-05 | §2.5 |
| REQ-06 | §2.4 |
| REQ-07 | §2.3 |
| REQ-08 | §2.3, §2.7 |
| REQ-09 | §2.5 |
| REQ-10 | §2.6 |
| REQ-11 | §2.6 |
| REQ-12 | §2.1, §2.8 |
| REQ-13 | §2.7 |
| REQ-14 | §2.8 |
| REQ-15 | §4, §5 |
| REQ-16 | §2.6, §4, §6 |
| NFR-01..06 | §2.1, §2.3..2.8, §4..6 |
