import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { appendAuditLine, auditDirectory, readAuditLines, type AuditLine } from "../src/queue/audit"

function line(overrides: Partial<AuditLine> = {}): AuditLine {
  return {
    schema_version: 1,
    timestamp: "2026-11-04T12:00:00.000Z",
    command: "queue",
    target: "ORQUESTRADORA",
    sessionID: "ses_abc",
    messageID: "msg_fq_dispatch-42",
    delivery: "queue",
    idempotencyKey: "dispatch-42",
    result: "queued",
    error: null,
    ...overrides,
  }
}

const rawFile = (dir: string) => path.join(auditDirectory(dir), "audit.jsonl")
const readRaw = (dir: string) => fs.readFile(rawFile(dir), "utf8").catch(() => "")

describe("queue audit trail", () => {
  test("appends without rewriting the first line's bytes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "queue-audit-"))
    try {
      expect(await appendAuditLine(dir, line({ idempotencyKey: "k1" }))).toBe(true)
      const first = await readRaw(dir)
      expect(await appendAuditLine(dir, line({ idempotencyKey: "k2" }))).toBe(true)
      const all = await readRaw(dir)
      expect(all.startsWith(first)).toBe(true)
      expect(all.trim().split("\n").length).toBe(2)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("creates the audit file with 0600 permissions", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "queue-audit-"))
    try {
      await appendAuditLine(dir, line())
      const stat = await fs.stat(rawFile(dir)).catch(() => null)
      expect(stat?.mode & 0o777).toBe(0o600)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("never writes the message text into the audit file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "queue-audit-"))
    try {
      await appendAuditLine(dir, line())
      expect(await readRaw(dir)).not.toContain("FORGEQUEUE_SENTINEL")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("keeps idempotencyKey present and messageID null on failure", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "queue-audit-"))
    try {
      await appendAuditLine(dir, line({ result: "failed", messageID: null, error: "boom" }))
      const [record] = await readAuditLines(dir, "ses_abc", 100)
      expect(record).toMatchObject({ idempotencyKey: "dispatch-42", messageID: null, result: "failed" })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("truncates error to 200 characters", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "queue-audit-"))
    try {
      const error = "x".repeat(500)
      await appendAuditLine(dir, line({ result: "failed", messageID: null, error }))
      const [record] = await readAuditLines(dir, "ses_abc", 100)
      expect(record.error).toHaveLength(200)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("reads newest first, filtered by session and limited", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "queue-audit-"))
    try {
      await appendAuditLine(dir, line({ idempotencyKey: "a", messageID: "m1" }))
      await appendAuditLine(dir, line({ sessionID: "ses_other", idempotencyKey: "b", messageID: "m2" }))
      await appendAuditLine(dir, line({ idempotencyKey: "c", messageID: "m3" }))
      expect((await readAuditLines(dir, "ses_abc", 100)).map((l) => l.messageID)).toEqual(["m3", "m1"])
      expect(await readAuditLines(dir, "ses_abc", 1)).toHaveLength(1)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("reports write failure without throwing", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "queue-audit-"))
    try {
      await fs.mkdir(auditDirectory(dir), { recursive: true })
      await fs.writeFile(rawFile(dir), "")
      await fs.chmod(auditDirectory(dir), 0o555)
      expect(await appendAuditLine(dir, line())).toBe(false)
    } finally {
      await fs.chmod(auditDirectory(dir), 0o755).catch(() => {})
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
