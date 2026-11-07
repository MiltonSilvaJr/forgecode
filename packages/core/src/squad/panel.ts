export * as SquadPanel from "./panel.js"

import { createHash } from "node:crypto"
import { DateTime, Effect, Schema } from "effect"
import { Config } from "../config.js"
import { Database } from "../database/database.js"
import { Git } from "../git.js"
import { AbsolutePath } from "../schema.js"
import { ConfigSquad } from "@opencode/schema/config/squad"
import { Squad } from "@opencode/schema/squad"
import { SquadKanban } from "@opencode/schema/squad-kanban"
import { SquadDispatch } from "./dispatch.js"
import { requireEnabled } from "./guard.js"
import { PanelCi } from "./panel/ci.js"
import { PanelJira } from "./panel/jira.js"
import { SquadStore } from "./store.js"

const stageNames = ["jira", "ci", "merge", "deploy", "acceptance"] as const
const columns = ["backlog", "in_progress", "in_review", "blocked", "done"] as const

type StageName = (typeof stageNames)[number]
type Stages = Record<StageName, typeof Squad.Stage.Type>

const unknown = (source: string) => Squad.Stage.make({ status: "unknown", evidence: null, source })

/**
 * Builds the kanban document from the dispatches of the active generation. Read-only: it measures git
 * ancestry and reads the dispatch ledger, and writes nothing. A stage is `verified` or `failed` only with
 * evidence; everything else is `unknown`, never inferred.
 */
export const build = Effect.fn("SquadPanel.build")(function* () {
  yield* requireEnabled()
  const dispatches = yield* SquadDispatch.list()
  const config = yield* Config.Service
  const panel = Config.latest(yield* config.entries(), "squad")?.panel
  const cards = yield* Effect.forEach(dispatches, (dispatch) => card(dispatch, panel), { concurrency: 4 })
  const now = DateTime.makeUnsafe(Date.now())
  const byID = Object.fromEntries(cards.map((entry) => [entry.id, entry]))
  return Squad.PanelDocument.make({
    versaoSchema: 1,
    revisao: createHash("sha256").update(JSON.stringify(cards)).digest("hex").slice(0, 12),
    atualizadoEm: now,
    colunas: columns,
    cards: byID,
    fonte: {
      dispatch: "squad_dispatch ledger",
      merge: "git merge-base --is-ancestor",
      acceptance: "squad dispatch accept",
      jira: panel?.jira_command === undefined ? "not configured" : "squad.panel.jira_command",
      ci: panel?.ci_evidence !== undefined ? "squad.panel.ci_evidence" : panel?.ci_command !== undefined ? "squad.panel.ci_command" : "not configured",
    },
  })
})

const card = Effect.fn("SquadPanel.card")(function* (dispatch: Squad.Dispatch, panel: ConfigSquad.Info["panel"]) {
  const stages = {
    jira: yield* PanelJira.read({
      command: panel?.jira_command,
      orq: dispatch.orqID,
      head: dispatch.head,
      since: DateTime.toEpochMillis(dispatch.createdAt),
    }),
    ci: yield* PanelCi.read({
      command: panel?.ci_command,
      evidence: panel?.ci_evidence,
      name: dispatch.proof,
      headOid: dispatch.headOid,
    }),
    merge: yield* mergeStage(dispatch),
    deploy: unknown("none"),
    acceptance: acceptanceStage(dispatch),
  } satisfies Stages
  const missing = stageNames.filter((name) => stages[name].status === "unknown")
  const blockers = dispatch.exigidos.filter((name) => name !== "merge" && stages[name].status === "failed")
  const verified = stageNames.filter((name) => stages[name].status === "verified")
  const column = columnOf(dispatch, stages, blockers)
  const evidence = stageNames.flatMap((name) => {
    const stage = stages[name]
    return stage.evidence === null ? [] : [{ name, ...stage.evidence }]
  })
  return Squad.PanelCard.make({
    id: dispatch.orqID,
    titulo: dispatch.scope,
    coluna: column,
    agente: dispatch.owner,
    prioridade: dispatch.milestone,
    refs: [dispatch.head, ...(dispatch.headOid ? [dispatch.headOid] : [])],
    evidencias: evidence.map((entry) => `${entry.name}: ${entry.type} ${entry.reference}`),
    ...(blockers.length > 0 || dispatch.state === "blocked"
      ? { bloqueio: dispatch.state === "blocked" ? "dispatch blocked" : `failed: ${blockers.join(", ")}` }
      : {}),
    atualizadoEm: DateTime.makeUnsafe(
      Math.max(DateTime.toEpochMillis(dispatch.createdAt), ...evidence.flatMap((entry) => (entry.at ? [DateTime.toEpochMillis(entry.at)] : []))),
    ),
    estagios: stages,
    exigidos: dispatch.exigidos,
    // A required stage with no evidence is unknown by construction, so this also keeps `done` honest.
    desconhecido: missing,
    progressa: missing.length === 0 && verified.length > 0,
  })
})

/** `done` needs every required stage verified; a failed required stage other than merge blocks; pending merge is not a block. */
const columnOf = (dispatch: Squad.Dispatch, stages: Stages, blockers: readonly StageName[]): Squad.CardColumn => {
  if (dispatch.exigidos.every((name) => stages[name].status === "verified")) return "done"
  if (dispatch.state === "blocked" || blockers.length > 0) return "blocked"
  if (stages.merge.status === "verified") return "in_review"
  if (dispatch.state === "accepted") return "in_progress"
  return "backlog"
}

const mergeStage = Effect.fn("SquadPanel.mergeStage")(function* (dispatch: Squad.Dispatch) {
  const source = "git merge-base --is-ancestor"
  if (dispatch.headOid === undefined) return unknown(source)
  const db = (yield* Database.Service).db
  const store = yield* SquadStore.Service
  const git = yield* Git.Service
  const owner = yield* store.sessionByName(db, dispatch.generationID, dispatch.owner)
  if (!owner) return unknown(source)
  const repository = yield* git.repo.discover(AbsolutePath.make(owner.location.directory))
  if (!repository) return unknown(source)
  const merged = yield* git.history.isAncestor(repository, dispatch.headOid, dispatch.base)
  if (merged === undefined) return unknown(source)
  return Squad.Stage.make({
    status: merged ? "verified" : "failed",
    evidence: { type: "git", reference: `${dispatch.headOid.slice(0, 12)} ${merged ? "is" : "is not"} an ancestor of ${dispatch.base}`, at: DateTime.makeUnsafe(Date.now()) },
    source,
  })
})

const acceptanceStage = (dispatch: Squad.Dispatch) => {
  const source = "squad dispatch accept"
  if (dispatch.state !== "accepted" || dispatch.headOid === undefined) return unknown(source)
  return Squad.Stage.make({
    status: "verified",
    evidence: { type: "dispatch_accept", reference: `${dispatch.orqID} head=${dispatch.headOid.slice(0, 12)}`, ...(dispatch.acceptedAt ? { at: dispatch.acceptedAt } : {}) },
    source,
  })
}

/** The document in the shape `priorizacao/build_kanban.py` reads: snake_case keys, ISO instants. */
export const toKanban = (document: Squad.PanelDocument) => SquadKanban.fromPanel(Schema.encodeSync(Squad.PanelDocument)(document))
