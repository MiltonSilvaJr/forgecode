---
date: 2026-11-06
id: openkanban-tech-analysis
title: OpenKanban Technical Deep-Dive - Architecture & Integration Feasibility
status: evaluation
author: milton
tags:
  - technical-analysis
  - architecture
  - tui
  - agent-coordination
  - squad-orchestration
priority: high
---

# OpenKanban Technical Deep-Dive

**Parent Evaluation:** [openkanban-evaluation.md](./2026-11-06_openkanban-evaluation.md)

---

## Executive Summary

OpenKanban is a **well-architected, Go-based TUI** for orchestrating CLI-driven agents. It separates concerns cleanly (UI, board logic, terminal management, git operations) and provides a **configuration-driven extensibility model** that could be adapted for OpenCode's squad orchestration feature.

**Key Findings:**
- ✅ Bubbletea architecture is clean and reusable (study guide, not copy source)
- ✅ Embedded PTY terminals with `creack/pty` + `hinshun/vt10x` are proven patterns
- ✅ Worktree isolation model prevents state pollution
- ✅ Configuration schema is simple and extensible
- ⚠️ Go codebase; OpenCode is TypeScript — porting effort ~4-6 weeks for full feature parity
- ⚠️ Assumes CLI agents; squad agents are Effect-based (needs translation layer)
- ⚠️ No built-in state durability or audit trail (board state is ephemeral JSON files)

---

## 1. Architectural Overview

### 1.1 System Diagram (From OpenKanban ARCHITECTURE.md)

```
┌─────────────────────────────────────────────────────────────────┐
│                       OpenKanban TUI                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   Backlog   │  │ In Progress │  │    Done     │              │
│  │  ┌───────┐  │  │  ┌───────┐  │  │  ┌───────┐  │              │
│  │  │Ticket │  │  │  │Ticket │  │  │  │Ticket │  │              │
│  │  └───────┘  │  │  └───────┘  │  │  └───────┘  │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Core Engine                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Project/     │  │ Git Manager  │  │Terminal Panes│          │
│  │ TicketStore  │  │  (worktrees) │  │   (PTY)      │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Layers & Responsibilities

| Layer | Modules | Role |
|-------|---------|------|
| **TUI** | `internal/ui/` | Bubbletea model, keybinding dispatch, rendering |
| **Logic** | `internal/board/`, `internal/project/` | Ticket CRUD, status transitions, multi-project support |
| **Terminal** | `internal/terminal/pane.go` | PTY multiplexing, vt10x rendering |
| **Git** | `internal/git/worktree.go` | Worktree lifecycle, branch operations |
| **Agents** | `internal/agent/` | Config loading, status detection, context injection |
| **Config** | `internal/config/config.go` | Parse `~/.config/openkanban/config.json` |

**Clean separation of concerns** — each layer has minimal dependencies on others.

---

## 2. Component Analysis

### 2.1 TUI Layer — Bubbletea (`internal/ui/`)

**Framework:** [Bubbletea](https://github.com/charmbracelet/bubbletea) (Elm-inspired state machine)

**Model Structure:**
```go
type Model struct {
    config          *config.Config
    globalStore     *project.GlobalTicketStore  // Multi-project tickets
    columns         []board.Column              // Backlog, In Progress, Done
    filterProjectID string                      // Current filter
    worktreeMgrs    map[string]*git.WorktreeManager
    agentMgr        *agent.Manager
    mode            Mode                        // Normal, CreateTicket, AgentView, etc.
    panes           map[board.TicketID]*terminal.Pane
    // Navigation state, forms, etc.
}
```

**Modes** (state machine):
- `ModeNormal` — Navigate board (j/k move rows, h/l move columns)
- `ModeCreateTicket` — Form input
- `ModeEditTicket` — Form edit
- `ModeAgentView` — Full-screen terminal (pass-through to PTY)
- `ModeSettings` — Settings panel
- `ModeHelp` — Help overlay
- `ModeFilter` — Search/filter
- `ModeSpawning` — Agent startup in progress
- `ModeConfirm` — Confirmation dialog

**Key Pattern:**
```go
func (m *Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
    switch msg := msg.(type) {
    case tea.KeyMsg:
        return m.handleKeyInMode(msg)
    case terminal.OutputMsg:
        return m.handleTerminalOutput(msg)
    case tea.WindowSizeMsg:
        return m.handleResize(msg)
    }
}
```

**Relevance to Squad:**
- Mode system maps well to squad state machine (candidate, active, blocked, done)
- Keybinding dispatch could route squad operations (assign, pause, escalate)
- Column-based rendering works for swimlanes or status columns

### 2.2 Board Logic (`internal/board/`)

**Ticket Definition:**
```go
type Ticket struct {
    ID            string       `json:"id"`
    ProjectID     string       `json:"project_id"`
    Title         string       `json:"title"`
    Description   string       `json:"description,omitempty"`
    Status        TicketStatus `json:"status"`
    BranchName    string       `json:"branch_name,omitempty"`
    WorktreePath  string       `json:"worktree_path,omitempty"`
    AgentType     string       `json:"agent_type,omitempty"`
    AgentStatus   AgentStatus  `json:"agent_status,omitempty"`
    CreatedAt     time.Time    `json:"created_at"`
    UpdatedAt     time.Time    `json:"updated_at"`
}
```

**Status Enum:**
```go
const (
    StatusBacklog    = "backlog"
    StatusInProgress = "in_progress"
    StatusDone       = "done"
)
```

**Agent Status Enum:**
```go
const (
    AgentNone      = "none"
    AgentIdle      = "idle"
    AgentWorking   = "working"
    AgentWaiting   = "waiting"
    AgentCompleted = "completed"
    AgentError     = "error"
)
```

**Relevance to Squad:**
- Simple ticket model; easily extended with squad-specific fields (agent assignment, deadline, WIP limit)
- Status enum could expand to include squad states (Candidate, Assigned, Active, Paused, Blocked, Done, Escalated)
- Agent status tracking is straightforward (poll status file or connect to agent process)

### 2.3 Terminal Layer (`internal/terminal/pane.go`)

**Key Libraries:**
- `creack/pty` — PTY allocation and I/O
- `hinshun/vt10x` — Virtual terminal emulator (parse ANSI escape codes, render cells)

**Pane Structure:**
```go
type Pane struct {
    id      string
    vt      vt10x.Terminal   // Terminal state machine (cells, cursor, colors)
    pty     *os.File         // PTY file descriptor
    cmd     *exec.Cmd
    workdir string
    width   int
    height  int
}

// Start launches a command in the PTY
func (p *Pane) Start(command string, args ...string) tea.Cmd {
    // Allocate PTY
    ptmx, err := pty.Start(p.cmd)
    // Start reading from PTY in background
    // Convert bytes to vt100 events, update vt.Terminal state
    // Emit OutputMsg to Bubbletea for rendering
}

// HandleKey converts Bubbletea KeyMsg to PTY input
func (p *Pane) HandleKey(msg tea.KeyMsg) tea.Msg {
    // Ctrl+G to return to board, else pass to PTY stdin
    p.pty.Write(translateKey(msg))
}

// View renders vt.Terminal cells with colors
func (p *Pane) View() string {
    // Build ansi string from vt.Terminal cell array
}
```

**Data Flow:**
```
Agent process  ──(stdout)──▶ PTY Master
                              │
                              ▼
                        (vt10x parses)
                              │
                              ▼
                      Terminal.State cell grid
                              │
                              ▼
                      Bubbletea renders as ANSI
```

**Limitations & Considerations:**
- ✅ Handles **arbitrary terminal output** — any ANSI-compatible CLI agent works
- ✅ **Lightweight** — pure Go, no external dependencies beyond vt10x
- ⚠️ **Lossy rendering** — vt10x only stores on-screen content; scrollback requires custom logic (config.scrollback_lines)
- ⚠️ **No structured output** — sees raw terminal bytes; can't parse tool calls or async progress

**Relevance to Squad:**
- **CLI agents**: Embedding PTY works perfectly
- **Effect-based agents**: Would need translation layer (squad response ← PTY output parsing) OR skip PTY and use structured channels
- **Hybrid approach**: Squad tasks that spawn CLI agents (opencode, claude) would embed PTY; squad-internal tasks would use Effect channels

### 2.4 Git Layer (`internal/git/worktree.go`)

**Worktree Operations:**
```go
type WorktreeManager struct {
    project     *Project
    repoPath    string
    worktreeDir string
}

// CreateWorktree creates isolated checkout
func (m *WorktreeManager) CreateWorktree(branchName, baseBranch string) (string, error) {
    // git worktree add -b <branch> <path> <base>
    cmd := exec.Command("git", "worktree", "add", "-b", branchName, 
                        filepath.Join(m.worktreeDir, branchName), 
                        baseBranch)
    return filepath.Join(m.worktreeDir, branchName), cmd.Run()
}

// RemoveWorktree cleans up
func (m *WorktreeManager) RemoveWorktree(path string) error {
    // git worktree remove <path> [--force]
}
```

**Relevance to Squad:**
- **Squad tasks don't always need code** — worktrees are git-specific
- **Could extend** to squad context: each squad task gets a worktree if it modifies code
- **Or separate concern** — squad orchestration is higher-level; code branching is handled by agents themselves

### 2.5 Agent Layer (`internal/agent/`)

**Config Schema:**
```json
{
  "agents": {
    "opencode": {
      "command": "opencode",
      "args": [],
      "status_file": ".opencode/status.json"
    },
    "claude": {
      "command": "claude",
      "args": ["--dangerously-skip-permissions"],
      "status_file": ".claude/status.json"
    }
  }
}
```

**Agent Spawning:**
```go
// Build context prompt from template
func BuildContextPrompt(template string, ticket *Ticket) string {
    // Replace {{.Title}}, {{.Description}}, {{.BranchName}}, etc.
}

// Spawn agent in ticket's worktree
cmd := exec.Command(agentConfig.Command, agentConfig.Args...)
cmd.Dir = ticket.WorktreePath
cmd.Stdin = pty
cmd.Stdout = pty
cmd.Env = append(os.Environ(), "TICKET_ID="+ticket.ID, "BRANCH="+ticket.BranchName)
```

**Status Detection:**
```go
type StatusDetector struct {
    cache map[string]cachedStatus
}

// Poll status file or process state
func (d *StatusDetector) DetectStatus(agentType, sessionID string, running bool) AgentStatus {
    // Check ~/.opencode/status.json or `ps aux | grep`
}
```

**Relevance to Squad:**
- ✅ Configuration-driven agent definition is **reusable** for squad
- ✅ Status file polling pattern works for squad (read agent status JSON)
- ⚠️ Context injection via environment variables + template string is **limited**
- ⚠️ No support for **streaming status updates** or **async tool calls**

---

## 3. Data Model & Persistence

### 3.1 File Layout

```
~/.config/openkanban/
├── config.json                      # Global config (agents, UI, behavior)
└── projects.json                    # Project registry
└── tickets/
    ├── <project-id>.json            # Tickets for each project
    └── <project-id>.json
```

### 3.2 Ticket Persistence

**Storage:** JSON files (one per project)

**Example: tickets/my-app.json**
```json
{
  "project_id": "my-app",
  "tickets": {
    "ticket-001": {
      "id": "ticket-001",
      "project_id": "my-app",
      "title": "Implement user auth",
      "status": "in_progress",
      "branch_name": "task/impl-user-auth",
      "worktree_path": "/path/to/worktrees/task/impl-user-auth",
      "agent_type": "opencode",
      "agent_status": "working",
      "created_at": "2026-11-06T10:00:00Z",
      "updated_at": "2026-11-06T12:30:00Z"
    }
  }
}
```

**Limitations:**
- ❌ **No audit trail** — only latest state is persisted
- ❌ **No versioning** — updates overwrite; no history
- ❌ **No durability** — crash during write = potential data loss
- ❌ **No concurrency** — doesn't handle multi-process updates (race condition risk)

**Relevance to Squad:**
- For simple squad orchestration, JSON suffices as **temporary state**
- For **production squad coordination**, need:
  - Event log (every state change recorded with timestamp, actor, reason)
  - Checksum or WAL (write-ahead log) for safety
  - Durable read model (ReqSQL or similar for efficient queries)

---

## 4. Configuration & Extensibility

### 4.1 Config Schema

**File:** `~/.config/openkanban/config.json`

**Structure:**
```json
{
  "defaults": {
    "default_agent": "opencode",
    "branch_prefix": "task/",
    "branch_template": "{prefix}{slug}",
    "slug_max_length": 40,
    "auto_spawn_agent": true,
    "auto_create_branch": true
  },
  "agents": {
    "agent-name": {
      "command": "cli-command",
      "args": ["--flag"],
      "env": { "KEY": "value" },
      "init_prompt": "Custom prompt with {{.Title}}"
    }
  },
  "ui": {
    "theme": "catppuccin-mocha",
    "show_agent_status": true,
    "refresh_interval": 5,
    "column_width": 40
  },
  "cleanup": {
    "delete_worktree": true,
    "delete_branch": false,
    "force_worktree_removal": false
  },
  "behavior": {
    "confirm_quit_with_agents": true
  }
}
```

**Strengths:**
- ✅ Simple, flat schema (no nesting beyond 2 levels)
- ✅ Agents are **pluggable** — add new agent without code change
- ✅ **In-app editing** — can modify via TUI settings menu
- ✅ **Live reload** — some fields reload without restart

**Weaknesses:**
- ⚠️ No schema validation (client-side only, no JSON Schema)
- ⚠️ String-based templating for init_prompt (fragile vs. structured)
- ⚠️ No versioning or migration path

**Relevance to Squad:**
- Config pattern is **applicable** to squad squad definitions
- Squad config could expand defaults with WIP limits, escalation rules, SLA targets
- Could add `squads` section:
  ```json
  {
    "squads": {
      "squad-backend": {
        "agents": ["opencode", "aider"],
        "wip_limit": 3,
        "escalation_delay_minutes": 30
      }
    }
  }
  ```

### 4.2 Keybindings

**Built-in (not customizable in current version):**

| Context | Key | Action |
|---------|-----|--------|
| Board | `j/k` | Move ticket up/down |
| Board | `h/l` | Move between columns |
| Board | `space` | Move ticket to next column |
| Board | `n` | New ticket |
| Board | `s` | Spawn agent |
| Board | `enter` | Attach to agent |
| Board | `?` | Help |
| AgentView | `ctrl+g` | Return to board |

**Planned:** Custom keybindings via config (not yet implemented)

---

## 5. Comparison: OpenKanban vs. OpenCode Squad Needs

### 5.1 Feature Matrix

| Feature | OpenKanban | Squad Needs | Gap |
|---------|-----------|------------|-----|
| **Multi-state workflow** | 3 states (Backlog, In Progress, Done) | 7+ states (Candidate, Assigned, Active, Paused, Blocked, Done, Escalated) | 🟡 Extendable |
| **Agent coordination** | Spawn CLI agents | Coordinate Effect-based agents | 🔴 Translation layer needed |
| **Terminal embedding** | PTY multiplexing + vt10x | Real-time status + tool calls | 🟡 Hybrid approach |
| **Worktree isolation** | git worktree per ticket | Optional (squad-scoped) | 🟡 Can extend |
| **Status durability** | Ephemeral JSON | Event log + audit trail | 🔴 New infrastructure |
| **Permission model** | Single user | Squad-level RBAC | 🔴 New layer |
| **Observability** | TUI display | Metrics, traces, logs | 🟡 Integrate with OpenCode observability |
| **Distributed agents** | Local + SSH | Remote agents, clustering | 🔴 Future work |
| **Configuration** | JSON config file | Hybrid (code + config) | 🟡 Extend schema |

### 5.2 Reusable Patterns

| Pattern | OpenKanban | Applicability to Squad | Effort |
|---------|-----------|----------------------|--------|
| **Bubbletea state machine** | Mode-based UI | Squad TUI state management | ⏱️ Low (study + adapt) |
| **PTY embedding** | Terminal multiplexing | Optional (for CLI agents) | ⏱️ Medium (port to TypeScript) |
| **Keybinding dispatch** | Modal keybindings | Squad control flow | ⏱️ Low (adapt patterns) |
| **Config-driven agents** | Agent registry | Squad agent routing | ⏱️ Low (extend schema) |
| **Status polling** | Status file + process | Agent state tracking | ⏱️ Medium (integrate with Effect) |
| **Worktree isolation** | git worktree pattern | Optional context isolation | ⏱️ Low (if adopted) |

---

## 6. Integration Strategy

### 6.1 Approach A: Learn & Adapt (Recommended)

**Scope:**
- Study OpenKanban architecture (ARCHITECTURE.md + code)
- Port **key patterns** to TypeScript/Effect (Bubbletea → Ink or custom TUI)
- **Do not copy code** — respect AGPL-3.0 licensing

**Effort:**
- Understanding: 1-2 weeks
- Porting Bubbletea patterns: 2-3 weeks
- Integration with OpenCode: 3-4 weeks
- **Total: 6-9 weeks**

**Deliverables:**
1. Squad TUI component (packages/tui/src/feature-plugins/squad/)
2. Squad orchestration logic (packages/core/squad/)
3. Configuration schema (extend .forge/product/current/capabilities/)
4. Documentation + examples

### 6.2 Approach B: Embed as Subprocess (Not Recommended)

**Scope:**
- Install OpenKanban as binary dependency
- Call `openkanban` from OpenCode as subprocess
- Share session state via IPC (gRPC or HTTP)

**Problems:**
- ❌ **Licensing**: AGPL-3.0 source disclosure requirement
- ❌ **Tight coupling**: Hard to customize for squad-specific needs
- ❌ **Process overhead**: Adds complexity to deployment

### 6.3 Hybrid Approach: Learn + Selective Code Reuse

**Scope:**
- Port Bubbletea state machine pattern (not AGPL-licensed, just the concept)
- Use OpenKanban's PTY layer if licensing allows (or re-implement with creack/pty)
- Build squad-specific layer on top

**Licensing Check:**
- Bubbletea patterns: Elm architecture (not AGPL-specific, learn freely)
- PTY libraries: MIT/Apache licenses (safe to use directly)
- OpenKanban's config & keybinding dispatch: Study + reimplment

---

## 7. Technical Debt & Future Work

### OpenKanban's Own Limitations

1. **No durable event log** — Current JSON persistence isn't safe for production squad coordination
2. **No RBAC** — Assumes single user; squad feature needs permission model
3. **No schema validation** — config.json is unvalidated (runtime errors)
4. **Keybindings not customizable** — Hard-coded in UI layer (near-term roadmap to fix)
5. **Status detection is polling** — Refresh interval adds latency (could use webhooks or async channels)
6. **No plugin system** — Custom agents via config only; no Lua/WASM plugins

### OpenCode Needs Beyond OpenKanban

1. **Durable state & event sourcing** — Squad decisions should be auditable
2. **Effect-based integration** — Squad agents are programmatic, not CLI
3. **Distributed coordination** — Future: squads spanning multiple agents/processes
4. **Observability** — Integrate with CloudWatch + Application Signals
5. **Permission model** — Squad-level RBAC + delegation rules
6. **Streaming responses** — Real-time tool calls, not just agent status

---

## 8. Proof-of-Concept Plan

### Phase 1: Architecture Study (1 week)

**Tasks:**
- [ ] Clone OpenKanban, build locally (`go build`)
- [ ] Run demo on sample project
- [ ] Trace code: `main.go` → `internal/app/app.go` → `internal/ui/model.go`
- [ ] Document state transitions (Mode enum + Update logic)
- [ ] Document keybinding dispatch (handleKey → command dispatch)
- [ ] Sketch TypeScript equivalent (Effect + Ink or Dioxus)

**Deliverable:** Architecture study document (2-3 pages, ASCII diagrams)

### Phase 2: Squad State Machine (1 week)

**Tasks:**
- [ ] Design squad states (Candidate, Assigned, Active, Paused, Blocked, Done, Escalated)
- [ ] Define transitions with guards (e.g., can only pause if Active)
- [ ] Create Effect-based state machine (squad/state-machine.ts)
- [ ] Add transition commands (assign, pause, resume, escalate)
- [ ] Unit tests for state transitions

**Deliverable:** Squad state machine module + tests

### Phase 3: TUI Prototype (2 weeks)

**Tasks:**
- [ ] Create squad TUI layout (mockup → ASCII → Ink)
- [ ] Implement keybinding dispatch (map OpenKanban keys to squad commands)
- [ ] Wire up one transition (e.g., "new task" → "assign" → "active")
- [ ] Display real-time squad status
- [ ] Integrate with mock squad executor

**Deliverable:** TUI prototype (packages/tui/src/feature-plugins/squad/)

### Phase 4: Integration & Validation (2 weeks)

**Tasks:**
- [ ] Connect squad TUI to real squad orchestrator
- [ ] Add persistence layer (durable events)
- [ ] Test multi-squad coordination
- [ ] Performance test (large squad counts, fast transitions)
- [ ] Documentation + example configs

**Deliverable:** Integrated squad feature ready for alpha testing

**Total Estimated Effort:** 6 weeks (2 weeks study + 4 weeks implementation)

---

## 9. Licensing & Legal

**OpenKanban License:** AGPL-3.0

**Implications for OpenCode:**
- ✅ **Can study** design and architecture freely
- ✅ **Can reference** in documentation and ADRs
- ✅ **Can reimplement** concepts (state machine, keybinding dispatch) in TypeScript
- ✅ **Can use libraries** OpenKanban depends on (creack/pty, etc.) if they're permissive licensed
- ⚠️ **Cannot reuse code verbatim** without adopting AGPL-3.0 for derivative work
- ⚠️ **Must avoid GPL contamination** — never `git submodule` or vendor OpenKanban

**Recommended Path:** **Learn + Reimplement** (safest legally, gives OpenCode full control)

---

## 10. Risk Assessment

### High-Risk Factors

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **Squad agents are Effect-based, not CLI** | 🔴 High | Build translation layer; separate CLI+PTY support from Effect-native paths |
| **No built-in state durability** | 🔴 High | Implement event log + event sourcing from day 1 |
| **Distributed coordination not addressed** | 🔴 High | Design for async/remote agents early; use Effect distributed traits |
| **Licensing confusion (AGPL-3.0)** | 🟡 Medium | Get legal review; ensure reimplement, never copy |
| **OpenKanban is new (154 stars, actively maintained but small community)** | 🟡 Medium | Use as inspiration, not production dependency; self-host critical logic |

### Medium-Risk Factors

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **PTY layer porting effort** | 🟡 Medium | Use TypeScript vt100 library (vterminal or similar); or skip PTY if Effect-native agents suffice |
| **Config schema evolution** | 🟡 Medium | Use JSON Schema validation + version migrations from start |
| **Performance at scale** | 🟡 Medium | Benchmark early (100s of squads, 1000s of tasks); optimize event log queries |

### Low-Risk Factors

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **Keybinding conflicts with existing OpenCode TUI** | 🟢 Low | Test keybindings early; use isolated modal context for squad feature |
| **Theme integration** | 🟢 Low | Use OpenCode's existing theme tokens (already standardized) |

---

## 11. Decision & Recommendation

### Recommended Path Forward

**✅ Option: Learn & Adapt via POC Spike**

1. **Create a spec story** (`.forge/specs/active/`) for squad orchestration
2. **Allocate 2 weeks** for architecture study + POC
3. **Reimplement patterns** in TypeScript/Effect (do not copy code)
4. **Focus on squad-specific needs:**
   - Event sourcing + audit trail
   - Effect-based agent integration
   - Permission model (future)
5. **Use OpenKanban as inspiration** for UX/keybindings, not a dependency

### Next Steps

1. ✅ Review this analysis with the team
2. 🔲 Get legal sign-off on "learn + reimplement" approach
3. 🔲 Create squad orchestration spec story (`.forge/specs/active/squad-v1/`)
4. 🔲 Schedule 2-week POC sprint
5. 🔲 Build architecture document + prototype
6. 🔲 Decide on TypeScript TUI framework (Ink, Dioxus, or custom)
7. 🔲 Plan integration with OpenCode Session/Agent systems

---

## References

- **OpenKanban Repo:** https://github.com/TechDufus/openkanban
- **ARCHITECTURE.md:** https://raw.githubusercontent.com/TechDufus/openkanban/main/ARCHITECTURE.md
- **CONFIGURATION.md:** https://raw.githubusercontent.com/TechDufus/openkanban/main/docs/CONFIGURATION.md
- **Bubbletea Docs:** https://github.com/charmbracelet/bubbletea
- **creack/pty:** https://github.com/creack/pty
- **vt10x (hinshun):** https://github.com/hinshun/vt10x

---

**Status:** Ready for design review and decision on squad feature direction.

**Follow-Up:** Route to architecture committee for scope finalization.
