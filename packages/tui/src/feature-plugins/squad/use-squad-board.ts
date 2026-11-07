import {
  ClientError,
  isConflictError,
  isForbiddenError,
  isServiceUnavailableError,
  type SquadLivenessReport,
  type SquadPanelDocument,
} from "@opencode/client"
import { createSignal, onCleanup, type Accessor } from "solid-js"

export type SquadReadPort = {
  panel(): Promise<SquadPanelDocument>
  liveness(): Promise<SquadLivenessReport>
}

export type SquadBoardState =
  | { readonly type: "loading" }
  | {
      readonly type: "ready"
      readonly panel: SquadPanelDocument | null
      readonly panelError: string | null
      readonly liveness: SquadLivenessReport | null
      readonly livenessError: string | null
      readonly staleSince: number | null
    }
  | { readonly type: "disabled"; readonly message: string }
  | { readonly type: "unavailable"; readonly clientVersion: string }
  | { readonly type: "failed"; readonly message: string; readonly retry: boolean }

export type SquadBoardOptions = {
  readonly clientVersion: string
  readonly now: () => number
}

export type SquadBoardHandle = {
  readonly state: Accessor<SquadBoardState>
  refresh(): Promise<void>
}

function disabledMessage(error: { message: string }): string {
  return `squad desabilitado — ligue squad.enabled e tente novamente (${error.message})`
}

function unexpectedStatus(error: ClientError): number | undefined {
  const cause = error.cause
  if (typeof cause === "object" && cause !== null && "status" in cause && typeof cause.status === "number")
    return cause.status
  return undefined
}

function terminalState(error: unknown, options: SquadBoardOptions): SquadBoardState | undefined {
  if (isForbiddenError(error)) return { type: "disabled", message: disabledMessage(error) }
  if (error instanceof ClientError && error.reason === "UnexpectedStatus" && unexpectedStatus(error) === 404)
    return { type: "unavailable", clientVersion: options.clientVersion }
  if (isConflictError(error)) return { type: "failed", message: error.message, retry: true }
  if (isServiceUnavailableError(error) || (error instanceof ClientError && error.reason === "Transport"))
    return { type: "failed", message: "servidor indisponível", retry: true }
  return undefined
}

function describeError(error: unknown): string {
  if (isForbiddenError(error)) return disabledMessage(error)
  if (isConflictError(error)) return error.message
  if (isServiceUnavailableError(error)) return "servidor indisponível"
  if (error instanceof ClientError && error.reason === "Transport") return "servidor indisponível"
  if (error instanceof Error) return error.message
  return String(error)
}

export function useSquadBoard(port: SquadReadPort, options: SquadBoardOptions): SquadBoardHandle {
  const [state, setState] = createSignal<SquadBoardState>({ type: "loading" })
  let disposed = false
  let inflight: Promise<void> | undefined

  const refresh = (): Promise<void> => {
    if (inflight) return inflight
    const run = (async () => {
      const [panel, liveness] = await Promise.allSettled([port.panel(), port.liveness()])
      if (disposed) return
      const current = state()
      const prior = current.type === "ready" ? current : undefined
      if (!prior && panel.status === "rejected") {
        const terminal = terminalState(panel.reason, options)
        if (terminal) {
          setState(terminal)
          return
        }
      }
      const failed = panel.status === "rejected" || liveness.status === "rejected"
      setState({
        type: "ready",
        panel: panel.status === "fulfilled" ? panel.value : (prior?.panel ?? null),
        panelError: panel.status === "rejected" ? describeError(panel.reason) : null,
        liveness: liveness.status === "fulfilled" ? liveness.value : (prior?.liveness ?? null),
        livenessError: liveness.status === "rejected" ? describeError(liveness.reason) : null,
        staleSince: failed ? options.now() : null,
      })
    })()
    inflight = run
    void run.finally(() => {
      if (inflight === run) inflight = undefined
    })
    return run
  }

  void refresh()
  onCleanup(() => {
    disposed = true
  })

  return { state, refresh }
}
