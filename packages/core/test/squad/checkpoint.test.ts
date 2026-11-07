import { describe, expect } from "bun:test"
import { createHash } from "node:crypto"
import path from "path"
import { Effect, Layer } from "effect"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { SquadAudit } from "@opencode/core/squad/audit"
import { InvalidCheckpointError, SquadCheckpoint } from "@opencode/core/squad/checkpoint"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadStore } from "@opencode/core/squad/store"
import { SquadCheckpointTable, SquadSessionTable } from "@opencode/core/squad/sql"
import { Document, Info } from "@opencode/schema/config"
import { ConfigSquad } from "@opencode/schema/config/squad"
import { Global } from "@opencode/util/global"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const config = (maxBytes?: number) => [
  new Document({
    type: "document",
    info: new Info({
      squad: new ConfigSquad.Info({
        enabled: true,
        ...(maxBytes === undefined ? {} : { checkpoint: { max_bytes: maxBytes } }),
      }),
    }),
  }),
]

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

const layer = (directory: string, maxBytes?: number) =>
  Layer.mergeAll(
    SquadRegistry.layer,
    SquadStore.layer,
    SquadAudit.layer,
    Database.layer({ path: path.join(directory, "opencode.db") }).pipe(Layer.provide(globalFor(directory))),
    Config.testLayer(config(maxBytes)),
  )

const it = testEffect(Layer.empty)

// Assembled at runtime so the fixture is not itself a PEM header in a versioned file.
const SENTINEL = [`${"-".repeat(5)}BEGIN PRIVATE KEY${"-".repeat(5)}`, "MIIsentinel", `${"-".repeat(5)}END PRIVATE KEY${"-".repeat(5)}`].join("\n")

const sections = (omit: string[] = [], extra = "") =>
  ["Resultado", "Fontes", "Comandos e provas", "Limites", "Próximos passos", "Posse da árvore"]
    .filter((title) => !omit.includes(title))
    .map((title) => `## ${title}\nconteúdo de ${title}`)
    .join("\n\n") + extra

const missingOf = (error: unknown) => (error instanceof InvalidCheckpointError ? error.missing : [])

const setup = Effect.gen(function* () {
  const registry = yield* SquadRegistry.Service
  yield* registry.init({
    generation: "gen-1",
    sessions: [
      {
        name: "ATLAS",
        role: "worker",
        provider: "deepseek",
        model: "deepseek-flash",
        location: { directory: "/squad/atlas" },
        sessionID: "ses_atlas",
      },
    ],
  })
})

describe("SquadCheckpoint", () => {
  it.live("a missing section is named in the refusal and nothing is stored", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          const error = yield* SquadCheckpoint.write({ name: "ATLAS", body: sections(["Posse da árvore"]) }).pipe(Effect.flip)
          expect(missingOf(error)).toEqual(["Posse da árvore"])
          const empty = yield* SquadCheckpoint.write({
            name: "ATLAS",
            body: sections(["Limites"], "\n\n## Limites\n\n"),
          }).pipe(Effect.flip)
          expect(missingOf(empty)).toEqual(["Limites"])
          expect(yield* SquadCheckpoint.latest({ generation: "gen-1", name: "ATLAS" })).toBeUndefined()
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("the hash is sha256 of the normalized body; CRLF and BOM do not change it", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          const body = sections()
          const expected = createHash("sha256").update(body, "utf8").digest("hex")
          const plain = yield* SquadCheckpoint.write({ name: "ATLAS", body })
          expect(plain.sha256).toBe(expected)
          const noisy = yield* SquadCheckpoint.write({ name: "ATLAS", body: "\uFEFF" + body.replace(/\n/gu, "\r\n") })
          expect(noisy.sha256).toBe(expected)
          expect(noisy.body).toBe(body)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("secret-like text is refused by default and accepted only with a reason, which is audited", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          const body = sections([], `\n\n${SENTINEL}`)
          const refused = yield* SquadCheckpoint.write({ name: "ATLAS", body }).pipe(Effect.flip)
          expect(refused._tag).toBe("InvalidCheckpointError")
          const noReason = yield* SquadCheckpoint.write({ name: "ATLAS", body, allowSecretLikeText: true }).pipe(Effect.flip)
          expect(noReason._tag).toBe("InvalidCheckpointError")
          const db = (yield* Database.Service).db
          expect(yield* db.select().from(SquadCheckpointTable).all()).toHaveLength(0)
          const audit = yield* SquadAudit.Service
          expect(JSON.stringify(yield* audit.list())).not.toContain("MIIsentinel")
          const accepted = yield* SquadCheckpoint.write({
            name: "ATLAS",
            body,
            allowSecretLikeText: true,
            reason: "fixture key",
          })
          expect(accepted.sha256).toHaveLength(64)
          const trail = (yield* audit.list()).filter((entry) => entry.kind === "checkpoint" && entry.result === "accepted_secret_like")
          expect(trail).toHaveLength(1)
          expect(trail[0]?.detail).toContain("fixture key")
          expect(JSON.stringify(yield* audit.list())).not.toContain("MIIsentinel")
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("the export carries the same hash as the stored checkpoint", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          const written = yield* SquadCheckpoint.write({ name: "ATLAS", body: sections() })
          const file = SquadCheckpoint.exportDocument(written)
          expect(createHash("sha256").update(file.content, "utf8").digest("hex")).toBe(written.sha256)
          expect(file.filename).toContain(written.sha256.slice(0, 12))
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("a new layer over the same database reads the same body and hash", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const written = yield* Effect.gen(function* () {
            yield* setup
            return yield* SquadCheckpoint.write({ name: "ATLAS", body: sections() })
          }).pipe(Effect.provide(layer(dir.path)))
          const reread = yield* SquadCheckpoint.latest({ generation: "gen-1", name: "ATLAS" }).pipe(
            Effect.provide(layer(dir.path)),
          )
          expect(reread?.body).toBe(written.body)
          expect(reread?.sha256).toBe(written.sha256)
        }),
      ),
    ),
  )

  it.live("history is kept and the session points at the most recent checkpoint", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          const first = yield* SquadCheckpoint.write({ name: "ATLAS", body: sections() })
          const second = yield* SquadCheckpoint.write({ name: "ATLAS", body: sections([], "\n\nmais") })
          expect(second.sha256).not.toBe(first.sha256)
          const history = yield* SquadCheckpoint.history({ generation: "gen-1", name: "ATLAS" })
          expect(history.map((entry) => entry.sha256)).toEqual([first.sha256, second.sha256])
          const db = (yield* Database.Service).db
          const row = yield* db.select().from(SquadSessionTable).get()
          expect(row?.checkpoint_sha256).toBe(second.sha256)
        }).pipe(Effect.provide(layer(dir.path))),
      ),
    ),
  )

  it.live("a body above squad.checkpoint.max_bytes is refused", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          yield* setup
          const error = yield* SquadCheckpoint.write({ name: "ATLAS", body: sections() }).pipe(Effect.flip)
          expect(error.message).toContain("max_bytes")
        }).pipe(Effect.provide(layer(dir.path, 50))),
      ),
    ),
  )
})
