import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode/core/database/database"
import { SquadAudit } from "@opencode/core/squad/audit"
import { SquadLaunch } from "@opencode/core/squad/launch"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadReplace } from "@opencode/core/squad/replace"
import { SquadSessionTable } from "@opencode/core/squad/sql"
import { fakeWorld, type WorldOptions } from "../fixture/squad-world"
import { squadBase } from "../fixture/squad-env"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const oldModel = { providerID: "deepseek", id: "deepseek-flash", variant: "high" }

const scenario = <A, E, R>(
  options: WorldOptions,
  body: (world: ReturnType<typeof fakeWorld>) => Effect.Effect<A, E, R>,
) =>
  tmpdirScoped().pipe(
    Effect.flatMap((dir) => {
      const world = fakeWorld(options)
      return body(world).pipe(Effect.provide(Layer.mergeAll(squadBase(dir.path), world.sessionLayer, world.channelLayer)))
    }),
  )

const rows = (name: string) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    return yield* db.select().from(SquadSessionTable).where(eq(SquadSessionTable.name, name)).all()
  })

const failure = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? (Cause.squash(exit.cause) as { _tag?: string; message?: string }) : undefined

const initOld = (world: ReturnType<typeof fakeWorld>, state: "verified" | "starting" | "creating" = "verified") =>
  Effect.gen(function* () {
    world.seed("ses_old", oldModel)
    const registry = yield* SquadRegistry.Service
    const db = (yield* Database.Service).db
    yield* registry.init({
      generation: "gen-1",
      sessions: [
        {
          name: "ATLAS",
          role: "worker",
          provider: "deepseek",
          model: "deepseek-flash",
          variant: "high",
          location: { directory: "/squad/atlas" },
          sessionID: "ses_old",
        },
      ],
    })
    yield* db.update(SquadSessionTable).set({ state, checkpoint_sha256: "cafe", last_error: "provider rejected the model" }).run()
  })

const fast = { pollInterval: 10, timeout: 300 }

describe("SquadReplace", () => {
  it.live("gives the name a new session on another provider, inheriting the checkpoint", () =>
    scenario({ measuredModel: undefined }, (world) =>
      Effect.gen(function* () {
        yield* initOld(world)
        yield* SquadReplace.replace({ name: "ATLAS", provider: "openai", model: "gpt-x", variant: "low", reason: "provider down", ...fast })
        const all = yield* rows("ATLAS")
        expect<unknown>(all.length).toBe(1)
        expect<unknown>(all[0]?.session_id === "ses_old" ? "unchanged" : "replaced").toBe("replaced")
        expect<unknown>(all[0]?.session_id?.startsWith("ses_")).toBe(true)
        expect<unknown>([all[0]?.provider, all[0]?.model, all[0]?.variant]).toEqual(["openai", "gpt-x", "low"])
        expect<unknown>(all[0]?.checkpoint_sha256).toBe("cafe")
        expect<unknown>(all[0]?.state).toBe("verified")
        expect<unknown>(world.creates.length).toBe(1)
      }),
    ),
  )

  it.live("audits session_replace with from, to and the reason, keeping the old session untouched", () =>
    scenario({}, (world) =>
      Effect.gen(function* () {
        yield* initOld(world)
        const audit = yield* SquadAudit.Service
        yield* SquadReplace.replace({ name: "ATLAS", provider: "openai", model: "gpt-x", reason: "provider down", ...fast })
        const line = (yield* audit.list()).find((entry) => entry.kind === "session_replace")
        expect<unknown>(line?.target).toBe("ATLAS")
        expect<unknown>(line?.detail).toContain("ses_old")
        expect<unknown>(line?.detail).toContain("provider down")
        expect<unknown>(world.stored.has("ses_old")).toBe(true)
        expect<unknown>(world.creates.includes("ses_old")).toBe(false)
      }),
    ),
  )

  it.live("an unknown name and a missing provider are refused before any effect", () =>
    scenario({}, (world) =>
      Effect.gen(function* () {
        yield* initOld(world)
        const unknownName = yield* SquadReplace.replace({ name: "GHOST", provider: "openai" }).pipe(Effect.exit)
        expect<unknown>(failure(unknownName)?._tag).toBe("SessionNotFoundError")
        const noProvider = yield* SquadReplace.replace({ name: "ATLAS", provider: "" }).pipe(Effect.exit)
        expect<unknown>(failure(noProvider)?._tag).toBe("ConflictError")
        expect<unknown>((yield* rows("ATLAS"))[0]?.session_id).toBe("ses_old")
        expect<unknown>(world.creates.length).toBe(0)
      }),
    ),
  )

  it.live("--retry from starting needs --reason and does not require passing through failed", () =>
    scenario({ failEnqueues: 1 }, (world) =>
      Effect.gen(function* () {
        yield* initOld(world, "creating")
        yield* SquadLaunch.launch(fast).pipe(Effect.exit)
        expect<unknown>((yield* rows("ATLAS"))[0]?.state).toBe("starting")
        const noReason = yield* SquadLaunch.launch({ retry: true, ...fast }).pipe(Effect.exit)
        expect<unknown>(failure(noReason)?.message).toContain("--reason")
        yield* SquadLaunch.launch({ retry: true, reason: "evidence never arrived", ...fast })
        expect<unknown>((yield* rows("ATLAS"))[0]?.state).toBe("verified")
      }),
    ),
  )
})
