import { RGBA } from "@opentui/core"
import type { Plugin } from "@opencode/plugin/tui"
import type { SquadLivenessReport, SquadPanelCard, SquadPanelDocument, SquadSessionStatus, SquadStage } from "@opencode/client"

export const COLUNAS = ["backlog", "in_progress", "in_review", "blocked", "done"] as const

/** Fixed epoch (ms) used as "atualizadoEm"/"measuredAt" across squad fixtures. */
export const T0 = 1_700_000_000_000

export function stage(overrides: Partial<SquadStage> = {}): SquadStage {
  return { status: "unknown", evidence: null, source: "none", ...overrides }
}

export function panelCard(overrides: Partial<SquadPanelCard> = {}): SquadPanelCard {
  return {
    id: "card-1",
    titulo: "Card",
    coluna: "backlog",
    agente: "builder-1",
    refs: [],
    evidencias: [],
    estagios: {
      jira: stage(),
      ci: stage(),
      merge: stage(),
      deploy: stage(),
      acceptance: stage(),
    },
    exigidos: [],
    desconhecido: [],
    progressa: false,
    ...overrides,
  }
}

export function panelDocument(overrides: Partial<SquadPanelDocument> = {}): SquadPanelDocument {
  return {
    versaoSchema: 1,
    revisao: "abc123def456",
    atualizadoEm: T0,
    colunas: [...COLUNAS],
    cards: {},
    fonte: {},
    ...overrides,
  }
}

export function sessionStatus(overrides: Partial<SquadSessionStatus> = {}): SquadSessionStatus {
  return {
    name: "builder-1",
    role: "worker",
    provider: "anthropic",
    model: "claude",
    location: { directory: "/workspace/squad" },
    state: "verified",
    liveness: {
      verdict: "idle",
      measuredAt: T0,
      workingStale: false,
      presumedDead: false,
    },
    inboxPending: 0,
    cost: { unknown: true },
    ...overrides,
  }
}

export function livenessReport(overrides: Partial<SquadLivenessReport> = {}): SquadLivenessReport {
  return {
    generation: "ORQ-1",
    sessions: [],
    inboxPending: 0,
    cost: { unknown: true },
    previous: null,
    ...overrides,
  }
}

export function themeFixture() {
  const color = RGBA.fromInts(200, 200, 200)
  const focused = RGBA.fromInts(80, 80, 80)
  return {
    text: {
      base: color,
      muted: color,
      faint: color,
      formfield: { focused },
      feedback: { error: { base: color, muted: color }, warning: { base: color, muted: color } },
    },
    background: {
      base: color,
      raised: { base: color, high: color, max: color },
      formfield: { focused },
    },
  }
}

export function contextFixture(version = "2.2.5-test"): Plugin.Context {
  return {
    theme: themeFixture(),
    app: { version, channel: "test" },
    keymap: { layer: () => {} },
  } as unknown as Plugin.Context
}
