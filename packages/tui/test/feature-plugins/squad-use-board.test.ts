import { expect, test } from "bun:test"
import { ClientError, type SquadLivenessReport, type SquadPanelDocument } from "@opencode/client"
import { createRoot } from "solid-js"
import { useSquadBoard, type SquadBoardState } from "../../src/feature-plugins/squad/use-squad-board"
import { T0, livenessReport, panelDocument } from "./squad-fixtures"

type Harness = {
  state(): SquadBoardState
  refresh(): Promise<void>
  calls: string[]
  dispose(): void
}

function harness(options: {
  panel?: () => Promise<SquadPanelDocument>
  liveness?: () => Promise<SquadLivenessReport>
  now?: () => number
}): Harness {
  const calls: string[] = []
  const port = {
    panel: () => {
      calls.push("panel")
      return options.panel ? options.panel() : Promise.resolve(panelDocument())
    },
    liveness: () => {
      calls.push("liveness")
      return options.liveness ? options.liveness() : Promise.resolve(livenessReport())
    },
  }
  const scope = createRoot((dispose) => ({ dispose, ...useSquadBoard(port, { clientVersion: "2.2.5-test", now: options.now ?? (() => T0) }) }))
  return { ...scope, calls }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

test("every refresh performs exactly two reads: panel and liveness", async () => {
  const board = harness({})
  try {
    expect(board.state().type).toBe("loading")
    await board.refresh()
    expect(board.calls.length).toBe(2)
    expect(board.calls).toContain("panel")
    expect(board.calls).toContain("liveness")
    const state = board.state()
    expect(state.type).toBe("ready")
    if (state.type === "ready") {
      expect(state.panel?.revisao).toBe("abc123def456")
      expect(state.liveness?.generation).toBe("ORQ-1")
      expect(state.staleSince).toBeNull()
    }
    await board.refresh()
    expect(board.calls.length).toBe(4)
  } finally {
    board.dispose()
  }
})

test("partial failure keeps the other document and reports the failed side", async () => {
  const panelFailure = new Error("boom")
  const board = harness({ panel: () => Promise.reject(panelFailure) })
  try {
    await board.refresh()
    const state = board.state()
    expect(state.type).toBe("ready")
    if (state.type === "ready") {
      expect(state.panel).toBeNull()
      expect(state.panelError).toBe("boom")
      expect(state.liveness?.generation).toBe("ORQ-1")
      expect(state.livenessError).toBeNull()
      expect(state.staleSince).not.toBeNull()
    }
  } finally {
    board.dispose()
  }
})

test("a failed refresh keeps the previous document and marks staleSince", async () => {
  let clock = T0
  let failPanel = false
  const board = harness({
    now: () => clock,
    panel: () => (failPanel ? Promise.reject(new Error("rede caiu")) : Promise.resolve(panelDocument())),
  })
  try {
    await board.refresh()
    expect(board.state().type).toBe("ready")
    failPanel = true
    clock = T0 + 90_000
    await board.refresh()
    const state = board.state()
    expect(state.type).toBe("ready")
    if (state.type === "ready") {
      expect(state.panel?.revisao).toBe("abc123def456")
      expect(state.panelError).toBe("rede caiu")
      expect(state.liveness?.generation).toBe("ORQ-1")
      expect(state.staleSince).toBe(T0 + 90_000)
    }
  } finally {
    board.dispose()
  }
})

test("maps terminal errors on first load", async () => {
  const forbidden = harness({ panel: () => Promise.reject({ _tag: "ForbiddenError", message: "squad off" }) })
  try {
    await forbidden.refresh()
    const state = forbidden.state()
    expect(state.type).toBe("disabled")
    if (state.type === "disabled") expect(state.message).toContain("squad.enabled")
  } finally {
    forbidden.dispose()
  }

  const missing = harness({
    panel: () => Promise.reject(new ClientError("UnexpectedStatus", { cause: { status: 404 } })),
  })
  try {
    await missing.refresh()
    const state = missing.state()
    expect(state.type).toBe("unavailable")
    if (state.type === "unavailable") expect(state.clientVersion).toBe("2.2.5-test")
  } finally {
    missing.dispose()
  }

  const conflict = harness({ panel: () => Promise.reject({ _tag: "ConflictError", message: "geração em transição" }) })
  try {
    await conflict.refresh()
    const state = conflict.state()
    expect(state.type).toBe("failed")
    if (state.type === "failed") {
      expect(state.message).toBe("geração em transição")
      expect(state.retry).toBe(true)
    }
  } finally {
    conflict.dispose()
  }

  const transport = harness({ panel: () => Promise.reject(new ClientError("Transport")) })
  try {
    await transport.refresh()
    const state = transport.state()
    expect(state.type).toBe("failed")
    if (state.type === "failed") {
      expect(state.message).toBe("servidor indisponível")
      expect(state.retry).toBe(true)
    }
  } finally {
    transport.dispose()
  }

  const unavailable = harness({
    panel: () => Promise.reject({ _tag: "ServiceUnavailableError", message: "manutenção" }),
  })
  try {
    await unavailable.refresh()
    const state = unavailable.state()
    expect(state.type).toBe("failed")
    if (state.type === "failed") expect(state.message).toBe("servidor indisponível")
  } finally {
    unavailable.dispose()
  }
})

test("refresh is single-flight: an in-flight refresh is not doubled", async () => {
  const first = deferred<SquadPanelDocument>()
  const board = harness({ panel: () => first.promise })
  try {
    expect(board.calls.length).toBe(2)
    const pending = board.refresh()
    expect(board.calls.length).toBe(2)
    first.resolve(panelDocument())
    await pending
    expect(board.state().type).toBe("ready")
    await board.refresh()
    expect(board.calls.length).toBe(4)
  } finally {
    board.dispose()
  }
})

test("dispose during in-flight refresh leaves no update behind", async () => {
  const first = deferred<SquadPanelDocument>()
  const board = harness({ panel: () => first.promise })
  expect(board.calls.length).toBe(2)
  board.dispose()
  first.resolve(panelDocument())
  await Promise.resolve()
  expect(board.state().type).toBe("loading")
})
