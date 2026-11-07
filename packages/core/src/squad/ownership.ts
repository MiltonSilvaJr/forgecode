export * as SquadOwnership from "./ownership.js"

import { createHash, randomUUID } from "node:crypto"
import { realpath } from "node:fs/promises"
import path from "node:path"
import { Context, Effect, Layer } from "effect"
import { and, eq, isNull } from "drizzle-orm"
import { Config } from "../config.js"
import { Database } from "../database/database.js"
import { Git } from "../git.js"
import { AbsolutePath } from "../schema.js"
import { SquadAudit } from "./audit.js"
import { requireEnabled } from "./guard.js"
import { InvalidInputError } from "./invalid.js"
import { ConflictError } from "./registry.js"
import { SquadCheckpointTable, SquadSessionTable, SquadTreeOwnerTable } from "./sql.js"
import { SquadStore } from "./store.js"

export interface CheckpointRef {
  readonly sha256: string
  readonly intact: boolean
}

/**
 * The checkpoint a release depends on. The default reads the persisted checkpoint the session row points at and
 * recomputes its hash; a richer checkpoint service can replace it without touching `release`.
 */
export interface CheckpointPortInterface {
  readonly latest: (generationID: string, name: string) => Effect.Effect<CheckpointRef | undefined, never, Database.Service>
}

export class CheckpointPort extends Context.Service<CheckpointPort, CheckpointPortInterface>()("@opencode/Squad/CheckpointPort") {}

export const checkpointLayer = Layer.succeed(
  CheckpointPort,
  CheckpointPort.of({
    latest: (generationID, name) =>
      Effect.gen(function* () {
        const db = (yield* Database.Service).db
        const session = yield* db
          .select()
          .from(SquadSessionTable)
          .where(and(eq(SquadSessionTable.generation_id, generationID), eq(SquadSessionTable.name, name)))
          .get()
          .pipe(Effect.orDie)
        if (!session?.checkpoint_sha256) return undefined
        const row = yield* db
          .select()
          .from(SquadCheckpointTable)
          .where(
            and(
              eq(SquadCheckpointTable.generation_id, generationID),
              eq(SquadCheckpointTable.name, name),
              eq(SquadCheckpointTable.sha256, session.checkpoint_sha256),
            ),
          )
          .get()
          .pipe(Effect.orDie)
        if (!row) return undefined
        return { sha256: row.sha256, intact: createHash("sha256").update(row.body).digest("hex") === row.sha256 }
      }),
  }),
)

export interface TreeKey {
  readonly key: string
  readonly scope: "worktree" | "repository"
}

/** The tree a Location belongs to: its Git worktree, or its repository when `squad.writer_scope` says so. */
export const treeKey = Effect.fn("SquadOwnership.treeKey")(function* (directory: string) {
  const config = yield* Config.Service
  const git = yield* Git.Service
  const scope = Config.latest(yield* config.entries(), "squad")?.writer_scope ?? "worktree"
  const repository = yield* git.repo.discover(AbsolutePath.make(directory))
  if (repository) return { key: scope === "repository" ? repository.commonDirectory : repository.worktree, scope } as TreeKey
  const canonical = yield* Effect.tryPromise(() => realpath(directory)).pipe(Effect.orElseSucceed(() => path.resolve(directory)))
  return { key: canonical, scope: "worktree" } as TreeKey
})

export interface ReleaseInput {
  readonly from: string
  readonly to: string
  readonly reason?: string
  readonly actor?: string
}

export const release = Effect.fn("SquadOwnership.release")(function* (input: ReleaseInput) {
  yield* requireEnabled()
  const reason = input.reason?.trim() ?? ""
  if (input.from.trim() === "" || input.to.trim() === "" || reason === "")
    return yield* new InvalidInputError({
      message: "release requires --from, --to and --reason",
      missing: [
        ...(input.from.trim() === "" ? ["from"] : []),
        ...(input.to.trim() === "" ? ["to"] : []),
        ...(reason === "" ? ["reason"] : []),
      ],
    })
  const db = (yield* Database.Service).db
  const store = yield* SquadStore.Service
  const checkpoints = yield* CheckpointPort
  const audit = yield* SquadAudit.Service

  const generation = yield* store.activeGeneration(db)
  if (!generation) return yield* new ConflictError({ message: "no active generation; run squad init first", pendencies: [] })
  if (!(yield* store.sessionByName(db, generation.id, input.to)))
    return yield* new ConflictError({ message: `${input.to} is not a session of generation ${generation.id}`, pendencies: [] })
  const owned = yield* db
    .select()
    .from(SquadTreeOwnerTable)
    .where(and(eq(SquadTreeOwnerTable.owner_name, input.from), isNull(SquadTreeOwnerTable.released_at)))
    .all()
    .pipe(Effect.orDie)
  if (owned.length === 0) return yield* new ConflictError({ message: `${input.from} does not own any tree`, pendencies: [] })

  const found = yield* Effect.forEach(owned, (row) => checkpoints.latest(row.generation_id, input.from))
  const pendencies = found.flatMap((checkpoint) =>
    checkpoint === undefined
      ? [`${input.from}: checkpoint ausente`]
      : checkpoint.intact
        ? []
        : [`${input.from}: checkpoint ${checkpoint.sha256} não confere com o corpo persistido`],
  )
  if (pendencies.length > 0)
    return yield* new ConflictError({ message: `release blocked: ${pendencies.join("; ")}`, pendencies })
  const checkpointSha256 = found.flatMap((checkpoint) => (checkpoint ? [checkpoint.sha256] : [])).join(",")

  const now = Date.now()
  yield* db
    .transaction((tx) =>
      Effect.gen(function* () {
        for (const row of owned) {
          yield* tx.update(SquadTreeOwnerTable).set({ released_at: now }).where(eq(SquadTreeOwnerTable.id, row.id)).run()
          yield* tx
            .insert(SquadTreeOwnerTable)
            .values({
              id: randomUUID(),
              tree_key: row.tree_key,
              tree_scope: row.tree_scope,
              generation_id: generation.id,
              owner_name: input.to,
              acquired_via: "dispatch",
              since: now,
            })
            .run()
        }
      }),
    )
    .pipe(Effect.orDie)

  yield* audit.append({
    kind: "release",
    generation: generation.id,
    target: input.to,
    result: "released",
    actor: input.actor ?? "operator",
    detail: `from=${input.from} to=${input.to} reason=${reason} trees=${owned.length} checkpoint_sha256=${checkpointSha256}`,
  })
  return { released: input.from, to: input.to, trees: owned.length, checkpointSha256 }
})

export interface AcquireInput {
  readonly generationID: string
  readonly name: string
  readonly directory: string
  readonly via: "launch" | "dispatch"
}

/**
 * Ownership is global, not per generation: one active row per tree in the whole database. A different session,
 * or the same name in another generation, cannot take the tree until the current row is released.
 * Returns `acquired` when this call opened the row and `held` when the session already owned the tree.
 */
export const acquireIn = (tx: SquadStore.Transaction, tree: TreeKey, input: Omit<AcquireInput, "directory">) =>
  Effect.gen(function* () {
    const current = yield* tx
      .select()
      .from(SquadTreeOwnerTable)
      .where(and(eq(SquadTreeOwnerTable.tree_key, tree.key), isNull(SquadTreeOwnerTable.released_at)))
      .get()
      .pipe(Effect.orDie)
    if (current) {
      if (current.owner_name === input.name && current.generation_id === input.generationID) return "held" as const
      return yield* new ConflictError({
        message: `tree ${tree.key} is owned by ${current.owner_name} (generation ${current.generation_id}); release it before ${input.name} can take it`,
        pendencies: [],
      })
    }
    yield* tx
      .insert(SquadTreeOwnerTable)
      .values({
        id: randomUUID(),
        tree_key: tree.key,
        tree_scope: tree.scope,
        generation_id: input.generationID,
        owner_name: input.name,
        acquired_via: input.via,
        since: Date.now(),
      })
      .run()
      .pipe(Effect.orDie)
    return "acquired" as const
  })

/** Entry point `launch` calls on verification (`via: "launch"`); the first dispatch confirms with `via: "dispatch"`. */
export const acquireTree = Effect.fn("SquadOwnership.acquireTree")(function* (input: AcquireInput) {
  yield* requireEnabled()
  const db = (yield* Database.Service).db
  const tree = yield* treeKey(input.directory)
  const status = yield* db.transaction((tx) => acquireIn(tx, tree, input)).pipe(Effect.catchTag("SqlError", Effect.die))
  return { status, key: tree.key, scope: tree.scope }
})
