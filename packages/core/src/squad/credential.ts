export * as CredentialPresence from "./credential.js"

import { Context, Effect, Layer } from "effect"
import { Squad } from "@opencode/schema/squad"

export interface Status {
  readonly presence: Squad.CredentialPresence
}

export interface Interface {
  readonly status: (providerID: string) => Effect.Effect<Status>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Squad/CredentialPresence") {}

export const layer = Layer.succeed(
  Service,
  Service.of({ status: () => Effect.succeed({ presence: "unknown" }) }),
)
