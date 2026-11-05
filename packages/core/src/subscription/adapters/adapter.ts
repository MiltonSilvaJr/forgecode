export * as SubscriptionAdapter from "./adapter.js"

import { Effect } from "effect"
import { SubscriptionAuth } from "@opencode/schema/subscription-auth"
import { Integration } from "../../integration.js"
import { SubscriptionSource } from "../source.js"
import type { Env } from "../native-session.js"

export interface CommandResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export type CommandRunner = (command: string, args: readonly string[], env?: Env) => Effect.Effect<CommandResult>

export type LoginSource = "managed" | "native"

export type LoginResult =
  | { readonly status: "already_authenticated" }
  | { readonly status: "authenticated" }
  | { readonly status: "started"; readonly url: string; readonly instructions: string }
  | { readonly status: "error"; readonly code: SubscriptionAuth.ErrorCode; readonly message: string }

export type LogoutResult =
  | { readonly status: "removed" }
  | { readonly status: "error"; readonly code: SubscriptionAuth.ErrorCode; readonly message: string }

/**
 * A subscription adapter declares its provider's credential sources, native session report,
 * official login/logout and the transport binding to an existing (or new) provider.
 */
export interface Adapter {
  readonly integrationID: string
  readonly providerID: string
  readonly sources: (env: Env) => Effect.Effect<readonly SubscriptionSource.Source[]>
  readonly report: (env: Env) => Effect.Effect<SubscriptionAuth.Source.Report>
  readonly login: (
    input: { readonly source: LoginSource; readonly env: Env },
    integration?: Integration.Interface,
  ) => Effect.Effect<LoginResult>
  readonly logout: (env: Env) => Effect.Effect<LogoutResult>
  readonly transport: { readonly provider: string }
}
