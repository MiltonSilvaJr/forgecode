import { describe, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import { Effect } from "effect"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Git } from "@opencode/core/git"
import { AbsolutePath } from "@opencode/core/schema"
import { initRepo } from "./fixture/git"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(Git.node))

describe("Git.history.resolve", () => {
  it.live("resolves branches and tags and returns undefined for a missing ref", () =>
    Effect.gen(function* () {
      const root = yield* tmpdirScoped()
      yield* Effect.promise(async () => {
        await initRepo(root.path)
        await $`git branch -M main`.cwd(root.path).quiet()
        await $`git tag v1.0`.cwd(root.path).quiet()
      })
      const directory = AbsolutePath.make(yield* Effect.promise(() => fs.realpath(root.path)))
      const git = yield* Git.Service
      const repository = yield* git.repo.discover(directory)
      expect(repository).toBeDefined()
      if (!repository) return

      const branchSha = yield* git.history.resolve(repository, "main")
      expect(branchSha).toMatch(/^[0-9a-f]{7,40}$/)
      const tagSha = yield* git.history.resolve(repository, "v1.0")
      expect(tagSha).toMatch(/^[0-9a-f]{7,40}$/)
      expect(yield* git.history.resolve(repository, "does-not-exist")).toBe(undefined)
    }),
  )
})
