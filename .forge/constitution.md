# Constitution — OpenCode

> Non-negotiable principles. Everything else (rules, commands, templates) derives from these.
> Evolve via `/forge:constitution` with human approval; never weaken silently.

1. **Spec is the source of truth.** Code is a derived artifact, generated or verified against the
   spec. Each artifact constrains the ambiguity of the next.
2. **Minimum necessary rigor.** Use the lowest scale level that removes ambiguity from context.
   Heavy process (full pipeline, evals) is opt-in, never default.
3. **Determinism where possible.** Manifests, schemas and deterministic validators decide
   lifecycle operations; LLM reviewers complement, never replace, them.
4. **Traceable, archivable change.** All work lives as an active change, is verified, applied to
   the baseline and archived. No silent gaps: blocked work goes to the deferral ledger and the
   project does not close until the ledger is resolved and tested.
5. **Language policy.** Identifiers in English; documentation and user-facing text in Português
   Brasileiro. "Objeto de Valor" always written in full. No technology prefixes in domain names.
6. **Financial correctness** (when the domain applies): money as integer cents, NBR 5891 rounding,
   append-only audit. Regulated flows (PCI DSS, fintech) require explicit human approval at
   archive time.
7. **Security by default.** No secrets in code, repos or images; least privilege; auditability;
   security by default. Projects that opt into the `authz` and `pii-pci` rule packs (see
   `rules/architecture/authz-pdp-pep.md` and `rules/architecture/pii-pci-classification.md`) inherit
   their specific clauses — PDP, deny-by-default, fail-closed, no PII/PAN in logs — as binding
   contracts in the project's local constitution; these are not universal invariants of the harness.
8. **Human commits only.** No AI co-authorship trailers in commits or PRs. Conventional Commits.
9. **Decisions are recorded.** Architectural decisions become ADRs; human gate decisions are
   recorded with author, timestamp and reason in `approvals.yaml`.
10. **Agent-agnostic by construction.** `.forge/` is the only source; every tool consumes
    generated adapters. Switching LLM/agent must never break the flow.
11. **Defect fixes start from an observed Red.** A regression test for a `bugfix` change is written before the fix and is *seen* failing on the pre-fix tree, for a behavioural reason — never a build error. The observation is recorded as replayable evidence, not asserted in a checkbox; a test that was never red proves nothing about the defect. Where a Red is genuinely impossible, the reason is waived explicitly and the debt is registered (see `rules/testing/regression-red-first.md`).
12. **One source of truth, with a known precedence.** When sources contradict, authority order
    decides: constitution > baseline (ADRs/capabilities) > rules > context/defaults (FORGE.md §2.1).
    A relevant architectural conflict is **blocking** — the agent stops and escalates to the human
    gate; it never "registers and proceeds", and never silently picks the lower source. Decisions
    that bind all bounded contexts (e.g. multi-tenant isolation) have a single owner, not a per-module
    choice.
