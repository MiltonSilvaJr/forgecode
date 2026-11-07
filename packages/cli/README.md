# @opencode/cli

Interface de linha de comando do OpenCode. Este documento cobre a camada **`squad`**, que orquestra várias sessões a partir de um registro durável no servidor. A camada é **experimental** e fica desligada por padrão.

## `squad`: orquestração multi-sessão

O `squad` registra uma *geração* (um conjunto nomeado de sessões com provider, modelo e `Location`), cria ou adota as sessões, prova que cada uma está viva por evidência durável e troca mensagens pela inbox de sessão. Todo o estado fica no servidor; a CLI só chama a API experimental (`/api/experimental/squad/...`).

### Ativação

A camada só existe quando `squad.enabled` é `true`. O default é `false`:

```json
{ "squad": { "enabled": true } }
```

Com a flag desligada, todo subcomando termina com código diferente de zero e a mensagem `squad.enabled is false`, e nenhuma sessão, linha ou evento é criado. Os subcomandos continuam aparecendo em `opencode squad --help` para que o operador descubra a flag. Desligar a flag interrompe toda operação; o estado já gravado permanece nas tabelas.

Chaves opcionais do bloco `squad`: `state_dir`, `liveness` (`stale_after`, `dead_after`), `writer_scope` (`worktree` ou `repository`), `launch.verify_timeout`, `checkpoint.max_bytes`, `credential.expiry_warn` e `panel` (`jira_command`, `ci_command`, `ci_evidence`). Uma chave desconhecida gera diagnóstico de configuração.

### Comandos

`opencode squad <subcomando> --help` mostra as flags e os defaults de cada um. Toda saída aceita `--json`; em erro, o JSON é `{ "error": { "code", "message", "details" } }`.

| Subcomando | O que faz |
|---|---|
| `init` | Cria a geração a partir de um arquivo JSON (`--config`). `--replace` exige `--reason`. |
| `check` | Valida configuração, modelo, `Location`, branch e presença de credencial. **Seguro, sem efeito.** |
| `plan` | Simula o `launch`: por sessão, se seria criada ou adotada e o SHA-256 do prompt de bootstrap. **Seguro, sem efeito.** |
| `launch` | Cria ou adota as sessões e só marca `verified` com as quatro evidências (veja abaixo). |
| `status` | Geração ativa e anterior, atividade medida e veredito de liveness. Somente leitura. |
| `send` | Enfileira uma mensagem na inbox de uma sessão (`--to` ou `--session-id`, `--message-file`). |
| `broadcast` | Valida todos os destinatários e então enfileira em cada sessão `verified`. |
| `checkpoint` | Grava o checkpoint de uma sessão. |
| `close` | Fecha a geração quando todas as sessões têm checkpoint íntegro e estão ociosas. |
| `transition` | Liga uma geração fechada à ativa, conferindo recibo e digest do registro. |
| `activate` | Entrega a geração ativa à orquestradora (apenas bootstrap). |
| `dispatch create\|list\|accept` | Cria, lista e aceita despachos com `ORQ-id`. |
| `release` | Passa a posse das árvores de uma sessão para outra (exige o checkpoint do dono). |
| `session replace` | Dá ao mesmo nome uma nova sessão em outro provider/modelo/variant. |
| `block` | Declara por que uma sessão está parada (`human` ou `tool`), ou limpa a declaração. |
| `panel build\|show` | Monta e resume o painel kanban. Somente leitura. |
| `audit export` | Grava a trilha de auditoria em JSON lines e imprime o digest da cadeia. |

`check` e `plan` não criam sessão, não enfileiram e não gravam registro. Ambos retornam o mesmo resultado em execuções repetidas sem mudança de estado.

### Contrato de despacho

`dispatch create` exige: `scope`, `owner` (nome registrado na geração ativa), `base`, `head`, `dor`, `dod`, `proof`, `exclusions` (lista não vazia), `exigidos` e `milestone`. A resposta nomeia todos os campos que faltam de uma vez.

- O `ORQ-id` tem o formato `ORQ-<geração>-<NNN>`, com sequência monotônica por geração.
- `exigidos` é um subconjunto não vazio de `jira`, `ci`, `merge`, `deploy`, `acceptance`; o default é `ci,merge,acceptance`.
- `proof` precisa declarar ao menos um item verificável (comando com saída, URL ou caminho de artefato); uma palavra como `ok` é recusada.
- Com git disponível, `base` é resolvida e o despacho grava `validation: verified`. `head` inexistente mas válida fica `unknown`, com o motivo.
- Texto com aparência de segredo é recusado.

### Formato de checkpoint

O corpo do checkpoint é um arquivo UTF-8 com seis seções obrigatórias, cada uma preenchida:

```
## Resultado
## Fontes
## Comandos e provas
## Limites
## Próximos passos
## Posse da árvore
```

O servidor grava o SHA-256 do corpo e varre o texto em busca de segredos. Texto que parece segredo só passa com `--allow-secret-like-text --reason <motivo>`, que fica auditado. `--export-dir` também grava o arquivo em um diretório que não esteja dentro de uma árvore git.

### `queue` e `steer`

`send` aceita `--delivery queue` (default) ou `--delivery steer`:

- `queue` enfileira a mensagem; ela é entregue quando a sessão estiver livre.
- `steer` entrega no próximo limite de passo da execução em curso.

Qualquer outro valor é rejeitado antes de qualquer efeito. O destino precisa estar `verified`; enviar para a própria sessão exige `--allow-self`. Com `--idempotency-key`, a mesma chave devolve o mesmo `message_id` e uma única linha de inbox; sem chave, cada chamada é uma mensagem nova.

### Prova de enfileiramento, não de leitura

A resposta de `send` e `broadcast` contém `message_id`, nome, `session_id`, `delivery` e o instante. Ela prova que a inbox **aceitou** a mensagem. Ela não afirma que a sessão leu, processou ou concluiu nada. A auditoria guarda `message_sha256` e `message_id`, nunca o texto.

### Evidência de `launch`

Uma sessão só vira `verified` com as quatro evidências duráveis: o modelo medido é o esperado, o marcador foi admitido na inbox, o marcador foi entregue e uma execução começou depois da admissão. Sem elas a sessão permanece `starting` e o erro nomeia a evidência que falta.

### Liveness

`status` mede atividade pelo relógio durável da sessão e pelos eventos de execução, nunca por uma frase do agente. O veredito é um destes:

| Veredito | Significado |
|---|---|
| `working` | Há execução em curso. |
| `idle` | A sessão está ociosa. |
| `stalled` | Sem atividade além de `liveness.stale_after` (default 60 minutos). |
| `unknown` | Não há medição suficiente. |

`working_stale` é um sinalizador separado: a execução está em curso, mas sem progresso medido. `working` prova execução, não progresso; uma sessão esperando aprovação de permissão continua `working` e recebe `working_stale`.

### Formato do `kanban.json`

`panel build` devolve um documento compatível com o `kanban.json` do painel existente: `versao_schema`, `revisao`, `atualizado_em`, `colunas`, `cards{}` e `fonte{}`. Cada card tem `id`, `titulo`, `coluna`, `agente`, `prioridade`, `refs`, `evidencias` e `estagios`.

- `estagios` tem as cinco chaves `jira`, `ci`, `merge`, `deploy` e `acceptance`, cada uma com `status` (`verified`, `failed` ou `unknown`), `evidence` (tipo, referência e instante, ou `null`) e `source`.
- Cada card declara `exigidos[]`. Um card só está `done` quando todo estágio exigido é `verified`.
- Estágio exigido sem evidência é `unknown`: o card fica com `progressa: false` e o estágio entra em `desconhecido[]`. Nenhum card com `desconhecido[]` mostra barra de progresso.
- Card sem nenhuma fonte configurada aparece em `backlog` com todos os estágios `unknown`.

`panel build --out <arquivo>` grava o documento no caminho pedido. `panel show` imprime o resumo por coluna.

### Painel no TUI (somente leitura)

A rota `squad-board` do TUI (`/squad-board`, atrás de `experimental.squad_board`) mostra o painel como
board kanban — colunas, cards, sessões e liveness da geração ativa — direto do servidor, sem réplica de
regra de negócio e **sem escrita alguma**: nenhuma mutação do squad é feita por essa tela. `j`/`k`
movem o foco entre cards, `h`/`l` trocam de coluna, `enter` abre o detalhe do card, `r` força um
refresh e `esc` volta. Para agir sobre o squad — aceitar um dispatch, enviar mensagem, fechar geração —
use os comandos normais (`squad send`, `squad dispatch accept`, etc.), nunca a tela.

Consumo fora do TUI continua por `squad panel show`, pelo plugin externo `painel-kanban` e pelo arquivo
`kanban.json`. As fontes de Jira e CI entram por comandos somente leitura configurados em `squad.panel`.

### Limites e segurança

O `squad` **não** faz o seguinte:

- não aprova nada: aceite, revisão e aprovação continuam humanos;
- não faz merge, push nem deploy;
- não libera execução produtiva: `activate` é apenas bootstrap e a geração permanece sem liberação produtiva;
- não lê nem afirma o que a sessão leu: só prova enfileiramento;
- não abre terminal nem automatiza janela de outro programa.

Segurança e termos de uso:

- Nenhuma credencial é gravada no registro, na auditoria ou no checkpoint. `check` e `status` informam apenas a **presença** de credencial e o prazo de expiração.
- A auditoria é append-only, encadeada por hash e sem corpo de mensagem; o campo `detail` passa por redação de tokens (`Bearer`, `sk-`, `ghp_`, `AKIA`, chaves `token` e blocos PEM).
- O texto da mensagem sempre vem de `--message-file`; nenhum caminho interpola texto em shell.
- Use somente contas e credenciais que o seu contrato com cada provider permite para uso automatizado e em paralelo. Respeite os termos de uso e os limites de taxa do provider; o `squad` não contorna nenhum deles.

### Demonstração sem credencial

`script/demo-squad.ts` roda a camada inteira contra um servidor local em loopback, com um **provider falso** injetado pela opção `fetch` do servidor. Não precisa de chave de API, de rede externa nem de modelo local instalado.

```sh
cd packages/cli
bun run script/demo-squad.ts
```

O roteiro cria duas sessões, roda `check` e `plan`, faz o `launch`, enfileira uma mensagem e mostra o evento `session.inbox.delivered`, grava um checkpoint por sessão, fecha a geração e executa a transição para a seguinte. Na verificação de `check` o item `model` aparece como `fail`: o provider falso é injetado no servidor e não consta do catálogo de modelos.

`--server <url>` executa o mesmo roteiro contra um servidor já iniciado (senha em `OPENCODE_PASSWORD`). Esse servidor precisa ter `squad.enabled: true` e um provider chamado `demo` com o modelo `demo-model`. Quando o servidor não responde, a demonstração termina com código 1 e uma mensagem como `demo-squad: cannot reach a server at <url>`.
