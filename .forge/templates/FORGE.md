---
forge_version: 1
project:
  name: <PROJECT_SLUG>
  display: <PROJECT_NAME>
  description: <PROJECT_DESCRIPTION>
  repo_slug:
  default_branch:
  owners: []
  domains: []
sdd:
  default_mode: brownfield          # greenfield | brownfield | feature | bugfix | refactor
  default_rigor: spec-anchored      # spec-first | spec-anchored | spec-as-source
  default_scale: 2                  # 0..4 (scale-adaptive complexity)
  archive_policy: after_verified_implementation
  human_gate_required: true
runtime:
  primary_stack:
  package_manager:
  run:
  test:
  typecheck:
  lint:
  # gates — nomes de script em .forge/scripts/<nome>.sh. Duas formas, um leitor só:
  #
  #   gates: check-authz,check-observability     # CSV escalar: tudo em phase: source
  #
  #   gates:                                     # block-sequence com FASE
  #     - check-authz                            #   item escalar ⇒ phase: source
  #     - name: check-image-digest
  #       phase: pre-deploy
  #     - name: check-rollout-health
  #       phase: post-deploy
  #
  # `source` é a fase da árvore de fontes — a única que o pre-push e o fechamento de wave
  # executam. Ela NÃO cobre o artefato implantável: digest publicado, manifesto renderizado,
  # cluster no ar. Ver rules/testing/gate-delivery-channel.md.
  gates:
integrations:
  jira:
  github:
  graph:
    enabled: true
    path: .forge/graph/graph.json
quality:
  evals_enabled: false              # opt-in (Layer 5)
  runners_config: .forge/runners.yaml
---

# FORGE.md — <PROJECT_NAME>

> Canonical rich source of project governance. Humans and Forge edit **this** file.
> `AGENTS.md` at the repo root is a **generated** operational projection (run `forge sync-adapters`);
> `CLAUDE.md`, `QWEN.md`, `GEMINI.md` symlink to `AGENTS.md`. Never edit generated files.

## 1. Identity

The YAML frontmatter above is the canonical project identity. Agents resolve empty fields at
runtime (`gh repo view`, MCP Atlassian) and persist them here. Durable stack context and
cross-project conventions live in [`context.md`](./context.md); non-negotiable principles live
in [`constitution.md`](./constitution.md).

## 2. SDD policy

- **Default rigor: `spec-anchored`** — living spec + verification against it. `spec-first` is
  allowed for disposable prototypes; `spec-as-source` only for mature contracts/generators
  (OpenAPI, AsyncAPI, Protobuf, schemas, SDKs, migrations).
- **Change-based lifecycle:** every feature/bugfix/refactor lives in
  `.forge/specs/active/<change-id>/` (manifest, requirements, design, tasks, stories, deltas,
  evidence). The verified baseline lives in `.forge/product/current/` and is **only** modified
  by `/forge:archive`. Never edit `product/current/` by hand.
- **Scale-adaptive levels (0..4):** the manifest `scale` field decides mandatory phases —
  0: tasks only · 1: short requirements + tasks · 2 (default): requirements + design + tasks ·
  3: + analyze + story sharding · 4: + FRD/NFRD/TRD/DDD + explicit regulatory approval.
  Choosing below the suggested risk level records skipped phases + justification in the manifest.

## 3. How to work

1. **Read specs first.** Active change: `.forge/specs/active/<change-id>/`. Current truth:
   `.forge/product/current/capabilities/`. Never reconstruct state from chat memory.
2. **Use the graph before raw reads** (when enabled): query/path/explain via `/forge:graph`,
   impact via `/forge:impact` (mandatory for scale ≥ 3).
3. **Worktrees:** every change works in `.forge/worktrees/<change-id>/` — inside the project,
   never outside. The worktree-guard hook blocks anything else. Worktrees are removed after merge.
4. **Branches:** `feature/<change-id>` → PR to `dev` → merge after human gate → promotion
   to `staging` triggers the only expensive CI run.
5. **Validate before declaring done:** run the commands in `runtime:` (test/typecheck/lint) plus
   the deterministic gates (`.forge/scripts/`). Human gates are presented as explicit options
   (approve/review/reject/supersede/abandon/block) and recorded in `approvals.yaml`.
6. **Archive:** `/forge:archive <change-id>` applies spec deltas to the baseline after verified
   implementation (pre-flight: manifest valid, tasks 100%, verification + approvals + traceability
   present). To end a change without touching the baseline use `/forge:close --reason
   abandoned|rejected|superseded`.

## 4. Language and commits

- Code identifiers in **English**; documentation and user-facing text in **Português Brasileiro**.
  "Objeto de Valor" is always written in full. Repository names never embed technology.
- Conventional Commits, imperative pt-BR subject, no AI co-authorship lines — ever.

## 5. Customization

Repo-local overrides live in `.forge/custom/` and take precedence over template files of the same
relative path (no fork needed). `forge doctor` flags orphan overrides as drift.

## 6. Layers (where things live)

| Layer | Root | Purpose |
|---|---|---|
| 1 Project Brain | `FORGE.md`, `forge.yaml`, `constitution.md`, `context.md`, `rules/`, `adapters/` | governance |
| 2 Spec Lifecycle | `specs/active/`, `specs/archived/`, `product/current/` | SDD change-based |
| 3 Execution Harness | `commands/`, `agents/`, `skills/`, `hooks/`, `scripts/`, `worktrees/` | operation |
| 4 Understanding | `graph/` | brownfield map, impact, C4 |
| 5 Dev Loop & Quality | `templates/story/`, `evals/`, `runners.yaml` | long-running + quantitative quality (opt-in) |
