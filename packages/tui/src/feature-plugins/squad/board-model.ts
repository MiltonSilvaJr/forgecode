import type { SquadPanelCard, SquadPanelDocument } from "@opencode/client"

export type BoardColumn = {
  readonly id: string
  readonly cards: SquadPanelCard[]
}

export type BoardModel = {
  readonly columns: BoardColumn[]
  readonly empty: boolean
}

export function boardModel(_document: SquadPanelDocument): BoardModel {
  return { columns: [], empty: true }
}

export function stalled(_card: SquadPanelCard): boolean {
  return false
}
