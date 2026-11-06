/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { Plugin } from "@opencode/plugin/tui"
import type { SquadLivenessReport, SquadPanelDocument } from "@opencode/client"
import { Board } from "../../src/feature-plugins/squad/board"
import { useSquadBoard, type SquadBoardHandle, type SquadReadPort } from "../../src/feature-plugins/squad/use-squad-board"
import { T0, contextFixture, livenessReport, panelCard, panelDocument, sessionStatus } from "./squad-fixtures"

function portFixture(options: {
  panel?: SquadPanelDocument
  liveness?: SquadLivenessReport
  panelResult?: (call: number) => Promise<SquadPanelDocument>
}): SquadReadPort {
  let calls = 0
  return {
    panel: () => {
      calls += 1
      if (options.panelResult) return options.panelResult(calls)
      return Promise.resolve(options.panel ?? panelDocument())
    },
    liveness: () => Promise.resolve(options.liveness ?? livenessReport()),
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

async function renderBoard(options: {
  port: SquadReadPort
  now?: () => number
  width?: number
  height?: number
}) {
  const context = contextFixture()
  const handle: { board?: SquadBoardHandle } = {}
  function Harness() {
    const board = useSquadBoard(options.port, { clientVersion: context.app.version, now: options.now ?? (() => T0) })
    if (!handle.board) handle.board = board
    return <Board context={context} board={board} now={options.now ?? (() => T0)} />
  }
  const app = await testRender(() => <Harness />, { width: options.width ?? 120, height: options.height ?? 40 })
  return { app, context, board: () => handle.board! }
}

test("first load shows loading before the documents arrive", async () => {
  let resolvePanel!: (document: SquadPanelDocument) => void
  const port: SquadReadPort = {
    panel: () =>
      new Promise<SquadPanelDocument>((resolve) => {
        resolvePanel = resolve
      }),
    liveness: () => new Promise<SquadLivenessReport>(() => {}),
  }
  const { app } = await renderBoard({ port })
  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("carregando")
    resolvePanel(panelDocument())
  } finally {
    app.renderer.destroy()
  }
})

test("renders the five columns and their cards", async () => {
  const document = panelDocument({
    cards: {
      "card-1": panelCard({ id: "card-1", titulo: "Primeiro", coluna: "backlog", prioridade: "P2" }),
      "card-2": panelCard({ id: "card-2", titulo: "Segundo", coluna: "in_review", desconhecido: ["deploy"] }),
      "card-3": panelCard({ id: "card-3", titulo: "Terceiro", coluna: "done" }),
    },
  })
  const { app, board } = await renderBoard({ port: portFixture({ panel: document }) })
  try {
    await board().refresh()
    await settle()
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("in_review")
    expect(frame).toContain("backlog")
    expect(frame).toContain("blocked")
    expect(frame).toContain("done")
    expect(frame).toContain("Primeiro")
    expect(frame).toContain("Segundo")
    expect(frame).toContain("Terceiro")
    // Selo de "sem progresso" sem barra de progresso (DA-04).
    expect(frame).toContain("sem progresso")
    expect(frame).not.toContain("█")
    // Rodapé de frescor: revisao + idade com relógio injetado.
    expect(frame).toContain("abc123def456")
    expect(frame.indexOf("/Users")).toBe(-1)
  } finally {
    app.renderer.destroy()
  }
})

test("footer shows the age with the injected clock", async () => {
  const { app, board } = await renderBoard({
    port: portFixture({ panel: panelDocument() }),
    now: () => T0 + 90_000,
  })
  try {
    await board().refresh()
    await settle()
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("1 min")
  } finally {
    app.renderer.destroy()
  }
})

test("empty cards with an active generation shows the empty state", async () => {
  const { app, board } = await renderBoard({ port: portFixture({ panel: panelDocument({ cards: {} }) }) })
  try {
    await board().refresh()
    await settle()
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("nenhum card")
    expect(frame).not.toContain("nenhuma geração")
  } finally {
    app.renderer.destroy()
  }
})

test("no active generation is distinct from the empty state", async () => {
  const { app, board } = await renderBoard({
    port: portFixture({
      panel: panelDocument({ cards: {} }),
      liveness: livenessReport({ generation: null }),
    }),
  })
  try {
    await board().refresh()
    await settle()
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("nenhuma geração ativa")
    expect(frame).not.toContain("nenhum card")
  } finally {
    app.renderer.destroy()
  }
})

test("403 points at squad.enabled", async () => {
  const port: SquadReadPort = {
    panel: () => Promise.reject({ _tag: "ForbiddenError", message: "squad off" }),
    liveness: () => Promise.resolve(livenessReport()),
  }
  const { app, board } = await renderBoard({ port })
  try {
    await board().refresh()
    await settle()
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("squad.enabled")
    expect(frame).toContain("squad off")
  } finally {
    app.renderer.destroy()
  }
})

test("404 names the server version gap", async () => {
  const { ClientError } = await import("@opencode/client")
  const port: SquadReadPort = {
    panel: () => Promise.reject(new ClientError("UnexpectedStatus", { cause: { status: 404 } })),
    liveness: () => Promise.resolve(livenessReport()),
  }
  const { app, board } = await renderBoard({ port })
  try {
    await board().refresh()
    await settle()
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("squad indisponível")
    expect(frame).toContain("2.2.5-test")
  } finally {
    app.renderer.destroy()
  }
})

test("409 shows the server message verbatim", async () => {
  const port: SquadReadPort = {
    panel: () => Promise.reject({ _tag: "ConflictError", message: "geração em transição" }),
    liveness: () => Promise.resolve(livenessReport()),
  }
  const { app, board } = await renderBoard({ port })
  try {
    await board().refresh()
    await settle()
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("geração em transição")
    expect(frame).toContain("r para tentar novamente")
  } finally {
    app.renderer.destroy()
  }
})

test("network failure offers a retry without throwing", async () => {
  const { ClientError } = await import("@opencode/client")
  const port: SquadReadPort = {
    panel: () => Promise.reject(new ClientError("Transport")),
    liveness: () => Promise.resolve(livenessReport()),
  }
  const { app, board } = await renderBoard({ port })
  try {
    await board().refresh()
    await settle()
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("servidor indisponível")
    expect(frame).toContain("r para tentar novamente")
  } finally {
    app.renderer.destroy()
  }
})

test("a failed refresh keeps the document and marks it stale", async () => {
  let clock = T0
  let fail = false
  const port = portFixture({
    panelResult: () => (fail ? Promise.reject(new Error("rede caiu")) : Promise.resolve(panelDocument())),
  })
  const { app, board } = await renderBoard({ port, now: () => clock })
  try {
    await board().refresh()
    await settle()
    await app.renderOnce()
    expect(app.captureCharFrame()).not.toContain("desatualizado")
    fail = true
    clock = T0 + 120_000
    await board().refresh()
    await settle()
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("desatualizado")
    expect(frame).toContain("rede caiu")
    expect(frame).toContain("2 min")
  } finally {
    app.renderer.destroy()
  }
})

test("no frame leaks session locations", async () => {
  const document = panelDocument({
    cards: { "card-1": panelCard({ id: "card-1", titulo: "Primeiro", coluna: "backlog" }) },
  })
  const { app, board } = await renderBoard({
    port: portFixture({
      panel: document,
      liveness: livenessReport({
        sessions: [sessionStatus({ location: { directory: "/Users/segredo/worktree" } })],
      }),
    }),
  })
  try {
    await board().refresh()
    await settle()
    await app.renderOnce()
    expect(app.captureCharFrame().indexOf("/Users")).toBe(-1)
  } finally {
    app.renderer.destroy()
  }
})
