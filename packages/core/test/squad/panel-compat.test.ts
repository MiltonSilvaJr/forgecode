import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { Git } from "@opencode/core/git"
import { SquadAudit } from "@opencode/core/squad/audit"
import { SquadChannel } from "@opencode/core/squad/channel"
import { SquadDispatch } from "@opencode/core/squad/dispatch"
import { SquadPanel } from "@opencode/core/squad/panel"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadStore } from "@opencode/core/squad/store"
import { Document, Info } from "@opencode/schema/config"
import { ConfigSquad } from "@opencode/schema/config/squad"
import { Global } from "@opencode/util/global"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

// The keys priorizacao/build_kanban.py reads from a kanban document and from each card.
const documentKeys = ["versao_schema", "revisao", "atualizado_em", "colunas", "cards", "fonte"]
const cardKeys = ["id", "titulo", "coluna", "agente", "prioridade", "prs", "refs", "evidencias", "bloqueio", "atualizado_em"]
const additiveKeys = ["estagios", "exigidos", "desconhecido", "progressa"]

const head = "b".repeat(40)

const layer = (directory: string) =>
  Layer.mergeAll(
    SquadRegistry.layer,
    SquadStore.layer,
    SquadAudit.layer,
    Layer.succeed(
      SquadChannel.Service,
      SquadChannel.Service.of({ enqueue: () => Effect.die("unexpected enqueue"), pending: () => Effect.succeed([]) }),
    ),
    Layer.succeed(
      Git.Service,
      {
        repo: {
          discover: () =>
            Effect.succeed(
              Git.Repository.make({
                worktree: "/squad/ATLAS" as never,
                gitDirectory: "/squad/ATLAS/.git" as never,
                commonDirectory: "/squad/ATLAS/.git" as never,
              }),
            ),
        },
        history: {
          resolve: (_repository: unknown, ref: string) => Effect.succeed(ref === "dev" ? "a".repeat(40) : head),
          isAncestor: () => Effect.succeed(false),
        },
      } as unknown as Git.Interface,
    ),
    Database.layer({ path: path.join(directory, "opencode.db") }).pipe(
      Layer.provide(
        Global.layerWith({ data: directory, cache: directory, config: directory, state: directory, tmp: directory, bin: directory, log: directory, repos: directory }),
      ),
    ),
    Config.testLayer([new Document({ type: "document", info: new Info({ squad: new ConfigSquad.Info({ enabled: true }) }) })]),
  )

const it = testEffect(Layer.empty)

describe("SquadPanel compatibility", () => {
  it.live("emits every key the existing consumer reads, with its types, and only adds keys", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const registry = yield* SquadRegistry.Service
          yield* registry.init({
            generation: "gen-1",
            sessions: [{ name: "ATLAS", role: "worker", provider: "p", model: "m", location: { directory: "/squad/ATLAS" } }],
          })
          yield* SquadDispatch.create({
            scope: "billing", owner: "ATLAS", base: "dev", head: "feature/x", dor: "d", dod: "d", proof: "ci", exclusions: ["n"], milestone: "M1",
          })
          const kanban = JSON.parse(JSON.stringify(SquadPanel.toKanban(yield* SquadPanel.build())))
          for (const key of documentKeys) expect(kanban).toHaveProperty(key)
          expect(kanban.versao_schema).toBe(1)
          expect(Array.isArray(kanban.colunas)).toBe(true)
          expect(typeof kanban.fonte).toBe("object")
          expect(Number.isNaN(Date.parse(kanban.atualizado_em))).toBe(false)
          const cards = Object.values(kanban.cards) as Record<string, unknown>[]
          expect(cards.length).toBe(1)
          for (const card of cards) {
            for (const key of [...cardKeys, ...additiveKeys]) expect(card).toHaveProperty(key)
            expect(kanban.colunas).toContain(card.coluna)
            expect(Array.isArray(card.prs)).toBe(true)
            expect(Array.isArray(card.refs)).toBe(true)
            expect((card.evidencias as unknown[]).every((entry) => typeof entry === "string")).toBe(true)
            expect(card.bloqueio === null || typeof card.bloqueio === "string").toBe(true)
          }
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("building the panel writes nothing: dispatches, audit and sessions are unchanged", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const registry = yield* SquadRegistry.Service
          yield* registry.init({
            generation: "gen-1",
            sessions: [{ name: "ATLAS", role: "worker", provider: "p", model: "m", location: { directory: "/squad/ATLAS" } }],
          })
          yield* SquadDispatch.create({
            scope: "billing", owner: "ATLAS", base: "dev", head: "feature/x", dor: "d", dod: "d", proof: "ci", exclusions: ["n"], milestone: "M1",
          })
          const snapshot = Effect.gen(function* () {
            return JSON.stringify([
              yield* SquadDispatch.list(),
              yield* (yield* SquadAudit.Service).list(),
              (yield* registry.generation("gen-1"))?.sessions,
            ])
          })
          const before = yield* snapshot
          yield* SquadPanel.build()
          yield* SquadPanel.build()
          expect(yield* snapshot).toBe(before)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )
})
