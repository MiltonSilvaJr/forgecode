import { ClientError } from "@opencode/client/promise"
import type { OpenCodeClient } from "@opencode/client/promise"
import { errorMessage } from "../util/error"
import type { AuditLine } from "./audit"

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{1,80}$/

export type AuditSink = { append(line: AuditLine): Promise<boolean> }

export type EnqueueResult = {
  sessionID: string
  target: string | null
  delivery: "queue" | "steer"
  idempotencyKey: string
  messageID: string | null
  created: string | null
  status: "queued" | "failed"
  error: string | null
}

export const deriveMessageID = (key: string) => `msg_fq_${key}`

export function validateIdempotencyKey(
  key: string | undefined,
): { ok: true; key: string } | { ok: false; code: 2; message: string } {
  if (key === undefined) return { ok: false, code: 2, message: "missing required --idempotency-key" }
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) return { ok: false, code: 2, message: "invalid idempotency key" }
  return { ok: true, key }
}

export async function enqueueOne(
  client: OpenCodeClient,
  input: {
    sessionID: string
    text: string
    delivery: "queue" | "steer"
    idempotencyKey: string
    target: string | null
    allowSelf: boolean
    serverUrl: string
    audit: AuditSink
    signal?: AbortSignal
  },
): Promise<EnqueueResult> {
  if (process.env.OPENCODE_SESSION_ID === input.sessionID && !input.allowSelf) {
    const result: EnqueueResult = {
      sessionID: input.sessionID,
      target: input.target,
      delivery: input.delivery,
      idempotencyKey: input.idempotencyKey,
      messageID: null,
      created: null,
      status: "failed",
      error: `Refusing to queue for the calling session ${input.sessionID}; pass --allow-self to override`,
    }
    await input.audit.append(auditLine(result))
    return result
  }
  try {
    const inbox = await client.session.prompt(
      {
        sessionID: input.sessionID,
        text: input.text,
        delivery: input.delivery,
        id: deriveMessageID(input.idempotencyKey),
      },
      ...(input.signal ? [{ signal: input.signal }] : []),
    )
    const result: EnqueueResult = {
      sessionID: input.sessionID,
      target: input.target,
      delivery: input.delivery,
      idempotencyKey: input.idempotencyKey,
      messageID: inbox.id,
      created: new Date(inbox.time.created).toISOString(),
      status: "queued",
      error: null,
    }
    await input.audit.append(auditLine(result))
    return result
  } catch (cause) {
    const result: EnqueueResult = {
      sessionID: input.sessionID,
      target: input.target,
      delivery: input.delivery,
      idempotencyKey: input.idempotencyKey,
      messageID: null,
      created: null,
      status: "failed",
      error: enqueueErrorMessage(cause, input),
    }
    await input.audit.append(auditLine(result))
    return result
  }
}

export async function enqueueAll(
  client: OpenCodeClient,
  input: {
    targets: ReadonlyArray<{ sessionID: string; target: string | null }>
    text: string
    delivery: "queue" | "steer"
    idempotencyKey: string
    allowSelf: boolean
    serverUrl: string
    audit: AuditSink
    signal?: AbortSignal
  },
): Promise<EnqueueResult[]> {
  const self = process.env.OPENCODE_SESSION_ID
  const targets = input.targets.filter((target) => input.allowSelf || target.sessionID !== self)
  const results: EnqueueResult[] = []
  for (const target of targets) {
    results.push(
      await enqueueOne(client, {
        sessionID: target.sessionID,
        text: input.text,
        delivery: input.delivery,
        idempotencyKey: input.idempotencyKey,
        target: target.target,
        allowSelf: input.allowSelf,
        serverUrl: input.serverUrl,
        audit: input.audit,
        signal: input.signal,
      }),
    )
  }
  return results
}

function auditLine(result: EnqueueResult): AuditLine {
  return {
    schema_version: 1,
    timestamp: new Date().toISOString(),
    command: "queue",
    target: result.target,
    sessionID: result.sessionID,
    messageID: result.messageID,
    delivery: result.delivery,
    idempotencyKey: result.idempotencyKey,
    result: result.status,
    error: result.error,
  }
}

function enqueueErrorMessage(
  cause: unknown,
  input: { sessionID: string; idempotencyKey: string; serverUrl: string },
): string {
  if (cause instanceof ClientError) {
    if (cause.reason === "Transport") return `cannot reach the ForgeCode server at ${input.serverUrl}`
    if (cause.reason === "UnexpectedStatus") {
      const status = (cause.cause as { status?: number } | undefined)?.status
      return `server error (HTTP ${status ?? "unknown"})`
    }
  }
  const tag = (cause as { _tag?: unknown } | null)?._tag
  if (tag === "SessionNotFoundError") return `Session ${input.sessionID} not found`
  if (tag === "ConflictError") return `idempotency key ${input.idempotencyKey} is already used by another item`
  return errorMessage(cause)
}
