---
name: new-adr
description: Cria um novo ADR no formato MADR com numeração sequencial automática em docs/product/adr/.
arguments:
  - name: title
    description: Título do ADR em português (será convertido para kebab-case no nome do arquivo)
    required: true
---

# /forge:new-adr

Cria um novo Registro de Decisão Arquitetural (ADR) com numeração sequencial automática.

> **Baseline disponível (MVP3+):** se `.forge/product/current/adr/` existir neste repo, ADRs novos pertencem ao **baseline** — siga `/forge:adr new` (este comando permanece para repos no layout legado `docs/product/adr/`; lá, `docs/product/` vira publicação gerada após a adoção do baseline).

## Passos a Executar

1. **Determinar próximo número**
   - Listar arquivos em `docs/product/adr/` com padrão `[0-9][0-9][0-9][0-9]-*.md`
   - Pegar o maior número e incrementar
   - Se não houver nenhum, começar em `0002` (0001 já existe)

2. **Derivar nome do arquivo**
   - Converter `title` para kebab-case em inglês (traduzir se necessário para o nome do arquivo)
   - Formato: `NNNN-<title-in-kebab-case>.md`

3. **Criar arquivo** a partir de `docs/product/adr/_template.md`
   - Substituir `{{TITLE}}` pelo título em pt-BR
   - Substituir `{{DATE}}` pela data atual YYYY-MM-DD
   - Substituir `{{STATUS}}` por `Proposto`
   - Deixar demais placeholders para preenchimento

4. **Atualizar índice** em `docs/product/adr/README.md`
   - Adicionar linha na tabela com número, título, status `Proposto` e data

5. **Abrir o arquivo** para edição

## Validações Pós-Execução

- [ ] Arquivo criado com numeração correta (sem pular números, sem duplicar)
- [ ] Status inicial: `Proposto`
- [ ] Índice `docs/product/adr/README.md` atualizado
- [ ] Todos os `{{PLACEHOLDER}}` visíveis (preenchimento é responsabilidade do autor)
