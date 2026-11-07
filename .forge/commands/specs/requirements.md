---
description: Gera/refina os requirements do change ativo (requirements.md, bugfix.md ou refactor.md conforme o tipo) com loop builder→validator (máx. 3 iterações) e gate HITL. Transiciona para requirements-ready.
argument-hint: "[<change-id>]"
---

# /forge:requirements — requirements do change com loop builder→validator

Argumentos: `$ARGUMENTS` (change-id opcional; sem argumento, use o único change ativo).

Artefato-alvo por tipo (manifest `type`): `feature|greenfield|brownfield` → `requirements.md` · `bugfix` → `bugfix.md` · `refactor` → `refactor.md`. Scale 0 dispensa esta fase (informe e sugira `/forge:tasks`).

## 1. Builder

Preencha/refine o artefato-alvo a partir de `proposal.md`, das clarificações já aplicadas e do contexto do repo:

- siga a estrutura do template instalado no change (não invente seções); o artefato de cada rodada é autocontido — nunca referencie "inalterado da rodada N" ou "herdado da rodada N": reescrita inteira a cada rodada apaga silenciosamente o que a anterior tinha, e revisão incremental (que lê só o que mudou) é estruturalmente cega a essa perda; a pasta do change precisa estar versionada (git) antes da primeira rodada de revisão;
- todo requisito verificável e rastreável (`REQ-NN` → proposal §; bugfix: as 6 seções do `bugfix.md`; refactor: invariantes verificáveis); todo requisito que define fórmula, ordenação ou limiar e traz exemplo de aceite tem o exemplo computado contra a fórmula antes de aprovar — reporte conflito se não fechar, nunca confie na forma textual;
- toda prova vermelha/verde prescrita num critério de aceite é executada no momento da escrita, com a saída real anotada: a vermelha descreve o presente, a verde precisa ser alcançável pelo próprio change (um diff contra o tronco num caminho que o change altera nunca fica vazio);
- incertezas → `NEEDS CLARIFICATION` (nunca inferir); toda afirmação de ausência que sustenta dispensa de uma rule obrigatória (pilar de observabilidade, segredo, teste) carrega a busca que a sustenta (fonte, comando, documento consultado) — "não verificado" nunca sustenta dispensa: vira pergunta (verificar) ou exceção formal registrada ao dono;
- precedente de outro change citado como prova de viabilidade vale pelo MESMO mecanismo (mesmo exportador, mesma forma de credencial, mesmo tipo de componente), não pelo resultado alcançado; nome de recurso (segredo, variável) é resolvido na forma da camada em que o comando roda (cofre ≠ cluster ≠ código), nunca copiado de outra camada;
- quando o parecer descrever o formato de um artefato que atravessa repositórios (token, mensagem, cabeçalho), a evidência é o código do produtor real em produção e do consumidor, nunca a fixture de um teste — fixture descreve o que o teste precisava, não o que a produção emite;
- antes de propor como novo um modelo, vínculo, coluna ou serviço de seleção, `git log -S<Nome>` no(s) repositório(s) tocado(s) pelos símbolos e nomes de tabela centrais (commits que criaram e removeram o conceito, com o motivo da remoção) e localização do dono real do schema (o nome da tabela em todos os repositórios de migration do workspace, não só no repositório de serviço);
- premissa arquitetural central de um módulo ("o core nunca faz X", "a operação é delegada a um componente externo via porta Y") confirma, antes da primeira frase de escopo, que não existe já sob o mesmo nome ou função um serviço de produção fazendo exatamente X, e que não há ADR (mesmo "Proposto") na mesma área de decisão citando um número diferente;
- troca de fonte de verdade de um dado ou vínculo exige inventário em três colunas antes de aprovar — escritores, leitores e efeitos colaterais externos (registro em terceiro, evento, cache) — com a ação de cada um no corte, mais a chave real das linhas (versão vs grupo) e a ordem corte/backfill/rollback; "fonte única" é afirmação sobre todos os consumidores, não sobre quem grava;
- propriedade de conservação (soma das partes = total) só prova algo se existe implementação plausível que a violaria; se o algoritmo calcula o último termo como resíduo, a propriedade é tautológica — acompanhe de uma propriedade companheira (não-negatividade, integralidade na menor unidade, desvio máximo por parcela) e cite o contraexemplo de mutação que ela pega;
- afirmação sobre estado de OUTRO change (mesclado, arquivado, ADR promovida, capability no baseline) é medida contra a ref de integração (`git ls-tree <default_branch>`, `merge-base --is-ancestor`), nunca pelo filesystem da worktree da feature; toda medição inscrita no artefato carrega o commit que a torna reproduzível — nunca o `HEAD` anterior ao commit do change nem uma árvore de trabalho suja;
- fora de escopo explícito.

## 2. Validator (sinal externo — §14.6)

Invoque um subagent **independente** (Agent tool, sem reaproveitar o contexto do builder) com este prompt, substituindo os paths:

> Você é um validator adversarial de requirements. Leia `<change-dir>/proposal.md` e `<change-dir>/<artefato-alvo>` (e `.forge/constitution.md` se existir). NÃO corrija nada — apenas valide e reporte. Critérios: (a) toda mudança declarada na proposal §2 coberta por requisito; (b) cada requisito verificável (critérios de aceite objetivos); (c) sem conflito entre requisitos ou com o fora-de-escopo; (d) ambiguidades reais sinalizadas; (e) estrutura do template respeitada; (f) todo exemplo numérico de critério de aceite foi computado contra a fórmula/regra que ele testa — reporte [CONFLICT] se não fechar. Responda EXATAMENTE neste formato:
>
> ```
> ## Status: PASS | FAIL
> [MISS]     <item da proposal sem requisito — um por linha>
> [CONFLICT] <inconsistência entre artefatos>
> [CLARIFY]  <ambiguidade que exige decisão humana>
> ```
>
> FAIL se houver qualquer [MISS] ou [CONFLICT]. [CLARIFY] sozinho não reprova, mas deve ser listado.

## 3. Loop (máximo 3 iterações)

- `PASS` → vá ao passo 4.
- `FAIL` → corrija **apenas** o que o relatório aponta ([MISS]/[CONFLICT]) e re-valide (nova iteração). `[CLARIFY]` → rode o protocolo do `/forge:clarify` para os itens antes de re-validar.
- Após a **3ª iteração** com FAIL: **pare** (não insista — validadores adversariais geram falsos positivos; o humano decide o que é real). Escalone via gate HITL abaixo apresentando os pontos remanescentes.

## 4. Gate HITL — `requirements_reviewed` (§12.1)

Apresente via `AskUserQuestion` (resumo de 2-3 linhas do estado + nº de iterações; **não** despeje o artefato no chat): **Approve** / **Review (loop de ajuste)** / **Reject** / **Block**. Registre a decisão:

```bash
bash .forge/scripts/approval-log.sh <change-id> --gate requirements_reviewed --decision <decision> [--reason "<motivo>"] --iteration <n> --scope "<artefato-alvo>"
```

Encadeie `approval-log.sh` e `spec-transition.sh` com `&&` (nunca `;`): uma falha segura no primeiro não impede o segundo se não estiverem encadeados, e a transição seguinte não tem como saber que o registro falhou.

- **Approve** → `bash .forge/scripts/spec-transition.sh <change-id> requirements-ready` e reporte o próximo comando (`/forge:design` em scale ≥2; `/forge:tasks` em scale 1; `type: bugfix` scale ≥2 pode ir direto a `/forge:tasks` — design é opcional para esse tipo, sugira `/forge:design` só se a correção tiver decisão arquitetural).
- **Review** → use o motivo como instrução e volte ao passo 1 (conta como nova rodada de loop; registre com `--iteration <n>` e o registro fica no approvals.yaml), sujeito ao teto e à regra de convergência abaixo: no teto, a escalada ao dono é obrigatória.
- **Reject** → registre e pare; sugira `/forge:close --reason rejected` se o change não segue.
- **Block** → registre a causa e pare (`spec-transition.sh <id> blocked --reason "<causa>"`).

### Teto e convergência do Review

Vale para este gate e, por remissão, para `design_reviewed` e `tasks_reviewed`. Existe porque um revisor adversarial sempre acha o próximo caso de borda de um mecanismo que cresce a cada correção: sem teto e sem régua estável, o loop delegado já chegou a 14 rodadas num mesmo gate.

- **Teto.** O gate tem teto de 3 rodadas de Review consecutivas, delegadas ou não (humano decidindo, humano que delegou a decisão a um revisor adversarial, ou `yolo-gate`), o mesmo número do loop builder→validator do §3. Cada Review é registrado com `--iteration <n>`, sendo `n` a posição da rodada na série consecutiva de Review deste gate, e o `approval-log.sh --iteration` recusa `n` acima de 3, de modo que uma quarta rodada não tem como ser registrada como Review. Ao atingir o teto (terceiro Review ainda com pendência), a escalada ao dono é obrigatória: apresente a série (achados de cada rodada e o mecanismo que cada um tocou) e peça a decisão de causa raiz — simplificar o mecanismo, mover a fronteira ou aceitar o risco —, registrada no approvals.yaml com o motivo começando por `escalada-teto:`. O dono decide Approve, Reject, Block ou um Review que abre série nova (`--iteration 1`) com a causa raiz escolhida como instrução; revisor delegado e `yolo-gate` nunca abrem série nova por conta própria.
- **Régua de severidade estável.** A régua de severidade (o que é BLOCKER, o que é MAJOR, o que é nota) é fixada na primeira rodada e repetida literalmente no prompt de cada rodada seguinte, junto com a lista dos achados anteriores e o mecanismo de cada um; uma régua que muda entre rodadas impede até de reconhecer a série.
- **Convergência.** Uma rodada de Review só pode abrir BLOCKER novo se o achado não for consequência direta da correção da rodada anterior no mesmo mecanismo; se for, ele entra como nota no motivo e não reabre o ciclo, e quem decide sobre ele é o dono, no Approve ou na escalada.
- **Causa raiz.** Quando o mesmo mecanismo reaparece pela segunda rodada seguida, o prompt do decisor (revisor delegado ou `yolo-gate`) pede causa raiz em vez de correção pontual: por que o mecanismo gera um caso de borda novo a cada correção, e se a saída é simplificá-lo ou mover a fronteira; a resposta vai no motivo do Review.
- **Reaudição de sugestões adotadas.** A partir da rodada N>1, para cada correção da rodada anterior que o autor adotou, o revisor reaudita a PRÓPRIA sugestão contra as decisões do dono (ledger, ADR) e contra a semântica do dado ou as camadas que o mecanismo atravessa — como se fosse texto do autor, não texto já aprovado. A sugestão adotada do revisor sai do escopo de desconfiança de ambos (o autor confia porque veio do revisor; o revisor confere só se foi incorporada, nunca se estava certa), e esses achados não contam como "consequência direta da correção anterior" para a regra de Convergência, porque o defeito é da sugestão, não do texto.
- **Delegação do gate.** Quando o dono delega a decisão a um revisor específico (fora do `yolo-gate` padrão), registre a delegação em `--reason` ("delegado pelo dono a <agente/modelo>") — `approval-log.sh --autonomous` ainda grava `decided_by` fixo do executor padrão; a delegação explícita no motivo é o que sustenta uma auditoria que filtra por `decided_by`.
- **Insumo de governança.** Quando uma notícia nova mudar o estado de um artefato de governança (ADR aceita, change mesclado, capability arquivada) durante o loop, derive quem promove/consome do campo do próprio artefato (ex.: a seção "Numeração e promoção" da ADR), nunca da proximidade temporal com outro evento; e remeça contra `develop` qualquer frase "medido nesta revisão" sobre o estado alterado — um fato medido cujo objeto mudou de estado é falso até ser medido de novo.

## Regras

- Pré-condição: status `proposed` (ou `requirements-ready` para refinamento — sem nova transição).
- A transição falha se restar `NEEDS CLARIFICATION`? O validador estrutural não checa conteúdo no MVP2 — é SUA responsabilidade não aprovar com pendências abertas.
- Toda decisão que não seja Approve exige motivo (o script recusa sem `--reason`).

## Modo autônomo (--yolo)

Se `autonomy.mode: yolo` (`forge.yaml`) ou `--yolo` na invocação, este gate não para no `AskUserQuestion`: invoque o agent `yolo-gate` (model **opus**, effort **high**) sobre o artefato — ele analisa, decide (approve/review/reject/block) e registra em `approvals.yaml` com `autonomous: true` via `approval-log.sh --autonomous`. `review` autônomo alimenta o loop até 3 iterações e então escala ao humano. Falhas de execução e conflitos de fontes continuam parando (não são gates). Ver `.forge/rules/conventions/autonomy-yolo.md`.
