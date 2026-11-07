---
title: Versionamento de Documentos de Especificação
applies_to:
  - docs/product/modules/**
priority: high
last_reviewed: 2026-05-08
---

# Versionamento de Documentos de Especificação

> Aplica-se a: PRD, FRD, NFRD, TRD e qualquer documento de especificação em `docs/product/modules/`.
> Não aplica-se a: ADRs (imutáveis após `accepted`), READMEs, runbooks e playbooks.

---

## Esquema de Versão

Todos os documentos de especificação seguem **SemVer** com três componentes: `MAJOR.MINOR.PATCH`

```
MAJOR — reestruturação significativa do documento (reorganização de seções, mudança de escopo)
MINOR — adição de conteúdo novo (nova seção, nova persona, novo RF, novo RNF, novo padrão técnico)
PATCH — correção de texto existente (factual, editorial, sem adição de novo conteúdo)
```

---

## Ciclo de Vida de Status

| Status | Significado | Versionamento permitido |
|--------|-------------|------------------------|
| `Rascunho` | Documento em elaboração — não publicado formalmente | Correções e adições não incrementam versão (trabalho em progresso) |
| `Rascunho para revisão` | Pronto para revisão técnica/negócio | Correções não incrementam versão; adições incrementam MINOR |
| `Aprovado para desenvolvimento` | Baseline aprovado — documento publicado | Toda mudança incrementa a versão conforme tabela SemVer |
| `Supersedido` | Substituído por nova versão — mantido para referência histórica | Sem edições permitidas |

**Regra crítica:** documentos em status `Rascunho` ou `Rascunho para revisão` podem ser corrigidos sem bump de versão, pois ainda não foram formalmente publicados. A partir de `Aprovado para desenvolvimento`, **toda alteração — inclusive correção de uma palavra — exige bump de PATCH**.

---

## Exemplos de Aplicação

| Alteração | Status atual | Novo status | Versão atual | Nova versão |
|-----------|-------------|-------------|-------------|------------|
| Corrigir "30 minutos" → "2 horas" no FRD | Rascunho para revisão | Sem mudança | v1.0 | v1.0 (sem bump) |
| Adicionar nova persona P-08 ao PRD | Rascunho para revisão | Sem mudança | v3.0 | v3.0 (sem bump) |
| Corrigir erro factual em documento aprovado | Aprovado | Aprovado | v1.0 | v1.0.1 |
| Adicionar nova seção de RNF | Aprovado | Aprovado | v1.0.1 | v1.1.0 |
| Reestruturar o FRD após mudança regulatória | Aprovado | Aprovado | v1.1.0 | v2.0.0 |
| Aprovação formal do PRD v3.0 | Rascunho para revisão | Aprovado | v3.0 | v3.0 (bump apenas de status) |

---

## Cabeçalho Obrigatório de Todo Documento de Especificação

```markdown
# <Sigla> — <Nome do Projeto>
**<Título do Documento>**

- **Versão:** X.Y.Z
- **Data:** AAAA-MM-DD (data da última alteração de versão ou de status)
- **Status:** Rascunho | Rascunho para revisão | Aprovado para desenvolvimento | Supersedido
- **Referência pai:** <caminho relativo do documento pai, se houver>

### Histórico de Versões

| Versão | Data | Status | Descrição da alteração |
|--------|------|--------|----------------------|
| X.Y.Z  | AAAA-MM-DD | Atual | Descrição |
| X.Y.Z-1 | AAAA-MM-DD | Anterior | Descrição |
```

---

## Responsabilidade de Atualização

- **Agentes de IA:** ao editar um documento de especificação, verificar o status atual antes de qualquer bump de versão. Se o documento estiver em `Rascunho` ou `Rascunho para revisão`, não incrementar a versão — apenas editar o conteúdo.
- **Time de produto/arquitetura:** responsável por mudar o status de `Rascunho para revisão` para `Aprovado para desenvolvimento`, o que congela o baseline de versionamento.

---

## Relação entre Documentos Filhos e Pai

Mudanças no PRD que impactem o escopo de um documento filho (FRD, NFRD, TRD) podem ou não exigir bump no filho:

| Tipo de mudança no PRD | Impacto no filho |
|-----------------------|-----------------|
| Adição de persona | Verificar se o fluxo do FRD cobre a nova persona; se não, adicionar — MINOR no FRD |
| Correção de restrição | Verificar se reflete em regras de negócio do FRD; se sim — PATCH no FRD |
| Novo RF | O FRD deve detalhar o novo RF — MINOR no FRD |
| Novo RNF | O NFRD deve detalhar — MINOR no NFRD |
| Decisão técnica nova | O TRD deve refletir — MINOR no TRD |
