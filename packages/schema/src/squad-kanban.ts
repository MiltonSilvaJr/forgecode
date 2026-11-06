export * as SquadKanban from "./squad-kanban.js"

import type { Squad } from "./squad.js"

type Document = typeof Squad.PanelDocument.Encoded

const stageNames = ["jira", "ci", "merge", "deploy", "acceptance"] as const

const iso = (millis: number | undefined) => (millis === undefined ? null : new Date(millis).toISOString())

/** The panel document in the shape `priorizacao/build_kanban.py` reads: snake_case keys and ISO instants. */
export const fromPanel = (document: Document) => ({
  versao_schema: document.versaoSchema,
  revisao: document.revisao,
  atualizado_em: iso(document.atualizadoEm),
  colunas: document.colunas,
  cards: Object.fromEntries(
    Object.entries(document.cards).map(([id, entry]) => [
      id,
      {
        id: entry.id,
        titulo: entry.titulo,
        coluna: entry.coluna,
        agente: entry.agente,
        prioridade: entry.prioridade ?? null,
        prs: [] as string[],
        refs: entry.refs,
        evidencias: entry.evidencias,
        bloqueio: entry.bloqueio ?? null,
        atualizado_em: iso(entry.atualizadoEm),
        estagios: Object.fromEntries(
          stageNames.map((name) => {
            const stage = entry.estagios[name]
            const evidence = stage.evidence
            return [
              name,
              {
                status: stage.status,
                evidence: evidence ? { type: evidence.type, reference: evidence.reference, at: iso(evidence.at) } : null,
                source: stage.source,
              },
            ]
          }),
        ),
        exigidos: entry.exigidos,
        desconhecido: entry.desconhecido,
        progressa: entry.progressa,
      },
    ]),
  ),
  fonte: document.fonte,
})

export type Kanban = ReturnType<typeof fromPanel>
