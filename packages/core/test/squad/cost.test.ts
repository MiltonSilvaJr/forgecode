import { describe, expect } from "bun:test"
import { Duration, Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadSessionTable } from "@opencode/core/squad/sql"
import { CredentialPresence } from "@opencode/core/squad/credential"
import { SquadStatus } from "@opencode/core/squad/status"
import { SubscriptionService } from "@opencode/core/subscription/service"
import { Document, Info } from "@opencode/schema/config"
import { ConfigSquad } from "@opencode/schema/config/squad"
import { SubscriptionAuth } from "@opencode/schema/subscription-auth"
import { fakeWorld } from "../fixture/squad-world"
import { squadBase } from "../fixture/squad-env"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const model = { providerID: "deepseek", id: "deepseek-flash", variant: "high" }

const entry = (name: string, sessionID: string) => ({
  name,
  role: "worker" as const,
  provider: "deepseek",
  model: "deepseek-flash",
  variant: "high",
  location: { directory: `/squad/${name}` },
  sessionID,
})

const scenario = <A, E, R>(body: (world: ReturnType<typeof fakeWorld>) => Effect.Effect<A, E, R>) =>
  tmpdirScoped().pipe(
    Effect.flatMap((dir) => {
      const world = fakeWorld()
      return body(world).pipe(Effect.provide(Layer.mergeAll(squadBase(dir.path), world.sessionLayer, world.channelLayer)))
    }),
  )

const verified = (...names: string[]) =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    for (const name of names)
      yield* db.update(SquadSessionTable).set({ state: "verified" }).where(eq(SquadSessionTable.name, name)).run()
  })

describe("squad cost", () => {
  it.live("status carries cost and tokens per session and the total per generation", () =>
    scenario((world) =>
      Effect.gen(function* () {
        world.seed("ses_a", model, [], { cost: 0.5, input: 100, output: 50 })
        world.seed("ses_b", model, [], { cost: 0.25, input: 10, output: 5 })
        const registry = yield* SquadRegistry.Service
        yield* registry.init({ generation: "gen-1", sessions: [entry("A", "ses_a"), entry("B", "ses_b")] })
        yield* verified("A", "B")
        const report = yield* SquadStatus.status()
        expect<unknown>(report.sessions[0]?.cost).toEqual({ cost: 0.5, tokens: { input: 100, output: 50 }, unknown: false })
        expect<unknown>(report.sessions[1]?.cost).toEqual({ cost: 0.25, tokens: { input: 10, output: 5 }, unknown: false })
        expect<unknown>(report.cost).toEqual({ cost: 0.75, tokens: { input: 110, output: 55 }, unknown: false })
      }),
    ),
  )

  it.live("a session that never recorded usage is unknown and makes the total a lower bound", () =>
    scenario((world) =>
      Effect.gen(function* () {
        world.seed("ses_a", model, [], { cost: 0.5, input: 100, output: 50 })
        world.seed("ses_b", model)
        const registry = yield* SquadRegistry.Service
        yield* registry.init({ generation: "gen-1", sessions: [entry("A", "ses_a"), entry("B", "ses_b")] })
        const report = yield* SquadStatus.status()
        expect<unknown>(report.sessions[1]?.cost).toEqual({ unknown: true })
        expect<unknown>(report.cost).toEqual({ cost: 0.5, tokens: { input: 100, output: 50 }, unknown: true })
      }),
    ),
  )
})

const day = 86_400_000

const credentialFor = (expiresIn: number | undefined, squad: ConstructorParameters<typeof ConfigSquad.Info>[0] = { enabled: true }) =>
  CredentialPresence.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Config.testLayer([
          new Document({
            type: "document",
            info: Info.make({ squad: new ConfigSquad.Info(squad), subscription_auth: { enabled: true } }),
          }),
        ]),
        Layer.mock(SubscriptionService.Service, {
          status: () =>
            Effect.succeed(
              SubscriptionAuth.Status.make({
                enabled: true,
                providers: [
                  {
                    id: "deepseek",
                    state: "ready",
                    ...(expiresIn === undefined ? {} : { expiresAt: Date.now() + expiresIn }),
                  },
                ],
              }),
            ),
        }),
      ),
    ),
  )

const statusWith = (layer: Layer.Layer<CredentialPresence.Service>) =>
  Effect.gen(function* () {
    const credential = yield* CredentialPresence.Service
    return yield* credential.status("deepseek")
  }).pipe(Effect.provide(layer))

describe("CredentialPresence expiry", () => {
  it.live("warns when the credential expires inside expiry_warn without changing presence", () =>
    Effect.gen(function* () {
      const soon = yield* statusWith(credentialFor(3 * day))
      expect<unknown>(soon.presence).toBe("present")
      expect<unknown>(soon.expiryWarn).toBe(true)
      expect<unknown>(soon.expiresAt).toBeDefined()
      const far = yield* statusWith(credentialFor(30 * day))
      expect<unknown>(far.presence).toBe("present")
      expect<unknown>(far.expiryWarn).toBe(false)
    }),
  )

  it.live("expiry_warn is configurable and a missing expiry never warns", () =>
    Effect.gen(function* () {
      const narrow = yield* statusWith(credentialFor(3 * day, { enabled: true, credential: { expiry_warn: Duration.days(1) } }))
      expect<unknown>(narrow.expiryWarn).toBe(false)
      const wide = yield* statusWith(credentialFor(10 * day, { enabled: true, credential: { expiry_warn: Duration.days(14) } }))
      expect<unknown>(wide.expiryWarn).toBe(true)
      const none = yield* statusWith(credentialFor(undefined))
      expect<unknown>(none.expiresAt).toBeUndefined()
      expect<unknown>(none.expiryWarn).toBe(false)
    }),
  )
})
