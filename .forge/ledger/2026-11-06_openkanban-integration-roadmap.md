---
date: 2026-11-06
id: openkanban-roadmap
title: Squad Orchestration Feature - Integration Roadmap & Next Steps
status: evaluation
author: milton
tags:
  - roadmap
  - squad-orchestration
  - implementation-plan
  - tui
  - kanban
priority: high
---

# Squad Orchestration — Integration Roadmap

**Related Documents:**
- [openkanban-evaluation.md](./2026-11-06_openkanban-evaluation.md) — Strategic evaluation
- [openkanban-technical-analysis.md](./2026-11-06_openkanban-technical-analysis.md) — Deep technical dive

---

## Executive Summary

This document provides a **concrete roadmap** for incorporating OpenKanban's kanban patterns into OpenCode's squad orchestration feature. It outlines:
- **Scope decisions** (what to build vs. what to defer)
- **Architecture & tech stack** (TypeScript + Effect + Ink/Dioxus)
- **Phased delivery** (POC → Alpha → GA)
- **Risk mitigation** & dependencies
- **Timeline** & resource estimates

---

## 1. Feature Vision

### 1.1 What We're Building

**Squad Orchestration TUI** — A terminal-based interface for:
1. **Viewing squad state** — Real-time dashboard of active squad tasks
2. **Coordinating agents** — Assign, pause, resume, escalate squad work
3. **Managing workflow** — Move tasks through states (Candidate → Active → Done)
4. **Observing progress** — Embedded agent terminals, logs, metrics
5. **Auditing decisions** — Full event log for compliance & debugging

### 1.2 Out of Scope (for v1)

- ❌ **Git worktrees** — Squad orchestration is agent-level; code branching handled by agents
- ❌ **Multi-project boards** — v1 assumes single project (squad context is project-scoped)
- ❌ **Distributed agents** — v1 assumes local/same-region agents (clustering for v2)
- ❌ **Permission UI** — v1 assumes single operator; RBAC for v2
- ❌ **Issue tracker sync** — v1 is self-contained; GitHub/Jira sync for v2

### 1.3 Comparison with OpenKanban

| Aspect | OpenKanban | Squad v1 | Notes |
|--------|-----------|---------|-------|
| **Board model** | 3 static columns | 7 state machine | More flexible for squad workflow |
| **Agent type** | CLI (any command) | Effect-based + CLI optional | Programmatic first |
| **Persistence** | Ephemeral JSON | Durable event log | Audit trail required |
| **Terminal embedding** | PTY multiplexing | Optional (CLI agents only) | Not required for Effect agents |
| **Configuration** | JSON config file | Code + config hybrid | Effect schema + config |
| **Deployment** | Standalone binary | OpenCode feature | Integrated TUI plugin |

---

## 2. Architecture Decisions

### 2.1 Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Language** | TypeScript | Match OpenCode stack |
| **Runtime** | Node.js + Bun | Existing OpenCode runtime |
| **TUI Framework** | Ink or Dioxus | React-like, proven in TUI |
| **State Machine** | Effect.ts | Already in OpenCode; typed |
| **Persistence** | SQLite + Event Log | Durable, queryable, ACID |
| **Agent Interface** | Effect channels | Programmatic, not CLI-based |
| **Observability** | CloudWatch Omni | Integrate with OpenCode observability |

### 2.2 Proposed Project Structure

```
packages/squad/                      # New package
├── src/
│   ├── state-machine/
│   │   ├── state.ts                 # Squad state definitions
│   │   ├── transition.ts            # State transitions + guards
│   │   └── state-machine.test.ts
│   ├── orchestrator/
│   │   ├── orchestrator.ts          # Main coordinator (Effect)
│   │   ├── executor.ts              # Task execution layer
│   │   └── scheduler.ts             # Work distribution
│   ├── persistence/
│   │   ├── event-log.ts             # Event sourcing
│   │   ├── schema.sql               # SQLite schema
│   │   └── query.ts                 # Event log queries
│   ├── agent-interface/
│   │   ├── agent.ts                 # Effect-based agent contract
│   │   └── cli-adapter.ts           # Optional CLI agent wrapper
│   └── config/
│       ├── squad-config.ts          # Squad definitions
│       └── default-squads.ts        # Built-in squad templates
├── test/
│   ├── state-machine.test.ts
│   ├── orchestrator.test.ts
│   └── integration.test.ts
└── package.json

packages/tui/src/feature-plugins/squad/   # TUI feature plugin
├── squad-ui.tsx                     # Ink/Dioxus component
├── keybindings.ts                   # Modal keybindings
├── hooks/
│   ├── useSquadState.ts             # Read squad state
│   └── useSquadCommands.ts          # Issue commands
├── views/
│   ├── board.tsx                    # Kanban board view
│   ├── task-detail.tsx              # Task detail + terminal
│   └── settings.tsx                 # Squad settings
└── test/
    └── squad-ui.test.tsx

.forge/product/current/capabilities/
├── squad-orchestration.md           # Squad capability spec
└── squad-state-machine.md           # State machine definition

.forge/specs/active/
├── squad-v1/                        # Squad v1 feature spec
│   ├── manifest.yaml
│   ├── REQUIREMENTS.md
│   ├── DESIGN.md
│   ├── tasks/
│   └── stories/
```

### 2.3 Squad State Machine

**States (v1):**
```
Candidate
├─ assign() ──→ Assigned
└─ delete() ──→ Deleted

Assigned
├─ start() ──→ Active
├─ defer() ──→ Candidate
└─ escalate() ──→ Escalated

Active
├─ pause() ──→ Paused
├─ complete() ──→ Done
├─ block() ──→ Blocked
└─ escalate() ──→ Escalated

Paused
├─ resume() ──→ Active
└─ abort() ──→ Candidate

Blocked
├─ unblock() ──→ Active
├─ abort() ──→ Candidate
└─ escalate() ──→ Escalated

Escalated
└─ resolve() ──→ Active (or Done, based on decision)

Done
└─ (terminal state)

Deleted
└─ (terminal state)
```

**Transition Guards:**
- ✅ Can only start if assigned
- ✅ Can only pause if active
- ✅ Can only unblock if blocked
- ✅ Cannot delete if active (must pause/abort first)

### 2.4 Squad Configuration (Effect Schema)

```typescript
import * as S from "@effect/schema/Schema"

// Squad definition (from .forge/product/current/capabilities/squad-orchestration.md)
const SquadSchema = S.Struct({
  id: S.String,
  name: S.String,
  description: S.optional(S.String),
  agents: S.Array(S.String),  // Agent IDs
  wip_limit: S.optional(S.Number),
  escalation_delay_minutes: S.optional(S.Number),
  on_complete: S.optional(S.Literal("next", "prompt", "done")),
})

// Task definition
const SquadTaskSchema = S.Struct({
  id: S.String,
  squad_id: S.String,
  title: S.String,
  state: S.Enum("candidate", "assigned", "active", "paused", "blocked", "done", "deleted"),
  assigned_agent: S.optional(S.String),
  created_at: S.Date,
  started_at: S.optional(S.Date),
  completed_at: S.optional(S.Date),
  metadata: S.optional(S.Record(S.String, S.Unknown)),
})

// Command
const SquadCommandSchema = S.Union(
  S.Struct({ type: S.Literal("assign"), agent_id: S.String }),
  S.Struct({ type: S.Literal("start") }),
  S.Struct({ type: S.Literal("pause") }),
  S.Struct({ type: S.Literal("resume") }),
  S.Struct({ type: S.Literal("complete") }),
  S.Struct({ type: S.Literal("block") }),
  S.Struct({ type: S.Literal("unblock") }),
  S.Struct({ type: S.Literal("escalate") }),
  S.Struct({ type: S.Literal("delete") }),
)
```

### 2.5 Event Log Schema (SQLite)

```sql
-- Durable event log for squad decisions
CREATE TABLE squad_events (
  id TEXT PRIMARY KEY,
  squad_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL,  -- task_created, state_transitioned, agent_assigned, etc.
  from_state TEXT,
  to_state TEXT,
  actor TEXT,                 -- User or agent ID
  reason TEXT,               -- Why the transition happened
  metadata JSONB,            -- Additional context
  timestamp DATETIME NOT NULL,
  FOREIGN KEY (squad_id) REFERENCES squads(id),
  FOREIGN KEY (task_id) REFERENCES squad_tasks(id)
);

-- Projection: current squad state (read model)
CREATE TABLE squad_tasks (
  id TEXT PRIMARY KEY,
  squad_id TEXT NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL,
  assigned_agent TEXT,
  created_at DATETIME,
  started_at DATETIME,
  completed_at DATETIME,
  FOREIGN KEY (squad_id) REFERENCES squads(id)
);
```

---

## 3. Implementation Phases

### Phase 0: Spike & Architecture Study

**Timeline:** 1 week

**Deliverables:**
- [ ] Clone + run OpenKanban locally
- [ ] Document state machine patterns
- [ ] Sketch TypeScript equivalent
- [ ] Choose TUI framework (Ink vs. Dioxus)
- [ ] Create architecture ADR

**Success Criteria:**
- Team alignment on tech stack
- Clear decision on Ink vs. Dioxus
- Spike code + docs in branch

**Acceptance:**
- Code review + approval
- Architecture review board sign-off

---

### Phase 1: Core State Machine (POC)

**Timeline:** 2 weeks

**Scope:**
- Implement squad state machine (Effect.ts)
- Add transition guards
- Create unit tests
- Document state diagram

**Deliverables:**
```typescript
// packages/squad/src/state-machine/state-machine.ts
export class SquadStateMachine extends Effect.Service<SquadStateMachine>() {
  readonly id: SquadID
  readonly state$: Stream<SquadState>

  transition(command: SquadCommand): Effect<void, InvalidTransition>
  getState(): Effect<SquadState>
}
```

**Tests:**
- [ ] All valid transitions succeed
- [ ] All invalid transitions fail with guard errors
- [ ] Terminal states (Done, Deleted) don't allow transitions
- [ ] Concurrent transitions handled correctly

**Success Criteria:**
- ✅ 100% state transition coverage
- ✅ All guards enforced
- ✅ No panics on invalid input

---

### Phase 2: Event Sourcing & Persistence

**Timeline:** 2 weeks

**Scope:**
- Implement event log (SQLite)
- Build event sourcing layer
- Create read model projections
- Add querying capabilities

**Deliverables:**
```typescript
// packages/squad/src/persistence/event-log.ts
export class SquadEventLog extends Effect.Service<SquadEventLog>() {
  append(event: SquadEvent): Effect<void>
  getEvents(squad_id: SquadID, from?: Timestamp): Effect<SquadEvent[]>
  getState(squad_id: SquadID): Effect<SquadStateSnapshot>
  replay(squad_id: SquadID): Effect<SquadState>
}
```

**Database Operations:**
- [ ] Schema creation
- [ ] Event append (append-only)
- [ ] Event queries (range, filter)
- [ ] Projection snapshots (for fast replay)

**Success Criteria:**
- ✅ Event log survives process restart
- ✅ State reconstructed from events
- ✅ No data loss on write
- ✅ Queries are < 100ms for 10k events

---

### Phase 3: Orchestrator & Agent Interface

**Timeline:** 3 weeks

**Scope:**
- Implement squad orchestrator (Effect)
- Define agent interface (Effect channels)
- Create CLI agent adapter (optional PTY wrapper)
- Add scheduler (work distribution)

**Deliverables:**
```typescript
// packages/squad/src/orchestrator/orchestrator.ts
export class SquadOrchestrator extends Effect.Service<SquadOrchestrator>() {
  createTask(title: string): Effect<SquadTask>
  assignTask(task_id: SquadTaskID, agent_id: AgentID): Effect<void>
  startTask(task_id: SquadTaskID): Effect<void>
  getTaskStatus(task_id: SquadTaskID): Effect<SquadTaskStatus>
  observeProgress(task_id: SquadTaskID): Stream<Progress>
}

// packages/squad/src/agent-interface/agent.ts
export interface SquadAgent {
  id: AgentID
  name: string
  execute(task: SquadTask, context: AgentContext): Effect<AgentResult>
  cancel(): Effect<void>
}
```

**Tests:**
- [ ] Task lifecycle (create → assign → start → complete)
- [ ] Agent assignment validation
- [ ] Task cancellation
- [ ] Concurrent task execution

**Success Criteria:**
- ✅ Multi-task coordination
- ✅ Agent assignment logic correct
- ✅ Task progress observable
- ✅ Clean cancellation

---

### Phase 4: TUI Implementation

**Timeline:** 3 weeks

**Scope:**
- Build squad TUI with Ink/Dioxus
- Implement keybindings (modal navigation)
- Create views (board, task detail, settings)
- Integrate with orchestrator

**Deliverables:**
```typescript
// packages/tui/src/feature-plugins/squad/squad-ui.tsx
export const SquadUI: React.FC<SquadUIProps> = ({ squadID }) => {
  const [state, commands] = useSquad(squadID)
  return (
    <Box>
      <SquadBoard state={state} onCommand={commands} />
      <Footer shortcuts={keybindings} />
    </Box>
  )
}
```

**Keybindings:**
| Key | Action |
|-----|--------|
| `j/k` | Move task up/down |
| `h/l` | Move between columns |
| `space` | Advance task (modal-aware) |
| `a` | Assign agent |
| `p` | Pause task |
| `r` | Resume task |
| `enter` | Task detail view |
| `?` | Help |

**Views:**
- [ ] Board (kanban columns)
- [ ] Task detail (full task info + terminal)
- [ ] Settings (squad config)
- [ ] Help overlay

**Success Criteria:**
- ✅ Responsive keybindings (< 50ms latency)
- ✅ Real-time state updates
- ✅ Task detail show embedded terminal (if CLI agent)
- ✅ Settings UI editable

---

### Phase 5: Integration & Testing

**Timeline:** 2 weeks

**Scope:**
- Integrate with OpenCode Session system
- Add observability hooks (CloudWatch)
- End-to-end testing
- Performance benchmarking

**Deliverables:**
- [ ] E2E tests (create squad → assign → execute → complete)
- [ ] Performance tests (100s squads, 1000s tasks)
- [ ] Observability integration (traces, metrics, logs)
- [ ] Documentation + examples

**Success Criteria:**
- ✅ 90%+ test coverage
- ✅ < 100ms latency for 100 tasks
- ✅ CloudWatch traces visible
- ✅ No memory leaks (profiling)

---

### Phase 6: Alpha Release & Feedback

**Timeline:** 1 week

**Scope:**
- Prepare alpha release notes
- Gather feedback from early users
- Document known limitations
- Plan v1.1 improvements

**Deliverables:**
- [ ] Alpha release (v0.1.0)
- [ ] User feedback summary
- [ ] v1.1 roadmap

**Success Criteria:**
- ✅ No critical bugs
- ✅ Positive user feedback
- ✅ Roadmap prioritized

---

## 4. Detailed Implementation Timeline

```
Week 1      Phase 0: Spike & Architecture Study
Week 2-3    Phase 1: State Machine (Core POC)
Week 4-5    Phase 2: Event Sourcing & Persistence
Week 6-8    Phase 3: Orchestrator & Agent Interface
Week 9-11   Phase 4: TUI Implementation
Week 12-13  Phase 5: Integration & Testing
Week 14     Phase 6: Alpha Release & Feedback

Total: ~14 weeks (3.5 months)
```

**Parallel Tracks:**
- **Track A (Backend):** Phases 1-3 (State Machine → Orchestrator)
- **Track B (Frontend):** Phases 2-4 (Persistence + TUI)
- **Track C (Testing):** Phases 3-5 (Unit tests → E2E → Performance)

---

## 5. Resource & Skills Requirements

### Team Composition (Recommended)

| Role | Count | Required Skills | FTE Weeks |
|------|-------|-----------------|-----------|
| **Backend Lead** | 1 | Effect.ts, TypeScript, State Machines | 8 weeks |
| **TUI Developer** | 1 | Ink/Dioxus, React, Terminal UI | 5 weeks |
| **QA/Test Automation** | 1 | TypeScript, Test frameworks, Performance testing | 6 weeks |
| **Product/Design** | 0.5 | UX, Keybinding design, Documentation | 3 weeks |

**Total:** ~22 FTE weeks (~5.5 weeks in parallel) = **3.5 calendar months**

### Skills to Acquire/Refresh

- [ ] Effect.ts patterns (streams, services, context)
- [ ] Ink vs. Dioxus evaluation
- [ ] Event sourcing best practices
- [ ] TUI keybinding design (OpenKanban study)
- [ ] SQLite schema design + query optimization

---

## 6. Dependencies & Blockers

### Internal Dependencies

| Dependency | Status | Impact | Mitigation |
|------------|--------|--------|-----------|
| **Session system** | ✅ Exists | Squad needs to integrate with Session | Coordinate with Session team early |
| **OpenCode Agent interface** | 🟡 In-flight | Squad agents must match Agent contract | Align schema in Phase 1 |
| **TUI framework decision** | ⏳ Pending | Blocks Phase 4 | Resolve in Phase 0 |
| **Observability integration** | 🟡 Partial | CloudWatch hooks needed | Reuse existing ADOT wiring |

### External Dependencies

| Dependency | Version | Status | Notes |
|-----------|---------|--------|-------|
| **effect** | v4 | ✅ Ready | Already in use |
| **sqlite3** | latest | ✅ Ready | npm package available |
| **ink** | v4+ | ✅ Ready | React-based TUI |
| **dioxus** | v0.5+ | ✅ Ready | Rust-based TUI (alternative) |

### Risk Blockers

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **Ink/Dioxus performance** | 🟡 Medium | POC performance test in Phase 0 |
| **SQLite scale** | 🟡 Medium | Load test with 10k+ events in Phase 2 |
| **OpenCode integration** | 🟡 Medium | Parallel design with Session team |
| **Terminal embedding for CLI agents** | 🟢 Low | Optional feature; can defer to v1.1 |

---

## 7. Success Metrics

### v1 GA Criteria

- ✅ **State Machine**: 100% transition coverage, no panics
- ✅ **Persistence**: Event log survives restarts, replay produces correct state
- ✅ **TUI**: Responsive (< 50ms keybinding latency), renders 100+ tasks smoothly
- ✅ **Orchestration**: Assigns & executes tasks correctly, handles failures gracefully
- ✅ **Testing**: 90%+ code coverage, E2E tests pass
- ✅ **Documentation**: API docs, examples, troubleshooting guide
- ✅ **Performance**: Handles 1000 tasks, 100 concurrent squads without degradation

### User-Facing Metrics

- 📊 Squad task completion time (target: < 5 minutes for typical task)
- 📊 Agent assignment latency (target: < 1 second)
- 📊 TUI responsiveness (target: 99th percentile < 100ms)
- 📊 User satisfaction (target: 4+ / 5 stars from early testers)

---

## 8. Decision Points & Checkpoints

### Decision 1: TUI Framework (Phase 0, Week 1)

**Question:** Ink or Dioxus?

**Criteria:**
- Performance (latency + render time)
- React pattern familiarity
- TypeScript integration
- Terminal rendering capabilities

**Decision Timeline:** EOW1

**Owner:** Architecture committee

---

### Decision 2: Agent Interface (Phase 1, Week 2)

**Question:** How do Effect agents integrate with squad tasks?

**Options:**
- A. Agent returns Effect<Result> — Squad awaits completion
- B. Agent returns Stream<Progress> — Squad observes real-time updates
- C. Hybrid — Execution phase + observation phase

**Decision Timeline:** EOW2

**Owner:** Squad + Agent teams

---

### Decision 3: PTY Embedding (Phase 3, Week 7)

**Question:** Include embedded terminals for CLI agents?

**Options:**
- A. Yes — Use creack/pty + vt10x (like OpenKanban)
- B. No — Show structured logs + metrics only
- C. Defer to v1.1

**Impact:** ~2 weeks of work if Yes

**Decision Timeline:** EOW7

**Owner:** Product + Engineering

---

### Checkpoint 1: Phase 1 Review (EOW3)

**Must Haves:**
- ✅ State machine passes all tests
- ✅ No panics on invalid input
- ✅ Guards enforced correctly

**Nice to Haves:**
- ✅ Documentation complete
- ✅ Architecture decision recorded

**Gate:** Proceed to Phase 2 if Must Haves met

---

### Checkpoint 2: Phase 2 Review (EOW5)

**Must Haves:**
- ✅ Event log tested with 10k+ events
- ✅ State reconstruction from events works
- ✅ No data loss on crash

**Nice to Haves:**
- ✅ Snapshot optimization implemented
- ✅ Query performance < 100ms

**Gate:** Proceed to Phase 3 if Must Haves met

---

### Checkpoint 3: Phase 4 Review (EOW11)

**Must Haves:**
- ✅ TUI renders without lag
- ✅ Keybindings work correctly
- ✅ Integrated with orchestrator

**Nice to Haves:**
- ✅ Terminal embedding (if Option A chosen)
- ✅ Custom theme colors

**Gate:** Proceed to Phase 5 if Must Haves met

---

### Checkpoint 4: Phase 5 Review (EOW13)

**Must Haves:**
- ✅ E2E tests pass
- ✅ 90%+ coverage
- ✅ Performance benchmarks OK

**Nice to Haves:**
- ✅ Memory profiling clean
- ✅ CloudWatch traces visible

**Gate:** Alpha release if Must Haves met

---

## 9. Known Risks & Mitigations

### Risk 1: TUI Framework Performance

**Scenario:** Ink or Dioxus rendering is too slow (> 200ms latency)

**Mitigation:**
- POC performance test in Phase 0 (render 100 tasks, measure latency)
- Profile with Bun's profiler
- If needed, switch to lower-level TUI library (e.g., Blessed, or custom ANSI rendering)

**Fallback:** Defer TUI to v1.1; release CLI interface first (v1.0 alpha)

---

### Risk 2: SQLite Bottleneck

**Scenario:** Event log queries are slow (> 500ms) with large data

**Mitigation:**
- Load test in Phase 2 with 100k events
- Add indexing on squad_id, timestamp
- Implement snapshot strategy (checkpoint events every 1000 entries)
- Consider WAL mode for concurrency

**Fallback:** Switch to PostgreSQL + jsonb (higher operational cost)

---

### Risk 3: Effect.ts Learning Curve

**Scenario:** Team unfamiliar with Effect; implementation slower than estimated

**Mitigation:**
- Allocate 1 week for Effect.ts training (Phase 0)
- Pair program on Phase 1 (state machine) with experienced Effect developer
- Use existing OpenCode services as templates

**Fallback:** Simplify to plain TypeScript for Phase 1 (POC), refactor to Effect later

---

### Risk 4: Integration with OpenCode Session

**Scenario:** Squad orchestrator doesn't cleanly compose with Session system

**Mitigation:**
- Early design alignment with Session team (Phase 0)
- Build adapter layer if mismatch found
- Document integration points clearly

**Fallback:** Squad runs as independent service; later migrate to unified architecture

---

## 10. Documentation & Knowledge Transfer

### Deliverables

| Document | Audience | Timing |
|----------|----------|--------|
| **Architecture ADR** | Team | EOW1 (Phase 0) |
| **State Machine Spec** | Developers | EOW3 (Phase 1) |
| **Event Schema Design** | Developers | EOW5 (Phase 2) |
| **Agent Interface Contract** | Developers | EOW8 (Phase 3) |
| **TUI Keybinding Guide** | Users | EOW11 (Phase 4) |
| **API Documentation** | Developers | EOW13 (Phase 5) |
| **Troubleshooting Guide** | Users | Week 14 (Alpha) |
| **Example Squads** | Users | Week 14 (Alpha) |

### Knowledge Transfer Plan

- **Phase 1-2:** Weekly design reviews + code walkthroughs
- **Phase 3-4:** Pair programming sessions (TUI developer learns Effect)
- **Phase 5:** Test automation review; QA learns squad behavior
- **Alpha:** User training + feedback session

---

## 11. Post-v1 Roadmap (v1.1 & Beyond)

### v1.1 Priorities (Q2 2027)

- [ ] **Terminal embedding** — PTY support for CLI agents
- [ ] **Permission model** — Squad-level RBAC
- [ ] **Metrics & observability** — CloudWatch integration (deep)
- [ ] **Custom keybindings** — User-defined shortcuts

### v2.0 Priorities (Q3+ 2027)

- [ ] **Distributed agents** — Multi-region, clustering
- [ ] **Issue tracker sync** — GitHub Issues / Jira bidirectional
- [ ] **Plugin system** — Custom squad behaviors (Lua/WASM)
- [ ] **Performance** — SQLite → TimescaleDB for time-series metrics
- [ ] **Web UI** — Complement TUI with browser interface

---

## 12. Approval & Sign-Off

### Required Approvals

- [ ] **Architecture Review** — TechLead / Architecture Committee
- [ ] **Product Sign-Off** — Product Manager (scope, timeline)
- [ ] **Resource Allocation** — Engineering Manager (team assignment)
- [ ] **Legal Review** — Licensing (OpenKanban AGPL-3.0 implications)

### Decision Authority

| Decision | Authority | Deadline |
|----------|-----------|----------|
| **Go/No-Go on Squad v1** | Product Committee | 2026-11-13 |
| **Tech stack finalization** | Architecture Committee | 2026-11-17 (EOW1) |
| **Resource allocation** | Engineering Manager | 2026-11-17 (EOW1) |
| **Timeline commitment** | VP Engineering | 2026-11-20 |

---

## 13. Next Actions (This Week)

### Immediate (Today - Nov 6)

- [ ] **Share** this roadmap with stakeholders
- [ ] **Schedule** architecture review meeting (EOW)
- [ ] **Create** decision tracking spreadsheet

### This Week (Nov 6-13)

- [ ] **Secure** product sign-off on scope
- [ ] **Allocate** team resources (backend + TUI + QA)
- [ ] **Schedule** Phase 0 kickoff (target: Nov 17)

### Next Week (Nov 13-20)

- [ ] **Begin Phase 0:** Spike + architecture study
- [ ] **Finalize** TUI framework decision
- [ ] **Start** OpenKanban deep-dive study
- [ ] **Design** Effect.ts training agenda

---

## 14. Appendix: Reference Materials

### OpenKanban References

- **Repo:** https://github.com/TechDufus/openkanban
- **Architecture:** https://raw.githubusercontent.com/TechDufus/openkanban/main/ARCHITECTURE.md
- **Configuration:** https://raw.githubusercontent.com/TechDufus/openkanban/main/docs/CONFIGURATION.md
- **Keybindings:** See Configuration.md → Keybindings section

### OpenCode References

- **Session System:** packages/core/src/session/
- **Agent Interface:** packages/core/src/agent/
- **TUI Architecture:** packages/tui/src/
- **Effect.ts in OpenCode:** Search `@effect/` in package.json

### External Resources

- **Bubbletea** (reference): https://github.com/charmbracelet/bubbletea
- **Ink** (TUI framework): https://github.com/vadimdemedes/ink
- **Dioxus** (alternative TUI): https://dioxuslabs.com/
- **Event Sourcing**: https://martinfowler.com/eaaDev/EventSourcing.html
- **Effect.ts**: https://effect.website/

---

**Status:** Ready for executive review and decision.

**Owner:** Squad Orchestration Product Team

**Last Updated:** 2026-11-06

**Next Review:** 2026-11-13 (Post-executive decision)
