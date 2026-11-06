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

function readPort(calls: string[]): SquadReadPort {
  return {
    panel: () => {
      calls.push("panel")
      return Promise.resolve(
        panelDocument({
          cards: {
            "card-1": panelCard({ id: "card-1", titulo: "Primeiro", coluna: "backlog" }),
            "card-2": panelCard({ id: "card-2", titulo: "Segundo", coluna: "backlog" }),
            "card-3": panelCard({ id: "card-3", titulo: "Terceiro", coluna: "in_progress" }),
          },
        }),
      )
    },
    liveness: () => {
      calls.push("liveness")
      return Promise.resolve({ generation: "ORQ-1", sessions: [], inboxPending: 0, cost: { unknown: true }, previous: null })
    },
  }
}

async function renderBoard() {
  const context = renderContext()
  const calls: string[] = []
  const port = readPort(calls)
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
  const app = await testRender(() => <Harness />, { width: 120, height: 40, kittyKeyboard: true })
  await handle.board!.refresh()
  await settle()
  await app.renderOnce()
  const theme = contextFixture().theme
  return {
    app,
    calls,
    focusedCardID: () => {
      const focused = theme.background.formfield.focused.toInts().join(",")
      const hit = collect(app.renderer.root).find(
        (node) =>
          typeof node.id === "string" &&
          node.id.startsWith("squad-card-") &&
          node.backgroundColor !== undefined &&
          node.backgroundColor.toInts().join(",") === focused,
      )
      return hit ? hit.id.replace("squad-card-", "") : undefined
    },
  }
}

test("j moves the focus one card down", async () => {
  const { app, focusedCardID } = await renderBoard()
  try {
    expect(focusedCardID()).toBe("card-1")
    app.mockInput.pressKey("j")
    await app.renderOnce()
    expect(focusedCardID()).toBe("card-2")
  } finally {
    app.renderer.destroy()
  }
})

test("j clamps at the last card and k clamps at the first", async () => {
  const { app, focusedCardID } = await renderBoard()
  try {
    app.mockInput.pressKey("j")
    await app.renderOnce()
    app.mockInput.pressKey("j")
    await app.renderOnce()
    expect(focusedCardID()).toBe("card-2")
    app.mockInput.pressKey("k")
    await app.renderOnce()
    app.mockInput.pressKey("k")
    await app.renderOnce()
    expect(focusedCardID()).toBe("card-1")
  } finally {
    app.renderer.destroy()
  }
})

test("h stays on the first column and l moves with clamp", async () => {
  const { app, focusedCardID } = await renderBoard()
  try {
    app.mockInput.pressKey("h")
    await app.renderOnce()
    expect(focusedCardID()).toBe("card-1")
    app.mockInput.pressKey("l")
    await app.renderOnce()
    expect(focusedCardID()).toBe("card-3")
    app.mockInput.pressKey("l")
    await app.renderOnce()
    expect(focusedCardID()).toBe("card-3")
  } finally {
    app.renderer.destroy()
  }
})

test("enter opens the focused card detail and esc returns to the board", async () => {
  const { app, focusedCardID } = await renderBoard()
  try {
    app.mockInput.pressKey("j")
    await app.renderOnce()
    expect(focusedCardID()).toBe("card-2")
    app.mockInput.pressEnter()
    await app.renderOnce()
    const detail = app.captureCharFrame()
    expect(detail).toContain("Segundo")
    expect(detail).toContain("detalhe")
    app.mockInput.pressEscape()
    await app.renderOnce()
    const board = app.captureCharFrame()
    expect(board).toContain("backlog")
    expect(focusedCardID()).toBe("card-2")
  } finally {
    app.renderer.destroy()
  }
})

test("r triggers exactly one refresh of two reads", async () => {
  const { app, calls } = await renderBoard()
  try {
    const before = calls.length
    app.mockInput.pressKey("r")
    await app.renderOnce()
    await settle()
    await app.renderOnce()
    expect(calls.length - before).toBe(2)
    expect(calls.slice(-2)).toEqual(["panel", "liveness"])
  } finally {
    app.renderer.destroy()
  }
})

test("help lists the keys and says read-only", async () => {
  const { app } = await renderBoard()
  try {
    app.mockInput.pressKey("?")
    await app.renderOnce()
    const help = app.captureCharFrame()
    expect(help).toContain("somente leitura")
    expect(help).toContain("j/k")
    expect(help).toContain("squad dispatch accept")
    expect(help).toContain("squad send")
    app.mockInput.pressEscape()
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("backlog")
  } finally {
    app.renderer.destroy()
  }
})

test("read-only invariant: no key performs a write on the full squad client", async () => {
  const writes: string[] = []
  const reads: string[] = []
  const guard = (name: string, write: boolean) => () => {
    if (write) {
      writes.push(name)
      throw new Error(`escrita proibida: ${name}`)
    }
    reads.push(name)
    return Promise.resolve(undefined)
  }
  const squad: Record<string, unknown> = {}
  for (const name of ["session.list", "check", "plan", "liveness", "audit", "dispatch.list", "panel"])
    squad[name] = guard(name, false)
  for (const name of [
    "generation.create",
    "generation.close",
    "session.send",
    "session.launch",
    "session.replace",
    "broadcast",
    "block",
    "checkpoint",
    "transition",
    "activate",
    "dispatch.create",
    "dispatch.accept",
    "release",
  ])
    squad[name] = guard(name, true)

  const base = renderContext()
  const context = { ...base, client: { experimental: { squad } } } as unknown as Plugin.Context
  const calls: string[] = []
  const port = readPort(calls)
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
  const app = await testRender(() => <Harness />, { width: 120, height: 40, kittyKeyboard: true })
  try {
    await handle.board!.refresh()
    await settle()
    await app.renderOnce()
    for (const key of ["j", "k", "h", "l", "r", "?"]) {
      app.mockInput.pressKey(key)
      await app.renderOnce()
    }
    app.mockInput.pressEnter()
    await app.renderOnce()
    app.mockInput.pressEscape()
    await app.renderOnce()
    expect(writes).toEqual([])
    expect(reads).toEqual([])
    expect(new Set(calls)).toEqual(new Set(["panel", "liveness"]))
  } finally {
    app.renderer.destroy()
  }
})
