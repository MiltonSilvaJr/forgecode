---
description: Análise cross-artifact do change ativo (proposal × requirements × design × tasks × constitution/rules) antes de implementar. Obrigatória em scale ≥ 3. Não altera artefatos — produz analysis.md.
argument-hint: "[<change-id>]"
---

# /forge:analyze — análise cross-artifact

Argumentos: `$ARGUMENTS` (change-id opcional; sem argumento, use o único change ativo).

Pré-condição: status `tasks-ready`. Obrigatória em **scale ≥ 3** antes de `/forge:implement`; recomendada em scale 2.

## Protocolo

Leia TODOS os artefatos do change + `.forge/constitution.md` + `.forge/rules/` aplicáveis e cruze:

1. **Cobertura ponta a ponta:** proposal §2 → REQ → design § → TASK. Liste qualquer elo quebrado nas duas direções (mudança sem task; task sem origem). Campo `Teste (comando)`/`Padrão de falha` de cada TASK: confira mecanicamente que o padrão é regex válido com assinatura comportamental aceita pelo classificador de Red, que o comando falha no vermelho e passa no verde, e que o alvo não está em escopo excluído pelo próprio design — "preenchido" não é "executável pelo motor".
2. **Conflitos:** entre artefatos do change; entre o change e constitution/rules; entre tasks (paths que colidem em waves paralelas). **Varredura de normas por superfície (não só pelas citadas):** antes de julgar conflito, varra pela superfície tocada, não pela lista de referências que o próprio artefato cita — (a) ADRs aceitas no tronco que nomeiam a superfície; (b) arquivos de `.forge/rules/**` cujo `applies_to` ou texto nomeia a superfície ou o tipo de artefato criado; (c) ADRs e specs ativas em branches/worktrees de changes com `affected_paths` sobreposto, lidas por `git ls-tree`/`git show <branch>:<path>`, nunca pelo checkout do tronco. Toda norma encontrada e não citada pelo change entra no `analysis.md`: compatível (com motivo) ou conflito (BLOCKER). Ao julgar conflito contra um ADR, busque também ADRs aceitas POSTERIORES sobre o mesmo tema (grep por termos-chave, não só pelo número citado) — um ADR que "detalha" outro raramente é referenciado de volta.
3. **Drift:** afirmações no design que contradizem o repo real (paths/contratos citados existem?); `affected_paths`/`affected_capabilities` do manifest coerentes com as tasks.
   - Precedente citado como justificativa ("mesma disciplina de X") é afirmação verificável: abra X e confirme que faz o que o artefato diz.
   - Afirmação de AUSÊNCIA ("não existe X", "zero ocorrências") nunca é aceita em prosa: exija o comando e o caminho da busca, e decomponha por camada em que X poderia existir (persistência, domínio, aplicação, contrato, cliente) — uma contagem única na raiz soma camadas com donos distintos e esconde qual delas está vazia.
   - Comportamento derivado de uma chave de configuração exige o PONTO DE CONSUMO citado (arquivo:linha onde o valor é lido e age), não só onde é declarado — configuração é intenção, não comportamento.
   - Alegação de retrocompatibilidade por "nenhum leitor recalcula/depende de X" é afirmação sobre TODOS os call sites de um padrão: sustente com `grep -arn` do símbolo/padrão na árvore inteira, nunca com a lista de pontos que o autor já conhecia.
   - Contrato já entregue por task `[X]` de onda anterior: cruze por script as RPCs/campos do contrato com as operações que as tasks consumidoras prometem (rotas, telas, casos de uso); "o arquivo existe" não é "está aderente".
   - Afirmação de fiação ("o mecanismo M é lido em P", "o gate humano G apresenta o campo") só é aceita com o trecho literal de P que de fato lê — grep no arquivo RECEPTOR, nunca no do autor; comando de diff/busca prescrito literalmente é exercitado no caso degenerado (ref ausente, lista vazia) antes de aceito, porque substituição vazia não falha — muda o significado do comando.
   - Antes de aceitar a premissa arquitetural central de um módulo novo ("o core nunca faz X", "delega a Y"), confirme que não existe já, sob nome ou função igual, um serviço de produção que faz X — spec greenfield sobre serviço brownfield real produz divergências em cascata que uma leitura do repositório evitaria; quando o change cria entidade/coluna/vínculo, um pickaxe (`git log -S<nome> --oneline`) no histórico do repositório tocado pega reintroduções de algo removido sem registrar o motivo.
   - Toda asserção prescrita (design/tasks) que nomeia um artefato como alvo de prova é aprovável só junto do comando que mostra o artefato alcançável e da saída desse comando — não "o artefato existe" em prosa. E todo passo de prova prescrito declara o CONTROLE NEGATIVO (a variação de uma única entrada — chave errada, credencial ausente, dado de antes — e a falha esperada): raciocínio mecânico plausível ("se decripta, falha com a chave errada") é exatamente o que sobrevive à revisão de texto sem a execução do controle.
   - Qualquer artefato do change com marcador de template intocado (`REQ-XXX`, `SCN-XXX`, `<capability-kebab>`, `<title>`, `TODO-TEMPLATE`) é achado **BLOCKER** — "cobertura ponta a ponta" declarada sobre um esqueleto não vale.
4. **Fases puladas:** se o scale exige fase ausente, confira `quick_plan` (enabled + justificativa) — ausente → achado bloqueante.
5. **Riscos operacionais:** tasks sem critério de verificação; dependências externas sem fallback; ausência de tasks de teste para REQs críticos.
   - Cláusula nova idêntica aplicada pelo gerador a várias tasks: se o escopo real é de serviço/plataforma (não de feature) ou se repete no mesmo serviço, recomende task própria por serviço precedendo as de feature — presença de texto em N tasks não prova que alguma consiga executá-la.
   - Todo passo de ferramenta do forge prescrito numa task (red record/replay, spec-transition, verify, gates) tem a pré-condição do MOTOR conferida (não só a doc do comando) contra o estado em que a task o roda.
   - Propriedade de conservação (soma = total) sem prova de poder discriminante: exija citar a mutação plausível que a deixaria vermelha — comum quando o último termo é calculado como resíduo. Mudança de regra de arredondamento/rateio: liste os tetos/limites que comparam o valor arredondado e teste o valor exato na fronteira com a regra nova — decisões corretas isoladamente podem colidir onde a configuração encosta no teto.
   - Controle que distingue humano de agente (ancestralidade de processo, variável de ambiente, TTY) precisa dizer, já no design, como o caminho permitido é exercitado pelos próprios gates que rodam como agente — sem isso, o caminho positivo é inteiro intestável por quem implementa e verifica.
6. **Cobertura de superfície (gate pré-marco):** o cruzamento entre a tabela "Checklist de cobertura de superfície" do `requirements.md` e o grafo de tasks é feito por **script** — `SRF-01`, em `lib/tasks-graph.mjs`, executado pelo `validate-spec` desde a transição a `tasks-ready`. Rode `bash .forge/scripts/validate-spec.sh <change-id>` e trate cada `WARN (SRF-01 …)` como achado de tipo `coverage`: REQ que declara endpoint/rota e cujas tasks, como declaradas, não produzem superfície nenhuma. **Não refaça esse cruzamento a olho** — ele deixou passar, num plano de 89 tasks, uma rota que o contrato promete e nenhuma task implementa. O que continua sendo seu aqui: linha `NEEDS CLARIFICATION` na tabela (achado **BLOCKER** de tipo `coverage`), e superfície não-HTTP (tela, CLI, variável de ambiente), que o `SRF-01` deliberadamente não julga.

## Saída

Grave `analysis.md` no change com:

```
# Analysis — <change-id>
## Status: PASS | FAIL
## Achados
| ID | Severidade (BLOCKER/HIGH/MEDIUM) | Tipo (coverage/conflict/drift/risk) | Onde | Recomendação |
## Pendências operacionais (não bloqueiam o artefato)
- <pendência> — destino: ledger (`/forge:ledger`) ou handoff (`/forge:handoff`)
## Síntese (2-3 linhas)
## Revisão
Revisor: <subagente> (<modelo>) | Transcrito por: <sessão orquestradora>
```

**Quem julga e quem grava.** Quando a análise deste comando é delegada a um subagente revisor sem permissão de escrita (ex.: `general-purpose` ou `code-reviewer` invocado só para julgar), esse subagente **nunca** tenta escrever `analysis.md` diretamente — a escrita é recusada pelo harness e força uma transcrição manual sem regra, o que já reescreveu o prompt de delegação quatro vezes seguidas numa mesma sessão. Em vez disso: o revisor delegado devolve a tabela de achados e a síntese como **texto** na resposta (exatamente no formato acima), e é a **sessão orquestradora** — nunca o subagente — quem grava `analysis.md` no change, transcrevendo esse texto sem reinterpretar os achados. O arquivo registra os dois lados na linha `## Revisão`: **quem revisou** (nome do subagente e modelo usado no julgamento) e **quem transcreveu** (a sessão orquestradora, que grava o arquivo). Alternativa descartada: dar permissão de escrita ao subagente revisor — isso junta julgamento e gravação no mesmo agente e elimina a checagem de que quem grava leu o que foi julgado.

No chat: apenas o Status + contagem por severidade + próxima ação (BLOCKER → resolver antes de `/forge:implement`; sem BLOCKER → `/forge:implement` liberado). Não despeje a tabela no chat (§17.6).

## Conflito é bloqueante (guardrail G1 — `conflict-handling.md`)

Todo achado de tipo `conflict` que seja **arquitetural relevante** (isolamento de dados, segurança/auth, contrato de API/evento, modelo de domínio, persistência) é **BLOCKER** — não HIGH, não "registrar e seguir". Inclui:

- **rule ↔ ADR:** uma rule contradiz um ADR aceito → BLOCKER; resolva pela precedência (FORGE.md §2.1: ADR vence; a rule é drift).
- **módulo ↔ módulo:** dois módulos decidem a mesma questão transversal de forma divergente → BLOCKER (decisão transversal tem dono único).
- **change ↔ baseline/constitution:** → BLOCKER.

**Efeito determinista:** enquanto `analysis.md` tiver um BLOCKER (ou `Status: FAIL`), `spec-transition.sh` **recusa** a transição para `implementing` — `/forge:implement` fica travado. Para destravar: resolva o conflito (aplicar a fonte de maior autoridade, ou abrir/atualizar ADR via `/forge:adr`, escalando no HITL) e **re-rode `/forge:analyze`** para regenerar um `analysis.md` limpo.

**Checagem determinista de governança de dados (G4):** rode também

```bash
bash .forge/scripts/check-data-governance.sh <change-id>
```

Ele flagra divergências literais vs a matriz transversal (`.forge/rules/data/data-governance.md`) — ex.: um módulo declarando "RLS opcional"/"sem RLS" para tabela multi-tenant de domínio, ou cache sem namespace de tenant. Qualquer `CONFLICT` retornado é um achado **BLOCKER** de tipo `conflict` no `analysis.md` (decisão transversal tem dono único — `conflict-handling.md` G4).

**Checagem determinista de frescor do grafo/impacto (guardrail G5 — `lsp-impact-analysis.md`):** quando o change toca código (`affected_paths` não vazio) e há grafo construído, rode

```bash
node .forge/scripts/lib/impact-freshness.mjs .forge/specs/active/<change-id> .
```

Mesma fórmula de fingerprint usada pelo pré-flight do `/forge:archive` (`impact-freshness.mjs`) — um só ponto de verdade para "o `impact.json` corresponde ao grafo atual?". `missing` ou `stale` é achado **BLOCKER** de tipo `risk`: "impact.json ausente/desatualizado — rode `/forge:update` e depois `/forge:impact --change <id>` antes de `/forge:implement`". `not-applicable` (sem grafo, ou change sem `affected_paths`) não gera achado. Desde LDG-0036, isto **não depende mais do agente lembrar**: `spec-transition.sh` já chama `impact-freshness.mjs` diretamente na transição para `implementing` e recusa `missing`/`stale` por conta própria — o mesmo mecanismo determinista de G1, um nível abaixo. A checagem aqui em `/forge:analyze` continua valendo por rodar MAIS CEDO no ciclo (item 4 do protocolo, antes de tasks/implement) e por produzir o achado registrado em `analysis.md`, mas o bloqueio real já não depende de ninguém rodar este comando manualmente.

## Regras

- **Não corrija nada** neste comando — achados são insumo; correções acontecem nos comandos de fase (ou via Review no gate correspondente).
- Sem transição de estado (analyze é checkpoint, não fase).
- Conflito relevante **nunca** é rebaixado para HIGH para "destravar" — isso é o anti-padrão que originou o guardrail.
- **Defeito de artefato × pendência operacional.** Todo achado é classificado como defeito de artefato (algo errado em proposal, requirements, design ou tasks, que entra na tabela de Achados com severidade) ou pendência operacional (estado de execução fora do artefato: recibo de outra sessão, ledger ainda não levado ao tronco, merge ou push pendente, ambiente indisponível); a pendência operacional não bloqueia o artefato, nunca recebe severidade e vai para a seção `## Pendências operacionais` com destino ledger ou handoff.
- **Régua de severidade estável.** A régua de severidade (o critério de BLOCKER, HIGH e MEDIUM) é fixada na primeira rodada de analyze do change e não muda entre rodadas: o prompt de cada rodada seguinte, inclusive a delegada a um revisor, repete a régua da primeira e a lista dos achados anteriores com o mecanismo de cada um.
- **Teto e convergência entre rodadas** (mesma regra do `/forge:requirements` §4, Teto e convergência do Review). Teto de 3 rodadas de analyze consecutivas com BLOCKER no mesmo change, delegadas ou não; ao atingir, escala ao dono a decisão de causa raiz (simplificar o mecanismo ou mover a fronteira) em vez de rodar a quarta.
- **Convergência.** Uma rodada só abre BLOCKER novo se o achado não for consequência direta da correção da rodada anterior no mesmo mecanismo; se for, ele entra como nota na Síntese e não reabre o ciclo, e quando o mesmo mecanismo reaparece pela segunda rodada o prompt do revisor pede causa raiz em vez de correção pontual. Exceção: conflito arquitetural relevante (G1) e achado das checagens deterministas (`SRF-01`, G4, G5) nunca viram nota — continuam BLOCKER, e a série vai direto ao dono como decisão de causa raiz.
- **Gate de marco:** nenhum módulo/change é declarado concluído (marco) sem um `/forge:analyze`
  **verde** (Status: PASS, sem BLOCKER) cruzando requirements×design×tasks — incluindo a
  cobertura de superfície do item 6. "Concluído" dito em chat sem esse `analysis.md` limpo não
  vale; re-rode `/forge:analyze` após qualquer correção antes de fechar o marco.

## Procedência da medição

Toda medição citada no `analysis.md` carrega o commit que a torna reproduzível — nunca o `HEAD` de antes do commit do change, nem uma árvore de trabalho suja. Sobre trabalho ainda não commitado, o carimbo diz isso literalmente ("árvore de trabalho não commitada, em <data>") em vez de emprestar um SHA que não contém o medido. Antes de tratar um achado de rodada anterior como aberto, reexecute o comando contra o estado commitado atual e carimbe o veredito — resolvido, agravado ou intocado: um achado sobre moldura (manifest, metadados, caminhos declarados) é exatamente o tipo que o commit seguinte fecha sem que nada registre.

## Regras adicionais de instrumento e correção

- **Contagem de achados por instrumento ancorado.** A contagem de achados por severidade usa um padrão ancorado na LINHA DE DEFINIÇÃO da tabela (`^\| AN-NN \|`), nunca o prefixo solto — citações em prosa (ex.: "o resíduo está em AN2-10") inflam a contagem por grep simples. Quando o WARN de um check determinista (ex.: SRF-02 "esqueleto") contradiz uma contagem independente feita a olho na tabela, o defeito é do instrumento, não do artefato — reconte por caminho substituto (cópia normalizada + controle negativo) e registre, nunca dispense a checagem.
- **Histórico, não reescrita, para achado bloqueante resolvido.** Ao re-rodar `/forge:analyze` depois de corrigir um BLOCKER: commite a passada que achou o BLOCKER antes de corrigir; na nova passada, mova o achado corrigido para uma seção `## Achados resolvidos` (fora da tabela, sem severidade em célula) citando o comando que reconfere e o SHA da correção. Apagar a linha reescreve a análise como se o bloqueio nunca tivesse existido; mantê-la com severidade trava o gate para sempre.
- **Correção herda duas obrigações da análise que a propôs.** (1) Toda premissa factual da recomendação sobre artefato já entregue é remedida com o comando antes de virar texto normativo de task/design — a coluna "evidência" mede o que falta, não o que a recomendação presume existir; sem essa remedição o achado é "premissa não verificada", não correção aplicável. (2) Toda correção que mexe em partida/readiness/crash/negação global declara o raio (quais planos/rotas/consumidores compartilham o mecanismo e se o defeito existe em cada um) — fail-closed no MENOR escopo que fecha o defeito, nunca no raio do revisor sem justificativa própria.
- **Validador gated por status, numa cópia com status avançado.** Quando o change ainda não alcançou o estado que liga um check (`reached('tasks-ready')` etc.), um EXIT=0 do validador é vazio, não prova nada; valide copiando o diretório do change para FORA do repositório real (clone/worktree descartável — nunca com `FORGE_ROOT` apontando para o repo real, porque alguns subcomandos resolvem o alvo pelo id e mutam o change de verdade mesmo com `--path` de cópia) com o `status` avançado por estado-alvo.
- **Número delegado em artefato durável é reproduzido, não repassado.** Contagem/medição que um subagente devolve e que vai virar comentário de código, texto de artefato de spec ou mensagem de commit é reproduzida pelo orquestrador com o comando antes de ser escrita; número que só orienta a decisão do momento pode ficar como veio. Pela mesma razão, afirmação de ausência de um subagente ("só um arquivo cita X", "nenhum outro...") é rederivada com um comando que enumera o universo pela fonte, nunca aceita pela busca que o agente descreveu.
- **Correção a jusante que edita artefato a montante reabre o gate a montante.** Quando resolver um achado do `analyze`/`tasks` exige editar design/requirements já aprovado, isso não é um ajuste local: liste os achados que o gate a montante tinha fechado sobre aquela seção e reexecute o cenário de cada um contra a regra nova; nunca reescreva a justificativa de um achado antigo para caber na solução nova — só acrescente. Registre a edição como nova iteração do gate a montante.
