# OpenCode Ledger

Evaluation repository and decision logs for OpenCode architecture, external research, and technology assessments.

---

## Recent Entries

### OpenKanban Evaluation (Nov 6, 2026)

**Assessment of OpenKanban TUI kanban board for squad orchestration feature integration.**

A comprehensive evaluation of [OpenKanban](https://github.com/TechDufus/openkanban), a TUI kanban board for orchestrating AI agents, with the goal of incorporating kanban and agent-coordination patterns into OpenCode's squad orchestration feature.

**Documents:**

1. **[2026-11-06_openkanban-executive-summary.md](./2026-11-06_openkanban-executive-summary.md)** — 📊 **START HERE**
   - Executive summary for decision-makers
   - Recommendation: Proceed with squad orchestration feature
   - Key findings + business case
   - 5-minute read

2. **[2026-11-06_openkanban-evaluation.md](./2026-11-06_openkanban-evaluation.md)** — 🎯 Strategic Evaluation
   - Project overview + features
   - Architectural insights for squad feature
   - Mapping OpenKanban to squad concepts
   - Gaps & considerations
   - POC direction
   - 30-minute read

3. **[2026-11-06_openkanban-technical-analysis.md](./2026-11-06_openkanban-technical-analysis.md)** — 🔧 Technical Deep-Dive
   - Detailed architecture analysis
   - Component breakdown (TUI, board, terminal, git, agents)
   - Data model & persistence
   - Configuration & extensibility
   - Comparison matrix
   - Integration strategies
   - 45-minute read

4. **[2026-11-06_openkanban-integration-roadmap.md](./2026-11-06_openkanban-integration-roadmap.md)** — 🛣️ Implementation Roadmap
   - Feature vision & scope
   - Architecture decisions (tech stack, project structure)
   - Squad state machine design
   - Phased delivery plan (6 phases, 14 weeks)
   - Resource requirements
   - Success metrics
   - Risk assessment
   - 60-minute read

5. **[2026-11-06_openkanban-adversarial-review.md](./2026-11-06_openkanban-adversarial-review.md)** — ⚠️ **CRITICAL: Adversarial Review**
   - Challenges assumptions in original evaluation
   - Identifies unvalidated claims and hidden risks
   - Questions legal safety of "learn + reimplement"
   - Exposes timeline and resource optimism
   - **Recommendation: 4-week validation sprint before committing to 14-week roadmap**
   - 45-minute read

---

## How to Use This Ledger

### For Decision-Makers

1. **FIRST**: Read [2026-11-06_openkanban-adversarial-review.md](./2026-11-06_openkanban-adversarial-review.md) ⚠️
2. Then: [2026-11-06_openkanban-executive-summary.md](./2026-11-06_openkanban-executive-summary.md)
3. Ask questions from FAQ section
4. Check "Approval Path" for sign-off process

**Time investment:** 50-60 minutes (adversarial review + executive summary)

### For Technical Leads

1. Start: [2026-11-06_openkanban-technical-analysis.md](./2026-11-06_openkanban-technical-analysis.md)
2. Review: "Architecture Decisions" section of [roadmap](./2026-11-06_openkanban-integration-roadmap.md)
3. Discuss: Implementation phases + decision points

**Time investment:** 45-60 minutes

### For Product Managers

1. Read: [openkanban-evaluation.md](./2026-11-06_openkanban-evaluation.md) (section 1-3)
2. Review: [roadmap](./2026-11-06_openkanban-integration-roadmap.md) (section 1-2, 4)
3. Check: Success metrics + user impact

**Time investment:** 30-40 minutes

### For Implementation Team

1. Study: [roadmap](./2026-11-06_openkanban-integration-roadmap.md) (all sections)
2. Reference: [technical-analysis.md](./2026-11-06_openkanban-technical-analysis.md) for patterns
3. Clone: https://github.com/TechDufus/openkanban for Phase 0 spike

**Time investment:** 60+ minutes

---

## Decision Timeline

| Date | Milestone | Owner |
|------|-----------|-------|
| **Nov 6, 2026** | ✅ Evaluation complete | Milton (AI Agent) |
| **Nov 6, 2026** | ✅ Adversarial review complete | Milton (AI Agent) |
| **Nov 13 - Dec 11, 2026** | 🔲 **Validation sprint** (4 weeks) | Product + Engineering + Legal |
| **Week 1 (Nov 13-20)** | 🔲 User discovery (problem validation) | Product Manager |
| **Week 2 (Nov 20-27)** | 🔲 Legal review (AGPL risk) | Legal + IP Lawyer |
| **Week 3-4 (Nov 27-Dec 11)** | 🔲 Technical spike (Effect.ts POC, TUI bake-off) | Engineering |
| **Dec 11, 2026** | 🔲 **Go/No-Go decision** (post-validation) | VP Engineering + Product |
| **Dec 18, 2026** | 🔲 Implementation kickoff (if GO) | Squad Orchestration Team |

---

## Key Recommendation

### 🟡 **Conditional Proceed - Validation Required**

**Original:** ✅ Proceed with Squad Orchestration Feature (14 weeks)

**After Adversarial Review:** ⚠️ **Run 4-week validation sprint first**

**Critical Issues Identified:**
1. 🔴 Problem not validated with users (no user research)
2. 🔴 Legal risk of "learn + reimplement" unverified (AGPL-3.0)
3. 🟡 Effect.ts learning curve underestimated (1 week insufficient)
4. 🟡 Timeline optimistic (integration complexity not accounted)
5. 🟡 Resource availability unconfirmed (no named team members)

**Revised Approach:**
- **Week 1-4:** Validation sprint (user research, legal review, technical spike)
- **Dec 11:** Go/No-Go decision based on validation
- **If GO:** 21-week implementation (MVP at week 11, not week 14)
- **If NO-GO:** Pivot to alternative (web dashboard, IDE plugin)

**Cost of validation:** 4 weeks (~$80k)
**Cost of skipping:** Potentially 14 weeks building wrong solution (~$280k)

See [openkanban-adversarial-review.md](./2026-11-06_openkanban-adversarial-review.md) for full analysis.

---

## FAQ

### Q: How is this different from OpenKanban?

**A:** We're taking OpenKanban's **design patterns** (kanban board, keybindings, agent coordination) as inspiration, but **reimplementing from scratch** in TypeScript + Effect to:
1. Avoid AGPL-3.0 licensing issues
2. Integrate deeply with OpenCode (Session, Agent systems)
3. Add squad-specific features (event sourcing, RBAC, distributed agents)

### Q: What if we just use OpenKanban as a dependency?

**A:** Not feasible:
- ❌ AGPL-3.0 would require OpenCode to disclose source
- ❌ Go vs. TypeScript complicates deployment
- ❌ Missing squad-specific features (event log, RBAC)

### Q: Can we start smaller (MVP)?

**A:** Yes! Phase 0 (Week 1) is a low-risk spike to validate assumptions. If it fails, we have learned cheaply.

### Q: When is v1.0 ready?

**A:** Target: **Mid-February 2027** (14 weeks from Nov 27 kickoff)

### Q: What about terminal embedding for CLI agents?

**A:** Deferred to v1.1 (reduces v1 scope by 2 weeks). Most agents are Effect-based anyway.

---

## Related Documents in .forge/

- **Product Baseline:** `.forge/product/current/capabilities/`
- **Squad Capability Spec:** `.forge/product/current/capabilities/squad-orchestration.md` (to be created after approval)
- **Forge Specs:** `.forge/specs/active/` (squad-v1 spec story to be created)

---

## Contacts

| Role | For Questions About |
|------|---------------------|
| **Product Lead** | Strategic value, scope, timeline |
| **Architecture Lead** | Tech stack, design, integration points |
| **Engineering Manager** | Resource allocation, schedule |
| **Legal** | Licensing (AGPL-3.0) |

---

## Document Metadata

| Field | Value |
|-------|-------|
| **Created** | November 6, 2026 |
| **Author** | Milton (AI Agent) |
| **Status** | Ready for Executive Review |
| **Confidence** | High (based on OpenKanban architecture study + OpenCode codebase analysis) |
| **Next Review** | November 13, 2026 (post-decision) |

---

**Navigation:**
- 📊 [Executive Summary](./2026-11-06_openkanban-executive-summary.md) — For decision-makers
- 🎯 [Strategic Evaluation](./2026-11-06_openkanban-evaluation.md) — Concepts & gaps
- 🔧 [Technical Analysis](./2026-11-06_openkanban-technical-analysis.md) — Architecture & patterns
- 🛣️ [Implementation Roadmap](./2026-11-06_openkanban-integration-roadmap.md) — Phases & timeline
