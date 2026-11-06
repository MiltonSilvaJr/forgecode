import { describe, expect } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode/core/database/database"
import { SquadAudit } from "@opencode/core/squad/audit"
import { SquadAuditTable } from "@opencode/core/squad/sql"
import { Global } from "@opencode/util/global"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const globalFor = (directory: string) =>
  Global.layerWith({
    data: directory,
    cache: directory,
    config: directory,
    state: directory,
    tmp: directory,
    bin: directory,
    log: directory,
    repos: directory,
  })

const layer = (directory: string) =>
  Layer.mergeAll(
    SquadAudit.layer,
    Database.layer({ path: path.join(directory, "opencode.db") }).pipe(Layer.provide(globalFor(directory))),
  )

const it = testEffect(Layer.empty)

const append = (target: string, actor = "ORQ") =>
  Effect.gen(function* () {
    const audit = yield* SquadAudit.Service
    return yield* audit.append({ kind: "send", target, result: "accepted", actor })
  })

const seed = Effect.gen(function* () {
  yield* append("A")
  yield* append("B", "ATLAS")
  yield* append("C")
})

const rows = Effect.gen(function* () {
  const db = (yield* Database.Service).db
  return yield* db.select().from(SquadAuditTable).orderBy(SquadAuditTable.id).all()
})

describe("SquadAudit chain", () => {
  it.live("an untouched chain verifies and the digest is a stable sha256", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* seed
          const first = yield* SquadAudit.chain()
          const again = yield* SquadAudit.chain()
          expect(first.integrity).toBe("integrity_ok")
          expect(first.digest).toMatch(/^[0-9a-f]{64}$/u)
          expect(again.digest).toBe(first.digest)
          expect(first.entries.map((entry) => entry.target)).toEqual(["A", "B", "C"])
          yield* append("D")
          expect((yield* SquadAudit.chain()).digest).not.toBe(first.digest)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("each line records the actor and the hash of the previous line", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* seed
          const stored = yield* rows
          expect(stored.map((row) => row.actor)).toEqual(["ORQ", "ATLAS", "ORQ"])
          expect(stored[0]?.prev_hash).toMatch(/^0{64}$/u)
          expect(stored[1]?.prev_hash).toBe(SquadAudit.rowHash(stored[0]!))
          expect(stored[2]?.prev_hash).toBe(SquadAudit.rowHash(stored[1]!))
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("tampering with an intermediate line breaks the integrity and changes the export digest", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* seed
          const issued = yield* SquadAudit.chain()
          const db = (yield* Database.Service).db
          const middle = (yield* rows)[1]!
          yield* db.update(SquadAuditTable).set({ result: "rejected" }).where(eq(SquadAuditTable.id, middle.id)).run()
          const tampered = yield* SquadAudit.chain()
          expect(tampered.integrity).toBe("integrity_broken")
          expect(tampered.digest).not.toBe(issued.digest)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("tampering with the last line changes the digest a third party already holds", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* seed
          const issued = yield* SquadAudit.chain()
          const db = (yield* Database.Service).db
          const last = (yield* rows)[2]!
          yield* db.update(SquadAuditTable).set({ target: "FORGED" }).where(eq(SquadAuditTable.id, last.id)).run()
          expect((yield* SquadAudit.chain()).digest).not.toBe(issued.digest)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("a window starting after the first line still verifies", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const audit = yield* SquadAudit.Service
          yield* append("OLD")
          const boundary = Date.now() + 5
          yield* Effect.sleep("20 millis")
          yield* append("NEW1")
          yield* append("NEW2")
          const window = yield* SquadAudit.chain({ since: boundary })
          expect(window.entries.map((entry) => entry.target)).toEqual(["NEW1", "NEW2"])
          expect(window.integrity).toBe("integrity_ok")
          expect((yield* audit.list()).length).toBe(3)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )
})
