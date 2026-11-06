/** @jsxImportSource @opentui/solid */
import { For, Show } from "solid-js"
import type { SquadLivenessReport, SquadPanelCard } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import { renderSessionLine } from "./render-fields"

const STAGE_ORDER = ["jira", "ci", "merge", "deploy", "acceptance"] as const

export function CardDetail(props: {
  card: SquadPanelCard
  liveness: SquadLivenessReport | null
  theme: Plugin.Context["theme"]
}) {
  const theme = props.theme
  return (
    <box flexGrow={1} flexDirection="column" paddingLeft={1}>
      <text fg={theme.text.base}>{props.card.titulo}</text>
    </box>
  )
}
