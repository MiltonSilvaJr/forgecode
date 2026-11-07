# Bugfix — <CHANGE_ID>

> Análise do bug do change `<CHANGE_ID>`. Este artefato substitui `requirements.md` no tipo `bugfix`.
> Marque incertezas com `NEEDS CLARIFICATION`. O change só atinge `requirements-ready` quando a análise estiver completa e sem pendências.

## 1. Comportamento atual (incorreto)

O que acontece hoje, com passos de reprodução determinísticos e evidência (log, screenshot, teste falhando).

## 2. Comportamento esperado

O que deveria acontecer, rastreável a requisito/spec/baseline existente quando houver.

## 3. Comportamento que deve permanecer inalterado

Fronteira explícita da correção — o que NÃO pode mudar como efeito colateral.

## 4. Root cause

Causa raiz (não o sintoma). Arquivo/função/condição; por que o defeito foi introduzido e por que não foi detectado.

## 5. Testes de regressão

Protocolo Red-first (ver `rules/testing/regression-red-first.md`): o teste que reproduz o defeito é escrito **antes** da correção, roda na árvore pré-correção e é **observado** falhando por comportamento — nunca por erro de compilação ou fixture ausente. A observação é registrada com `/forge:red record` e reproduzida por `/forge:red replay`; declaração sem replay não vale como evidência. Quando o Red for genuinamente impossível, use `/forge:red waive --reason <non-behavioral|no-test-infra|external-unreproducible|hotfix-under-incident>` — não invente teste para cumprir tabela.

Além do teste de reprodução:

- Propriedades/PBT quando o domínio justificar (ex.: invariantes monetárias).
- Testes que protegem a seção 3 (comportamento que deve permanecer inalterado).

### 5.1 Declaração de evidência do Red

Preencha `evidence/red/red-evidence.json` (schema `red-evidence/v1`) com:

| Campo | Conteúdo |
|---|---|
| `test_path` / `test_id` | Arquivo e caso de teste que reproduz o defeito |
| `command` | Comando que executa apenas esse teste |
| `base_commit` | Commit da árvore pré-correção onde o Red foi observado |
| `failure_pattern` | Padrão que a saída da falha na base precisa casar no replay |
| `excerpt` / `excerpt_sha256` | Trecho e hash da saída de falha observada |
| `classification` | `behavioral` (Red válido), `setup-exception` (exceção de setup de fixture — Red só com `failure_pattern` que case) ou `build-error` (ruído, não conta) |
| `reproduces` | Seção deste documento que o teste reproduz — normalmente §1 |
| `fix_files` | Arquivos alterados pela correção |
| `waiver` | Motivo tipado, nota e ids de deferral/ledger quando o Red não for possível |

## 6. Rastreabilidade

Issue/report de origem, specs/baseline relacionados.
