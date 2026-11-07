/** @jsxImportSource @opentui/solid */
import { createMemo, createSignal } from "solid-js"
import type { Plugin } from "@opencode/plugin/tui"
import {
  ClientError,
  type SquadLivenessReport,
  type SquadPanelCard,
  type SquadPanelDocument,
  type SquadStage,
} from "@opencode/client"
import { Board } from "../../squad/board"
import { boardModel } from "../../squad/board-model"
import { Sessions } from "../../squad/sessions"
import { useSquadBoard, type SquadReadPort } from "../../squad/use-squad-board"
import type { Story } from "./index"
import { StoryFooter } from "./footer"

const T0 = 1_700_000_000_000
const COLUNAS = ["backlog", "in_progress", "in_review", "blocked", "done"] as const

function stage(overrides: Partial<SquadStage> = {}): SquadStage {
  return { status: "unknown", evidence: null, source: "none", ...overrides }
}

function card(overrides: Partial<SquadPanelCard> = {}): SquadPanelCard {
  return {
    id: "card-1",
    titulo: "Card",
    coluna: "backlog",
    agente: "builder-1",
    refs: [],
    evidencias: [],
    estagios: { jira: stage(), ci: stage(), merge: stage(), deploy: stage(), acceptance: stage() },
    exigidos: [],
    desconhecido: [],
    progressa: false,
    ...overrides,
  }
}

function panel(overrides: Partial<SquadPanelDocument> = {}): SquadPanelDocument {
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

function liveness(overrides: Partial<SquadLivenessReport> = {}): SquadLivenessReport {
  return { generation: "ORQ-1", sessions: [], inboxPending: 0, cost: { unknown: true }, previous: null, ...overrides }
}

function normalPanel(): SquadPanelDocument {
  const cards: Record<string, SquadPanelCard> = {}
  const seed = [
    { id: "card-1", titulo: "Ajustar webhook de pagamento", coluna: "backlog", agente: "builder-1" },
    { id: "card-2", titulo: "Revisar fila de liquidação", coluna: "in_progress", agente: "builder-2" },
    { id: "card-3", titulo: "Corrigir timeout do gateway", coluna: "in_review", agente: "builder-1" },
    { id: "card-4", titulo: "Bloqueado por credencial PCI", coluna: "blocked", agente: "builder-3", desconhecido: ["ci"] },
    { id: "card-5", titulo: "Publicar changelog v0.1.0", coluna: "done", agente: "builder-2", progressa: true },
  ] as const
  for (const item of seed) cards[item.id] = card({ ...item, desconhecido: "desconhecido" in item ? [...item.desconhecido] : [] })
  return panel({ cards })
}

function normalLiveness(): SquadLivenessReport {
  return liveness({
    sessions: [
      {
        name: "builder-1",
        role: "worker",
        provider: "anthropic",
        model: "claude",
        location: { directory: "/workspace/squad" },
        state: "verified",
        liveness: { verdict: "idle", measuredAt: T0, workingStale: false, presumedDead: false },
        inboxPending: 0,
        cost: { unknown: true },
      },
      {
        name: "builder-2",
        role: "worker",
        provider: "anthropic",
        model: "claude",
        location: { directory: "/workspace/squad" },
        state: "verified",
        liveness: { verdict: "working", measuredAt: T0, workingStale: false, presumedDead: false },
        inboxPending: 1,
        cost: { unknown: true },
      },
    ],
  })
}

function manyCards(count: number): SquadPanelDocument {
  const cards: Record<string, SquadPanelCard> = {}
  for (let index = 0; index < count; index++) {
    const id = `card-${index}`
    cards[id] = card({
      id,
      titulo: `Card ${index}`,
      coluna: COLUNAS[index % COLUNAS.length],
      agente: `builder-${(index % 4) + 1}`,
    })
  }
  return panel({ cards })
}

function previousGenerationLiveness(): SquadLivenessReport {
  return liveness({
    previous: {
      id: "ORQ-0",
      closedAt: T0 - 3_600_000,
      closedBy: "milton",
      sessions: [{ name: "builder-0", sessionID: "ses_old", state: "closed" }],
    },
  })
}

type Scenario = {
  id: string
  label: string
  panel: () => Promise<SquadPanelDocument>
  liveness: () => Promise<SquadLivenessReport>
}

const scenarios: Scenario[] = [
  { id: "normal", label: "normal", panel: () => Promise.resolve(normalPanel()), liveness: () => Promise.resolve(normalLiveness()) },
  { id: "vazio", label: "vazio (sem cards)", panel: () => Promise.resolve(panel()), liveness: () => Promise.resolve(liveness()) },
  {
    id: "sem-geracao",
    label: "sem geração ativa",
    panel: () => Promise.resolve(panel()),
    liveness: () => Promise.resolve(liveness({ generation: null })),
  },
  {
    id: "desatualizado",
    label: "desatualizado (falha preserva dados)",
    panel: () => Promise.resolve(normalPanel()),
    liveness: () => Promise.reject(new Error("timeout ao medir liveness")),
  },
  {
    id: "403",
    label: "403 — squad desabilitado",
    panel: () => Promise.reject({ _tag: "ForbiddenError", message: "squad.enabled está desligado" }),
    liveness: () => Promise.resolve(liveness()),
  },
  {
    id: "404",
    label: "404 — indisponível nesta versão",
    panel: () => Promise.reject(new ClientError("UnexpectedStatus", { cause: { status: 404 } })),
    liveness: () => Promise.resolve(liveness()),
  },
  {
    id: "geracao-anterior",
    label: "geração anterior (sessões fechadas)",
    panel: () => Promise.resolve(normalPanel()),
    liveness: () => Promise.resolve(previousGenerationLiveness()),
  },
  {
    id: "200-cards",
    label: "200 cards",
    panel: () => Promise.resolve(manyCards(200)),
    liveness: () => Promise.resolve(normalLiveness()),
  },
]

function SquadBoardStory(props: { context: Plugin.Context }) {
  const [selected, setSelected] = createSignal(0)
  let current = scenarios[0]
  const port: SquadReadPort = {
    panel: () => current.panel(),
    liveness: () => current.liveness(),
  }
  const board = useSquadBoard(port, { clientVersion: props.context.app.version, now: () => T0 })
  const squadLiveness = createMemo(() => {
    const state = board.state()
    return state.type === "ready" ? state.liveness : null
  })
  const cards = createMemo(() => {
    const state = board.state()
    if (state.type !== "ready" || !state.panel) return []
    return boardModel(state.panel).columns.flatMap((column) => column.cards)
  })

  const select = (index: number) => {
    setSelected(((index % scenarios.length) + scenarios.length) % scenarios.length)
    current = scenarios[selected()]
    void board.refresh()
  }

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "escape",
        title: "Back to storybook",
        group: "Storybook",
        run: () => props.context.ui.router.navigate({ type: "plugin", name: "storybook" }),
      },
      { bind: "up,k", title: "Previous scenario", group: "Storybook", run: () => select(selected() - 1) },
      { bind: "down,j", title: "Next scenario", group: "Storybook", run: () => select(selected() + 1) },
      ...scenarios.map((scenario, index) => ({
        bind: String(index + 1),
        title: `Scenario: ${scenario.label}`,
        group: "Storybook",
        run: () => select(index),
      })),
    ],
  }))

  return (
    <box width="100%" height="100%" flexDirection="column">
      <box flexGrow={1} flexDirection="row">
        <box flexGrow={3}>
          <Board context={props.context} board={board} now={() => T0} />
        </box>
        <box flexGrow={2} overflow="hidden">
          <Sessions liveness={squadLiveness()} cards={cards()} theme={props.context.theme} />
        </box>
      </box>
      <StoryFooter
        context={props.context}
        title="storybook / squad board — somente leitura"
        details={[scenarios[selected()].label]}
        message="somente leitura: use squad send e squad dispatch accept para escrever"
        controls={[
          { shortcut: "↑↓", label: "cenário" },
          { shortcut: "1-8", label: "ir direto" },
          { shortcut: "j/k/h/l", label: "navegar no board" },
          { shortcut: "enter", label: "detalhe" },
          { shortcut: "esc", label: "voltar" },
        ]}
      />
    </box>
  )
}

export const squadBoardStory: Story = {
  id: "squad-board",
  title: "Squad board",
  render: (context) => <SquadBoardStory context={context} />,
}
