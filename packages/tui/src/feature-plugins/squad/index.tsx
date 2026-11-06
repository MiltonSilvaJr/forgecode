/** @jsxImportSource @opentui/solid */
import { createMemo } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import { useConfig } from "../../config"
import { Board } from "./board"
import { boardModel } from "./board-model"
import { Sessions } from "./sessions"
import { useSquadBoard, type SquadReadPort } from "./use-squad-board"

/** Reactive accessor for the "squad_board" opt-in experiment (DA-01). */
export function useSquadBoardExperiment() {
  const config = useConfig()
  return () => config.data.experimental?.["squad_board"] === true
}

function SquadBoardPage(props: { context: Plugin.Context }) {
  // DD-05: the read port exposes exactly the two reads; no other client method is referenced.
  const port: SquadReadPort = {
    panel: () => props.context.client.experimental.squad.panel(),
    liveness: () => props.context.client.experimental.squad.liveness(),
  }
  const board = useSquadBoard(port, { clientVersion: props.context.app.version, now: () => Date.now() })
  const liveness = createMemo(() => {
    const state = board.state()
    return state.type === "ready" ? state.liveness : null
  })
  const cards = createMemo(() => {
    const state = board.state()
    if (state.type !== "ready" || !state.panel) return []
    return boardModel(state.panel).columns.flatMap((column) => column.cards)
  })
  return (
    <box width="100%" height="100%" flexDirection="row">
      <box flexGrow={3}>
        <Board context={props.context} board={board} now={() => Date.now()} />
      </box>
      <box flexGrow={2} overflow="hidden">
        <Sessions liveness={liveness()} cards={cards()} theme={props.context.theme} />
      </box>
    </box>
  )
}

export default Plugin.define({
  id: "opencode.squad-board",
  setup(context) {
    context.ui.router.register({
      name: "squad-board",
      render: () => <SquadBoardPage context={context} />,
    })
    context.ui.slot({
      append: "app",
      render() {
        const enabled = useSquadBoardExperiment()
        context.keymap.layer(() => ({
          mode: "global",
          commands: enabled()
            ? [
                {
                  id: "squad.board.open",
                  title: "Squad board",
                  group: "Squad",
                  slash: { name: "squad-board" },
                  palette: true,
                  run() {
                    const current = context.ui.router.current()
                    if (current.type === "plugin" && current.name === "squad-board") return
                    context.ui.dialog.clear()
                    context.ui.router.navigate({ type: "plugin", name: "squad-board" })
                  },
                },
              ]
            : [],
        }))
        return null
      },
    })
  },
})
