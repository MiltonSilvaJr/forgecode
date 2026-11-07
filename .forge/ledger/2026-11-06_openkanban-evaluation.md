---
date: 2026-11-06
id: openkanban-evaluation
title: OpenKanban TUI Kanban Board - Evaluation for Squad Orchestration
status: evaluation
author: milton
tags:
  - external-research
  - squad-orchestration
  - kanban
  - agent-coordination
  - tui
priority: medium
---

# OpenKanban Evaluation

**Project URL:** https://github.com/TechDufus/openkanban

**Brief:** A TUI kanban board for orchestrating AI coding agents with embedded terminals, git worktrees per ticket, and multi-project support.

---

## 1. Project Overview

### Purpose
OpenKanban provides a unified terminal interface for managing multiple AI coding agents across projects. It addresses the operational challenge of coordinating agent work through a visual kanban board paradigm.

### Key Features
- **Tickets as Git Worktrees** — Each task gets isolated git branches with corresponding worktrees
- **Embedded Terminals** — Agents run inside the TUI, not in separate terminal tabs
- **Agent Agnostic** — Supports OpenCode, Claude Code, Gemini, Codex, Aider, or custom CLI tools
- **Multi-Project Support** — Manage tickets across all repositories from one board
- **Highly Configurable** — Custom agents, keybindings, branch naming, cleanup behavior via `~/.config/openkanban/config.json`

### Technology Stack
- **Language:** Go
- **UI Framework:** TUI-based (terminal UI)
- **Release Channel:** Homebrew + Go install
- **License:** AGPL-3.0
- **Maturity:** Active (154 stars, 16 forks as of Nov 2026)

---

## 2. Architectural Insights Relevant to Squad Orchestration

### 2.1 Column-Based Workflow
OpenKanban's kanban board likely uses a columnar workflow (e.g., Backlog → In Progress → Review → Done), which maps naturally to squad state transitions:
- **Candidate State** — New squad work awaiting assignment
- **Active State** — Squad actively executing tasks
- **Blocked State** — Squad waiting on external dependencies or decisions
- **Completed State** — Squad has delivered and handed off

### 2.2 Worktree Isolation Pattern
Each ticket maps to a git worktree, providing:
- **Branch Isolation** — Work doesn't interfere with main checkout
- **Per-Task State** — Separate filesystem and git context per task
- **Terminal Co-location** — Agent + terminal + filesystem are co-located

**Relevance to Squad Orchestration:**
This pattern could apply to squad context — each squad agent work session could get its own worktree, preventing cross-squad state pollution.

### 2.3 Agent Spawning & Attachment
The TUI allows:
- `s` key to spawn a new agent inside a ticket
- `enter` to attach/interact with an agent
- Keybinding-driven control

**Relevance:**
Squad orchestration could expose similar affordances: spawn squad task, assign agent, monitor progress, switch between squads.

### 2.4 Configuration-Driven Extensibility
`~/.config/openkanban/config.json` centralizes agent definitions, keybindings, and cleanup behavior. This suggests a pluggable architecture where custom agents are registered at startup.

---

## 3. Mapping OpenKanban Concepts to Squad Feature

### Potential Adaptations

| OpenKanban Concept | Squad Orchestration Mapping | Benefit |
|---|---|---|
| **Tickets** | Squad tasks or work items | Units of delegation |
| **Columns** | Squad state machine (Candidate, Active, Blocked, Done) | Visual progress tracking |
| **Worktrees** | Squad context isolation + terminal session | Prevent cross-task pollution |
| **Agent spawning** | Assign agent to squad task | Coordinated execution |
| **Embedded terminals** | Real-time squad + agent interaction | Observability + intervention |
| **Keybindings** | Squad control flow (assign, escalate, pause, resume) | Ergonomic control |
| **Config.json** | Squad definitions + agent routing rules | Declarative squad composition |

### Non-Applicable Concepts
- **Git branch creation/management** — Squad orchestration is higher-level; may not need worktrees unless squad tasks spawn code changes
- **Multi-project support** — Squad is typically project-scoped; could be extended later

---

## 4. Architecture: What OpenKanban Does Well

### Strengths for Squad Adoption
1. **TUI-native** — Lightweight, scriptable, works over SSH
2. **Embedded execution** — No tab-switching or external process management
3. **State persistence** — Board state likely survives across sessions
4. **Configurable agents** — Easy to add custom squad coordinators
5. **Keybinding-driven UX** — Keyboard-first, accessible to terminal-native developers

### Design Principles Worth Adopting
- **Worktree isolation** — Prevents state leaks
- **Embedded terminal** — Co-locates control and observation
- **Config-driven agents** — Extensibility without code changes
- **Modal keybindings** — Ergonomic repeated actions (navigate, move, assign)

---

## 5. Gaps & Considerations

### Potential Limitations for Squad Context

| Aspect | Current OpenKanban | Squad Need | Implication |
|---|---|---|---|
| **State Persistence** | Likely file-based (board state) | Durable ledger + event log | Need audit trail, not just board state |
| **Agent Lifecycle** | Simple spawn/attach | Graceful shutdown, resource cleanup | Need coordinator, not just terminal multiplexer |
| **Permission Model** | Single user, local config | Squad-level RBAC | Need access control layer |
| **Observability** | TUI display + embedded terminal | Metrics, logs, traces | Integration with OpenCode's observability |
| **Distributed Agents** | Assumes local or SSH | Remote squad agents | May need client-server arch |

### Integration Complexity
- OpenKanban is **agent-agnostic** but assumes a **CLI-like interface** (spawn process, interact via stdin/stdout)
- Squad agents are **programmatic** (Effect-based, with typed interfaces)
- Mapping squad concepts (send prompt, stream response, tool call) to a TUI terminal session needs translation layer

---

## 6. Proof-of-Concept Direction

### Phase 1: Learn & Evaluate (1-2 weeks)
- [ ] Clone OpenKanban, build locally, run demo
- [ ] Trace command flow: new ticket → spawn agent → terminal interaction
- [ ] Identify file formats (board state, config schema)
- [ ] Document keybinding dispatch and TUI state machine

### Phase 2: Concept Adaptation (2-3 weeks)
- [ ] Design Squad State Machine
  - States: Candidate, Assigned, Active, Paused, Blocked, Done, Escalated
  - Transitions: transitions with guards (can only pause if Active, etc.)
- [ ] Map OpenKanban Keybindings to Squad Operations
  - `n` → new squad task
  - `a` → assign agent to task
  - `p` → pause squad
  - `r` → resume squad
  - `space` → advance state (modal context-dependent)
- [ ] Draft TUI Layout for Squad Orchestration
  - Left: Squad list (swimlanes or expandable rows)
  - Center: Task board (Candidate/Active/Done columns)
  - Right: Real-time task info (agent assignment, start time, WIP limit)

### Phase 3: Prototype Integration (3-4 weeks)
- [ ] Create wrapper around OpenKanban TUI or reuse as reference
- [ ] Integrate with OpenCode's Squad type definitions (from `.forge/product/current/capabilities/`)
- [ ] Add Effect-based squad task executor (instead of plain CLI agent)
- [ ] Test state transitions and error handling

---

## 7. Licensing & Reuse Considerations

**OpenKanban License:** AGPL-3.0

- ✅ Can study and adapt design patterns
- ✅ Can reference in documentation
- ⚠️ If using code directly: must also adopt AGPL-3.0 for derived work
- ✅ Safer path: port concepts to TypeScript/Effect in-house without copying code

**Recommendation:** Use OpenKanban as **inspiration for UX/architecture**, not as a code dependency. A clean TypeScript port gives OpenCode more control and keeps licensing uncomplicated.

---

## 8. Decision Points for Next Phase

### Questions to Resolve
1. **Scope:** Should squad orchestration include git worktree management (like OpenKanban) or focus purely on agent coordination?
   - If YES to worktrees: larger scope, more complex state management
   - If NO: can simplify to coordination + observability layer

2. **Terminal Embedding:** Should squad TUI embed real terminals (like OpenKanban) or show rich structured output (agent state, tool calls)?
   - Rich structured: better for programmatic agents (Effect-based), more aligned with OpenCode's model
   - Embedded terminal: matches OpenKanban but may not match squad agent interface

3. **Urgency:** Is squad orchestration on the critical path for OpenCode v4.x or a future enhancement?
   - Critical: prioritize POC and prototype
   - Future: defer deep integration; keep as reference

4. **Integration Point:** Where does squad TUI live?
   - As new feature in OpenCode TUI (packages/tui/src/feature-plugins/squad/)
   - As separate CLI tool (like OpenKanban, but integrated)
   - Both?

---

## 9. Recommended Next Action

**Create a lightweight spike story** in `.forge/specs/active/` to:
1. Prototype a simple squad state machine (5 states, 8 transitions)
2. Sketch the squad TUI layout (ASCII mockup)
3. Wire up one transition (e.g., "new task" → "assign agent" → "active")
4. Document learnings + identify blockers

**Estimated effort:** 3-5 days
**Deliverable:** Spike story with POC code + decision memo on scope & architecture

---

## 10. Reference & Follow-Up

- **OpenKanban Repo:** https://github.com/TechDufus/openkanban
- **Config Docs:** https://github.com/TechDufus/openkanban/blob/main/docs/CONFIGURATION.md
- **Related OpenCode Concepts:**
  - Squad definition (`.forge/product/current/capabilities/`)
  - Session orchestration (packages/core/session/)
  - TUI architecture (packages/tui/)

---

**Status:** Ready for review and decision on next phase.

**Follow-up:** Route to product committee for scope + prioritization decision.
