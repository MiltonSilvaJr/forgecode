export * as SquadPanel from "./panel.js"

import { DateTime, Effect } from "effect"
import { Squad } from "@opencode/schema/squad"
import { SquadDispatch } from "./dispatch.js"

const stages = ["jira", "ci", "merge", "deploy", "acceptance"] as const

const unknownStage = Squad.Stage.make({ status: "unknown", evidence: null, source: "none" })

export const build = Effect.fn("SquadPanel.build")(function* () {
  const dispatches = yield* SquadDispatch.list()
  const cards = Object.fromEntries(
    dispatches.map((dispatch) => [
      dispatch.orqID,
      Squad.PanelCard.make({
        id: dispatch.orqID,
        titulo: dispatch.scope,
        coluna: "backlog",
        agente: dispatch.owner,
        refs: [dispatch.head],
        evidencias: [],
        estagios: { jira: unknownStage, ci: unknownStage, merge: unknownStage, deploy: unknownStage, acceptance: unknownStage },
        exigidos: dispatch.exigidos,
        desconhecido: stages,
        progressa: true,
      }),
    ]),
  )
  return Squad.PanelDocument.make({
    versaoSchema: 1,
    revisao: "0",
    atualizadoEm: DateTime.makeUnsafe(Date.now()),
    colunas: ["backlog", "in_progress", "in_review", "blocked", "done"],
    cards,
    fonte: {},
  })
})

export const toKanban = (document: Squad.PanelDocument) => document
