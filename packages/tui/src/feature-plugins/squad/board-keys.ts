import type { KeymapLayer } from "@opencode/plugin/tui/context"

export type BoardKeyHandlers = {
  down(): void
  up(): void
  left(): void
  right(): void
  open(): void
  close(): void
  refresh(): void
  help(): void
}

export function boardKeys(_handlers: BoardKeyHandlers): KeymapLayer {
  return { commands: [] }
}
