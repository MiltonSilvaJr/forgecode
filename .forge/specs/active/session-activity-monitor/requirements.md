# Requirements — session-activity-monitor

> Rascunho não aprovado. IDs curtos REQ-NN são aliases locais dos REQ-SAM-NNN indicados abaixo. Cada CA-NN.n aparece na matriz de testes em tasks.md. NEEDS CLARIFICATION: Q01/Q02 em clarifications.md; propostas não são decisões ratificadas.

<a id="req-01"></a>
## REQ-01 — Identidade explícita e compatível (REQ-SAM-001)
- **Quando** a sessão atual é apresentada, **o sistema deve** usar UID completo até nome explicitamente atribuído e depois esse nome.
- **Critérios de aceite:**
  - [ ] CA-01.1: sem título/default/gerado não comprovadamente explícito mostra UID completo; largura insuficiente permite quebra/copiar UID, não elipse sem acesso ao valor integral.
  - [ ] CA-01.2: `/rename Nome`, diálogo, lista, API e ferramenta de rename preservam nome e atualizam painel após confirmação; falha/cancelamento não altera identidade.
  - [ ] CA-01.3: origem legada desconhecida não é inferida pelo texto/formato/evento indistinto; sem overwrite/backfill destrutivo. Política legado/gerado e regeneração após manual depende de Q01.
- **Rastreia:** proposal P01. Nome explícito de criação por API/agente não prova autoria humana; distinguir ação de autoria.

<a id="req-02"></a>
## REQ-02 — Opt-in experimental (REQ-SAM-002)
- **Quando** `experimental["session-activity-monitor"]` é ausente/false na configuração TUI, **o sistema deve** manter apresentação anterior; true habilita painel e resumo juntos.
- **Critérios de aceite:**
  - [ ] CA-02.1: registry Experiments permite ligar/desligar/persistir/recarregar sem perder outros experimentos.
  - [ ] CA-02.2: desligar desmonta recursos exclusivos/restaura Context e identidade prévios; não remove framework Experiments nem modifica config do servidor inadvertidamente.
- **Rastreia:** P02, P12; chave proposta, não publicada.

<a id="req-03"></a>
## REQ-03 — MAIN AGENT preserva recursos (REQ-SAM-003)
- **Quando** habilitado, **o sistema deve** substituir Context por MAIN AGENT na lateral direita, incluindo identidade/agente/estado/modelo/provider/variante ou effort/contexto/uso/tempo.
- **Critérios de aceite:**
  - [ ] CA-03.1: custo/contexto continuam acessíveis sem duplicação; MCP/limites/todo/footer/plugins externos preservam ordem relativa e ações existentes.
  - [ ] CA-03.2: loading/vazio/erro/indisponível distintos; sidebar oculta não desativa resumo nem esconde único acesso às listas.
- **Rastreia:** P02, P12.

<a id="req-04"></a>
## REQ-04 — Agente e estado factuais (REQ-SAM-004)
- **Quando** estado muda, **o sistema deve** mostrar texto ativo/concluído/falhou/interrompido/desconhecido sem depender de cor.
- **Critérios de aceite:**
  - [ ] CA-04.1: atividade confirmada prevalece sobre outcome anterior; idle sem outcome não é sucesso; nova sessão/enqueue/shutdown-recovery não vira concluída.
  - [ ] CA-04.2: agente do step em execução ou último comprovado prevalece; seleção sem execução recebe rótulo selecionado. Sem fonte: "Agente indisponível", não build/general/regex de título.
- **Rastreia:** P03.

<a id="req-05"></a>
## REQ-05 — Modelo/provider e esforço (REQ-SAM-005)
- **Quando** há step com modelo conhecido, **o sistema deve** exibir efetivo/provider distinguindo seleção futura.
- **Critérios de aceite:**
  - [ ] CA-05.1: troca durante step não reatribui uso/tempo ao novo modelo; sem step conhecido seleção é rotulada como tal ou indisponível.
  - [ ] CA-05.2: variante arbitrária permanece variante; effort só com produtor/mapeamento efetivo comprovados. Senão variante ou effort indisponível, nunca equivalência automática high/default/max.
- **Rastreia:** P04.

<a id="req-06"></a>
## REQ-06 — Janela de contexto, não acumulado (REQ-SAM-006)
- **Quando** há observação confiável de ocupação, **o sistema deve** mostrar capacidade C, ocupação O e porcentagens com fonte/instante. Ocupação atual exata não se deriva de acumulado da sessão.
- **Critérios de aceite:**
  - [ ] CA-06.1: preferir contexto efetivo da última iteração quando informado; proxy do último step de conversa é estimado, não atual confirmado. Sem fonte confiável: indisponível. Título/compactor não determinam janela MAIN AGENT.
  - [ ] CA-06.2: C>0/O válido: U=100×O/C, usado arredondado a uma casa decimal (half-up decimal só de apresentação), restante=max(0,100−U) arredondado independentemente; O/C inteiros exatos; O>C mostra overflow e U>100. C ausente/zero/O inválido não produz porcentagem. O=12345,C=200000 → 6,2%/93,8%; O=210000 → 105,0%/0,0%.
  - [ ] CA-06.3: compactação/revert/troca modelo/instruções/retomada invalidam atualidade até observação compatível; capacidade B não recebe percentual medido em A. Preservar última medição rotulada defasada ou indisponível.
- **Rastreia:** P05; não prometer tokenizer exato de contexto ainda não enviado.

<a id="req-07"></a>
## REQ-07 — Tokens cumulativos próprios sem dupla contagem (REQ-SAM-007)
- **Quando** há uso conhecido, **o sistema deve** apresentar acumulado da sessão selecionada, não família/último step.
- **Critérios de aceite:**
  - [ ] CA-07.1: categorias disjuntas normalizadas: I=fresh+cacheRead+cacheWrite; O=visibleOutput+reasoning; T=I+O. Provider inclusivo não soma cache/reasoning novamente. fresh=80,read=15,write=5,visible=24,reasoning=6 → I=100,O=30,T=130, não 150/136/156.
  - [ ] CA-07.2: contabilidade própria Core inclui títulos/compactações contabilizados, cada fato uma vez; não adicionar compaction.ended e usage.recorded do mesmo consumo, nem usage.updated absoluto como incremento. Fork/revert não inventam reembolso; filho não soma tokens do pai.
  - [ ] CA-07.3: rótulos explicitam acumulado próprio e escopo do custo existente (família na raiz). Paginar/navegar/reconectar não altera soma sem fato novo.
- **Rastreia:** P06.

<a id="req-08"></a>
## REQ-08 — Qualidade e ausência do uso (REQ-SAM-008)
- **Quando** provider não informa uso/categoria, **o sistema deve** preservar ausência/parcialidade, nunca zero conhecido inventado.
- **Critérios de aceite:**
  - [ ] CA-08.1: confirmado pela fonte normalizada/estimado/indisponível distintos; frescor é eixo independente. Parcial mostra subtotal conhecido e categorias faltantes, sem total confirmado.
  - [ ] CA-08.2: zero explícito é conhecido; undefined/NaN/infinito/negativo inválido não é zero confirmado. Legado normalizado a zero tem proveniência desconhecida, não reconstrução inventada.
  - [ ] CA-08.3: durante streaming último confirmado com aviso em atualização; sem promessa de billing/custo oficial/contador intermediário oficial. Estimativa streaming opcional nunca entra na soma confirmada.
- **Rastreia:** P06.

<a id="req-09"></a>
## REQ-09 — Duração de execução (REQ-SAM-009)
- **Quando** há início real busy, **o sistema deve** mostrar duração da execução mais recente, não idade/soma de steps.
- **Critérios de aceite:**
  - [ ] CA-09.1: ativo/fresco: floor(max(0,agora−busy)/1000) segundos, relógio decorrido monotônico após âncora; terminal idle≥busy: floor((idle−busy)/1000), parado. Criação/primeiro render não substituem início.
  - [ ] CA-09.2: busy ausente/intervalo inconsistente/atividade não reconciliada → indisponível ou última observação desatualizada. Recovery/nova execução cria âncora sem somar desligamento; reconnect não reinicia relógio do servidor.
- **Rastreia:** P07.

<a id="req-10"></a>
## REQ-10 — Subagentes relacionados (REQ-SAM-010)
- **Quando** lista subagentes, **o sistema deve** usar filhos diretos (`parentID === atual.id`) como proposta principal, nunca irmãos/ancestrais da família global.
- **Critérios de aceite:**
  - [ ] CA-10.1: nome/descrição seguro, estado/modelo/provider/variante/uso próprio/duração comprovados, senão indisponíveis; conjunto paginado incompleto tem indicador, não contagem exata enganosa.
  - [ ] CA-10.2: teclado/mouse navegam à filha correta; voltar preserva origem/seleção. Na filha, MAIN AGENT representa filha e lista seus filhos. Não há nova ação de interrupção.
- **Rastreia:** P08. **Justificativa:** parentID já tipado/paginável; descendentes completos exigem descoberta adicional/limites. Aba antiga de família preservada como família, não rebatizada silenciosamente.

<a id="req-11"></a>
## REQ-11 — Shells correlacionados e privados (REQ-SAM-011)
- **Quando** há shells ativos, **o sistema deve** listar somente associação comprovada sessionID/location de origem autorizada.
- **Critérios de aceite:**
  - [ ] CA-11.1: ID/estado/duração desde time.started e resumo seguro; remover sensível ANTES de truncar. Proposta: executável permitido sem argumentos, senão Comando shell + ID; nunca env/argumentos livres/cwd/output inline.
  - [ ] CA-11.2: saída existente por ID/location originais; seleção não muda alvo de diálogo aberto. Ausente/deletada/sem permissão: erro recuperável sem criar/executar shell; não chamar remove/kill/interrupt.
  - [ ] CA-11.3: inventário efêmero não é histórico, saída pode sobreviver ao fim. Filhos SO/shells de descendentes não inferidos por PID/comando; principal só sessão atual, inclusão adicional exige vínculo demonstrado.
- **Rastreia:** P09.

<a id="req-12"></a>
## REQ-12 — Resumo compacto coerente (REQ-SAM-012)
- **Quando** experimento ativo/sessão conhecida, **o sistema deve** mostrar próximo ao prompt contagens de filhos diretos ativos e shells ativos do conjunto do painel.
- **Critérios de aceite:**
  - [ ] CA-12.1: mesma projeção/qualidade/frescor, dedup ID, principal não conta como filho; ativo=execução running confirmada, não enqueue. Zero só inventário completo/fresco; parcial ≥N ou N conhecidos.
  - [ ] CA-12.2: no máximo uma linha reservada; 9→10→100 não muda altura do prompt; em 44×12 prioriza edição/permissões e detalhes sem sidebar. Tokens da família excluídos da principal por cobertura não confiável.
- **Rastreia:** P10, P11.

<a id="req-13"></a>
## REQ-13 — Snapshot/eventos e isolamento (REQ-SAM-013)
- **Quando** conecta/reconecta/troca sessão/location, **o sistema deve** reconciliar snapshot/eventos e rejeitar gerações/entidades antigas.
- **Critérios de aceite:**
  - [ ] CA-13.1: subscribe antes de snapshot; buffer/revalidação por chave até corte consistente; eventos absolutos substituem, duráveis dedup agregado/seq; resposta A lenta não sobrescreve B/evento novo. Gap/overflow/desconexão marca desatualizado e pede resync.
  - [ ] CA-13.2: fresco só após fontes necessárias reconciliadas; falha/loading parcial não transforma unknown em sucesso nem mantém contadores live. Reconnect/duplicatas não alteram total/linhas.
- **Rastreia:** P11.

<a id="req-14"></a>
## REQ-14 — Layout, navegação, tema e acessibilidade (REQ-SAM-014)
- **Quando** há resize/muitos itens, **o sistema deve** manter prompt/foco/scroll e detalhes acessíveis sem perda funcional.
- **Critérios de aceite:**
  - [ ] CA-14.1: 44×12,80×24,140×40, resize ida/volta, sidebar oculta,0/1/1000 itens; expansão limitada/viewport rolável. UID/nomes Unicode longos não capturam todas as linhas.
  - [ ] CA-14.2: seleção por ID, Enter/mouse abre, Escape volta, foco visível; texto/ícones além de cor. Tokens semânticos claro/escuro/custom, sem hue cru.
  - [ ] CA-14.3: inglês LTR/RTL e texto misto/nome RTL com UID/modelo/tempo legíveis. Não alegar DOM/bdi no OpenTUI sem verificar; lateral física direita do PRD não espelha arbitrariamente; teclado segue convenção TUI existente.
- **Rastreia:** P12.

<a id="req-15"></a>
## REQ-15 — Contratos/dados compatíveis (REQ-SAM-015)
- **Quando** acrescenta proveniência/ocupação, **o sistema deve** evoluir aditivamente sem mudar campos legados.
- **Critérios de aceite:**
  - [ ] CA-15.1: envelope experimental opcional; cliente antigo lê title/tokens/time; servidor antigo degrada novo para indisponível. Replay/import/fork/move legados preservam títulos/totais sem inventar origem.
  - [ ] CA-15.2: versão/decoder cobrem eventos antigos/novos; clientes regenerados pelo gerador, não editados; migration no SQLite real se alternativa persistida aprovada; nenhuma troca de banco/serviço autorizada.
- **Rastreia:** P01, P06, P11, P12.

<a id="req-16"></a>
## REQ-16 — Privacidade e somente leitura (REQ-SAM-016)
- **Quando** observa atividade, **o sistema deve** minimizar conteúdo/reusar autorização sem nova permissão de controle.
- **Critérios de aceite:**
  - [ ] CA-16.1: payload/frames/logs sem credenciais/env/prompts/raw provider metadata/output desnecessário; sanitizar ANSI/controles de títulos/resumos antes de renderizar, nunca executar texto.
  - [ ] CA-16.2: ID de outra sessão/location não revela detalhes/shell; teste negativo ownership; painel não dispara prompt/command/remove/interrupt/coleta adicional flag off.
- **Rastreia:** P09, P12.

## Requisitos não funcionais do change (quando houver)
- **NFR-01 — Recursos:** zero novo polling de inventário; no máximo um ticker visual 1 Hz por monitor visível ativo, nenhum por item; desmontar/flag off zera timers/listeners adicionais. Medir contagens com relógio injetado.
- **NFR-02 — Trabalho limitado:** proposta no máximo 50 linhas de entidades expandidas montadas por viewport para 1000; demais acessíveis via paginação/scroll. Delta por chave, não revarrer transcript por fragmento textual; medir operações, não wall-clock.
- **NFR-03 — Espaço:** resumo ≤1 linha e altura editável invariável com contagens; em 44×12 não encobrir entrada/permissões; medir geometria do renderer.
- **NFR-04 — Precisão:** conhecidos finitos/não negativos; arredondar só apresentação; fonte/instante acessíveis nos detalhes.
- **NFR-05 — Regressão:** testes focados + check canônico; narrow/wide, claro/escuro/custom e flag off; suites por package, nunca testes na raiz.
- **NFR-06 — Privacidade:** zero leitura extra de shell.output antes de ação explícita; fixtures de segredo/ANSI ausentes de frame/log do monitor. Não prometer detecção universal de segredo em texto arbitrário.

## Checklist de cobertura de superfície
| REQ | Parâmetro/config exposto | Superfície (tela/endpoint/CLI) | Coberto por task |
|---|---|---|---|
| REQ-01 | origem de título experimental | PATCH /api/session/:sessionID e /rename existentes | TASK-02, TASK-04, TASK-09 |
| REQ-02 | experimental.session-activity-monitor TUI | Experiments e cli.json global | TASK-08 |
| REQ-03 | sem parâmetro exposto; MAIN AGENT | lateral direita TUI | TASK-09 |
| REQ-04 | sem parâmetro exposto; estado/agente | MAIN AGENT | TASK-07, TASK-09 |
| REQ-05 | sem parâmetro exposto; modelo/variante | MAIN AGENT | TASK-07, TASK-09 |
| REQ-06 | observação contexto experimental | GET /api/session/:sessionID e eventos | TASK-03, TASK-04, TASK-07 |
| REQ-07 | uso próprio experimental | GET /api/session/:sessionID e eventos | TASK-03, TASK-04, TASK-07 |
| REQ-08 | proveniência experimental | GET /api/session/:sessionID e eventos | TASK-03, TASK-04, TASK-07 |
| REQ-09 | sem parâmetro exposto; duração | monitor TUI | TASK-07, TASK-09 |
| REQ-10 | sem parâmetro exposto; filhos/navegação | monitor/subsessão TUI | TASK-06, TASK-10 |
| REQ-11 | sem parâmetro exposto; shell/saída | GET /api/shell/:id/output existente e TUI | TASK-06, TASK-10 |
| REQ-12 | sem parâmetro exposto; contagens | composer/prompt TUI | TASK-11 |
| REQ-13 | envelope experimental opcional | GET /api/event e GET /api/session/:sessionID existentes | TASK-04, TASK-05 |
| REQ-14 | sem parâmetro exposto; foco/resize | TUI | TASK-12, TASK-13 |
| REQ-15 | novos campos opcionais | GET /api/session/:sessionID e PATCH /api/session/:sessionID | TASK-02, TASK-03, TASK-04 |
| REQ-16 | sem parâmetro exposto; somente leitura | TUI e GET /api/shell/:id/output existente | TASK-06, TASK-10, TASK-14 |

## Superfícies de API e dados
Sem endpoint novo na alternativa proposta. Shape experimental/persistência dependem de Q02; tabela não é contrato publicado.

## Mapa endpoint → ação → recurso → policy
| Endpoint | Ação | Recurso | Policy | REQ |
|---|---|---|---|---|
| GET /api/session/:sessionID | ler projeção com expansão opcional | sessão | autenticação/middleware/resolução existentes; testar ownership | REQ-06, REQ-07, REQ-08, REQ-13, REQ-15 |
| PATCH /api/session/:sessionID | rename existente, origem factual | sessão | autorização existente, sem confiar em origem fornecida pelo cliente | REQ-01, REQ-15 |
| GET /api/event | observar feed global, filtrar no consumidor | eventos | autenticação existente; location global não é sessão atual | REQ-13, REQ-16 |
| GET /api/shell/:id/output | ler por ação explícita | shell/location original | resolução existente, teste negativo | REQ-11, REQ-16 |

## Classificação de dados
| Dado/campo | Classificação | Mascaramento | Fronteira de tokenização |
|---|---|---|---|
| título/descrição/comando/cwd | sensitive | sem logs textuais; comando allowlist sem args | não coletar PAN/PII; texto arbitrário pode conter |
| IDs/location | sensitive | logs só IDs necessários, sem divulgar diretórios | autorização existente, sem store externo |
| tokens/modelo/provider/tempo | sensitive | números/IDs/metadados mínimos | excluir providerMetadata bruta |
| credencial/env/prompt/output | sensitive | excluídos do monitor; output só diálogo explícito | sem novo transporte/store |

## Checklist de sinais OTel por boundary
- [ ] Comprovar trace/log/métrica da expansão de boundary existente (TASK-04/TASK-14) sem texto sensível, caso Q02 autorize.
- Cobertura OTel do host não medida aqui. observability.md exige três pilares; não dispensado por não verificado. Q02 bloqueia introdução silenciosa de stack externa/instrumentação global fora de escopo.

## Mapa de eventos auditáveis
| Mutação | Audit event | Payload (sem PII/PAN crua) | REQ |
|---|---|---|---|
| nome atribuído/gerado | session.renamed existente, expansão opcional proposta | ID/origem; não duplicar título em log diagnóstico | REQ-01, REQ-15 |
| uso concluído/auxiliar | session.step.ended/failed e session.usage.recorded existentes | números/proveniência mínima sem metadata bruta | REQ-07, REQ-08, REQ-15 |
| abrir/navegar monitor | nenhuma mutação durável nova | sem novo evento de domínio para UI derivável | REQ-10, REQ-11, REQ-16 |

## Fora de escopo (reafirmação)
Todos os itens de proposal §3, incluindo billing e estimativas streaming obrigatórias. Entrega principal inclui resumo e painel, sem redução silenciosa do PRD.
