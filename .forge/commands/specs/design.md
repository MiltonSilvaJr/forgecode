---
description: Gera/refina o design técnico do change ativo com loop builder→validator (máx. 3 iterações) e gate HITL. Transiciona para design-ready. Fase obrigatória em scale ≥ 2.
argument-hint: "[<change-id>]"
---

# /forge:design — design do change com loop builder→validator

Argumentos: `$ARGUMENTS` (change-id opcional; sem argumento, use o único change ativo).

Pré-condições: status `requirements-ready` (scale ≥2). Scale 0/1 dispensam esta fase — informe e sugira `/forge:tasks` (forçar design em scale baixo é permitido sem transição extra). Tipo `bugfix` scale ≥2 pula esta fase automaticamente (root cause vive no `bugfix.md`) e pode ir direto a `/forge:tasks`; `design-ready` continua disponível como opção quando a correção tem decisão arquitetural — crie `design.md` normalmente e siga o fluxo de baixo. Para os demais tipos, pular design em scale ≥2 declarando `quick_plan.enabled: true` com `design` em `skipped_phases` (e `justification` de 8+ caracteres) no manifest **também dispensa esta fase** (LDG-0172, gate w205): o guard de `design.md` do validador honra a dispensa a partir de `tasks-ready`, e `spec-transition.sh` autoriza a rota lateral `requirements-ready → tasks-ready` pelo mesmo idioma já usado para `story-sharding`. É afrouxamento declarado, não ausência de contenção — a `justification` exigida, a fase pulada sem ela virando achado bloqueante em `/forge:analyze`, e o gate HITL `design_reviewed` seguem valendo.

## 1. Builder

Preencha/refine `design.md` (estrutura do template do change) a partir de `proposal.md` + artefato de requirements + rules do projeto (`.forge/rules/`, `.forge/context.md`):

- decisão técnica em termos de componentes/fluxos/contratos; alternativas consideradas com trade-offs;
- contratos e integrações afetados com estratégia de compatibilidade;
- plano de migração/rollout; riscos com detecção;
- rastreabilidade: todo `REQ-NN` mapeado para a seção do design que o atende; preenchimento do `spec-delta.yaml` (um `add_requirement`/`modify_requirement` por REQ, com cenários) entra na definição de pronto — validador verde sobre o template intocado (`REQ-XXX-001`, `<capability-kebab>`) não prova cobertura;
- varredura de normas vigentes pela superfície tocada, não pelas referências lembradas: ADRs aceitas no tronco citando a superfície/serviço, `.forge/rules/**` cujo `applies_to` nomeia o tipo de artefato criado, e ADRs/specs aceitas em branches e worktrees ativas com `affected_paths` sobreposto (via `git show <branch>:<path>`, nunca checkout) — cada norma não citada vira linha no design: compatível com motivo, ou `[CONFLICT]`;
- reserva de identificador novo (migration, código, chave) por universo com controle positivo em cada um — `git log --all -S<id>` como universo primário (mais rápido que `git grep` por ponta e cobre o mesmo), mais arquivos modificados/não rastreados de cada worktree, mais registros de coordenação (canal, ledger, reservas de branch); universo que devolve zero no próprio controle reprova a varredura, não confirma identificador livre;
- nome de tipo/arquivo novo roda contra os validadores de nomenclatura do repositório (ganchos pre-commit) antes de fixado — nome recusado troca no próprio design;
- `DD-NNN` é identificador de escopo do change que o define; toda citação fora dele (tasks, analyze, handoff) qualifica com o change/módulo — resolva primeiro no design do próprio change, nunca pelo registro global, que devolve homônimos de outros changes;
- ausência de um símbolo de domínio não é uma grandeza única: decomponha por camada em que poderia aparecer (persistência, agregado/domínio, aplicação, contrato/rota) antes de concluir bloqueio;
- afirmação de comportamento derivada de configuração cita o ponto de consumo (arquivo:linha onde o valor é lido), não só onde é declarado — valor em defaults.yaml é intenção, não comportamento, até o grep mostrar quem lê; endpoint/parâmetro de produto de terceiro adotado como mecanismo tem a documentação primária citada, com nível de licença/edição e escopo (global/deployment/objeto) conferidos — recurso de edição paga num projeto em edição gratuita é `[CONFLICT]`;
- quando um identificador muda de origem, formato ou dono, leia o CONSUMIDOR que o resolve (o que ele faz com valor desconhecido — falha, degrada ou fabrica), não só o contrato; fallbacks "resolve-or-enroll"/"get-or-create"/"synthetic for local" são o sinal;
- serviço gerenciado novo (especialmente ao corrigir achado): grep na memória/ledger do projeto pelo nome e busca explícita por aviso de disponibilidade/EOL, além da capacidade técnica; ao instruir sincronizar um espelho de comando/plugin, nomeie o comando do destino certo — um script cujo destino padrão é estado global do usuário não documenta bem sozinho;
- dispensa de exigência de rule obrigatória nunca se apoia em "não verificado" — vira pergunta ou exceção formal registrada; precedente de outro change citado como viabilidade vale pelo mecanismo (exportador, credencial, protocolo), não pelo resultado alcançado;
- dependência entre changes declarada só pelos artefatos consumidos esquece o estado compartilhado que qualquer apply toca: para toda task que escreve em state remoto, release Helm ou banco compartilhado, pergunte se a árvore desta branch declara tudo que está vivo nesse estado — se não, a task herda hard-stop do merge pendente;
- toda prova vermelha/verde de um critério de aceite é executada no momento da escrita, com a saída real anotada: a vermelha descreve o presente, a verde precisa ser alcançável pelo próprio change (diff contra o tronco num caminho que o change altera nunca fica vazio); registro em arquivo com schema (`approvals.yaml`, manifest) nomeia a forma que o validador aceita; toda asserção que nomeia um artefato-alvo (migração anterior, baseline, ref) só é aprovável junto do comando que mostra o artefato alcançável, com a saída; todo passo de prova prescrito declara o controle negativo — a entrada errada e a falha esperada — executado ou com lugar executável no plano; exemplo numérico nomeado como regressão de "A em vez de B" é calculado sob os dois algoritmos, não só sob o escolhido;
- premissa arquitetural central ("o core nunca faz X", "delega via porta Y") confirma, antes da primeira frase de escopo, que não existe já sob o mesmo nome um serviço de produção fazendo o oposto, e que não há ADR (mesmo Proposto) na mesma área de decisão citando outro número;
- risco registrado como condicionado a "nenhum produtor hoje" enumera TODAS as transições para o estado (jobs, consumers, reconciliação), não só os fluxos de comando em discussão; controle de detecção (drift, auditoria) declara, por onda anterior do mesmo change, onde o valor efetivo mora e se a camada observada ainda é autoritativa naquele ponto;
- controle que distingue sessão humana de sessão de agente (ancestralidade, env var, TTY) declara como o caminho permitido é exercitado pelos próprios gates que rodam como agente;
- "substituído por"/"reescrito"/"não portado" exige tabela ramo antigo → mecanismo novo → cobertura → diferença, com os consumidores do comportamento antigo (constraint, SQLSTATE, mensagem) conferidos no código; correção de ordem de lock inventaria todos os pontos que travam as mesmas linhas na mesma transação (SQL da aplicação, triggers, funções) e testa pelo caminho real com controle negativo — um serializador por linha-pai só cobre os pares que passam por ele, então linhas globais/compartilhadas e instruções multi-tabela pedem ordem própria conferida por corrida;
- privilégio por coluna (GRANT) exige tabela "caminho de escrita × colunas × está no GRANT?" derivada do texto inteiro (rotas, jobs, edge cases, migrations futuras) e sonda executável; troca de acesso direto por função com REVOKE exige inventário por PONTO DE ACESSO, não por tabela (método atual, chamadores em develop e em PRs abertos dependentes, colunas lidas/escritas, incluindo APIs de framework); correção por ponto de extensão de framework cita a linha do framework que mostra como ele é resolvido (DI, cast, factory) e o grep dos registros existentes antes de propor um novo;
- residual que cita controle compensatório traz evidência medida de que está ativo para aquele componente específico, a frase "detecta/impede o cenário porque..." testada contra o atacante já dentro do processo legítimo, e inventário por código de tudo que o segredo protege; status "fechado" só com mecanismo existente, nunca especificado;
- afirmação de fiação ("X é lido em Y", "o gate humano lê o campo aqui") só é aprovável com a citação literal do trecho de Y que faz a leitura, ou a TASK que o acrescenta; comando de diff/varredura prescrito é exercitado no caso degenerado (ref ausente, lista vazia) antes de aceitar — substituição vazia não falha, muda o significado em silêncio;
- caminho de inclusão configurável num sistema com exclusões "por construção" confronta o conjunto aceito, nas formas degeneradas, com cada exclusão existente; confinamento de caminho usa `relative()`/raiz+separador, nunca `startsWith` de string crua; correção que substitui uma camada de validação inteira é aditiva por padrão (defesa em profundidade) — substituição exige tabela "regra antiga → onde passa a viver" cruzada contra os critérios de aceite rastreados;
- correção de revisor tem o raio do defeito, não maior: nomeie quais planos/rotas/consumidores compartilham o mecanismo afetado e se o defeito existe em cada um; a metade de raio maior só entra com justificativa própria;
- toda afirmação sobre estado de OUTRO change (mesclado, arquivado, ADR promovida) é medida contra a ref de integração (`git ls-tree <default_branch>`, `merge-base --is-ancestor`), nunca pelo filesystem da worktree da feature; todo path citado é conferido contra `origin` (`git fetch` + `cat-file -e origin/<branch>:<path>`), nunca pelo checkout local; medição inscrita no design carrega o commit que a torna reproduzível — nunca o `HEAD` anterior ao commit do change nem árvore suja;
- número vindo de subagente delegado que vai para o design (comentário, valor citado) é reproduzido pelo orquestrador antes de ser escrito, ou registrado com procedência explícita ("medido por agente delegado, não reconferido");
- opção recomendada: `git grep` o mecanismo em `.forge/specs/archived/**` e `.forge/product/current/capabilities/**` antes de propor como nova — se há rejeição anterior ou cenário normativo contrário, citar arquivo/linha, a premissa que caiu e o delta de capability ou ADR que supersede;
- o artefato de cada rodada é autocontido — nunca referencie "inalterado da rodada N" ou "herdado da rodada N"; a pasta do change precisa estar versionada (git) antes da primeira rodada de revisão: reescrita inteira a cada rodada apaga silenciosamente o que a anterior tinha, e revisão incremental (que lê só o que mudou) é estruturalmente cega a essa perda;
- decisão durável/transversal → sugerir ADR (`/forge:new-adr`) e referenciar — não duplicar.

## 1a. Propagação de correções

Quando um achado de `design_reviewed` corrige uma decisão (`DD-NN`) já escrita, a correção só está concluída quando:

- `requirements.md` e `tasks.md` do mesmo change, e `epic_context.md`/`stories/STORY-*.md` quando existirem, deixam de citar o valor antigo (`grep -arn` pelo `DD-NN` e pelos termos técnicos trocados) — a correção é medida pela ausência do valor antigo em toda a spec ativa, não pela presença do novo só no artefato editado primeiro;
- toda frase nova do tipo "feito na TASK-NN" ou "o artefato X passa a conter Y" vem acompanhada da edição correspondente em X na mesma rodada; trocar um componente compartilhado (imagem, biblioteca, credencial) reabre a verificação de cada consumidor, não só da que motivou a troca;
- editar um artefato já aprovado por um gate anterior para corrigir um achado a jusante reabre a obrigação de reconferir o que aquele gate tinha fechado: liste os achados fechados sobre a mesma seção e reexecute o cenário de cada um contra a regra nova — nunca reescreva a descrição de um achado anterior, só acrescente;
- edição em lote entre rodadas (script de substituição) carrega asserção de preservação — contar os trechos obrigatórios que a edição não pretende mudar antes e depois — além da asserção de aplicação; o recorte de uma remoção pedida por decisão vai até o fim da cláusula citada, nunca até o fim da célula/linha, e o texto efetivamente removido é comparado ao texto mandado remover;
- duplicar uma política de gate para um alvo novo (em vez de estender a existente) exige teste de paridade com o MESMO insumo nos dois caminhos, comparando os vereditos — é o único teste que falha quando uma cláusula defensiva não atravessa.

## 2. Validator (sinal externo — §14.6)

Invoque um subagent **independente** (Agent tool) com este prompt, substituindo os paths:

> Você é um validator adversarial de design técnico. Leia `<change-dir>/proposal.md`, `<change-dir>/<artefato-de-requirements>` e `<change-dir>/design.md` (e `.forge/rules/architecture/` se existir). NÃO corrija — valide e reporte. Critérios: (a) todo REQ coberto na tabela de rastreabilidade por seção real do design; (b) decisão técnica não contradiz requirements nem rules do projeto; (c) contratos afetados têm estratégia de compatibilidade; (d) riscos têm detecção/mitigação; (e) alternativas registradas (não só a escolhida); (f) todo exemplo numérico de critério de aceite foi computado contra a fórmula/regra que ele testa — reporte [CONFLICT] se não fechar. Responda EXATAMENTE no formato:
>
> ```
> ## Status: PASS | FAIL
> [MISS]     <REQ/aspecto sem cobertura no design>
> [CONFLICT] <contradição com requirements/rules/contratos>
> [CLARIFY]  <decisão em aberto que exige humano>
> ```
>
> FAIL se houver qualquer [MISS] ou [CONFLICT].

## 3. Loop (máximo 3 iterações)

Igual ao `/forge:requirements`: corrigir só o apontado; `[CLARIFY]` → protocolo do `/forge:clarify`; FAIL na 3ª iteração → escalonar no gate HITL com os pontos remanescentes.

**Emenda de requisito já aprovado.** Quando o design expuser uma contradição num requisito já fechado em `requirements_reviewed` (fórmula × exemplo de aceite, mecanismo citado por nome que a medição não alcança), registre a emenda no texto do requisito com data e motivo, liste-a no prompt deste gate como ratificação obrigatória, e registre no `approvals.yaml` do gate de requirements o motivo de ratificação — uma emenda sem esse registro é improviso, mesmo quando funciona.

## 4. Gate HITL — `design_reviewed` (§12.1)

`AskUserQuestion` (resumo 2-3 linhas + iterações): **Approve** / **Review** / **Reject** / **Block**.

```bash
bash .forge/scripts/approval-log.sh <change-id> --gate design_reviewed --decision <decision> [--reason "<motivo>"] --iteration <n> --scope "design.md"
```

Encadeie `approval-log.sh` e `spec-transition.sh` com `&&` (nunca `;`): uma falha segura no primeiro não impede o segundo se não estiverem encadeados, e a transição seguinte não tem como saber que o registro falhou.

- **Approve** → `bash .forge/scripts/spec-transition.sh <change-id> design-ready`; próximo: `/forge:tasks`.
- **Review** → motivo vira instrução; volte ao passo 1 (registre com `--iteration <n>`), sujeito ao mesmo teto de 3 rodadas, à régua de severidade estável e à regra de convergência do `/forge:requirements` (§4, Teto e convergência do Review): no teto, a escalada ao dono é obrigatória.
- **Reject**/**Block** → registre e pare (close/blocked conforme o caso).

## Modo autônomo (--yolo)

Se `autonomy.mode: yolo` (`forge.yaml`) ou `--yolo` na invocação, este gate não para no `AskUserQuestion`: invoque o agent `yolo-gate` (model **opus**, effort **high**) sobre o artefato — ele analisa, decide (approve/review/reject/block) e registra em `approvals.yaml` com `autonomous: true` via `approval-log.sh --autonomous`. `review` autônomo alimenta o loop até 3 iterações e então escala ao humano. Falhas de execução e conflitos de fontes continuam parando (não são gates). Ver `.forge/rules/conventions/autonomy-yolo.md`.
