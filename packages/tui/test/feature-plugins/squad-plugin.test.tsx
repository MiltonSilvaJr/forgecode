/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { Plugin } from "@opencode/plugin/tui"
import type { KeymapLayer } from "@opencode/plugin/tui/context"
import SquadBoard from "../../src/feature-plugins/squad"
import { builtins } from "../../src/plugin/builtins"
import { ConfigProvider, resolve } from "../../src/config"
import { contextFixture } from "./squad-fixtures"

function setupContext() {
  const routes: string[] = []
  const layers: Array<() => KeymapLayer> = []
  const slots: Array<{ append: string; render(): unknown }> = []
  const context = {
    app: { version: "2.2.5-test", channel: "test" },
    theme: contextFixture().theme,
    client: {
      experimental: {
        squad: {
          panel: async () => ({}),
          liveness: async () => ({}),
        },
      },
    },
    ui: {
      router: {
        register(page: { name: string }) {
          routes.push(page.name)
        },
        current() {
          return { type: "home" }
        },
        navigate() {},
      },
      slot(claim: { append: string; render(): unknown }) {
        slots.push(claim)
      },
      dialog: { clear() {} },
    },
    keymap: {
      layer(factory: () => KeymapLayer) {
        layers.push(factory)
      },
    },
  }
  return { context: context as unknown as Plugin.Context, routes, layers, slots }
}

test("registers the squad-board route and ships as a builtin", () => {
  const { context, routes } = setupContext()
  void SquadBoard.setup(context)
  expect(builtins.includes(SquadBoard) && routes.includes("squad-board")).toBe(true)
})

async function globalLayer(experimental: Record<string, boolean>) {
  const { context, layers, slots } = setupContext()
  void SquadBoard.setup(context)
  expect(layers.length).toBe(0)
  function Probe() {
    for (const slot of slots) slot.render()
    return null
  }
  const app = await testRender(
    () => (
      <ConfigProvider config={resolve({ experimental }, { terminalSuspend: true })}>
        <Probe />
      </ConfigProvider>
    ),
    { width: 40, height: 5 },
  )
  try {
    await app.renderOnce()
    expect(layers.length).toBe(1)
    return layers[0]()
  } finally {
    app.renderer.destroy()
  }
}

test("the palette/slash command is gated by config.experimental.squad_board", async () => {
  const enabled = await globalLayer({ squad_board: true })
  expect(enabled.mode).toBe("global")
  expect(enabled.commands.map((command) => ("id" in command ? command.id : ""))).toContain("squad.board.open")
  const command = enabled.commands.find((item) => "id" in item && item.id === "squad.board.open")
  expect(command && "slash" in command ? command.slash : undefined).toEqual({ name: "squad-board" })
  expect(command && "palette" in command ? command.palette : undefined).toBe(true)

  const disabled = await globalLayer({})
  expect(disabled.commands.length).toBe(0)
})

test("no global layer command declares a bind", async () => {
  const layer = await globalLayer({ squad_board: true })
  expect(layer.commands.every((command) => !("bind" in command) || command.bind === undefined)).toBe(true)
})
