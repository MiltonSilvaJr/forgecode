# Proposal — session-activity-monitor

> Rascunho para revisão, 2026-11-05. Feature brownfield, scale 3 proposto por delegação do pedido de classificação. Nenhuma aprovação humana recebida. Fonte: resumo PRD/HLD recebido nesta sessão; PRD integral da sessão-pai não acessado nem declarado conferido.

## 1. Por quê (problema / motivação)
O usuário precisa acompanhar a sessão atual sem inferir estado pela cor nem confundir contexto ocupado com consumo acumulado. A lateral já apresenta Context/custo e outros plugins; composer permite navegar por subagentes e shells, mas as fontes têm semânticas diferentes. Investigação e base em `evidence.md`; não há medição de produtividade que sustente promessas quantitativas de benefício.

## 2. O que muda
| PRD | Mudança observável integral | Requisitos |
|---|---|---|
| P01 | Identidade: UID completo até nome explicitamente atribuído, depois nome; distinguir default/gerado/legado sem sobrescrever dados | REQ-01 |
| P02 | Opt-in TUI; substituir Context por MAIN AGENT preservando contexto/custo/MCP/todo/limites/footer | REQ-02, REQ-03 |
| P03 | Agente real/fallback factual; ativo/concluído/falhou/interrompido/desconhecido textuais | REQ-04 |
| P04 | Modelo/provider efetivos; effort só com correspondência comprovada, senão variante/indisponível | REQ-05 |
| P05 | Capacidade, ocupação e porcentagens de contexto com fonte, precisão, compactação e troca de modelo | REQ-06 |
| P06 | Tokens cumulativos próprios, cache/raciocínio sem dupla contagem; ausência/parcialidade/confirmado/estimado/indisponível/desatualizado | REQ-07, REQ-08 |
| P07 | Duração desde execução real até terminal, retomadas e ausência honestas | REQ-09 |
| P08 | Subagentes da sessão correta; relação escolhida, estado, nome/descrição/modelo/variante/uso/duração comprovados; navegação | REQ-10 |
| P09 | Shells da sessão/location, resumo privado, duração/estado e saída existente por navegação; descendentes só com prova de viabilidade | REQ-11 |
| P10 | Resumo próximo ao prompt com contagens ativas coerentes e espaço limitado; tokens agregados só confiáveis | REQ-12 |
| P11 | Snapshot/eventos/reconexão/troca de sessão; deduplicação, frescor e descarte de respostas antigas | REQ-13 |
| P12 | Muitos itens/scroll, narrow/low/resize/sidebar oculta, teclado/mouse, a11y, tema semântico, compatibilidade e privacidade | REQ-14, REQ-15, REQ-16, NFR-01..06 |

Painel e resumo pertencem ao mesmo change: compartilham entidades e frescor; não entregar contagens divergentes ou adiar o resumo silenciosamente. Estimativas streaming são evolução opcional, não dependência principal.

NEEDS CLARIFICATION: Q01/Q02 em `clarifications.md` tratam identidade e conflitos normativos antes da aprovação. Propostas de fonte/fórmula/limites precisam ratificação nos gates, não são decisões humanas já tomadas.

## 3. O que NÃO muda (fora de escopo)
- Criar squad/orquestrador, alterar ForgeQueue/inbox, autenticação/billing, dashboard externo, serviço/broker adicional, terminar shells/processos ou interromper subagentes pelo novo painel.
- Exibir credenciais, env, prompts, raw provider metadata ou output inline. Saída de shell só por ação explícita no visualizador existente.
- Reescrever títulos/totais históricos para fingir proveniência; mudar semântica pública de TokenUsage; prometer contagem intermediária oficial ou faturamento.
- Migrar arquitetura/banco/transporte para satisfazer templates sem decisão humana. Nenhum código, commit, merge, deploy, checkout, reset ou archive nesta execução.

## 4. Impacto
- Capacidade nova `session-activity-monitor`; paths e dependências no manifest. Não promover baseline nesta fase.
- Base: HEAD `9c98dbb609b7ef7d8e20bf2679d25244876f8870`, branch `feature/subscription-auth`; ref local `origin/dev` = `14638b54d3dfb52162c05c0e3f0c59e1e3f18015`; merge-base `63a8aefd98ccd30f56b78b618ec7f9e83a6255f5`, divergência 51/1. Sem fetch: não afirmar frescor de rede. Trabalho preexistente preservado.
- Scale 3: TUI, Core/projeções, Schema/Protocol/Server e client, com sincronização; exige analyze e sharding. Scale 2 omitiria decomposição multi-módulo; 4 não é justificado por billing/regulação excluídos. Régua `.forge/commands/specs/spec.md:26-35`; usuário delegou classificação, não aprovação. Rigor spec-anchored.
- Nenhuma dependência funcional imposta em squad/subscription-auth/forgequeue. Possível colisão de migrations/schema/client gerado; revalidar base e coordenação antes de código. Manifests locais não provam integração ao tronco.
- Riscos: origem de título perdida, ausência de uso convertida a zero, ocupação não retida, família global confundida com descendência, corrida snapshot/evento, segredos em argumentos e normativa genérica incompatível.
- Escrita exclusiva desta pasta. Não criar worktree/branch nem alterar harness para contornar regras. Divergência de worktree é pendência de governança, não dispensa deste agente.

## 5. Próximos passos
1. Sessão-pai conduz `/forge:clarify` uma pergunta por vez, iniciando Q01, e registra apenas respostas reais.
2. Versionamento por humano autorizado, validator independente (máximo 3 rodadas) e gate `requirements_reviewed`. Ferramenta de subagente independente indisponível aqui.
3. Design/tasks anexos são rascunhos antecipados, não execução formal de fases sem pré-condição. Revisar Q02, depois gates `design_reviewed`/`tasks_reviewed`.
4. Após gates: analyze formal, sharding + epic_context, grafo/impacto fresco e implementação isolada acordada. `dev_loop.sharded: false` até isso ocorrer; não avançar implementing nesta tarefa.
