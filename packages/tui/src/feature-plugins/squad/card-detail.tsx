/** @jsxImportSource @opentui/solid */
import { For, Show } from "solid-js"
import type { SquadLivenessReport, SquadPanelCard } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import { renderSessionLine, renderStageLine } from "./render-fields"

const STAGE_ORDER = ["jira", "ci", "merge", "deploy", "acceptance"] as const

export function CardDetail(props: {
  card: SquadPanelCard
  liveness: SquadLivenessReport | null
  theme: Plugin.Context["theme"]
}) {
  const theme = props.theme
  const session = () => props.liveness?.sessions.find((status) => status.name === props.card.agente)
  return (
    <box flexGrow={1} flexDirection="column" paddingLeft={1}>
      <text fg={theme.text.base}>{props.card.titulo}</text>
      <text fg={theme.text.muted}>
        {props.card.agente}
        {props.card.prioridade ? ` · ${props.card.prioridade}` : ""}
      </text>
      <Show when={props.card.refs.length > 0}>
        <text fg={theme.text.muted}>refs: {props.card.refs.join(", ")}</text>
      </Show>
      <Show when={props.card.evidencias.length > 0}>
        <text fg={theme.text.muted}>evidências: {props.card.evidencias.join(", ")}</text>
      </Show>
      <Show when={props.card.bloqueio !== undefined}>
        <text fg={theme.text.muted}>bloqueio: {props.card.bloqueio}</text>
      </Show>
      <box height={1} />
      <For each={STAGE_ORDER}>
        {(key) => (
          <text fg={theme.text.base} wrapMode="none">
            {renderStageLine(key, props.card.estagios[key], props.card.exigidos.includes(key))}
          </text>
        )}
      </For>
      <Show when={props.card.desconhecido.length > 0}>
        <text fg={theme.text.muted}>desconhecido: {props.card.desconhecido.join(", ")}</text>
      </Show>
      <box height={1} />
      <Show when={session() !== undefined} fallback={<text fg={theme.text.muted}>sessão não encontrada nesta geração</text>}>
        <text fg={theme.text.base} wrapMode="none">
          sessão: {renderSessionLine(session()!)}
        </text>
      </Show>
    </box>
  )
}
