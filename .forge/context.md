# Context — OpenCode

> Durable stack/user/convention context (Layer 1). Keeps `FORGE.md` focused on governance.
> Inspired by USER/RULES layer separation patterns; aligned with Spec Kit's constitution
> and OpenSpec's project.md. Mutable assistant memory is intentionally NOT a Forge concept —
> durable state lives in the spec lifecycle and manifests.

## Project

- **What it is:** AI-powered development tool
- **Primary stack:** _(filled by `/forge:init` scan — see FORGE.md `runtime:`)_
- **Structure:** _(filled by `/forge:init` scan)_
- **Identity extras:** `issuer` (JWT issuer for display/examples, when applicable): _(set by the
  platform team; mirrored into the generated AGENTS.md identity block for agent compatibility)_

## Team stack defaults

C#/.NET 8+, React, Go, TypeScript, PostgreSQL, MongoDB, Redis, Kubernetes, AWS / Azure / GCP -
Google Cloud Platform. Regulated context: PCI DSS, fintech, PAT - Programa de Alimentação do
Trabalhador, mobilidade urbana. Local dev environment: Docker Desktop (compose as canonical
service definition).

## Cross-project conventions (always apply)

- Repository names never embed technology (`RoleRepository`, not `PostgresRoleRepository`;
  technology goes in the description field).
- "Objeto de Valor" always written in full — never abbreviated.
- Field names in stories/models always in English; metrics referenced generically
  ("Métricas", not "Métricas Prometheus").
- No dots inside Mermaid diagram labels; no em-dash in labels.
- Diagrams: Mermaid text is the versioned source of truth; elaboration and visual maintenance
  go through the draw.io MCP (`drawio` server / `/drawio:drawio` plugin) when available, with
  the deterministic converter as the CI/offline fallback (`rules/conventions/diagram-tooling.md`).
- Money stored as integer cents; monetary rounding follows NBR 5891 (round half to even).
- Multi-tenant isolation via `tenant_id` column (not schema, not RLS) where the platform
  convention applies.
- TSP = Token Service Provider (never Terminal Service Provider) in payments context.
- LLM instruction files and architectural conventions in English (token efficiency); output
  templates and Brazilian regulatory terminology in Portuguese.
- Document version control entries: `NOME - DATA - DESCRIÇÃO` bullets; spec documents follow the
  status ladder Rascunho → Rascunho para revisão → Aprovado para desenvolvimento → Supersedido.
- FRD documents follow the strict section structure; epic template sections: 📌 Épico,
  🎯 Objetivo, 🔗 Dependências Técnicas, 🧩 Estrutura de Persistência.

Detailed, enforceable versions of these conventions live in `.forge/rules/` (with deterministic
hooks/validators where objective). When a rule here conflicts with a repo-specific override in
`.forge/custom/`, the override wins and `forge doctor` reports the divergence.
