---
title: Segurança e Gestão de Segredos
applies_to:
  - all
priority: high
last_reviewed: 2026-05-08
---

# Segurança e Gestão de Segredos

## Postura de Segurança

<project_name> é plataforma de infraestrutura regulada. Princípios:
- Segurança por padrão
- Menor privilégio
- Defesa em profundidade
- Auditoria completa

## Regras Absolutas de Segredos

- **Nenhum segredo em código-fonte**
- **Nenhum segredo em repositórios** (nem em histórico de git)
- **Nenhum segredo em imagens Docker**
- **Segredos injetados exclusivamente em runtime**

## Por Ambiente

### Dev / Local

- `.env` é permitido **apenas** em ambiente local de desenvolvimento
- `.env` **nunca** commitado (`.gitignore` obrigatório)
- Cada desenvolvedor gera suas próprias chaves locais

### Staging e Produção

- Configurações não sensíveis: **Kubernetes ConfigMaps**
- Segredos: **Kubernetes Secrets** gerenciados pelo **External Secrets Operator (ESO)**
- Arquivos `.env` são **proibidos** em stg/prd
- Segredos hardcoded em `docker-compose.yml` ou `appsettings.json` são **proibidos**
- Convenção de path no AWS Secrets Manager: `<env>/<bc-modulo>/<chave>`

### Rotação de Segredos

- Rotação obrigatória (ver frequências em `jwt-authentication.md` para JWT)
- Alterações de Secrets auditáveis
- Aplicações devem suportar reinício controlado para rotação sem downtime

## Dados Sensíveis

- **Minimização obrigatória** — coletar apenas o necessário
- LGPD by design
- Logs **nunca** contêm: senhas, tokens, PAN, CPF, dados biométricos
- Mascaramento obrigatório onde dados de log rozeiam PII

## Autenticação e Autorização

- Autenticação forte obrigatória em todas as APIs
- RBAC explícito — nenhuma rota sensível sem controle de acesso
- Ver `jwt-authentication.md` para JWT e `jwt-permissions.md` para RBAC

## Monitoramento de Segurança

- Todas as ações sensíveis auditáveis: quem, quando, origem, ação
- Dados de auditoria imutáveis
- OWASP ZAP DAST em schedule semanal (após Fase 3.1)
- Trivy em todo build de imagem Docker

## Proibições Explícitas

- Commitar segredos (bloqueia CI)
- Compartilhar credenciais entre pessoas ou serviços
- Contas de serviço genéricas sem rastreabilidade
- Bypassar ConfigMaps/Secrets em stg/prd
- Ignorar alertas de segurança (zero tolerance para CVEs com fix disponível)

## Princípio Final

Se um segredo pode ser visto, ele já está comprometido.
