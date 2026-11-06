/** @jsxImportSource @opentui/solid */
import type { Plugin } from "@opencode/plugin/tui"
import type { SquadBoardHandle } from "./use-squad-board"

export function Board(props: { context: Plugin.Context; board: SquadBoardHandle; now: () => number }) {
  return <box width="100%" height="100%" />
}
