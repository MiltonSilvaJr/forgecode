---
title: Red-first em correção de defeito
applies_to:
  - all
priority: high
last_reviewed: 2026-07-28
based_on: []
---

# Red-first em correção de defeito

O ciclo é o mesmo do desenvolvimento de feature — Red, Green, Refactor — mas a consequência de pular o Red é outra. Em código novo, escrever o teste depois custa design pior: a API não foi pressionada por nenhum consumidor antes de existir. Em correção de defeito, custa algo mais grave — a garantia de que o teste testa o que se pensa que ele testa. Um teste de regressão que nunca foi visto vermelho pode estar passando pelo motivo errado: mock complacente, asserção fraca demais para distinguir o certo do errado, ou um caminho de código que simplesmente não é o do defeito. O teste entra na suíte, fica verde para sempre, e a regressão que ele deveria guardar volta sem que ninguém perceba.

## Escopo

Esta política se aplica a todo change em que `isDefectFixing(manifest)` é verdadeiro (`lib/defect-scope.mjs`): `type: bugfix`, **ou** qualquer outro `type` que declare `fixes_defects` — uma lista não vazia de ids de defeito no `manifest.yaml` — sem precisar recategorizar o change. `type: bugfix` sozinho já basta, como sempre; `fixes_defects` existe para o change que corrige um defeito real sem que o resto do trabalho seja de correção (um `type: feature` que, de passagem, fecha um bug relatado, por exemplo) — antes deste campo, esse change ficava inteiramente fora da política: a escrita da evidência recusava e a leitura respondia "n/a" com rc 0, mesmo quando o corpo do change descrevia um defeito corrigido. Quando `fixes_defects` declara mais de um id, a política cobra uma entrada de `entries[]` **resolvida** (`observed`|`waived`) por id declarado — um change com `fixes_defects: [D1, D2]` e evidência só para D1 continua reprovando, nomeando D2 como o id que falta.

## Itens normativos

1. **O Red vem antes da correção e reproduz o defeito relatado — não uma aproximação dele.** O teste falha por comportamento: valor errado, exceção indevida, efeito colateral ausente. Nunca por erro de compilação, import quebrado ou fixture inexistente. Falha de build na árvore pré-correção não é Red; é ruído disfarçado de evidência, e passa a mesma sensação de rigor sem nenhuma das garantias.

2. **O teste é escrito no nível em que o defeito se manifesta.** Se o defeito atravessa camadas, serviços ou bounded contexts, o teste atravessa também. Cobrir apenas a unidade corrigida prova que a unidade mudou de comportamento — não prova que o defeito sumiu do caminho onde o usuário o encontrou.

3. **O Red precisa ser observado, não presumido.** Rode o teste na árvore pré-correção, veja-o falhar e confira que a mensagem de falha corresponde ao defeito descrito. Suíte verde em cada componente isolado não é evidência sobre a cadeia que os liga — e é exatamente na cadeia que defeitos de integração se escondem.

4. **O teste permanece na suíte depois do Green**, nomeado de forma que o próximo leitor entenda qual defeito ele guarda. Um teste de regressão anônimo é candidato natural a ser apagado no próximo refactor por parecer redundante.

5. **Uma âncora que não falha na base é defeito do TESTE, não do código sob correção — o teste afirma o CAMINHO que reproduz o defeito, não só o resultado observado ao final** (issue #150). `failure_pattern` nulo, vazio ou genérico demais casa com qualquer falha adjacente na base — inclusive uma que nada tem a ver com o defeito relatado — e a mesma sensação de rigor do item 1 (Red observado) se sustenta sobre uma âncora que não amarra nada. `/forge:red replay` recusa `failure_pattern` ausente com `not-possible`, e o `positive_control` opcional (§ Verificação) prova, na mesma corrida, que a base seria capaz de ficar verde antes de aceitar a falha do comando declarado como prova do defeito.

## Verificação

O item 3 não é auto-declarado — e a evidência que o registra também não é a prova. `/forge:red record` grava `evidence/red/*.json` no change: qual teste (`test_path`/`test_id`, ambos obrigatórios), com qual comando, qual padrão de falha se espera, quais arquivos a correção toca. Isso é uma **declaração de intenção verificável**, não uma observação — todo campo ali é escrito por quem está sendo verificado, então nenhum campo do artefato (incluindo metadados como `replayed_at`/`replay_head`) decide, por si, se o Red foi observado de fato.

Quem decide é a **execução**. `bash .forge/scripts/red-evidence.sh replay <change-id>` reconstrói a árvore pré-correção, roda aquele teste e exige o resultado declarado — falha na base, classificada como comportamental e casando com o padrão registrado, além de passagem em HEAD. Exceção não tratada no setup da fixture (ex.: `IAsyncLifetime.InitializeAsync` do xUnit lançando porque a imagem de Testcontainers não pode ser puxada) não é asserção e tem classe própria, `setup-exception` (issue #191): conta como Red **somente** quando `failure_pattern` está declarado e casa com a saída — sem essa âncora, uma exceção de ambiente (Docker parado, porta ocupada, credencial ausente) passaria por defeito reproduzido. `/forge:verify` e a transição para `verified` chamam `red-evidence.sh ensure <change-id>` **sempre**, para todo change sujeito à política (§ Escopo), incondicionalmente, sem atalho algum — nenhum cache local, nenhuma leitura de campo do artefato decide se a execução acontece: ela acontece, ponto, toda vez que um desses dois gates precisa decidir. `ensure` reexecuta o motor de replay e sobrescreve o artefato com o resultado real antes de qualquer decisão de bloqueio ser tomada — mesmo quando o artefato já dizia `status: observed` por uma edição manual. Isso tem custo real (o teste declarado roda de novo a cada `/forge:verify` e a cada transição para `verified`) — aceito deliberadamente: duas tentativas anteriores de evitar esse custo com um atalho local (ver ADR 0003) criaram problemas próprios sem fechar a lacuna de fato.

`bash .forge/scripts/check-red-first.sh check` **sozinho** — o caminho usado por `pre-push` e por `doctor`, que precisam ser rápidos e não podem pagar o custo de um replay a cada invocação — não chama `ensure`. Ele confere só o que é estático: completude da declaração, classificação real do excerto (`red-classify`, não o campo `classification` auto-declarado), casamento com `failure_pattern`, e — para um waiver — que o deferral/ledger que ele referencia existe de verdade. Ele **não** confirma que um replay real aconteceu por trás de um `status: observed` — um artefato editado à mão com campos internamente consistentes passa por esse check sozinho. Isso é um limite aceito, não um descuido: a garantia real está nos dois gates que decidem de fato (verify e a transição para verified), que sempre chamam `ensure` antes de avaliar.

O replay roda em worktrees git efêmeros — que só materializam o que está versionado. Repositório cuja suíte depende de dependências não versionadas (`node_modules`, `.venv`, pacotes restaurados, etc.) precisa declarar `setup_command` na evidência (ex.: `npm ci`), executado no worktree antes do teste, com o mesmo teto de tempo. Sem isso, o comando falha por ambiente incompleto — o motor distingue esse caso de uma falha comportamental real e responde com `not-possible` (rebaixável por waiver), nunca com um `FAIL` inegociável.

`positive_control` (opcional, issue #150) é um comando adicional, declarado junto do resto da evidência, que precisa **passar** na mesma árvore base e na mesma corrida do teste declarado — antes de rodar o teste, o replay roda o controle na base; falhando (ou indeterminado), o veredito é `not-possible` com a saída do controle no excerto, mesmo que o teste declarado também falhe na base por um motivo aparentemente comportamental. É a prova, por execução, de que a base é capaz de ficar verde em algo — sem ela, uma base genuinamente quebrada (não só no ponto do defeito, mas por inteiro) produz uma falha comportamental real que não prova nada sobre o defeito relatado especificamente. Opcional por decisão (DA-13 do plano de issues): tornar obrigatório invalidaria evidências gravadas por escritores antigos sem o campo; a obrigatoriedade é item de roadmap.

### O limite desta norma

Esta norma é calibrada para a ameaça de **descuido** — o teste de regressão escrito depois do fato, nunca visto vermelho, que passa por mock complacente, asserção fraca demais ou um caminho de código que não é o do defeito. Contra esse alvo ela é sólida: o replay prova, por execução real, que o teste declarado falha na árvore anterior por comportamento (não por build quebrado) e passa depois da correção — nada além disso, e é o suficiente para fechar a lacuna que motivou a norma.

Ela **não protege contra um autor adversarial** — alguém disposto a construir deliberadamente uma evidência que satisfaça o protocolo sem que o teste tenha valor real. Três vetores são conhecidos e permanecem abertos, por decisão deliberada, não por lacuna esquecida:

- **O comando declarado é arbitrário.** `red-evidence.sh record` aceita qualquer `command` — nada impede declarar um comando escolhido para falhar na base por um motivo qualquer alheio ao defeito relatado (uma flag experimental, uma dependência de ambiente), e passar depois da correção pelo mesmo motivo alheio.
- **O defeito pode ser introduzido no próprio PR para satisfazer o protocolo.** Um autor que controla o histórico git pode commitar um bug artificial, um teste que o reproduz, e a "correção" desse bug artificial — o replay observa Red genuíno segundo sua própria definição, porque o defeito genuinamente existiu na árvore que ele examinou; só não é o defeito que o `bugfix.md` descreve.
- **O waiver cuja justificativa é externamente inverificável.** `external-unreproducible` e `hotfix-under-incident` dependem da palavra de quem grava o waiver — o harness confere que existe um `DEFER-NN` de verdade (e, no segundo caso, que ele bloqueia o archive), não que a dependência externa realmente está indisponível ou que o incidente realmente aconteceu.

Nenhum desses três é fechável com mais campo no artefato, mais script local, ou mais cache — o padrão já apareceu duas vezes (ver ADR 0003) e a lição generaliza: **evidência produzida inteiramente pela parte sendo verificada, num ambiente que ela controla, não pode provar a si mesma para um terceiro adversarial.**

**A execução de referência é a do CI.** Metade dessa frase — "num ambiente que ela controla" — foi fechada: `bash .forge/scripts/red-evidence.sh ci` varre todo change ativo sujeito à política (§ Escopo), reexecuta o replay e agrega o veredito num exit code, e é isso que o workflow `red-first.yml` roda em cada pull request, num runner definido pelo workflow e não pela máquina de quem escreve. O que o `red-evidence.json` commitado afirma não basta: o veredito que bloqueia o merge é o de lá. Localmente o replay continua rodando em `/forge:verify` e na transição para `verified` — o CI acrescenta uma autoridade, não substitui as existentes.

Isso fecha o ambiente e encerra de vez a tentação de reintroduzir cache local (execuções isoladas não têm entre o que cachear). **Não fecha os três vetores acima**, e a distinção importa: o `command` continua vindo do artefato que o autor escreve, o defeito artificial continua indistinguível do genuíno para o motor, e o waiver continua dependendo da palavra de quem o grava. Um gate que parece fechar mais do que fecha é pior que a ausência do gate, porque desliga a revisão humana que os três ainda exigem.

**Bloqueiam** (condições não rebaixáveis por modo de operação, nem em `yolo`):

- ausência de evidência de Red num change sujeito à política (§ Escopo);
- teste que já passava na base — não reproduz nada;
- falha na base classificada como erro de build, e não como comportamento;
- saída da falha que não casa com o padrão declarado;
- `failure_pattern` ausente ou vazio na evidência (issue #150) — uma âncora vazia casaria com qualquer falha na base, inclusive uma adjacente ao defeito relatado (item 5 acima); `replay` recusa com `not-possible` em vez de aceitar por vacuidade;
- `positive_control` declarado (§ Verificação) que falha na base (issue #150) — sem prova de que a base seria capaz de ficar verde, a falha do comando declarado não comprova o defeito relatado, mesmo classificada como comportamental.

**Avisam** (sinal de qualidade, não veto):

- teste que não alcança, no grafo de código, nenhum dos arquivos corrigidos. É um proxy imperfeito do item 2: a alcançabilidade estática não enxerga injeção de dependência, reflexão, e2e sobre processo HTTP nem message bus, então a ausência de interseção sugere revisão, não condena o teste;
- teste e correção no mesmo commit, o que impede separar temporalmente o Red do Green;
- nome de teste sem referência ao defeito;
- mock de símbolo exportado por um dos arquivos corrigidos — o caminho clássico do teste que passa pelo motivo errado.

Permanece um resíduo honor-system que nenhum script fecha: que o motivo da falha seja **semanticamente** o defeito relatado, e não uma quebra adjacente que por acaso casa com o padrão declarado. O replay prova que houve falha comportamental reprodutível e específica; não prova intenção. Essa parte continua sendo responsabilidade de quem escreve e de quem revisa.

## Quando o Red não é possível

Há casos legítimos. Registre-os com `/forge:red waive --reason <motivo>` em vez de fabricar um teste para cumprir tabela — um teste inventado para satisfazer o gate é pior que a ausência declarada, porque mente para o próximo leitor.

| Motivo | Quando se aplica | Efeito |
|---|---|---|
| `non-behavioral` | Typo, copy, configuração, documentação — nada que mude comportamento executável | Recusado automaticamente se o diff tocar código presente no grafo |
| `no-test-infra` | Brownfield sem suíte de testes utilizável | Abre deferral e registra dívida técnica no ledger |
| `external-unreproducible` | Depende de terceiro indisponível para reprodução local | Abre deferral |
| `hotfix-under-incident` | Incidente em produção, correção antes do teste | Deferral com `blocks: [archive]` — o archive fica travado até o teste chegar |

Um waiver não é aceito só por estar presente no artefato: a cada checagem, `check-red-first` reaplica a política do motivo declarado, não confia no que foi gravado da última vez. Para `non-behavioral`, isso quer dizer reler o diff real contra o grafo de código a cada vez — grafo ausente ou malformado dispara uma tentativa de regeneração determinística (`graph.sh update`, sem LLM); se mesmo assim não houver grafo utilizável, o waiver é recusado, nunca concedido em silêncio por falta de como conferir. Para os outros três motivos, isso quer dizer confirmar que o `DEFER-NN` (e, para `no-test-infra`, também o `LDG-NNNN`) referenciado existe de verdade em `deferrals.json`/`ledger.json` — um `deferral_id`/`ledger_id` colado à mão sem o registro correspondente não corrobora nada; e que, para `hotfix-under-incident`, esse deferral carrega `blocks: [archive]` — sem isso o archive nunca fica de fato travado até o teste chegar.

Mudar o `type` do change (ou esvaziar `fixes_defects`) depois de já ter alguma evidência de Red gravada (`/forge:red record` já rodou, ou o status já não é mais `pending`) desliga toda a política em silêncio quando o change deixa de satisfazer `isDefectFixing` (§ Escopo) — um `type: feature` que mantém `fixes_defects` declarado não aciona este WARN, porque a lista sozinha já basta para manter a política ligada. Isso pode ser legítimo (change recategorizado, ou defeito removido da lista), então não trava; mas `check-red-first` emite um `WARN` citando a mudança, para deixar rastro em vez de silêncio total.

## Referências

- [TDD — ciclo Red-Green-Refactor](./tdd.md)
- [Contrato mínimo de testes por mudança](./change-test-contract.md)
- [Quality Gates e Níveis de Teste](./quality-gates.md)

A decisão está registrada no ADR `0003-red-first-regression-evidence` do repositório forge-harness. Como toda rule do template, esta nasce com `based_on: []` (guardrail G3 — o template não traz ADRs); o projeto adotante que queira ancorá-la formalmente cria o ADR próprio via `/forge:adr` e passa a declarar `based_on: [ADR-NNNN]`.
