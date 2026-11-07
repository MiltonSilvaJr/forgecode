---
date: 2026-11-06
id: openkanban-exec-summary
title: OpenKanban Evaluation - Executive Summary
status: evaluation
author: milton
tags:
  - executive-summary
  - decision-memo
  - squad-orchestration
priority: critical
---

# OpenKanban Evaluation — Executive Summary

**Recommendation:** ✅ **Proceed with Squad Orchestration Feature**

Use OpenKanban as design inspiration (not code reuse) for a new OpenCode squad orchestration TUI.

---

## TL;DR

| Aspect | Status |
|--------|--------|
| **OpenKanban Value** | ✅ High — proven kanban patterns, TUI architecture, keybinding dispatch |
| **Integration Feasibility** | ✅ High — OpenCode TypeScript stack, Effect already in use |
| **Effort Estimate** | 🟡 Medium — 14 weeks (3.5 months) for v1 GA |
| **Technical Debt** | 🟡 Medium — Need event sourcing, RBAC (future), distributed coordination (future) |
| **Licensing Risk** | ✅ Low — "learn + reimplement" approach avoids AGPL issues |
| **User Impact** | ✅ High — Unlocks coordinated agent workflows, improves UX |

---

## Key Findings

### 1. What OpenKanban Does Well

**Proven patterns we'll reuse:**
- ✅ **Kanban board model** (columnar workflow) — Adaptable to squad states
- ✅ **Bubbletea state machine** — Clean separation of concerns; easy to port to TypeScript
- ✅ **Embedded terminals** — Proven PTY + vt100 pattern for agent observation
- ✅ **Configuration-driven agents** — Extensible without code changes
- ✅ **Keybinding dispatch** — Modal navigation (Normal → CreateTicket → AgentView)

### 2. Why Squad Orchestration Matters

**Problem we're solving:**
- Coordinating multiple AI agents across squad tasks is currently manual + error-prone
- No single view of squad state → context switching + lost work
- No durability → crash = lost progress

**Value proposition:**
- Unified TUI for squad coordination
- Reliable state management (event sourcing)
- Real-time observability
- Audit trail for compliance

### 3. Technical Soundness

**Architecture decision: Learn + Reimplement**
- ✅ Study OpenKanban (architecture, patterns)
- ✅ Reimplement in TypeScript + Effect (our stack)
- ✅ Avoid AGPL-3.0 licensing issues
- ✅ Full control over squad-specific features

**Why not use OpenKanban as dependency?**
- ❌ AGPL-3.0 would require OpenCode to disclose source (not acceptable)
- ❌ Go codebase; we're TypeScript (deployment complexity)
- ❌ Assumes CLI agents; we need Effect integration
- ❌ No event sourcing (OpenKanban uses ephemeral JSON)

---

## Business Case

### Investment Required

| Category | Estimate | Justification |
|----------|----------|---------------|
| **Development** | 14 weeks | 5 FTE (backend 2, TUI 1, QA 1, PM 0.5) |
| **Infrastructure** | 0 weeks | Use existing OpenCode platforms (SQLite, CloudWatch) |
| **Operations** | 0 weeks | Feature is in-process; no new services |

### Expected Returns

| Metric | Baseline | Target | Timeframe |
|--------|----------|--------|-----------|
| **Squad task completion time** | Manual + 10min overhead | < 5 min average | v1 GA |
| **Agent coordination errors** | 3+ per day (manual) | < 0.1 per day | v1 GA |
| **User context switches** | 5-10 per task | < 1 per task | v1 GA |
| **Auditability** | Not tracked | 100% of decisions logged | v1 GA |

### Risk Mitigation

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **14-week timeline** | 🟡 Medium | Parallel tracks (backend + TUI), agile checkpoints |
| **Tech stack complexity** | 🟡 Medium | Allocate Effect.ts training (1 week, Phase 0) |
| **SQLite scale** | 🟡 Medium | Load test 100k events in Phase 2; scale to PostgreSQL if needed (v1.1) |
| **TUI responsiveness** | 🟡 Medium | POC performance test in Phase 0; fallback to CLI interface if needed |

---

## Scope & Deliverables

### v1.0 GA (Week 14)

**Included:**
- ✅ Squad state machine (7 states, clean transitions)
- ✅ Event sourcing + durable persistence (SQLite)
- ✅ Squad TUI (board, task detail, settings)
- ✅ Effect-based agent integration
- ✅ Keybindings (assign, pause, resume, escalate, complete)
- ✅ 90%+ test coverage
- ✅ CloudWatch integration (basic)
- ✅ Documentation + examples

**Not Included (v1.1+ scope):**
- ❌ Terminal embedding for CLI agents (optional, v1.1)
- ❌ Permission model / RBAC (v1.1)
- ❌ GitHub Issues / Jira sync (v1.2)
- ❌ Distributed agents / clustering (v2.0)

---

## Timeline & Checkpoints

```
Week 1       Phase 0: Spike (TUI framework decision)
Weeks 2-3    Phase 1: State Machine (POC)
Weeks 4-5    Phase 2: Event Sourcing (persistence)
Weeks 6-8    Phase 3: Orchestrator (agent integration)
Weeks 9-11   Phase 4: TUI (keybindings, board, detail)
Weeks 12-13  Phase 5: Integration & Testing
Week 14      Phase 6: Alpha Release

Total: 14 weeks (start Nov 17, GA ~mid-Feb 2027)
```

**Checkpoints (go/no-go gates):**
- EOW3: State machine 100% tested ✓
- EOW5: Event sourcing scale-tested ✓
- EOW11: TUI keybindings responsive ✓
- EOW13: E2E tests pass, 90%+ coverage ✓

---

## Key Decisions Required

### 1. TUI Framework (EOW1)

**Options:** Ink vs. Dioxus

**Recommendation:** Ink
- React-like patterns (familiar to OpenCode team)
- Proven TUI rendering
- TypeScript-first
- Smaller bundle than Dioxus

**Decision owner:** Architecture Committee

---

### 2. Agent Interface (Week 2)

**Options:**
- A. Agent returns `Effect<Result>` — Squad awaits completion
- B. Agent returns `Stream<Progress>` — Real-time updates
- C. Hybrid (execution + observation)

**Recommendation:** Option C (Hybrid)
- Supports both batch + streaming agents
- Aligns with OpenCode's async model

**Decision owner:** Squad + Agent team alignment

---

### 3. Terminal Embedding (Week 7)

**Options:**
- A. Include PTY support for CLI agents
- B. Structured logs only
- C. Defer to v1.1

**Recommendation:** Option C (Defer to v1.1)
- Reduces v1 scope by 2 weeks
- CLI agent support less critical (most agents are Effect-based)
- Can add PTY in v1.1 if user demand

**Decision owner:** Product Manager

---

## Success Criteria

### Technical (Internal)

- ✅ State machine: 100% transition coverage, no panics
- ✅ Persistence: Event log survives restarts
- ✅ TUI: Responsive (< 50ms keybinding latency)
- ✅ Orchestration: Multi-task coordination works
- ✅ Testing: 90%+ coverage, E2E tests pass
- ✅ Performance: 1000 tasks, 100 squads without degradation

### User-Facing (External)

- ✅ Squad task completion < 5 minutes (vs. 15 min manual)
- ✅ Coordination errors < 0.1 per day (vs. 3+ manual)
- ✅ User satisfaction ≥ 4/5 stars (alpha feedback)
- ✅ Zero data loss (event log = source of truth)

---

## Approval Path

### Sign-Off Required From

1. **Product Manager** — Scope + timeline
   - **Deadline:** Nov 13, 2026
   
2. **Engineering Lead** — Resource allocation + technical feasibility
   - **Deadline:** Nov 17, 2026
   
3. **Architecture Committee** — Tech stack + design review
   - **Deadline:** Nov 17, 2026
   
4. **Legal** — Licensing (AGPL-3.0 implications)
   - **Deadline:** Nov 13, 2026

### Go/No-Go Decision

**Decision date:** Nov 20, 2026 (VP Engineering + Product)

**Success = all sign-offs received + no critical blockers**

---

## FAQ

### Q: Why not just use OpenKanban directly?

**A:** Three blockers:
1. **Licensing**: AGPL-3.0 requires OpenCode source disclosure (not acceptable for commercial SaaS)
2. **Stack mismatch**: Go vs. TypeScript; integration complexity
3. **Architecture mismatch**: CLI agents vs. Effect-based agents; missing event sourcing

Our approach (learn + reimplement) gives us control + licensing freedom.

---

### Q: What if 14 weeks is too long?

**A:** Fallback strategies:
1. **Reduced scope** — CLI-only interface (skip TUI) → 8 weeks
2. **Phased delivery** — GA with limited features (3 states instead of 7) → 10 weeks
3. **Defer terminal embedding** — Already planned for v1.1 (-2 weeks)

We can hit 12 weeks if we cut terminal embedding (recommended).

---

### Q: How does this fit with existing OpenCode features?

**A:** Squad orchestration is a **new layer** on top of:
- **Session** (existing) — Individual agent sessions
- **Agent** (existing) — Agent interface + execution
- **TUI** (existing) — Terminal UI framework

Squad adds: **coordination** between agents + **state durability**.

No breaking changes to existing systems.

---

### Q: What about distributed agents / multi-machine?

**A:** **Out of scope for v1** (target: v2.0, Q3 2027)

v1 assumes agents run locally or in same region. We'll design with distribution in mind (event-based, not shared memory), so v2 migration is clean.

---

### Q: Can we run a POC first?

**A:** **Yes, Phase 0 (Week 1)** is exactly that:
- Study OpenKanban architecture
- Build minimal state machine (POC)
- Evaluate TUI framework choices
- ~40 hours, low risk

If Phase 0 fails (e.g., TUI framework underperforms), we have learned and can pivot cheaply.

---

## Recommendation

### ✅ Proceed with Squad Orchestration Feature

**Rationale:**
1. ✅ **Strategic value** — Unlocks coordinated agent workflows
2. ✅ **Technical soundness** — Well-scoped, proven patterns
3. ✅ **Feasible timeline** — 14 weeks realistic with proper resource allocation
4. ✅ **Low licensing risk** — "Learn + reimplement" approach is clean
5. ✅ **Incremental delivery** — v1 has clear minimal feature set; v1.1+ planned

**Next steps:**
1. **Nov 6** — Share this evaluation with stakeholders ✓
2. **Nov 13** — Secure product + legal sign-off
3. **Nov 17** — Finalize tech stack + resource allocation
4. **Nov 20** — Final go/no-go decision
5. **Nov 27** — Phase 0 kickoff (architecture study)

---

## Contacts & Escalation

| Role | Name | Contact | For |
|------|------|---------|-----|
| **Product Lead** | [TBD] | [email] | Scope + timeline questions |
| **Architecture Lead** | [TBD] | [email] | Tech stack + design questions |
| **Engineering Manager** | [TBD] | [email] | Resource allocation |
| **Legal** | [TBD] | [email] | Licensing questions |

---

## Supporting Documents

For more details, see:
1. **[openkanban-evaluation.md](./2026-11-06_openkanban-evaluation.md)** — Strategic evaluation + decision points
2. **[openkanban-technical-analysis.md](./2026-11-06_openkanban-technical-analysis.md)** — Deep technical dive + architecture
3. **[openkanban-integration-roadmap.md](./2026-11-06_openkanban-integration-roadmap.md)** — Detailed implementation plan + phases

---

**Status:** Ready for executive review

**Distribution:** Product committee, Engineering leadership, Architecture review board

**Prepared by:** Milton (AI Agent)

**Date:** November 6, 2026
