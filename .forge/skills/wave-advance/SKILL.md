---
name: wave-advance
description: Verifica se a wave atual pode ser fechada e avança para a próxima wave elegível. Checa stories done, deferrals e gates antes de fechar; nega avanço se bloqueado. Operado por scripts deterministas (wave-ops.sh + deferral-ops.sh).
---

# Wave Advance (§17.7)

Skill de orquestração de waves — não lê artefatos de spec, opera apenas em waves.json/progress.json/deferrals.json.

## Protocolo

### Entrada

Receba: `change_id` + `current_wave_id`.

### Verificações antes de fechar a wave atual

1. **Stories done:**
   ```bash
   # Lê apenas progress.json
   bash .forge/scripts/wave-ops.sh status <change-id>
   ```
   Se `stories: done < total da wave`: wave não pode fechar — liste as stories pendentes e pare.

2. **Deferrals (apenas na última wave):**
   ```bash
   bash .forge/scripts/deferral-ops.sh status <change-id>
   ```
   Se `OPEN (...)`: não pode concluir — escale via HITL.

3. **Gate da wave**: não capture nem repasse veredito — o `close` executa os gates declarados em `runtime.gates` ele mesmo. A skill `gate-runner` continua valendo para os gates baratos POR TASK dentro de `/forge:implement`, que são outra coisa.

### Fechar a wave atual

```bash
bash .forge/scripts/wave-ops.sh close <change-id> <wave-id>
```

Sem `--gate`. O exemplo anterior passava `--gate OK` literal — o que fechava a wave sem executar nada, porque o `close` aceitava o veredito de quem o chamava.

### Abrir a próxima wave elegível

```bash
# Identifique a próxima wave com status pending cujas depends_on estão closed
bash .forge/scripts/wave-ops.sh open <change-id> <next-wave-id>
```

Se não houver próxima wave: todas as waves estão `closed` — o change está pronto para `/forge:close`.

### Saída

Uma linha de confirmação:

```
W1 fechada → W2 aberta (stories: STORY-04, STORY-05, STORY-06)
```

ou

```
Todas as waves fechadas — pronto para /forge:close (verifique deferrals).
```

## Regras

- Não leia tasks.md, design.md ou qualquer artefato do change — apenas os arquivos JSON de estado.
- Wave com `gate_result: FAIL` jamais fecha — corrija e re-invoque.
- A última wave requer `deferral status OK` antes de fechar.
