/** @jsxImportSource @opentui/solid */
import { For, Show } from "solid-js"
import type { SquadLivenessReport, SquadPanelCard } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import { formatInstant } from "./render-fields"
import { previousGeneration, sessionRows, type SessionRow } from "./session-model"

function rowLines(row: SessionRow): string[] {
  const head = `${row.name} · ${row.role} · ${row.state} · ${row.provider}/${row.model}${row.variant ? `/${row.variant}` : ""}`
  const liveness = `veredito: ${row.verdict} · medido em ${formatInstant(row.measuredAt)} · última atividade: ${
    row.lastActivity !== null ? formatInstant(row.lastActivity) : "—"
  } · origem: ${row.source ?? "—"}`
  const flags = [
    row.workingStale ? "workingStale" : null,
    row.presumedDead ? "presumedDead" : null,
    row.cause !== null ? `causa: ${row.cause}` : null,
    row.inboxPending > 0 ? `inbox: ${row.inboxPending}` : null,
  ].filter((part) => part !== null)
  return flags.length > 0 ? [head, liveness, flags.join(" · ")] : [head, liveness]
}

export function Sessions(props: {
  liveness: SquadLivenessReport | null
  cards: SquadPanelCard[]
  theme: Plugin.Context["theme"]
}) {
  const theme = props.theme
  const rows = () => (props.liveness ? sessionRows(props.liveness) : [])
  const previous = () => (props.liveness ? previousGeneration(props.liveness) : null)
  const unmatched = () =>
    props.cards.filter(
      (card) => card.agente.length > 0 && !rows().some((row) => row.name === card.agente),
    )
  return (
    <box flexGrow={1} flexDirection="column" paddingLeft={1}>
      <text fg={theme.text.base}>sessões da geração ativa</text>
      <For each={rows()}>
        {(row) => (
          <box flexDirection="column">
            <For each={rowLines(row)}>
              {(line, index) => (
                <text fg={index() === 0 ? theme.text.base : theme.text.muted} wrapMode="none">
                  {line}
                </text>
              )}
            </For>
          </box>
        )}
      </For>
      <Show when={unmatched().length > 0}>
        <box height={1} />
        <For each={unmatched()}>
          {(card) => (
            <text fg={theme.text.muted} wrapMode="none">
              {card.titulo} ({card.agente}): sessão não encontrada nesta geração
            </text>
          )}
        </For>
      </Show>
      <Show when={previous() !== null}>
        <box height={1} />
        <text fg={theme.text.base} wrapMode="none">
          geração anterior {previous()!.id} · fechada em{" "}
          {previous()!.closedAt !== null ? formatInstant(previous()!.closedAt) : "—"} · por {previous()!.closedBy ?? "—"}
        </text>
        <For each={previous()!.sessions}>
          {(session) => (
            <text fg={theme.text.muted} wrapMode="none">
              {session.name} · {session.sessionID ?? "—"} · {session.state}
            </text>
          )}
        </For>
      </Show>
    </box>
  )
}
