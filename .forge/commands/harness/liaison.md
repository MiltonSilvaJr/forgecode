---
description: Canal de mensagens ORDENADAS entre agentes de repositórios distintos (ex.: dono do .proto/gRPC e app cliente) — elimina drift de handoff manual. Store JSONL append-only por remetente, thread como campo, relógio de Lamport por thread, abertura de thread e entrada de participante como mensagens auditáveis. Transporte plugável (fs, git, manual) com sync idempotente e merge append-only. Operado por script determinista — exceto o subcomando ask, consulta síncrona a um peer sob mandato read-only.
argument-hint: "[open|thread|send|ask|notify|native|inbox|read|ack|status|conflicts|export|import|peer|transport|sync|render|baton] [flags]"
---

# /forge:liaison — canal de mensagens ordenadas entre repositórios

Argumentos: `$ARGUMENTS`. Sem subcomando, mostra `status` (resumo de todos os canais conhecidos
localmente).

> **Por que existe:** repositórios distintos que colaboram por contrato (ex.: `axis-go-cloud`,
> dono dos `.proto` gRPC, e `axis-fare-validator`, app Android cliente) hoje trocam handoff por
> arquivo manual — e o contrato sofre drift porque nada garante que as duas pontas viram a mesma
> sequência de decisões. O liaison é um canal com **ordem garantida**, **N participantes** e
> **múltiplas threads**, sem exigir um servidor compartilhado.

## Modelo (leia antes de operar)

- **Store: um JSONL append-only por remetente** — `.forge/liaison/<channel>/log/<sender>.jsonl`.
  Um único escritor por arquivo é o que torna o merge entre réplicas livre de conflito.
- **Thread é campo da mensagem** (`thread_id`), não arquivo — várias threads convivem no mesmo
  conjunto de logs.
- **Lamport é por THREAD, não por canal** — um participante com participação parcial só conhece
  as mensagens das threads em que está; um relógio por canal exigiria ver threads alheias para
  incrementar. Ordem dentro da thread: `(lamport, sender, seq)`. Entre threads não há ordem
  definida, e não precisa haver.
- **`seq` é monotônico e sem buracos por remetente** — é o detector de mensagem perdida.
- **Abertura de thread (`kind: thread-open`) e entrada de participante (`kind: join`) são
  mensagens**, não configuração editada por fora — a composição da thread converge pelo mesmo
  mecanismo do resto do canal e fica auditável no próprio log.
- **Visibilidade: a thread ROTEIA, o canal CONFINA.** A lista de participantes de uma thread
  define quem é cobrado por ack e para quem o roteamento se dirige — **não** quem pode ler. Com
  hub compartilhado, quem alcança o transporte lê tudo; prometer isolamento por thread
  seria falsa sensação de segurança. Confidencialidade de verdade exige canal separado.
- **`export`/`import` são a primitiva de sincronização** — copie o diretório exportado para o
  outro repositório (scp, PR, drive, o que for) e importe do outro lado. O transporte automático
  (`sync`) é essa mesma primitiva com o transporte fazendo a cópia; o backend `manual` é
  literalmente ela.

## Protocolo

```bash
# inicializar (uma vez por canal; --self só na primeira chamada de qualquer canal deste repo)
bash .forge/scripts/liaison-ops.sh open <channel> --self <meu-id> --participants <a,b,c>

# threads são mensagens
bash .forge/scripts/liaison-ops.sh thread open <channel> <thread-id> \
  --subject "<txt>" --participants <a,b,c> [--body "<txt>"] [--requires-ack]
bash .forge/scripts/liaison-ops.sh thread join <channel> <thread-id> [--subject "<txt>"] [--body "<txt>"]
bash .forge/scripts/liaison-ops.sh thread list <channel>

# enviar (kind: note|question|answer|contract-change — ack/thread-open/join têm subcomando próprio)
bash .forge/scripts/liaison-ops.sh send <channel> --thread <id> --kind <k> --subject "<txt>" \
  [--body "<txt>" | --body-file <path>] [--requires-ack] [--in-reply-to <msg_id>] \
  [--change <change-id>] [--contract-files <a,b>] [--commit <sha>]
bash .forge/scripts/liaison-ops.sh ack <channel> <msg_id> [--subject "<txt>"] \
  [--body "<txt>" | --body-file <path>] [--reason wont-adopt|acknowledged]
# --reason wont-adopt exige --body/--body-file: recusa sem justificativa é o defeito, não o ack em si

# consultar
bash .forge/scripts/liaison-ops.sh inbox  <channel> [--thread <id>]   # não lido por thread
bash .forge/scripts/liaison-ops.sh read   <channel> --upto <msg_id>   # avança o cursor local
# reparo manual de acks anteriores à issue #105 (ack não avançava cursor nenhum): rode `read
# --upto <msg_id>` para cada mensagem já ackada que ficou como não lida — é o mesmo comando que
# um `ack` de hoje já dispara sozinho quando o cursor consegue avançar
bash .forge/scripts/liaison-ops.sh status [<channel>]                 # one-line + posições retidas
bash .forge/scripts/liaison-ops.sh conflicts list <channel>          # o que está retido, e o que fazer
bash .forge/scripts/liaison-ops.sh conflicts resolve <channel> <sender> <seq>  # republica em seq novo

# sincronização manual (a primitiva — sempre disponível, sem configurar nada)
bash .forge/scripts/liaison-ops.sh export <channel> --out <dir>
bash .forge/scripts/liaison-ops.sh import <channel> --from <dir>

# transporte (configura o ponto de encontro do canal, uma vez por repositório)
bash .forge/scripts/liaison-ops.sh transport set   <channel> --kind fs --path <dir-do-hub>
bash .forge/scripts/liaison-ops.sh transport set   <channel> --kind git --remote <url> [--branch <b>]
bash .forge/scripts/liaison-ops.sh transport show  <channel>
bash .forge/scripts/liaison-ops.sh transport probe <channel>          # o ponto de encontro responde?

# sincronizar (push do próprio log + pull dos demais, na mesma chamada)
bash .forge/scripts/liaison-ops.sh sync <channel> [--push-only | --pull-only]

# regenerar a view mestre
bash .forge/scripts/liaison-ops.sh render <channel>                   # <channel>/CHANNEL.md
```

## Transporte

O transporte é **plugável** (`scripts/lib/transports/<kind>.sh`, contrato `t_probe`/`t_push`/
`t_pull`) e move **arquivos opacos**: não parseia mensagem, não sabe o que é thread, não decide
merge. A política de merge é uma só — a mesma para `import` e para `sync` — porque duas políticas
fariam a mais frouxa virar o caminho de menor resistência.

| kind | ponto de encontro | quando |
|---|---|---|
| `manual` | diretório com `log/` + `blobs/`, no layout exato do `export` | a fronteira não é cruzável por script (pendrive, anexo, VPN montada à mão). **Nunca cria o diretório**: se ele não existe, o `probe` reprova, para você não publicar num lugar que ninguém combinou |
| `fs` | `<path>/<channel>/{log,blobs}`, criado sob demanda | default do piloto — dois repositórios na mesma máquina ou num volume compartilhado |
| `fs-union` | o mesmo de `fs` | opt-in, sem recomendação de troca: carrega o `_common.sh` do checkout principal e recusa, sem cair para a cópia da árvore, quando ele falta ou quando não une o log (tronco anterior à #110: atualize o tronco antes de sincronizar) — e, enquanto isso, o canal inteiro fica indisponível, inclusive `sync --pull-only` e `transport probe`; exige checkout git, e fora de git recusa, então ali use `fs`; uma árvore anterior ao kind recusa o `liaison.yaml` do tronco com `kind inválido` antes de tocar o hub; a invocação inline `FORGE_ROOT=<worktree>` numa worktree de branch anterior à #123 lê o `liaison.yaml` dela (`kind: fs`) e continua sem essa proteção (issue #123) |
| `git` | branch **órfã** dedicada num remote; cada sync usa um repositório descartável próprio em `.forge/cache/liaison-git-run/` e o push não-fast-forward é o compare-and-swap | os participantes não compartilham filesystem. Branch órfã por construção: sem ancestral comum com o código, nunca vira candidata a merge nem dispara CI. A branch é dedicada ao liaison: symlink ou submódulo em qualquer ponto dela faz o sync recusar |
| `gh` | — | **declarado, não implementável por script.** O harness proíbe invocar o CLI do GitHub em `.sh` (rede, auth interativa, estado irreprodutível em gate); o backend reprova por construção. A via por issue é sua, agente, com as ferramentas que você tem |

**Topologia: hub único por canal, nunca par-a-par.** Cada participante publica o próprio log no
ponto de encontro e puxa os N−1 restantes — a configuração cresce como N (cada repo aponta para um
lugar), não como N². Par-a-par deixaria dois participantes divergentes por tempo indeterminado sem
ninguém perceber.

**O push publica apenas o próprio log.** Um participante nunca republica o log de terceiro: se o
fizesse, publicaria a versão possivelmente atrasada que ele conhece, regredindo o hub e apagando
mensagens que o dono do log já havia enviado.

**Sem transporte configurado, `sync` REPROVA** citando o comando que falta. Pré-requisito ausente
nunca desliga a sincronização em silêncio contra um default inventado — o canal ficaria mudo com
cara de funcionando.

**O canal mora no TRONCO, não na branch.** `liaison-ops.sh`, a cobrança de ack e o SessionStart resolvem o `ROOT` pelo `.git` compartilhado (`--git-common-dir`), nunca pelo `--show-toplevel`. É o que mantém o invariante do store: **um escritor por arquivo de remetente**. Resolvido pelo worktree, cada branch ganharia a sua cópia de `log/<self>.jsonl` com o próprio contador de `seq`, e duas branches escrevendo em paralelo produziriam duas mensagens diferentes na MESMA posição — que é como um ack legítimo já ficou inacessível ao destinatário. Entre máquinas distintas nenhuma verificação local alcança: ali o escritor único é acordo, e a evidência de que foi quebrado é o `seq` colidindo do lado de quem recebe.

**`status` e `render` sinalizam `created_at` incoerente com a causalidade** — mensagem cujo `created_at` é anterior ao da mensagem que ela responde (`in_reply_to`). Não bloqueia e não reordena nada: a ordem da thread é `(lamport, sender, seq)` e nunca timestamp. É diagnóstico barato de um defeito caro — um relógio de parede inconsistente costuma ser a primeira pista visível de que duas cópias do mesmo log estão escrevendo em paralelo.

**`conflicts list` enumera o que está retido e `conflicts resolve` traz o conteúdo de volta.** O conteúdo de uma posição retida NUNCA entra no log local: para quem recebe, ele simplesmente não existe. `resolve` o republica numa sequência nova do seu próprio log — o único caminho legítimo num log append-only — com `authored_by` do autor real e `resolves` apontando a posição de origem, e sempre como `note`: reemitir um `ack` ou um `contract-change` como se fosse seu falsificaria autoria de decisão, e a cobrança de ack conta exatamente isso. Republicar não corrige a divergência (só a origem pode), e republicar duas vezes é recusado.

**`status` e `render` NOMEIAM as posições retidas por divergência** — remetente, `seq` e `msg_id`, uma linha por posição, além do contador. Um remetente calado é indistinguível de um remetente quieto, e um total agregado esconde exatamente isso: a réplica parece saudável enquanto uma fatia do canal não chega. Se aparecer alguma linha `! quarentena por divergência`, a ação é na ORIGEM (restaurar a linha reescrita, ou republicar o conteúdo com `seq` novo) — a réplica não tem como decidir qual versão é a verdadeira.

**`ack` avisa quando publica mas o cursor não avança** (issue #108) — `WARN: ack publicado, mas o cursor não avançou (<motivo>)` em stderr, com `rc 0`: o ack em si já é um ato de protocolo PUBLICADO no log antes desse efeito colateral rodar, então falhar o comando reportaria erro num ato que funcionou. O reparo manual é o `read --upto <msg_id>` do bloco de comandos acima. **O `doctor` nomeia quando `liaison-ops.sh status` falha**, em vez de sumir com a seção inteira: `✗ harness: LIAISON: status falhou — <primeira linha do erro>`. Cursores anteriores a essa correção que nunca avançaram (a issue #105 introduziu o avanço automático; até o #108, o `catch` que hoje avisa ficava vazio e engolia a falha em silêncio) não são reparados por esta mudança — é passivo retroativo, a medir em campo antes de decidir um reparo automático.

**`status` distingue mensagem ENVIADA de mensagem PUBLICADA** (issue #109) — `· N própria(s) não publicada(s)` aparece quando o log próprio tem mensagens depois da marca do último `sync` bem-sucedido; `send` sozinho nunca publica nada, só grava localmente. Depois de um `sync` com push, a linha soma um `(há Xmin)` medido contra `published_at` (carimbo de hora do PUSH, wall clock deliberado) — nunca contra `created_at` (data do HEAD do commit, determinística e alheia a quando o push de fato aconteceu). Sem nenhum `sync` prévio, a linha aparece sem o parêntese: não há carimbo contra o que medir. É o mesmo motivo do item acima aplicado à outra ponta do protocolo — sem esta marca, uma mensagem `send`ada e esquecida (sessão encerrada antes do `sync`, transporte indisponível) ficava sem aviso nenhum, e o remetente acreditava que a contraparte já via algo que nunca saiu da árvore local. **Com o bastão (add-liaison-handoff-baton):** nos transportes `fs`, `fs-union` e `manual`, o `status` GERAL relê o arquivo do `self` no hub e, se a marca estiver desatualizada em relação ao que o hub de fato tem, REGRAVA a marca de publicação (sob a trava de `state.json`) e avisa `hub atrás do log próprio: rode sync` — único caso em que `status` grava algo; `baton status` e `baton list` continuam sendo só leitura.

## Regras de import (o que protege o canal de um peer malicioso ou corrompido)

- `sender` da mensagem é conferido contra o arquivo em que ela chegou (`log/<X>.jsonl` só pode
  conter `sender: X`) — divergência mata spoofing e vai para `<channel>/conflicts/`.
- Mensagem que se declara com o `self.id` local vinda de fora é recusada.
- Duplicata com `content_sha` igual é **no-op silencioso** — é o que torna `sync` idempotente.
- Adulteração em trânsito (`content_sha` não confere com o conteúdo) vira conflito em `conflicts/`,
  sem tocar o log.
- **Reescrita de história REPROVA, mas quarentena a POSIÇÃO, não o remetente.** O log de um remetente é append-only: uma posição (`seq`) já conhecida não pode chegar com outro `msg_id` ou outro `content_sha`. Quando chega, é **divergência** — aquela posição vai para quarentena, as demais mensagens do mesmo remetente continuam sendo aplicadas, o comando sai com erro nomeando cada posição retida (`<sender>@seq=<n>`), e cada uma ganha seu registro em `conflicts/<sender>.seq-<n>.divergence.json`. A réplica MANTÉM a versão que já conhecia da posição divergente, então não se abre buraco no log; a exceção é o bundle que traz duas versões da MESMA posição, que é quarentenada por inteiro (não há critério para escolher entre as duas) e aí o buraco de `seq` é reportado nos diagnósticos. O registro some sozinho no `sync` seguinte quando a origem resolve a divergência — restaurando a linha, ou republicando o conteúdo com `seq` novo, que é o caminho legítimo em log append-only.
- **Divergência isola a posição, nunca cala o remetente.** Descartar o remetente inteiro protegia o mesmo invariante e custava o canal: uma reescrita em duas posições reteve 73 mensagens posteriores íntegras em três réplicas por dias, e o remetente não tinha como notar, porque a réplica dele próprio estava completa (issue #48).
- Mensagem cujo `thread_id` não tem `thread-open` correspondente **ainda conhecido localmente**
  fica em quarentena (recalculada a cada `render`/`inbox`, nunca persistida à parte) — liberada
  automaticamente assim que a abertura chega.
- Tetos: corpo inline ≤2 KB (acima disso, use `--body-file`, vira blob ≤64 KB); ≤200 mensagens aplicadas por chamada de `import`/`sync`. **Excedeu o teto, o resto vira LOTE, não descarte:** aplica-se um prefixo por `seq` (o único corte que preserva append-only) e reporta-se quantas faltam — repetir `sync` converge. Não há flag de override do teto de propósito: ele existe para conter bundle malicioso ou corrompido, e uma flag de "recuperação" seria exatamente o que um bundle hostil pediria.
- `trust` é carimbado no IMPORT (`self` só para o que este repositório escreveu; tudo que veio de
  fora vira `untrusted-peer`, mesmo que a mensagem alegue outra coisa) — nunca decidido pelo
  remetente.

## `baton` — dono único de uma unidade de trabalho

Coordena uma unidade de trabalho que uma sessão de outro repositório participante poderia
duplicar (ex.: as duas pontas da mesma migração, ou um handoff de sessão que encerrou sem
concluir). Leia a seção "Bastão de dono único" da rule
[liaison-protocol](../../rules/conventions/liaison-protocol.md#bastão-de-dono-único) antes de
operar — modelo de estado (dobra, `provisional`/`stable`, desempate por code point), lease e
carimbo, publicação automática da renovação e os limites declarados moram lá, não aqui.

```bash
bash .forge/scripts/liaison-ops.sh baton offer    <channel> --thread <id> --subject "<txt>" \
  [--body "<txt>" | --body-file <path> | --from-handoff] [--for <a,b>] [--max-lease <s>] [--session <id>]
bash .forge/scripts/liaison-ops.sh baton claim    <channel> <baton_id> [--lease <s>] [--session <id>]
bash .forge/scripts/liaison-ops.sh baton renew    <channel> <baton_id> [--lease <s>] [--session <id>]
bash .forge/scripts/liaison-ops.sh baton release  <channel> <baton_id> [--session <id>] [--body "<txt>" | --body-file <path>]
bash .forge/scripts/liaison-ops.sh baton complete <channel> <baton_id> [--session <id>] [--body "<txt>" | --body-file <path>]
bash .forge/scripts/liaison-ops.sh baton withdraw <channel> <baton_id> [--session <id>] [--body "<txt>" | --body-file <path>]
bash .forge/scripts/liaison-ops.sh baton status   <channel> [<baton_id>] [--json]
bash .forge/scripts/liaison-ops.sh baton list     <channel> [--json]
```

Flags aceitas por verbo (fonte única: `BATON_VERB_FLAGS` em `scripts/lib/liaison-baton.mjs`; o
script recusa qualquer flag fora desta lista, nomeando o verbo e as flags aceitas):

| Verbo | Flags aceitas |
|---|---|
| `offer` | `--thread`, `--subject`, `--body`, `--body-file`, `--from-handoff`, `--for`, `--max-lease`, `--session` |
| `claim` | `--lease`, `--session` |
| `renew` | `--lease`, `--session` |
| `release` | `--session`, `--body`, `--body-file` |
| `complete` | `--session`, `--body`, `--body-file` |
| `withdraw` | `--session`, `--body`, `--body-file` |
| `status` | `--json` |
| `list` | `--json` |

- `offer` recusa (sem gravar) quando a thread não tem participante além do `self`, quando
  `--for` cita alguém fora da thread, ou quando o `eligible` resultante não sobra ninguém além
  do `self` — bastão não é coordenação dentro do próprio repositório.
- `--from-handoff` usa o `HANDOFF.md` da worktree corrente como corpo (gerado na hora se
  ausente), pelo MESMO caminho de `--body-file` (teto de 64 KB, varredura de segredo); exclusivo
  de `--body`/`--body-file`. Ver nota em [/forge:handoff](./handoff.md#transferência-de-posse).
- `claim` devolve `won` (rc 0, com `provisional`/`stable`), qualquer outro veredito nomeado (rc
  3, com a titular corrente) ou recusa de pré-condição sem gravar (rc 1) — oferta desconhecida,
  `--lease` fora da faixa, ou sessão já titular com lease vigente (esse último caso é rc 0 sem
  gravar, não recusa).
- `renew`/`release`/`complete`/`withdraw` recusam sem gravar quando a sessão não é a titular
  corrente (`release`/`complete`/`renew`) ou quando não é o ofertante com o bastão disponível ou
  vencido além da folga (`withdraw`).
- `renew` distingue o motivo pelo código de saída: rc 0 renovado; rc 4 perda real (não é a titular corrente, ou o lease venceu, e a retomada é `baton claim`); rc 5 ainda não é hora (só com `FORGE_BATON_RENEW_IF_DUE=1`, antes da metade do prazo); rc 1 erro ou transitório (trava ocupada ou perdida, oferta desconhecida, `--lease` fora da faixa, exceção). O gancho de renovação automática só avisa perda e tira o bastão do cache com rc 4; com rc 5 regrava o cache a partir da dobra; com rc 1 não toca o cache e tenta de novo no próximo evento.
- `status <channel> [<baton_id>]` e `list <channel>` são só leitura: nunca gravam mensagem. O
  `status` GERAL (sem `baton`) soma à linha do canal `· bastões: N disponível(is), M nosso(s), K
  perdido(s)`.

## `ask` — consulta síncrona a um peer

`liaison ask <canal> <thread> <participante> "<pergunta>"`.

O fluxo normal do canal é **assíncrono**: você manda `question --requires-ack` e o outro lado
responde quando abrir a sessão dele. Isso é o certo na maioria dos casos. O `ask` existe para
quando a resposta bloqueia o trabalho **agora** e o repositório do peer está acessível nesta
máquina — tipicamente desambiguar um contrato antes de gerar stub.

**Esta é a única operação do liaison que não é determinista.** Todo o resto é script puro; o `ask`
invoca um agente e depende de julgamento. A fronteira importa: o resultado de um `send` é sempre o
mesmo, o de um `ask` não é.

```bash
# 1. registrar a pergunta — SEMPRE primeiro, antes de consultar
bash .forge/scripts/liaison-ops.sh send <canal> --thread <thread> --kind question \
  --subject "<pergunta em uma linha>" --body "<contexto>" --requires-ack

# 2. localizar o repositório do peer
bash .forge/scripts/liaison-ops.sh peer-path <canal> <participante>

# 3. consultar o peer com o cwd no repositório dele, sob o mandato abaixo, e
# 4. registrar a resposta no NOSSO log
bash .forge/scripts/liaison-ops.sh send <canal> --thread <thread> --kind answer \
  --in-reply-to <msg_id-da-pergunta> --subject "<resumo>" --body "<resposta>" \
  --authored-by <participante> --via ask-peer
```

**A pergunta entra no log antes da consulta.** Se o peer estiver offline ou a resposta não vier, a
pergunta permanece registrada e o caminho assíncrono continua valendo — um `ask` que falha degrada
para o fluxo normal, em vez de perder a intenção. Nunca perguntar sem registrar.

**Por que a resposta vai no nosso arquivo.** O invariante que torna o merge livre de conflito para
qualquer número de participantes é **um escritor por arquivo**. Gravar em `log/<peer>.jsonl` faria
dois processos escreverem o mesmo arquivo — nós agora, e o peer quando abrir a sessão dele. O log
dele divergiria do nosso e o import do outro lado reprovaria por reescrita de história. Então a
resposta é **nossa mensagem sobre o que o peer disse**: `authored_by` preserva a autoria real e o
`trust` fica `untrusted-peer`, valendo a regra
[liaison-untrusted-input](../../rules/conventions/liaison-untrusted-input.md) por inteiro.

### Mandato da consulta (não negociável)

- **Somente leitura.** O agente consultado lê o repositório do peer e responde; não edita arquivo,
  não cria commit, não roda build, não mexe em estado. Perguntar não autoriza agir.
- **Sem `--dangerously-skip-permissions`.** Uma consulta que precise contornar permissões não é
  uma consulta.
- **Nunca por script.** Um `.sh` que invoque agente headless exigiria rede, autenticação e um
  repositório peer em estado específico — nada reproduzível num gate, e um mecanismo que só
  funciona na máquina de quem o escreveu é armadilha, não ferramenta. O gate `w113` varre
  `scripts/` e `hooks/` para garantir que nenhum `.sh` o faça.
- **O peer é endereçado explicitamente.** Com mais de um participante, "pergunte ao canal" não
  existe: ou você sabe a quem perguntar, ou o caminho é o assíncrono, que roteia pela thread.
- **Nunca invente a resposta.** Se a consulta falhou, diga que falhou. Uma resposta fabricada com
  `authored_by` de outro repositório é a pior corrupção possível deste canal.

## Mensageria nativa entre sessões (campainha → `sync` → `inbox --show`)

A mensageria nativa do Claude Code (`SendMessage`) é **campainha**, não registro — ver [liaison-protocol](../../rules/conventions/liaison-protocol.md#mensageria-nativa-entre-sessões). O fluxo operacional:

```bash
# 1. gravar o fato no liaison, publicar, e resolver o ponteiro canônico
bash .forge/scripts/liaison-ops.sh send <channel> --thread <id> --kind <k> --subject "<txt>" [--body "<txt>"]
bash .forge/scripts/liaison-ops.sh sync <channel>
bash .forge/scripts/liaison-ops.sh notify <channel> <msg_id> --to <destino>
# imprime "liaison:<channel>/<msg_id>" — esse ponteiro vai como primeira linha não vazia do
# corpo do SendMessage nativo (é a forma que a ferramenta `notify` já imprime); ponteiro no
# meio do texto seria ambíguo com uma citação

# 2. o SendMessage nativo (fora do liaison) leva o ponteiro como primeira linha

# 3. do lado de quem recebe: diagnóstico de cobertura
bash .forge/scripts/liaison-ops.sh native check [--session <id>] [--transcript <path>] [--report] [--pending]

# 4. registrar o que chegou — mensagem com conteúdo que vira registro próprio
bash .forge/scripts/liaison-ops.sh send <channel> --via cross-session --native-ref <fingerprint> --session <id>
# --native-ref é o fingerprint da recepção (sha256 hex); a origem (from_addr/from_name/from_mode)
# é extraída do transcript por esse fingerprint, nunca informada por flag

# 4b. ou, quando a troca é genuinamente efêmera (lista FECHADA de classes)
bash .forge/scripts/liaison-ops.sh native dispose <fingerprint> --ephemeral <classe>

# 5. ler o que chegou (corpo sob banner UNTRUSTED, neutralizado — regra liaison-untrusted-input)
bash .forge/scripts/liaison-ops.sh inbox <channel> --show
```

### Cadastro de workspaces permitidos (`native allow|revoke|pin`) — restrição humana

```bash
# só roda num terminal do operador, FORA de qualquer sessão do Claude Code — o CLI recusa
# com rc != 0 se detectar qualquer marcador de sessão de agente (CLAUDECODE, CLAUDE_CODE_SESSION_ID, CLAUDE_PID)
bash .forge/scripts/liaison-ops.sh native allow <identidade> --reason "<motivo>"
bash .forge/scripts/liaison-ops.sh native revoke <identidade> --reason "<motivo>"
bash .forge/scripts/liaison-ops.sh native pin   # fixa self_identity no primeiro cadastro
```

A identidade de workspace é o remote `origin` do repositório mais externo (`git remote get-url origin`, que aplica `insteadOf`); remote com alias SSH (`git@<alias>:owner/repo`) gera identidade com o alias como host, e é assim que deve ser cadastrado. O cadastro vale **só para a saída**: os dois lados de uma conversa precisam cadastrar um ao outro para que ela flua nos dois sentidos.

### Detector de mudanças de contenção

```bash
bash .forge/scripts/liaison-ops.sh native containment [--range <a>..<b>] [--format text|markdown]
```

Chamado por `pre-push` (avisa, sem bloquear), `doctor` (estado atual) e `/forge:prepare-pr`/`/forge:ship` (seção "Mudanças de contenção" no PR, para decisão humana no merge). As quatro mudanças fechadas: cadastro alterado; linha do gancho de `SendMessage` removida/trocada em `hooks.manifest`; gancho ausente da fiação efetiva quando o manifesto o declara armado; identidade do remote `origin` diferente de `self_identity`.

### O gancho de saída

`guard-cross-session-send.sh` (`PreToolUse`, `SendMessage`) recusa com rc 2 quando: o corpo contém segredo (mesma varredura do `send`); o destino é sessão/subagente sem ponteiro resolvido nem declaração efêmera válida na primeira linha; ou o destino está fora do workspace atual e não há cadastro `allow` ativo. **Limite declarado:** `allowed_workspaces` protege contra liberação induzida pelo próprio fluxo, não é fronteira de segurança — um agente determinado rodando como o mesmo usuário do sistema contorna o gancho inteiro (ver [liaison-untrusted-input](../../rules/conventions/liaison-untrusted-input.md#mensagem-nativa-recebida)). A única contenção que o usuário do sistema não altera é a configuração gerenciada do Claude Code, recomendada para repositórios em escopo PCI.

## Quando usar

- Uma mudança de contrato (`.proto`, schema, API) que afeta outro repositório: `thread open` +
  `send --kind contract-change --contract-files <arquivo>`.
- Uma dúvida que bloqueia o outro lado: `send --kind question --requires-ack`, e o outro lado
  fecha com `ack` (nunca `requires_ack` num `ack`/`answer` — trava anti-eco).
- Handoff de progresso entre sessões que tocam repositórios distintos do mesmo domínio.

## Regras

- **Nunca edite `log/*.jsonl` ou `CHANNEL.md` à mão** — são gerados/mutados só pelo script.
- `.forge/liaison/` é dado durável do projeto (fora da maquinaria substituível pelo `forge
  update`) — nada aqui é sobrescrito por upgrade do harness.
- Emita one-line de confirmação com o `msg_id` afetado.
