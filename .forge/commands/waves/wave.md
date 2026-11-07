---
description: Gerencia o plano de waves do change ativo — plan (deriva waves das stories), open (abre wave respeitando deps), close (fecha com gate), status (one-line). Artefatos operados por script determinista (nunca modelo relendo tudo).
argument-hint: "plan|open|close|status [<change-id>] [<wave-id>]"
---

# /forge:wave — gerenciamento de waves

Argumentos: `$ARGUMENTS` (subcomando + change-id opcional + wave-id onde aplicável).

Todos os subcomandos deleguem ao script determinista — não leia nem reescreva waves.json nem progress.json diretamente:

```bash
bash .forge/scripts/wave-ops.sh <sub> <change-id> [<wave-id>] [--gate OK|FAIL]
```

## Subcomandos

### plan

Deriva `waves.json` a partir das stories em `stories/` do change.

```bash
bash .forge/scripts/wave-ops.sh plan <change-id>
```

- Pré-condição: `dev_loop.sharded: true` no manifest (`/forge:shard` já rodado).
- Resultado: `waves.json` + `progress.json` inicializados; one-line de resposta.

Wave 0 sempre contém stories sem dependências (fundação). Waves subsequentes respeitam topologia.

### open

Abre uma wave — **recusa se alguma dependência (`depends_on`) não estiver `closed`**.

```bash
bash .forge/scripts/wave-ops.sh open <change-id> <wave-id>
```

- Se a wave já estiver `open`: erro (não é idempotente por design — abrir duas vezes indica erro de orquestração).
- Emite one-line de confirmação.

### close

Fecha a wave aberta. **O `close` executa os gates ele mesmo** — não passe veredito:

```bash
bash .forge/scripts/wave-ops.sh close <change-id> <wave-id>
```

- Roda `run-gates.sh`, que executa os gates declarados em `runtime.gates` do `FORGE.md`. Reprova se algum falhar; grava em `waves.json` o resultado **observado**, com procedência (`executed:OK (N gate(s))` ou `executed:NO-GATES` quando o projeto não declarou nenhum).
- **Só a fase `source`.** `runtime.gates` não é lista plana: cada entrada tem uma fase, declarada na forma block-sequence (`- name: … / phase: pre-deploy`) ou implícita como `source` na forma CSV escalar. O fechamento de wave executa **apenas** `phase: source` — a árvore de fontes. Gate de `pre-deploy`/`post-deploy` existe porque o artefato implantável ainda não existe aqui, e ele **não roda** neste ponto: fechar a wave verde não afirma nada sobre digest publicado, manifesto renderizado ou cluster no ar. Ver `rules/testing/gate-delivery-channel.md`.
- `--gate FAIL` continua aceito e recusa sem gastar execução — afirmação negativa do chamador não precisa de prova. **`--gate OK` não substitui execução**: os gates rodam de todo modo e o resultado real decide.
- Antes, o `close` assumia `OK` na ausência de `--gate`, e este comando mandava capturar o resultado de um `run-gates.sh` que **não existia** no repositório. Quem fechava a wave assinava o próprio laudo, sem ter caminho honesto disponível.
- **Última wave**: antes de fechar, verifique que não há `deferral` `open`:
  ```bash
  bash .forge/scripts/deferral-ops.sh status <change-id>
  ```
  Se houver `OPEN (...)`, não feche — escale via HITL.

### status

Resumo de uma linha do estado atual.

```bash
bash .forge/scripts/wave-ops.sh status <change-id>
```

Exemplo de saída: `OK: waves: 1/3 closed; open: W1; stories: 4/9; deferrals: 0 open`

## Regras

- Dados em waves.json/progress.json são fonte de verdade — nunca use o modelo para reconstruir estado a partir dos artefatos do change.
- `/forge:wave close` na última wave + todos os deferrals `tested` → pré-condição para `/forge:close`.
- Sem `wave close --gate FAIL` — gate com FAIL é bloqueante; corrija e reabra.
