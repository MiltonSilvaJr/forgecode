---
forge_version: 1
project:
  name: opencode
  display: OpenCode
  description: AI-powered development tool
  repo_slug:
  default_branch: dev
  owners: []
  domains: []
sdd:
  default_mode: brownfield          # greenfield | brownfield | feature | bugfix | refactor
  default_rigor: spec-anchored      # spec-first | spec-anchored | spec-as-source
  default_scale: 2                  # 0..4 (scale-adaptive complexity)
  archive_policy: after_verified_implementation
  human_gate_required: true
runtime:
  primary_stack: TypeScript
  package_manager: bun
  run: bun run dev
  test: bun turbo test --concurrency=3
  typecheck: bun run typecheck
  lint: bun run lint
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
  #
  # Invocação (pre-push, /forge:verify e fechamento de wave, igual nos três): `bash <gate>.sh
  # --path <raiz>`, sem posicional; o change em foco, quando há, vem em FORGE_CHANGE_ID.
  gates:
codegraph:
  # Mapa de camadas do code graph. Vazio = heurística embutida do engine (convenções de pasta +
  # sufixo de projeto .NET). Declare aqui os layouts que ela não reconhece — plataforma satélite,
  # pacotes compartilhados, monólito legado — em vez de esperar mudança no engine. Ordem importa:
  # o primeiro padrão que casar vence. Ver §8.
  layers: []
  orphans_by_design: []
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

# FORGE.md — OpenCode

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

## 2.1 Source-of-truth precedence (authority order)

When two sources contradict each other, the **higher-authority** source wins; the lower one is
**drift to fix**, not a valid alternative. Order, highest first:

1. **`constitution.md`** — non-negotiable principles.
2. **Baseline** — accepted **ADRs** and `product/current/capabilities/` (the law in force).
3. **Rules** — `.forge/rules/**` (conventions derived from decisions; a rule that codifies an
   architectural decision must declare its `based_on:` ADR).
4. **`context.md` / defaults** — durable stack/convention context.

An agent **never silently picks** a lower source over a higher one, and **never guesses** the
precedence. If a rule contradicts an accepted ADR, the ADR governs and the rule is reported as
drift (see `.forge/rules/conventions/conflict-handling.md`). A relevant architectural conflict is
**blocking** — stop and escalate via the human gate; do not "register and proceed".

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

## 7. Code graph: layer map and the meaning of `unknown`

The graph engine classifies every file into `api | application | domain | infrastructure |
contracts | test | config | unknown`. Its built-in heuristic reads folder conventions and the .NET
project-suffix convention; a repository whose layout differs — a satellite platform under
`<root>/src/services/<svc>/<Ns>.<Layer>`, shared packages under `packages/dotnet/<Ns>`, a legacy
pre-Clean-Architecture monolith under `src/<Product>.<Layer>` — **declares** its own layouts in the
`codegraph.layers` frontmatter block instead of waiting for the engine to grow another regex. Each
entry is a path glob plus a layer; entries are evaluated in declaration order (first match wins) and
always before the built-in heuristic. Declaring nothing keeps the heuristic and the exact graph of
before.

`unknown` is **not** a defect by itself. It carries two different meanings and only one of them is a
gap. Declaring `layer: unknown` for a path is the statement "the layer taxonomy does not describe
this code" — frontend, tooling, documentation MDX, browser E2E specs — and those nodes are marked
`taxonomy: "out"` in `graph.json` and **excluded from the denominator** of `stats.layer_coverage`.
`unknown` reached by falling through the heuristic stays in the denominator, because that one is a
real gap and the metric has to keep saying so. Reporting both as the same number is what made 18% of
a measured repository read as a hole where there was none.

Orphan nodes follow the same logic. `forge validate graph` no longer reports a bare orphan count:
an assembly marker resolved by reflection, a migration discovered by assembly scanning, a browser
E2E spec and static content are orphans **by design**, and the warning names only what is left over
— dead code or an import the extractor failed to resolve. Test-layer, config-layer, `migrations/`
and out-of-taxonomy nodes are recognized without any declaration; anything else the repository knows
to be legitimately edgeless goes into `codegraph.orphans_by_design`.

## 8. Autonomy (HITL vs YOLO)

`forge.yaml > autonomy.mode` controls how HITL gates (§12.1) are decided. `hitl` (default) stops for a
human via `AskUserQuestion`. `yolo` delegates each approval gate to an Opus-effort-high subagent
(`yolo-gate`), recorded in `approvals.yaml` with `autonomous: true` — never disguised as human.
Execution failures (`[!]`, blockers, source conflicts) still stop; `human_hard_stops` (default
`human_archive_approval`) and `irreversible_hard_stops` (prod deploy, promote-staging, adapter removal,
branch cleanup) stay human even in yolo. Full contract: `rules/conventions/autonomy-yolo.md`.
