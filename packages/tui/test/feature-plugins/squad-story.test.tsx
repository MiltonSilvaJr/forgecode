/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { Plugin } from "@opencode/plugin/tui"
import { Keymap } from "../../src/context/keymap"
import { resolve } from "../../src/config"
import { squadBoardStory } from "../../src/feature-plugins/system/storybook/squad-board"
import { contextFixture } from "./squad-fixtures"

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function renderContext(): Plugin.Context {
  const base = contextFixture()
  return {
    ...base,
    keymap: { layer: (factory: Parameters<typeof Keymap.createLayer>[0]) => Keymap.createLayer(factory) },
  } as unknown as Plugin.Context
}

async function renderStory() {
  const context = renderContext()
  const app = await testRender(
    () => (
      <Keymap.Provider config={resolve({}, { terminalSuspend: true })}>{squadBoardStory.render(context)}</Keymap.Provider>
    ),
    { width: 120, height: 40, kittyKeyboard: true },
  )
  await settle()
  await app.renderOnce()
  return { app, context }
}

test("squad board story advertises read-only in its footer", async () => {
  const { app } = await renderStory()
  try {
    expect(app.captureCharFrame()).toContain("somente leitura")
  } finally {
    app.renderer.destroy()
  }
})

test("squad board story renders the normal scenario with cards from all columns", async () => {
  const { app } = await renderStory()
  try {
    const frame = app.captureCharFrame()
    expect(frame).toContain("backlog")
    expect(frame).toContain("Ajustar")
  } finally {
    app.renderer.destroy()
  }
})

test("squad board story switches to the empty scenario", async () => {
  const { app } = await renderStory()
  try {
    app.mockInput.pressKey("2")
    await settle()
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("nenhum card na geração ativa")
  } finally {
    app.renderer.destroy()
  }
})

test("squad board story switches to the no-active-generation scenario", async () => {
  const { app } = await renderStory()
  try {
    app.mockInput.pressKey("3")
    await settle()
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("nenhuma geração ativa")
  } finally {
    app.renderer.destroy()
  }
})

test("squad board story switches to the stale scenario and keeps prior cards visible", async () => {
  const { app } = await renderStory()
  try {
    app.mockInput.pressKey("4")
    await settle()
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("desatualizado")
    expect(frame).toContain("Ajustar")
  } finally {
    app.renderer.destroy()
  }
})

test("squad board story switches to the forbidden (403) scenario", async () => {
  const { app } = await renderStory()
  try {
    app.mockInput.pressKey("5")
    await settle()
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("desabilitado")
  } finally {
    app.renderer.destroy()
  }
})

test("squad board story switches to the unavailable (404) scenario", async () => {
  const { app } = await renderStory()
  try {
    app.mockInput.pressKey("6")
    await settle()
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("indisponível")
  } finally {
    app.renderer.destroy()
  }
})

test("squad board story switches to the previous-generation scenario", async () => {
  const { app } = await renderStory()
  try {
    app.mockInput.pressKey("7")
    await settle()
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("geração anterior")
  } finally {
    app.renderer.destroy()
  }
})

test("squad board story switches to the 200-cards scenario without crashing", async () => {
  const { app } = await renderStory()
  try {
    app.mockInput.pressKey("8")
    await settle()
    await app.renderOnce()
    const frame = app.captureCharFrame()
    expect(frame).toContain("200 cards")
    expect(frame).toContain("Card 0")
  } finally {
    app.renderer.destroy()
  }
})

test("squad board story never imports a network or write primitive", async () => {
  const source = await Bun.file(
    new URL("../../src/feature-plugins/system/storybook/squad-board.tsx", import.meta.url),
  ).text()
  expect(/\bfetch\(/.test(source)).toBe(false)
  expect(/Bun\.write|writeFile|context\.storage/.test(source)).toBe(false)
})
