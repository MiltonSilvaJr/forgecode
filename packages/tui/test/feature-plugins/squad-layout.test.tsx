/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { Renderable } from "@opentui/core"
import type { Plugin } from "@opencode/plugin/tui"
import { Keymap } from "../../src/context/keymap"
import { resolve } from "../../src/config"
import { Board } from "../../src/feature-plugins/squad/board"
import { useSquadBoard, type SquadBoardHandle, type SquadReadPort } from "../../src/feature-plugins/squad/use-squad-board"
import { T0, contextFixture, panelCard, panelDocument } from "./squad-fixtures"

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const HEADER = /(backlog|in_progress|in_review|blocked|done) · \d+/g
const headerCount = (frame: string) => frame.match(HEADER)?.length ?? 0

function collect(node: Renderable): Renderable[] {
  return [node, ...node.getChildren().filter((child): child is Renderable => typeof child !== "string").flatMap(collect)]
}

function renderContext(): Plugin.Context {
  const base = contextFixture()
  return {
    ...base,
    keymap: { layer: (factory: Parameters<typeof Keymap.createLayer>[0]) => Keymap.createLayer(factory) },
  } as unknown as Plugin.Context
}

function portWithCards(cards: Record<string, ReturnType<typeof panelCard>>): SquadReadPort {
  return {
    panel: () => Promise.resolve(panelDocument({ cards })),
    liveness: () =>
      Promise.resolve({ generation: "ORQ-1", sessions: [], inboxPending: 0, cost: { unknown: true }, previous: null }),
  }
}

async function renderBoard(port: SquadReadPort, width: number, height: number) {
  const context = renderContext()
  const handle: { board?: SquadBoardHandle } = {}
  function Harness() {
    const board = useSquadBoard(port, { clientVersion: context.app.version, now: () => T0 })
    if (!handle.board) handle.board = board
    return (
      <Keymap.Provider config={resolve({}, { terminalSuspend: true })}>
        <Board context={context} board={board} now={() => T0} />
      </Keymap.Provider>
    )
  }
  const app = await testRender(() => <Harness />, { width, height, kittyKeyboard: true })
  await handle.board!.refresh()
  await settle()
  await app.renderOnce()
  return app
}

function cards(count: number, column = "backlog") {
  const record: Record<string, ReturnType<typeof panelCard>> = {}
  for (let index = 1; index <= count; index += 1) {
    const id = `card-${index}`
    record[id] = panelCard({ id, titulo: `Card ${index}`, coluna: column as "backlog" })
  }
  return record
}

function squadCards(app: Awaited<ReturnType<typeof testRender>>) {
  return collect(app.renderer.root).filter(
    (node) => typeof node.id === "string" && node.id.startsWith("squad-card-"),
  )
}

test("at 120x40 all five column headers are visible side by side", async () => {
  const app = await renderBoard(portWithCards(cards(3)), 120, 40)
  try {
    expect(headerCount(app.captureCharFrame())).toBe(5)
  } finally {
    app.renderer.destroy()
  }
})

test("at 80x24 ten cards are all reachable and the current header stays visible", async () => {
  const app = await renderBoard(portWithCards(cards(10)), 80, 24)
  try {
    for (let index = 0; index < 9; index += 1) {
      app.mockInput.pressKey("j")
      await app.renderOnce()
    }
    const frame = app.captureCharFrame()
    for (let index = 1; index <= 10; index += 1) {
      expect(frame).toContain(`Card ${index}`)
    }
    expect(headerCount(frame)).toBe(1)
    expect(frame).toContain("backlog · 10")
  } finally {
    app.renderer.destroy()
  }
})

test("mounts at most viewport + 4 card renderables with 200 cards", async () => {
  const app = await renderBoard(portWithCards(cards(200)), 80, 24)
  try {
    expect(squadCards(app).length).toBeLessThanOrEqual(28)
    const mounted = () => squadCards(app).map((node) => node.id)
    expect(mounted()).not.toContain("squad-card-card-150")
    for (let index = 0; index < 150; index += 1) app.mockInput.pressKey("j")
    await app.renderOnce()
    expect(mounted()).toContain("squad-card-card-150")
  } finally {
    app.renderer.destroy()
  }
})
