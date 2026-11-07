import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "@opencode/core/config"
import { Git } from "@opencode/core/git"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { CredentialPresence } from "@opencode/core/squad/credential"
import { check, type CheckSession } from "@opencode/core/squad/check"
import { Document, Info } from "@opencode/schema/config"
import { ConfigSquad } from "@opencode/schema/config/squad"
import { testEffect } from "../lib/effect"

const enabled = [
  new Document({ type: "document", info: new Info({ squad: new ConfigSquad.Info({ enabled: true }) }) }),
]

const session = (name: string, extra: Partial<CheckSession> = {}): CheckSession => ({
  name,
  provider: "deepseek",
  model: "deepseek-flash",
  variant: "high",
  location: `/squad/${name}`,
  branch: "feature/x",
  ...extra,
})

const modelInfo = (provider: string, model: string, variants: string[] = []) =>
  Model.Info.make({
    ...Model.Info.default(Provider.ID.make(provider), Model.ID.make(model)),
    variants: variants.map((id) => ({ id: Model.VariantID.make(id) })),
  })

const repository = (dir: string) =>
  Git.Repository.make({
    worktree: AbsolutePath.make(dir),
    gitDirectory: AbsolutePath.make(`${dir}/.git`),
    commonDirectory: AbsolutePath.make(`${dir}/.git`),
  })

const checkLayer = (options: {
  model?: Model.Info
  repository?: Git.Repository
  branch?: string
  credential?: Layer.Layer<CredentialPresence.Service, never>
}) =>
  Layer.mergeAll(
    Config.testLayer(enabled),
    Layer.mock(Model.Service, { get: () => Effect.succeed(options.model) }),
    Layer.succeed(
      Git.Service,
      {
        repo: { discover: () => Effect.succeed(options.repository) },
        history: { branch: () => Effect.succeed(options.branch) },
      } as unknown as Git.Interface,
    ),
    options.credential ??
      Layer.succeed(
        CredentialPresence.Service,
        CredentialPresence.Service.of({ status: () => Effect.succeed({ presence: "unknown" }) }),
      ),
  )

const it = testEffect(Layer.empty)

describe("SquadCheck", () => {
  it.live("reports fail for a variant that is not in the catalog", () =>
    Effect.gen(function* () {
      const report = yield* check({ sessions: [session("A", { variant: "low" })] }).pipe(
        Effect.provide(checkLayer({ model: modelInfo("deepseek", "deepseek-flash", ["high"]) })),
      )
      expect(report.sessions[0]?.checks.find((entry) => entry.check === "variant")?.verdict).toBe("fail")
    }),
  )

  it.live("reports fail when the measured branch diverges", () =>
    Effect.gen(function* () {
      const report = yield* check({ sessions: [session("A", { branch: "feature/expected" })] }).pipe(
        Effect.provide(
          checkLayer({
            model: modelInfo("deepseek", "deepseek-flash", ["high"]),
            repository: repository("/squad/A"),
            branch: "feature/actual",
          }),
        ),
      )
      const branch = report.sessions[0]?.checks.find((entry) => entry.check === "branch")
      expect(branch?.verdict).toBe("fail")
      expect(branch?.reason).toContain("measured feature/actual")
    }),
  )

  it.live("reports warn for a directory that is not a git repository", () =>
    Effect.gen(function* () {
      const report = yield* check({ sessions: [session("A")] }).pipe(
        Effect.provide(checkLayer({ model: modelInfo("deepseek", "deepseek-flash", ["high"]) })),
      )
      expect(report.sessions[0]?.checks.find((entry) => entry.check === "location")?.verdict).toBe("warn")
    }),
  )

  it.live("reports fail for an unknown model", () =>
    Effect.gen(function* () {
      const report = yield* check({ sessions: [session("A", { model: "missing" })] }).pipe(
        Effect.provide(checkLayer({ model: undefined })),
      )
      expect(report.sessions[0]?.checks.find((entry) => entry.check === "model")?.verdict).toBe("fail")
    }),
  )

  it.live("is deterministic and carries the credential verdict", () =>
    Effect.gen(function* () {
      const run = () =>
        check({ sessions: [session("A")] }).pipe(
          Effect.provide(
            checkLayer({
              model: modelInfo("deepseek", "deepseek-flash", ["high"]),
              repository: repository("/squad/A"),
              branch: "feature/x",
              credential: Layer.succeed(
                CredentialPresence.Service,
                CredentialPresence.Service.of({ status: () => Effect.succeed({ presence: "absent" }) }),
              ),
            }),
          ),
        )
      const first = yield* run()
      const second = yield* run()
      expect(first).toEqual(second)
      expect(first.sessions[0]?.credential).toBe("absent")
    }),
  )
})

describe("CredentialPresence", () => {
  it.live("falls back to unknown when subscription_auth is off and never leaks a sentinel", () =>
    Effect.gen(function* () {
      process.env.OPENCODE_SQUAD_SENTINEL = "super-secret-sentinel-value"
      const report = yield* check({ sessions: [session("A")] }).pipe(
        Effect.provide(
          checkLayer({
            model: modelInfo("deepseek", "deepseek-flash", ["high"]),
            credential: CredentialPresence.layer,
          }),
        ),
      )
      expect(report.sessions[0]?.credential).toBe("unknown")
      expect(JSON.stringify(report)).not.toContain("super-secret-sentinel-value")
      delete process.env.OPENCODE_SQUAD_SENTINEL
    }),
  )
})
