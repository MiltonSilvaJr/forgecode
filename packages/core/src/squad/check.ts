export * as SquadCheck from "./check.js"

import { Effect } from "effect"
import { Squad } from "@opencode/schema/squad"
import { Provider } from "../provider.js"
import { Model } from "../model.js"
import { Git } from "../git.js"
import { AbsolutePath } from "../schema.js"
import { Config } from "../config.js"
import { DisabledError } from "./index.js"
import { CredentialPresence } from "./credential.js"

export interface CheckSession {
  name: string
  provider: string
  model: string
  variant?: string
  location: string
  branch?: string
}

const requireEnabled = () =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const entries = yield* config.entries()
    if (Config.latest(entries, "squad")?.enabled !== true) return yield* new DisabledError()
  })

const item = (check: string, verdict: Squad.CheckVerdict, reason?: string) =>
  Squad.CheckItem.make({ check, verdict, ...(reason === undefined ? {} : { reason }) })

const checkSession = (session: CheckSession) =>
  Effect.gen(function* () {
    const model = yield* Model.Service
    const git = yield* Git.Service
    const credential = yield* CredentialPresence.Service

    const checks: (typeof Squad.CheckItem.Type)[] = []

    const configured =
      session.name !== "" && session.provider !== "" && session.model !== "" && session.location !== ""
    checks.push(configured ? item("config", "ok") : item("config", "fail", "name, provider, model and location must be non-empty"))

    const info = yield* model.get(Provider.ID.make(session.provider), Model.ID.make(session.model))
    if (!info) {
      checks.push(item("model", "fail", `provider ${session.provider} or model ${session.model} not found in the catalog`))
    } else {
      checks.push(item("model", "ok"))
      if (session.variant && !info.variants.some((entry) => entry.id === session.variant)) {
        const variants = info.variants.map((entry) => entry.id)
        checks.push(
          item("variant", "fail", `variant ${session.variant} not available; expected one of: ${variants.join(", ") || "(none)"}`),
        )
      } else {
        checks.push(item("variant", "ok"))
      }
    }

    const repository = yield* git.repo.discover(AbsolutePath.make(session.location))
    if (!repository) {
      checks.push(item("location", "warn", `directory is not a git repository`))
      checks.push(item("branch", "warn", "branch not measurable: not a git repository"))
    } else {
      checks.push(item("location", "ok"))
      const branch = yield* git.history.branch(repository)
      if (session.branch && branch !== undefined && branch !== session.branch) {
        checks.push(item("branch", "fail", `branch diverged: measured ${branch}, expected ${session.branch}`))
      } else if (session.branch && branch === undefined) {
        checks.push(item("branch", "warn", "branch not measurable"))
      } else {
        checks.push(item("branch", "ok"))
      }
    }

    const presence = (yield* credential.status(session.provider)).presence

    return Squad.SessionCheck.make({
      name: Squad.SessionName.make(session.name),
      checks,
      credential: presence,
    })
  })

export const check = Effect.fn("Squad.check")(function* (input: { sessions: readonly CheckSession[] }) {
  yield* requireEnabled()
  const sessions = yield* Effect.forEach(input.sessions, checkSession)
  return Squad.CheckReport.make({ sessions })
})
