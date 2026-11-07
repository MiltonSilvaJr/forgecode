---
title: Proibição de Arquivos de Resumo
applies_to:
  - all
priority: high
last_reviewed: 2026-05-08
---

# Proibição de Arquivos de Resumo

## Regra Principal

Após a conclusão de qualquer atividade, tarefa ou implementação, o resultado **DEVE ser relatado exclusivamente via chat**. Criar arquivos markdown de resumo, progresso ou status é **PROIBIDO**.

## Padrões Proibidos

Qualquer arquivo com os seguintes padrões de nome é proibido:

- `*-summary.md`
- `*-completion.md`
- `*-report.md`
- `*-status.md`
- `*-results.md`
- `*-checkpoint.md`
- `*-verification-report.md`
- `*-implementation-summary.md`
- Qualquer arquivo markdown que documente progresso ou conclusão de trabalho

## Exceções Permitidas

Arquivos markdown **são** permitidos quando representam documentação técnica permanente:

- Guias de configuração e operação
- Documentação de APIs e contratos
- Arquitetura, ADRs e decisões de design
- Runbooks e procedimentos operacionais
- `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`
- Especificações: `requirements.md`, `design.md`, `tasks.md`
- Rules e policies em `.forge/rules/` e `docs/policies/`

## Rationale

Arquivos de resumo:
1. Poluem o repositório com conteúdo transitório
2. Ficam obsoletos rapidamente e criam confusão sobre o estado atual
3. Dificultam a navegação no repositório
4. Não agregam valor técnico permanente

Comunicação de progresso pertence ao **chat**, não ao repositório.
