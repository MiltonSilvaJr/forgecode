/** @jsxImportSource @opentui/solid */
import { For, Show, createMemo, createSignal } from "solid-js"
import type { SquadPanelCard } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import { boardKeys } from "./board-keys"
import { boardModel, stalled, type BoardColumn } from "./board-model"
import { CardDetail } from "./card-detail"
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
  const [view, setView] = createSignal<"board" | "detail" | "help">("board")

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

  const columns = createMemo(() => model()?.columns ?? [])
  const currentColumn = createMemo<BoardColumn | undefined>(() => columns()[columnIndex()])
  const focusedCard = createMemo<SquadPanelCard | undefined>(
    () => currentColumn()?.cards[Math.min(rowIndex(), Math.max(0, (currentColumn()?.cards.length ?? 1) - 1))],
  )

  const clampRow = (column: BoardColumn | undefined, row: number) =>
    Math.max(0, Math.min(row, Math.max(0, (column?.cards.length ?? 1) - 1)))
  // h/l land on the next column that holds cards; an all-empty board keeps the current column.
  const stepColumn = (from: number, direction: 1 | -1): number => {
    const all = columns()
    for (let index = from + direction; index >= 0 && index < all.length; index += direction) {
      if (all[index].cards.length > 0) return index
    }
    return from
  }
  const moveDown = () => {
    if (view() !== "board") return
    setRowIndex(clampRow(currentColumn(), rowIndex() + 1))
  }
  const moveUp = () => {
    if (view() !== "board") return
    setRowIndex(clampRow(currentColumn(), rowIndex() - 1))
  }
  const moveLeft = () => {
    if (view() !== "board") return
    const next = stepColumn(columnIndex(), -1)
    setColumnIndex(next)
    setRowIndex(clampRow(columns()[next], rowIndex()))
  }
  const moveRight = () => {
    if (view() !== "board") return
    const next = stepColumn(columnIndex(), 1)
    setColumnIndex(next)
    setRowIndex(clampRow(columns()[next], rowIndex()))
  }
  const openDetail = () => {
    if (view() === "board" && focusedCard()) setView("detail")
  }
  const closeView = () => {
    if (view() !== "board") setView("board")
  }
  const refreshNow = () => {
    if (view() !== "help") void props.board.refresh()
  }
  const toggleHelp = () => setView(view() === "help" ? "board" : "help")

  props.context.keymap.layer(() =>
    boardKeys({ down: moveDown, up: moveUp, left: moveLeft, right: moveRight, open: openDetail, close: closeView, refresh: refreshNow, help: toggleHelp }),
  )

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.background.base}>
      <Show when={view() === "help"}>
        <box flexGrow={1} flexDirection="column" paddingLeft={1}>
          <text fg={theme.text.base}>squad board — somente leitura</text>
          <text fg={theme.text.muted}>j/k movem o foco · h/l trocam de coluna · enter abre o detalhe · esc volta · r atualiza</text>
          <text fg={theme.text.muted}>para escrever use squad dispatch accept e squad send</text>
        </box>
      </Show>
      <Show when={view() === "detail"}>
        <box flexGrow={1} flexDirection="column">
          <Show when={focusedCard() !== undefined}>
            <CardDetail card={focusedCard()!} liveness={ready()?.liveness ?? null} theme={theme} />
          </Show>
          <text fg={theme.text.muted} paddingLeft={1}>esc para voltar ao board</text>
        </box>
      </Show>
      <Show when={view() === "board"}>
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
      </Show>
    </box>
  )
}
