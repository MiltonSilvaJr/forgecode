export * as SubscriptionRedaction from "./redaction.js"

import { SubscriptionAuth } from "@opencode/schema/subscription-auth"

export const REDACTED_TOKEN = "[redacted:token]"
export const REDACTED_DEVICE_CODE = "[redacted:device-code]"

/** Masks bearer tokens, token query fields and sensitive headers in an error body or log line. */
export function redact(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, `Bearer ${REDACTED_TOKEN}`)
    .replace(/\b(access_token|refresh_token|id_token|user_code)\s*=\s*[^\s&"']+/g, `$1=${REDACTED_TOKEN}`)
    .replace(/\b(authorization|x-api-key|cookie|set-cookie)\s*[:=]\s*[^\s,;"']+/gi, `$1=${REDACTED_TOKEN}`)
    .replace(/\bcode\s*=\s*[^\s&"']+/g, `code=${REDACTED_DEVICE_CODE}`)
}

/** Masks a single known-secret value. */
export function redactValue(_value: string): string {
  return REDACTED_TOKEN
}

/** Truncates a provider error body to `max` characters so raw bodies never reach logs. */
export function truncate(value: string, max = 200): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}…`
}

export function error(code: SubscriptionAuth.ErrorCode, message: string): SubscriptionAuth.Error {
  return { code, message }
}
