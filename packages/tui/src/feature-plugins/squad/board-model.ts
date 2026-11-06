import type { SquadPanelCard, SquadPanelDocument } from "@opencode/client"

export type BoardColumn = {
  readonly id: string
  readonly cards: SquadPanelCard[]
}

export type BoardModel = {
  readonly columns: BoardColumn[]
  readonly empty: boolean
}

export function boardModel(document: SquadPanelDocument): BoardModel {
  const columns = document.colunas.map((id) => ({ id, cards: [] as SquadPanelCard[] }))
  const byID = new Map(columns.map((column) => [column.id, column]))
  for (const card of Object.values(document.cards)) byID.get(card.coluna)!.cards.push(card)
  return { columns, empty: Object.keys(document.cards).length === 0 }
}

export function stalled(card: SquadPanelCard): boolean {
  return !card.progressa && card.desconhecido.length > 0
}
