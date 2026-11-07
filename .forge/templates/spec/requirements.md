# Requirements — <CHANGE_ID>

> Requisitos do change `<CHANGE_ID>`. Cada requisito é verificável e rastreável à proposal.
> Marque incertezas com `NEEDS CLARIFICATION` — o change só atinge `requirements-ready` quando não restar nenhuma (resolvidas via `/forge:clarify`).

## REQ-01 — <título curto>

- **Quando** <gatilho/condição>, **o sistema deve** <comportamento observável>.
- **Critérios de aceite:**
  - [ ] <condição verificável 1>
  - [ ] <condição verificável 2>
- **Rastreia:** proposal §2
- **Notas:** <restrições, dados, limites>

## Requisitos não funcionais do change (quando houver)

- **NFR-01 —** <meta mensurável com unidade> (método de medição; fonte de dados)

## Checklist de cobertura de superfície

> Preencha para **todo** parâmetro/configuração/flag exposto por este change (tela, endpoint,
> CLI, variável de ambiente, campo de config). O objetivo é detectar em `/forge:analyze` — antes
> do marco, não depois — parâmetros implementados sem superfície de acesso mapeada (ou
> vice-versa). Uma auditoria pós-marco já encontrou lacunas desse tipo tarde demais.

| REQ | Parâmetro/config exposto | Superfície (tela/endpoint/CLI) | Coberto por task |
|---|---|---|---|
| REQ-01 | <nome do parâmetro> | <ex.: `PATCH /settings`, tela Configurações, `--flag`> | TASK-NN |

- Nenhuma linha "N/A" sem justificativa — se o requisito não expõe parâmetro configurável, diga
  explicitamente "sem parâmetro exposto" em vez de omitir a linha.
- Todo parâmetro sem superfície mapeada é `NEEDS CLARIFICATION` até ser resolvido.

## Superfícies de API e dados

> As quatro seções abaixo são obrigatórias apenas quando o manifest declara `affects_surfaces`
> incluindo `api` e/ou `data` (proporcionalidade — NFR-03). Change que não toca essas superfícies
> pode remover esta seção inteira sem penalidade no `validate-spec`.

## Mapa endpoint → ação → recurso → policy

> Obrigatório quando `affects_surfaces` inclui `api`. `validate-spec` reprova a ausência desta
> tabela preenchida (REQ-13).

| Endpoint | Ação | Recurso | Policy | REQ |
|---|---|---|---|---|
| `<método> <path>` | <ação, ex.: read/write/delete> | <recurso protegido> | <policy/regra PDP aplicada> | REQ-NN |

## Classificação de dados

> Obrigatório quando o change manipula dado sensível (`affects_surfaces` inclui `api`/`data`).

| Dado/campo | Classificação (pii\|pan\|sensitive\|public) | Mascaramento | Fronteira de tokenização |
|---|---|---|---|---|
| <nome do campo> | <classificação> | <regra de mascaramento em log> | <onde o dado é tokenizado, se aplicável> |

## Checklist de sinais OTel por boundary

> Obrigatório quando este change adiciona ou altera um boundary de serviço.

- [ ] <boundary> emite **span** (trace) cobrindo a operação.
- [ ] <boundary> emite **log estruturado** correlacionado ao trace (`trace_id`/`span_id`).
- [ ] <boundary> emite **métrica** de golden signal (latência/erro/tráfego/saturação).

## Mapa de eventos auditáveis

> Obrigatório quando `affects_surfaces` inclui `api`. Todo evento é append-only — superfície
> declarativa da família *audit trail* (REQ-01(c)). `validate-spec` reprova a ausência desta
> tabela preenchida (REQ-13).

| Mutação | Audit event | Payload (sem PII/PAN crua) | REQ |
|---|---|---|---|
| <ação que muda estado> | <nome do evento auditável> | <campos do evento, mascarados> | REQ-NN |

## Fora de escopo (reafirmação)

- <item herdado da proposal §3>
