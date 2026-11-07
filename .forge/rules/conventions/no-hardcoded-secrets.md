---
title: Sem segredo hardcoded em arquivo versionado
applies_to:
  - all
priority: high
last_reviewed: 2026-08-19
---

# Sem segredo hardcoded em arquivo versionado

Uma credencial versionada é uma credencial vazada. Não "potencialmente", não "se alguém olhar": no instante em que o commit sai da máquina, o valor está no histórico e em todos os clones, e continua lá depois de a linha ser removida — porque remover a linha cria um commit novo, não apaga o anterior.

O modo de falha é característico e silencioso. A credencial entra num arquivo de configuração durante o desenvolvimento inicial, o build funciona, os testes passam, nada quebra. Ela permanece rastreada indefinidamente porque nenhum passo do fluxo pergunta por ela. A descoberta acaba acontecendo por auditoria, por varredura externa ou por acidente — sempre tarde, e sempre depois de o valor já ter sido distribuído. O custo de detectar no momento do commit é próximo de zero; o custo de descobrir depois inclui rotação da credencial, análise de exposição e, em contexto regulado (PCI DSS, LGPD), produção de evidência para auditoria.

## O que é proibido

Em qualquer arquivo **rastreado pelo git** — o que está no `.gitignore` não é o problema, porque não viaja com o repositório:

- **Credencial de conexão literal** em arquivo de configuração: `Password=`, `pwd=`, `password:` com valor literal em `appsettings*.json`, `*.config`, `*.yaml`/`*.yml`, `*.properties` e `.env` versionado.
- **Chave privada** em formato PEM, em qualquer arquivo — inclusive `.md`, `.txt` e script de provisionamento.
- **Token de provedor** com prefixo reconhecível: GitHub, AWS, Google, Slack, Stripe, npm, chaves de LLM, JWT emitido.
- **`Authorization: Basic`** com o base64 literal de `usuário:senha`.

**Comentar não resolve.** Um segredo dentro de um comentário continua versionado, continua legível por qualquer pessoa com acesso de leitura e continua no histórico. O gate varre linha comentada exatamente como varre linha ativa — foi uma ocorrência dentro de comentário que motivou esta rule.

## O que continua livre

Referência a segredo, que é o padrão correto: `Password=${DB_PASSWORD}`, `password: {{ .Values.secret.password }}`, `%DB_PASSWORD%`, `<informe-a-senha>` em documentação, e valor vazio. Documentar o **prefixo** de um token (dizer que os do GitHub começam com `ghp_`) também é livre — o gate ancora no prefixo *mais* o comprimento do valor, então uma menção sem o valor completo não casa.

Essa distinção é o que torna a regra sustentável. Um detector de entropia genérica reprovaria hash, UUID e lockfile; um gate que atrapalha o trabalho honesto vira `--no-verify` por hábito em duas semanas, o que é pior do que não ter gate nenhum.

## Como é verificado

`scripts/check-secrets.sh`, em quatro modos, sempre sobre o conjunto **versionado** (`git ls-files`) e nunca sobre o working tree:

| modo | onde roda | o que cobre |
|---|---|---|
| `staged` | hook `pre-commit` | o que vai entrar no commit — o único momento em que remover a linha ainda resolve |
| `range <rev-range>` | CI sobre o diff do PR | o que o PR introduz, num ambiente que o autor não controla |
| `path <path>` | manual, `runtime.gates` do `pre-push` (via `--path`) | varredura pontual de um diretório ou arquivo |
| `report [<path>]` | manual, adoção em brownfield | inventário do passivo **sem reprovar** — mede o tamanho do problema antes de decidir a política |

A lógica pura de detecção vive em `scripts/lib/secret-scan.mjs`; o `.sh` decide escopo, modo e exit code.

### Duas propriedades que o gate garante, e por quê

**Nunca passa por vacuidade.** Se o conjunto varrido vier vazio — path errado, glob que não casa, arquivo ausente, range que não resolve, allowlist ampla demais — o resultado é `FAIL` explícito, jamais `OK`. "Não encontrei violação" e "não procurei" são estados distintos e não podem colapsar no mesmo verde. Um gate que aprova por não ter olhado é pior que gate nenhum: compra confiança sem entregar verificação.

**Falha de integridade ignora o modo.** `enforce: warn` rebaixa **achado**, nunca conjunto vazio nem allowlist malformada. Essas duas dizem que o gate não rodou direito, e um gate que não rodou não pode reportar-se verde em modo nenhum.

## Configuração

No `forge.yaml`:

```yaml
secrets:
  enforce: block   # block | warn (default na ausência do bloco)
```

`block` reprova em qualquer achado. `warn` rebaixa achado a aviso e devolve 0 — é como um repositório brownfield **com passivo conhecido** adota o gate sem travar o time no dia da ativação, tipicamente combinado com `check-secrets.sh report` para medir o passivo e um plano de saneamento com prazo.

A **ausência** do bloco resolve para `warn`, e a razão é de rollout, não de rigor. Este gate não é opt-in: ele está fiado no `pre-commit` e no CI, então todo projeto que atualiza o harness passa a tê-lo sem ter pedido. Um repositório brownfield com passivo — credencial versionada há meses — teria, no dia da atualização, todo commit que encostasse naquele arquivo bloqueado, sem aviso prévio e sem janela para medir o tamanho do problema. Gate que chega travando o time no primeiro dia é gate que vira `--no-verify` de hábito, e aí ele deixa de proteger qualquer coisa.

O default brando vale só para quem **herda** o gate. Projeto novo nasce com `enforce: block` explícito no `forge.yaml` do template, e um repositório existente que rodou `check-secrets.sh report`, mediu o passivo e saneou declara `block` — que é o estado final esperado de todo mundo. Falha de **integridade** (conjunto varrido vazio, allowlist malformada) reprova nos dois modos: um gate que não rodou não pode se reportar verde.

Entre o `warn` do passivo e o `block` final existe a assimetria por invocação: `FORGE_SECRETS_ENFORCE=warn|block` sobrepõe o `forge.yaml` naquela chamada. Com o `forge.yaml` em `warn`, o hook de push pode rodar `FORGE_SECRETS_ENFORCE=block check-secrets.sh range <push>` — o segredo que **entra** bloqueia, o passivo herdado só avisa. Valor fora de `warn|block` reprova com rc 2, nunca cai em silêncio no `forge.yaml`; o modo `report` segue inventário com qualquer valor.

## Falso positivo: allowlist com justificativa obrigatória

Fixture de teste que precisa carregar um segredo sintético para provar que o detector detecta, e documentação que exibe um valor de exemplo completo, são exceções legítimas. Elas vão para `.forge/secrets-allowlist.txt`, uma por linha:

```
tests/fixtures/*.properties   # motivo: amostra sintética do suite, sem valor real
```

A justificativa é **obrigatória** (mínimo de 12 caracteres) e a sua ausência **reprova o gate** — não é ignorada nem tolerada. A allowlist é o ponto exato por onde gates de segredo são esvaziados na prática: a exceção entra "só desta vez", ninguém registra por quê, e um ano depois ninguém sabe se o path ainda merece a isenção ou se ali mora uma credencial de verdade. Exigir o motivo na própria linha faz a exceção envelhecer visível.

Isentar tudo não produz verde: com o conjunto varrido vazio o gate reprova pela regra de vacuidade.

## Se um segredo já foi commitado

Remover a linha **não** é a remediação. O valor continua no histórico e em cada clone já feito.

1. **Rotacione a credencial.** É o único passo que efetivamente encerra a exposição, e é o primeiro.
2. Remova o valor do código e substitua por referência ao cofre ou a variável de ambiente.
3. Avalie a reescrita de histórico (`git filter-repo`) — necessária para repositório público, cara e disruptiva para repositório com muitos clones ativos; a rotação já feita é o que torna essa decisão não urgente.
4. Registre no ledger o que foi exposto, por quanto tempo e o que foi rotacionado. Em contexto regulado, esse registro é a evidência.
