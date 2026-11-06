import { expect, test } from "bun:test"
import { boardModel, stalled } from "../../src/feature-plugins/squad/board-model"
import { panelCard, panelDocument } from "./squad-fixtures"

test("groups cards by column preserving document order", () => {
  const document = panelDocument({
    cards: {
      "card-1": panelCard({ id: "card-1", titulo: "Primeiro", coluna: "backlog", prioridade: "P3" }),
      "card-2": panelCard({ id: "card-2", titulo: "Segundo", coluna: "in_review" }),
      "card-3": panelCard({ id: "card-3", titulo: "Terceiro", coluna: "backlog", prioridade: "P1" }),
    },
  })
  const model = boardModel(document)
  expect(model.columns.map((column) => column.id).join(",")).toBe("backlog,in_progress,in_review,blocked,done")
  expect(model.columns.find((column) => column.id === "backlog")!.cards.map((card) => card.id)).toEqual([
    "card-1",
    "card-3",
  ])
  expect(model.columns.find((column) => column.id === "in_review")!.cards.map((card) => card.id)).toEqual(["card-2"])
  expect(model.columns.find((column) => column.id === "done")!.cards).toEqual([])
  expect(model.empty).toBe(false)
})

test("keeps record insertion order with no local sorting", () => {
  const document = panelDocument({
    cards: {
      "card-b": panelCard({ id: "card-b", prioridade: "P1" }),
      "card-a": panelCard({ id: "card-a", prioridade: "P3" }),
    },
  })
  const model = boardModel(document)
  expect(model.columns[0].cards.map((card) => card.id)).toEqual(["card-b", "card-a"])
})

test("empty cards record yields empty state without invented columns or cards", () => {
  const model = boardModel(panelDocument({ cards: {} }))
  expect(model.empty).toBe(true)
  expect(model.columns.map((column) => column.id).join(",")).toBe("backlog,in_progress,in_review,blocked,done")
  expect(model.columns.every((column) => column.cards.length === 0)).toBe(true)
})

test("stall seal requires progressa false and non-empty desconhecido", () => {
  expect(stalled(panelCard({ progressa: false, desconhecido: ["deploy"] }))).toBe(true)
  expect(stalled(panelCard({ progressa: false, desconhecido: [] }))).toBe(false)
  expect(stalled(panelCard({ progressa: true, desconhecido: ["deploy"] }))).toBe(false)
})
