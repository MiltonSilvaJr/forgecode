/** @jsxImportSource @opentui/solid */
import { For, Show, createMemo, createSignal } from "solid-js"
import type { SquadPanelCard } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import { boardModel, stalled } from "./board-model"
import { freshnessLabel } from "./render-fields"
import type { SquadBoardHandle } from "./use-squad-board"

function BoardCard(props: { card: SquadPanelCard; selected: boolean; theme: Plugin.Context["theme"] }) {
  return (
    <box
      id={`squad-card-${props.card.id}`}
      flexDirection="column"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={props.selected ? props.theme.background.formfield.focused : props.theme.background.raised.base}
    >
      <text fg={props.theme.text.base} wrapMode="none">
        {props.card.titulo}
      </text>
      <text fg={props.theme.text.muted} wrapMode="none">
        {props.card.agente}
        {props.card.prioridade ? ` · ${props.card.prioridade}` : ""}
      </text>
      <Show when={stalled(props.card)}>
        <text fg={props.theme.text.muted} wrapMode="none">
          sem progresso · desconhecido: {props.card.desconhecido.join(", ")}
        </text>
      </Show>
    </box>
  )
}

export function Board(props: { context: Plugin.Context; board: SquadBoardHandle; now: () => number }) {
  const theme = props.context.theme
  const state = props.board.state
  const [columnIndex, setColumnIndex] = createSignal(0)
  const [rowIndex, setRowIndex] = createSignal(0)

  const ready = createMemo(() => {
    const current = state()
    return current.type === "ready" ? current : null
  })
  const model = createMemo(() => (ready()?.panel ? boardModel(ready()!.panel!) : null))
  const noGeneration = createMemo(() => {
    const current = ready()
    return (
      current !== null &&
      current.liveness?.generation === null &&
      current.panel !== null &&
      Object.keys(current.panel.cards).length === 0
    )
  })

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.background.base}>
      <Show when={state().type === "loading"}>
        <box flexGrow={1} paddingLeft={1}>
          <text fg={theme.text.muted}>carregando painel do squad…</text>
        </box>
      </Show>
      <Show when={state().type === "disabled"}>
        <box flexGrow={1} paddingLeft={1}>
          <text fg={theme.text.feedback.error.base}>{(state() as { message: string }).message}</text>
        </box>
      </Show>
      <Show when={state().type === "unavailable"}>
        <box flexGrow={1} paddingLeft={1}>
          <text fg={theme.text.feedback.error.base}>
            squad indisponível nesta versão do servidor (cliente {(state() as { clientVersion: string }).clientVersion})
          </text>
        </box>
      </Show>
      <Show when={state().type === "failed"}>
        <box flexGrow={1} paddingLeft={1} flexDirection="column">
          <text fg={theme.text.feedback.error.base}>{(state() as { message: string }).message}</text>
          <Show when={(state() as { retry: boolean }).retry}>
            <text fg={theme.text.muted}>pressione r para tentar novamente</text>
          </Show>
        </box>
      </Show>
      <Show when={noGeneration()}>
        <box flexGrow={1} paddingLeft={1}>
          <text fg={theme.text.muted}>nenhuma geração ativa</text>
        </box>
      </Show>
      <Show when={model() !== null && !model()!.empty && !noGeneration()}>
        <box flexGrow={1} flexDirection="row" overflow="hidden">
          <For each={model()!.columns}>
            {(column) => (
              <box flexGrow={1} flexShrink={1} flexDirection="column" overflow="hidden">
                <text fg={theme.text.base} wrapMode="none">
                  {column.id} · {column.cards.length}
                </text>
                <For each={column.cards}>
                  {(card, index) => (
                    <BoardCard
                      card={card}
                      selected={model()!.columns.indexOf(column) === columnIndex() && index() === rowIndex()}
                      theme={theme}
                    />
                  )}
                </For>
              </box>
            )}
          </For>
        </box>
      </Show>
      <Show when={model() !== null && model()!.empty && !noGeneration()}>
        <box flexGrow={1} paddingLeft={1}>
          <text fg={theme.text.muted}>nenhum card na geração ativa</text>
        </box>
      </Show>
      <Show when={ready() !== null}>
        <box flexShrink={0} flexDirection="column" paddingLeft={1}>
          <Show when={ready()!.staleSince !== null}>
            <text fg={theme.text.feedback.warning.base}>desatualizado — dados preservados após falha</text>
          </Show>
          <Show when={ready()!.panelError !== null}>
            <text fg={theme.text.feedback.error.base}>painel: {ready()!.panelError}</text>
          </Show>
          <Show when={ready()!.livenessError !== null}>
            <text fg={theme.text.feedback.error.base}>sessões: {ready()!.livenessError}</text>
          </Show>
          <Show when={ready()!.panel !== null}>
            <text fg={theme.text.muted} wrapMode="none">
              {freshnessLabel(ready()!.panel!, props.now())}
            </text>
          </Show>
        </box>
      </Show>
      {/* Keymap layer installed with board-keys (TASK-06). */}
    </box>
  )
}
