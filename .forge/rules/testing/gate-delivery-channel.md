---
title: Prova de gate exercita o canal de entrega, não só o alvo
applies_to:
  - all
priority: high
last_reviewed: 2026-08-19
---

# Prova de gate exercita o canal de entrega, não só o alvo

Um gate tem duas metades: **o que ele decide** e **como ele chega até onde a decisão importa**. A prática comum prova só a primeira — monta uma fixture com a violação, roda o gate contra ela, vê a recusa, declara o gate vivo. A segunda metade fica sem prova nenhuma, e é onde o defeito mora com mais frequência, porque ela não aparece no diff.

O caso que originou esta rule: um gate foi ancorado corretamente no alvo real, testado contra a violação, aprovado — e entregue por um canal (`core.hooksPath` relativo) que sofria exatamente da doença que o gate curava. O teste de alvo passava nas duas versões do canal. Só a exigência de observar uma **recusa real, pelo caminho pelo qual o gate roda em produção**, distinguiu o gate vivo do gate morto.

## O que a regra exige

**A prova acontece pelo canal real.** Se o gate roda num hook, o teste faz o `git commit`/`git push` de verdade numa fixture e observa o bloqueio — não invoca o script do gate diretamente e só. Se o gate roda no CI, existe um cenário que reproduz a invocação do CI. Se o gate roda a partir de um worktree, o teste cria um worktree.

**A prova distingue "não encontrei violação" de "não rodei".** Um gate que não foi invocado produz o mesmo silêncio de um gate que aprovou. Toda prova de canal precisa de um sinal positivo de execução — um marcador que só o gate certo emite, um arquivo que só ele escreve —, nunca a mera ausência de erro. Ver [quality-gates](./quality-gates.md), item de vacuidade.

**A prova de mutação vale para o canal também.** Além de "quebro o alvo e o gate acusa", vale "quebro o canal e a prova acusa": desative o apontamento, aponte para a cópia antiga, rode a partir do lugar errado. Se o teste continua verde, ele não estava medindo o canal.

**Um gate cujo canal é config local não versionada exige backstop.** Config de máquina some num clone novo e num runner de CI. Onde a entrega depende dela, existe uma verificação independente de máquina — tipicamente no CI —, ou o gate é, na prática, opcional.

Ver também: [regression-red-first](./regression-red-first.md), [quality-gates](./quality-gates.md) e [conventions/machinery-propagation](../conventions/machinery-propagation.md).

## A fase de um gate, e o que a fase `source` NÃO cobre

Todo gate declarado em `runtime.gates` tem uma **fase**. A declaração aceita duas formas, e o leitor canônico (`lib/forge-runtime.sh`) entende as duas:

```yaml
runtime:
  gates: check-authz,check-observability          # CSV escalar — tudo em phase: source
```

```yaml
runtime:
  gates:                                          # block-sequence com fase
    - check-authz                                 #   item escalar ⇒ phase: source
    - name: check-image-digest
      phase: pre-deploy
    - name: check-rollout-health
      phase: post-deploy
```

A fase existe porque o contrato de gate do harness era inteiramente em forma de **árvore de fontes**: todo gate lê arquivos do repositório, `runtime.gates` é executada no fechamento da wave, e os hooks rodam no commit e no push — os três momentos em que o artefato implantável **ainda não existe**. Não havia onde declarar um gate que só faz sentido depois do build ou do deploy: digest publicado, manifesto renderizado, cluster no ar.

**O que `phase: source` não cobre, e é preciso dizer em voz alta.** Um harness com a suíte inteira verde na fase `source` não afirmou nada sobre:

- a **imagem** publicada — que o digest existe, que é o digest que o manifesto referencia, que a assinatura confere;
- o **manifesto renderizado** — o que o `helm template` de fato produz com os valores daquele ambiente, e não o que o chart promete;
- o **cluster** — admission, rollout, readiness, e o smoke test contra o que subiu.

É o mesmo espírito de `testing/regression-red-first.md` ao dizer que suíte verde não é evidência de que o teste reproduz o defeito: aqui, gate `source` verde não é evidência de que o que foi implantado está correto. Declarar tudo como `source` porque é a fase que o push executa transforma a fase num rótulo, e a lacuna volta a ser invisível.

## Contrato de invocação de um gate de `runtime.gates`

Todo chamador — o `pre-push`, o `/forge:verify` (`spec-verify.sh`) e o fechamento de wave (`run-gates.sh`) — invoca o gate da mesma forma: `bash .forge/scripts/<gate>.sh --path <raiz>`, com o diretório de trabalho na raiz e **nenhum argumento posicional**. O change em foco, quando existe, viaja na variável de ambiente `FORGE_CHANGE_ID`; no `pre-push` ela não é definida, porque não há change em foco. Um gate de consumidor precisa aceitar `--path <raiz>` e pode ignorar `FORGE_CHANGE_ID`. Até a issue #192 o verify e a wave passavam o change-id como `$1`, e um gate que valida a própria linha de comando reprovava o verify por erro de chamada, sem achado, enquanto passava no push. A prova desse contrato é `tests/w282-gate-invocation-contract-gate.sh`.

**Gate de fase `pre-deploy`/`post-deploy` pode ser INCONCLUSIVO.** Ele depende de credencial, de rede e de um ambiente que a máquina de quem desenvolve normalmente não tem. Esse estado não é verde nem vermelho: um gate que não pôde rodar por falta de credencial **não pode ser reportado como aprovado**, e também **não pode bloquear** quem não tem credencial na máquina. O executor que roda essas fases declara `inconclusive` e diz por quê — a mesma disciplina de contador de controle que separa "examinei e estava limpo" de "não examinei nada".
