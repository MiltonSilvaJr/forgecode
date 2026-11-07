---
title: Classificação PII/PCI — dados como código, mascaramento, fronteira PCI DSS 4.0.1
applies_to:
  - backend
  - platform
priority: high
last_reviewed: 2026-07-20
based_on: []
pack: pii-pci
opt_in: true
---

# Classificação PII/PCI — dados como código, mascaramento, fronteira PCI DSS 4.0.1

## Classificação de dados como código

Todo campo que carrega PII, PAN ou outro dado sensível é declarado em `data-classification.schema.json`
(mapa `field → { classification, masking, tokenization_boundary }`) — a classificação vive versionada
junto do código, não em planilha ou conhecimento tácito de time. `classification` assume um dos quatro
valores: `pii` (dado pessoal — CPF, e-mail, endereço), `pan` (Primary Account Number — número de cartão),
`sensitive` (dado sensível não-PII/PAN — ex.: senha, token de sessão) ou `public` (sem restrição).

- Um campo sensível sem entrada correspondente no mapa é **finding** do gate `check-data-governance`
  (REQ-12b) — a ausência de classificação é tratada como classificação incorreta, nunca como omissão
  neutra.
- `masking` descreve a estratégia de mascaramento aplicada em log/exibição (ex.: `"last4"`,
  `"redact_full"`, `"hash_sha256"`) — string livre, mas obrigatória; não há campo classificado sem
  estratégia de mascaramento declarada.
- `tokenization_boundary` (booleano) marca se o campo cruza a fronteira de tokenização (ver abaixo).

## Mascaramento em log (sempre enforce)

- PAN, CVV, track data e qualquer campo `classification: pii` ou `classification: sensitive` **nunca**
  aparecem em log, trace, decision-log ou mensagem de erro sem mascaramento aplicado antes da emissão.
- Esta é uma das duas invariantes inegociáveis da camada de imposição (junto com deny-by-default de
  `authz-pdp-pep.md`): o gate `check-data-governance` trata PAN/PII em log como violação sempre em
  `mode: enforce`, independentemente do `mode: warn` global de adoção do repositório.
- Mascaramento acontece na borda de emissão (logger, middleware de erro, exportador de trace) — nunca
  depender de que quem consome o log aplique a máscara depois. O dado bruto não deve deixar o processo
  que o mascarou.
- O decision-log do PDP (ver `authz-pdp-pep.md`) está sujeito ao mesmo regime: o `input` da avaliação
  Rego não é logado bruto quando contém claim classificada como PII/sensível.

## Fronteira de tokenização

- Dados de cartão (PAN) que precisam ser armazenados ou retransmitidos são substituídos por um token
  opaco no primeiro ponto de contato com o sistema — a fronteira de tokenização. Do outro lado da
  fronteira, o código de domínio manipula apenas o token; o PAN real nunca circula além do serviço/
  componente responsável pela tokenização (tipicamente um gateway de pagamento ou provedor de
  tokenização dedicado).
- `tokenization_boundary: true` no mapa de classificação marca explicitamente que aquele campo é
  substituído por token antes de cruzar para o restante do sistema — é o sinal declarativo que o gate
  usa para diferenciar "campo PAN vive só na borda" de "campo PAN vazou para o domínio".
- Um campo `classification: pan` com `tokenization_boundary: false` é um sinal de risco a ser
  justificado explicitamente na revisão — não é proibido por si (ex.: componente que *é* o serviço de
  tokenização), mas exige que a fronteira esteja documentada em outro lugar do desenho.

## Mapa controle → PCI DSS 4.0.1

| Controle desta rule/gate | Requisito PCI DSS 4.0.1 | Como é coberto |
|---|---|---|
| Classificação de dados como código + mascaramento em log | **Req 3** (proteção de dados armazenados do titular do cartão) | `data-classification.schema.json` declara `classification`/`masking` por campo; `check-data-governance` reprova PAN/PII sem mascaramento (sempre enforce) |
| — | **Req 4** (proteção de dados do titular do cartão em trânsito) | Fora do escopo de gate estático desta capability — controle de transporte (TLS 1.2+) é responsabilidade de infraestrutura/rede, coberto em `security-and-compliance.md` |
| PDP/PEP, deny-by-default | **Req 7** (restringir acesso por necessidade de conhecimento) | Coberto pela rule irmã `authz-pdp-pep.md` — par PDP/PEP em OPA/Rego, ver ADR-0002 |
| Identificação e autenticação de usuários e componentes | **Req 8** (identidade) | **Fora de escopo desta capability** — fronteira explícita: fica no `auth-service` de cada consumidor (emissão/validação de JWT, ver `jwt-authentication.md`). O PEP consome claims como insumo, nunca decide identidade. |
| Fronteira de tokenização | **Req 3** (minimização de exposição de PAN armazenado) | `tokenization_boundary: true` no mapa de classificação; PAN não circula além do ponto de tokenização |
| Audit trail append-only das decisões sobre dado sensível | **Req 10** (rastrear e monitorar todo acesso a componentes e dados do titular do cartão) | Imposição **declarativa** — mapa de eventos auditáveis exigido no template de requirements (REQ-13) + rule `domain/audit-immutability.md` (ver abaixo) |

### Fronteira explícita: Req 7 vs. Req 8

Esta capability (autorização + classificação de dados) cobre **Req 7** — quem pode acessar o quê,
decidido pelo par PDP/PEP — e a parcela de **Req 10** referente a audit trail de acesso a dado sensível.
**Req 8** (identificação e autenticação — "quem é o usuário", emissão/validação de credenciais) fica
**fora de escopo**: é responsabilidade do `auth-service` de cada consumidor. O PEP recebe claims de um
JWT já autenticado e as usa como insumo de contexto para a decisão de autorização (ver
`authz-pdp-pep.md` — "Claims JWT são insumo, nunca o mecanismo de decisão"); nunca reimplementa
autenticação nem decide identidade.

## Audit trail (Req 10) — imposição declarativa

A auditabilidade de acesso e mutação de dado sensível não é provada por varredura estática de código —
"toda mutação emite audit event" não é detectável de forma genérica sem alto falso-positivo. A garantia é
a tríade declarativa: (i) invariante de constitution (item 7, auditabilidade append-only); (ii) mapa de
eventos auditáveis exigido no template de requirements quando o change toca `layer:api`/dados (REQ-13);
(iii) esta rule referenciando `domain/audit-immutability.md`, que define o mecanismo de imposição real —
tabelas `audit_*` append-only, `REVOKE UPDATE/DELETE` + trigger de banco. A classificação de um campo como
`pii`/`pan`/`sensitive` neste rule-pack é o gatilho para que qualquer tabela que o armazene também siga o
padrão de imutabilidade de `audit-immutability.md` quando o campo compõe um registro de auditoria.

## Anti-padrões (bloqueantes)

- PAN, CVV ou track data em log, trace, decision-log ou mensagem de erro sem mascaramento.
- Campo `classification: pii`/`pan`/`sensitive` sem `masking` declarado no mapa.
- PAN armazenado ou circulando no domínio sem passar pela fronteira de tokenização (`tokenization_boundary`
  ausente ou `false` sem justificativa documentada).
- Reimplementar autenticação (Req 8) dentro desta capability em vez de delegar ao `auth-service`.

## Cross-reference

- `authz-pdp-pep.md` — PDP/PEP que cobre Req 7 (acesso); ADR-0002 (`authz-observability-substrate`) como
  decisão de referência para autorização e observabilidade.
- `jwt-authentication.md` / `jwt-permissions.md` — Req 8 (identidade), fora de escopo desta rule.
- `domain/audit-immutability.md` — mecanismo de imposição da parcela de audit trail (Req 10) que sustenta
  a tríade declarada acima.
- `security-and-compliance.md` — controles gerais de LGPD/PCI e gestão de vulnerabilidades.
- `observability.md` — mascaramento de PII em log como proibição explícita, coerente com esta rule.
