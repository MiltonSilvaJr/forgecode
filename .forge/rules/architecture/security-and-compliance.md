---
title: Segurança e Conformidade Regulatória
applies_to:
  - all
priority: high
last_reviewed: 2026-05-08
---

# Segurança e Conformidade Regulatória

## Controles Obrigatórios

- Autenticação forte em todas as APIs e interfaces
- RBAC com verificações explícitas — nenhuma rota sensível sem controle de acesso
- Audit trail completo de ações sensíveis (quem, quando, o quê, de onde)
- Audit data imutável (append-only, triggers de banco)

## Conformidade

### LGPD (Lei Geral de Proteção de Dados)

- **LGPD by design** — privacidade considerada desde o design da feature
- Coleta mínima de dados pessoais (data minimization obrigatória)
- Logs **nunca** contêm PII sem mascaramento
- Bases legais documentadas para cada categoria de dado pessoal coletado
- Direitos dos titulares implementados: acesso, correção, portabilidade, esquecimento

### PCI DSS (quando aplicável — <service> Payment Processing)

- Nenhum dado de cartão (PAN, CVV, track data) em logs, banco de aplicação ou código
- Tokenização obrigatória para dados de cartão
- Comunicação com adquirentes via TLS 1.2+
- Auditoria de acesso a dados de pagamento

## Gestão de Vulnerabilidades — Política Zero Tolerance

**Vulnerabilidades conhecidas com fix disponível = bloqueio imediato.**

| Severidade | Fix disponível | Ação |
|---|---|---|
| Critical / High / Medium / Low | Sim | Corrigir antes de qualquer merge para main |
| Qualquer | Não | Registrar waiver em `.security-waivers.yml` com owner + reapproveBy |

- CI/CD falha na detecção de CVE sem waiver aprovado
- Dependências com CVE devem ser atualizadas ou substituídas
- Waivers expirados bloqueam builds

### Processo de Waiver

1. CVE sem fix: abrir entrada em `.security-waivers.yml` com `owner`, `reason`, `reapproveBy`
2. CI valida via `_validate-waivers.yml`
3. Waivers com `reapproveBy` passado → CI falha
4. PRs com waivers próximos do vencimento recebem comentário automático

## Trivy (Scan de Imagens)

- Trivy obrigatório em todo build de imagem Docker em CI
- Configuração em `.trivyignore` (CVEs sem fix confirmado)
- Cross-ref: `docker-image-security.md`

## DAST (OWASP ZAP)

- Scan semanal automático contra staging (`security-owasp-zap.yml`)
- Findings HIGH+ bloqueiam deploy; MEDIUM registrados em backlog
- Procedimento de revisão e waivers em `docs/security/dast-zap.md`
- Política completa de vulnerabilidades: `docs/policies/vulnerability-tolerance.md`

## Proibições Explícitas

- PII em logs sem mascaramento
- Dados de cartão fora do escopo PCI
- CVE com fix disponível em produção
- Waivers sem `reapproveBy` definido
- Deploy com dependências vulneráveis sem waiver aprovado
