# Tasks — <CHANGE_ID>

> Tasks do change `<CHANGE_ID>`, ordenadas por dependência. Formato de ID: `TASK-NN` (numeração contínua).
> Status: `[ ]` todo · `[-]` em progresso · `[X]` concluída · `[!]` bloqueada (exige intervenção humana).
> Cada task é atômica (commit de vermelho + commit de implementação), rastreável a um REQ/seção do design, e declara o que toca.
> Cada task declara `Teste (comando)` e `Padrão de falha` (e `Setup do teste`, opcional): o Red é provado por execução (`red-evidence.sh task`) e uma task sem os dois campos é marcada `[!]`, não pulada.

## Wave 1 — <nome da onda>

- [ ] TASK-01 — <título objetivo> (rastreia: REQ-01; paths: `<path>`; depende: —)
  - Teste (comando): `<comando que roda só o teste desta task>`
  - Padrão de falha: `<regex da asserção esperada no vermelho>`
  - Setup do teste: `<comando de preparo>` (opcional)
- [ ] TASK-02 — <título objetivo> (rastreia: REQ-01; paths: `<path>`; depende: TASK-01)
  - Teste (comando): `<comando que roda só o teste desta task>`
  - Padrão de falha: `<regex da asserção esperada no vermelho>`

## Wave 2 — <nome da onda>

- [ ] TASK-03 — <título objetivo> (rastreia: REQ-02; paths: `<path>`; depende: TASK-02)
  - Teste (comando): `<comando que roda só o teste desta task>`
  - Padrão de falha: `<regex da asserção esperada no vermelho>`

## Rastreabilidade

| REQ / Design § | Tasks |
|---|---|
| REQ-01 | TASK-01, TASK-02 |
