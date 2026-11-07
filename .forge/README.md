# .forge/ — Forge Project Harness

Agent-agnostic project harness. **This tree is the only source of truth**; `.forge/`, `.codex/`,
`.agents/`, `.kiro/` and friends are generated adapters (`forge sync-adapters`) — never edit them
by hand. `AGENTS.md` at the repo root is the generated canonical interface; `CLAUDE.md`/`QWEN.md`/
`GEMINI.md` symlink to it.

| Path | Layer | What lives here |
|---|---|---|
| `FORGE.md` | 1 Project Brain | canonical rich governance source (edit here) |
| `forge.yaml` | 1 | machine-readable harness manifest |
| `constitution.md` / `context.md` | 1 | principles / durable stack+conventions context |
| `rules/` | 1 | enforceable team conventions (conventions, architecture, domain, testing, frontend) |
| `adapters/` | 1 | adapter declarations + lockfiles (generated targets, drift detection) |
| `specs/active/<change-id>/` | 2 Spec Lifecycle | changes in flight (manifest, requirements, design, tasks, stories, deltas, evidence) |
| `specs/archived/` | 2 | finished changes (history; `index.yaml`) |
| `product/current/` | 2 | verified baseline (capabilities with stable IDs) — only `/forge:archive` writes here |
| `commands/` / `agents/` / `skills/` | 3 Execution Harness | operational flow (projected into adapters) |
| `contracts/stages/` | 3 | stage I/O contracts for verify/archive/eval evidence |
| `hooks/` / `scripts/` | 3 | git+harness hooks, deterministic validators and gates |
| `worktrees/<change-id>/` | 3 | per-change git worktrees (local only, never committed) |
| `graph/` | 4 Understanding | code graph, impact, onboarding, C4 + overview.html |
| `templates/` | 5 Dev Loop | spec/bugfix/refactor/story/product/adapter templates |
| `evals/` + `runners.yaml` | 5 Quality | opt-in quantitative eval harness (A/B, grading, meta, benchmarks) |
| `custom/` | — | repo-local overrides (take precedence; no fork) |
| `schemas/` | — | JSON Schemas that make lifecycle operations deterministic |

Quick start: `/forge:init` installs this tree · `/forge:doctor` validates it ·
`/forge:status` shows harness/specs/baseline state · `/forge:spec new` starts a change.
