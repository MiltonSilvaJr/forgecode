import path from "path"
import { Layer } from "effect"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
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

/** The registry, store, audit, database and config every squad service test stands on. */
export const squadBase = (directory: string, squad?: ConstructorParameters<typeof ConfigSquad.Info>[0]) =>
  Layer.mergeAll(
    SquadRegistry.layer,
    SquadStore.layer,
    SquadAudit.layer,
    Database.layer({ path: path.join(directory, "opencode.db") }).pipe(Layer.provide(globalFor(directory))),
    Config.testLayer(squadEnabled(squad)),
  )
