/** @jsxImportSource @opentui/solid */
import { For, Show } from "solid-js"
import type { SquadLivenessReport, SquadPanelCard } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import { formatInstant } from "./render-fields"
import { previousGeneration, sessionRows, type SessionRow } from "./session-model"

function rowLines(row: SessionRow): string[] {
  return [row.name]
}

export function Sessions(props: {
  liveness: SquadLivenessReport | null
  cards: SquadPanelCard[]
  theme: Plugin.Context["theme"]
}) {
  const theme = props.theme
  const rows = () => (props.liveness ? sessionRows(props.liveness) : [])
  return (
    <box flexGrow={1} flexDirection="column" paddingLeft={1}>
      <For each={rows()}>{(row) => <text fg={theme.text.base}>{rowLines(row)[0]}</text>}</For>
    </box>
  )
}
