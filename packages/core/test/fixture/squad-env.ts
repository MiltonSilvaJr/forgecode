import path from "path"
import { Effect, Layer } from "effect"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { Git } from "@opencode/core/git"
import { SquadAudit } from "@opencode/core/squad/audit"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadStore } from "@opencode/core/squad/store"
import { Document, Info } from "@opencode/schema/config"
import { ConfigSquad } from "@opencode/schema/config/squad"
import { Global } from "@opencode/util/global"

export const squadEnabled = (squad: ConstructorParameters<typeof ConfigSquad.Info>[0] = { enabled: true }) => [
  new Document({ type: "document", info: new Info({ squad: new ConfigSquad.Info(squad) }) }),
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

/** Every directory is its own worktree of one repository, so ownership keys equal the session directories. */
export const stubGit = Layer.succeed(
  Git.Service,
  {
    repo: {
      discover: (directory: string) =>
        Effect.succeed(
          Git.Repository.make({
            worktree: directory as never,
            gitDirectory: `/repo/.git/worktrees/${path.basename(directory)}` as never,
            commonDirectory: "/repo/.git" as never,
          }),
        ),
    },
    history: { resolve: () => Effect.succeed("c".repeat(40)) },
  } as unknown as Git.Interface,
)

/** The registry, store, audit, database and config every squad service test stands on. */
export const squadBase = (directory: string, squad?: ConstructorParameters<typeof ConfigSquad.Info>[0]) =>
  Layer.mergeAll(
    SquadRegistry.layer,
    SquadStore.layer,
    SquadAudit.layer,
    Database.layer({ path: path.join(directory, "opencode.db") }).pipe(Layer.provide(globalFor(directory))),
    stubGit,
    Config.testLayer(squadEnabled(squad)),
  )
