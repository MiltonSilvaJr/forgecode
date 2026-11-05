export * as SubscriptionResolver from "./resolver.js"

import { Effect } from "effect"
import { SubscriptionAuth } from "@opencode/schema/subscription-auth"
import { SubscriptionSource } from "./source.js"

/** Fixed resolution priority: explicit env → ForgeCode store → native CLI session → keychain → API key. */
export const defaultOrder: readonly SubscriptionAuth.Source.Kind[] = [
  "env",
  "store",
  "native",
  "keychain",
  "api_key",
]

export interface Resolved {
  readonly resolution: SubscriptionAuth.Resolution
  readonly source: SubscriptionSource.Source | undefined
}

export interface ResolveInput {
  readonly integrationID: string
  readonly sources: readonly SubscriptionSource.Source[]
  readonly order?: readonly SubscriptionAuth.Source.Kind[]
  readonly fallbackApiKey?: boolean
}

/**
 * Resolves one provider's credential sources in priority order. A present-but-expired source
 * is skipped and the search continues; a source that fails by account mismatch blocks the API
 * key fallback (REQ-13). Returns a report without ever exposing the secret.
 */
export function resolve(input: ResolveInput): Effect.Effect<Resolved> {
  return Effect.gen(function* () {
    const fallbackApiKey = input.fallbackApiKey ?? true
    const order = (input.order ?? defaultOrder).filter((kind) => fallbackApiKey || kind !== "api_key")
    const byKind = new Map<SubscriptionAuth.Source.Kind, SubscriptionSource.Source[]>()
    for (const source of input.sources) {
      const list = byKind.get(source.kind) ?? []
      list.push(source)
      byKind.set(source.kind, list)
    }
    const skipped: SubscriptionAuth.Source.Skipped[] = []
    for (const kind of order) {
      const source = byKind.get(kind)?.[0]
      if (!source) {
        skipped.push({ kind, reason: "no_source" })
        continue
      }
      const accountMismatch = skipped.some((entry) => entry.reason === "account_mismatch")
      if (kind === "api_key" && accountMismatch) {
        skipped.push({ kind, reason: "account_mismatch" })
        continue
      }
      const report = yield* source.report()
      if (report.present && report.state === "ready") {
        const resolution: SubscriptionAuth.Resolution = {
          integrationID: input.integrationID,
          state: "ready",
          source: kind,
          skipped,
          ...(report.expiresAt !== undefined ? { expiresAt: report.expiresAt } : {}),
          ...(report.accountLabel !== undefined ? { accountLabel: report.accountLabel } : {}),
          ...(kind === "api_key" ? { fallback: "api_key", reason: fallbackReason(skipped) } : {}),
        }
        return { resolution, source }
      }
      skipped.push({ kind, reason: skipReason(report) })
    }
    return {
      resolution: { integrationID: input.integrationID, state: "missing", skipped },
      source: undefined,
    }
  })
}

function skipReason(report: SubscriptionAuth.Source.Report): string {
  if (report.state === "expired") return "expired"
  if (report.state === "incompatible") return report.detail ?? "incompatible"
  return report.detail ?? "missing"
}

function fallbackReason(skipped: readonly SubscriptionAuth.Source.Skipped[]): string {
  return skipped.find((entry) => entry.reason !== "no_source")?.reason ?? "subscription_unavailable"
}

/**
 * Memoizes resolution per integrationID until `invalidate` is called (credential switch), so
 * repeated reads do not re-read session files.
 */
export const makeResolver = () => {
  const cache = new Map<string, Resolved>()
  return {
    resolve: (input: ResolveInput): Effect.Effect<Resolved> =>
      Effect.gen(function* () {
        const existing = cache.get(input.integrationID)
        if (existing) return existing
        const result = yield* resolve(input)
        cache.set(input.integrationID, result)
        return result
      }),
    invalidate: (integrationID: string) => cache.delete(integrationID),
  }
}
