export * as SubscriptionRedaction from "./redaction.js"

import { SubscriptionAuth } from "@opencode/schema/subscription-auth"

export const REDACTED_TOKEN = "[redacted:token]"

export function redact(value: string): string {
  return value
}

export function redactValue(value: string): string {
  return value
}

export function truncate(value: string, _max = 200): string {
  return value
}

export function error(code: SubscriptionAuth.ErrorCode, message: string): SubscriptionAuth.Error {
  return { code, message }
}
