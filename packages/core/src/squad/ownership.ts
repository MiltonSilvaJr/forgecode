export * as SquadOwnership from "./ownership.js"

import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database.js"

export interface CheckpointRef {
  readonly sha256: string
  readonly intact: boolean
}

export interface CheckpointPortInterface {
  readonly latest: (generationID: string, name: string) => Effect.Effect<CheckpointRef | undefined, never, Database.Service>
}

export class CheckpointPort extends Context.Service<CheckpointPort, CheckpointPortInterface>()("@opencode/Squad/CheckpointPort") {}

export const checkpointLayer = Layer.succeed(CheckpointPort, CheckpointPort.of({ latest: () => Effect.succeed(undefined) }))

export interface TreeKey {
  readonly key: string
  readonly scope: "worktree" | "repository"
}

export const treeKey = Effect.fn("SquadOwnership.treeKey")(function* (directory: string) {
  return { key: directory, scope: "worktree" } as TreeKey
})

export interface ReleaseInput {
  readonly from: string
  readonly to: string
  readonly reason?: string
  readonly actor?: string
}

export const release = Effect.fn("SquadOwnership.release")(function* (input: ReleaseInput) {
  return { released: input.from, checkpointSha256: "" }
})
