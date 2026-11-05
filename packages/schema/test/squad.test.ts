import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Squad } from "@opencode/schema/squad"

const roundtrip = <S extends Schema.Schema.AnyNoContext>(schema: S) => (value: Schema.Schema.Encoded<S>) => {
  const decoded = Schema.decodeUnknownSync(schema)(value)
  return Schema.encodeSync(schema)(decoded)
}

describe("Squad.SessionName", () => {
  test("rejects empty and whitespace", () => {
    expect(Schema.is(Squad.SessionName)("has space")).toBe(false)
    expect(Schema.is(Squad.SessionName)("")).toBe(false)
  })

  test("accepts a valid role name", () => {
    expect(Schema.is(Squad.SessionName)("ORQUESTRADORA")).toBe(true)
  })
})

describe("Squad.SessionState", () => {
  test("rejects a value outside the set", () => {
    expect(Schema.is(Squad.SessionState)("bogus")).toBe(false)
  })

  test("accepts every documented state", () => {
    for (const state of ["creating", "starting", "verified", "closed", "failed"]) {
      expect(Schema.is(Squad.SessionState)(state)).toBe(true)
    }
  })
})

describe("Squad codec round-trips", () => {
  test("Generation", () => {
    const value = { id: "gen-2026-11-04", runID: "run-1", state: "active", createdAt: 0, sessions: [] }
    expect(roundtrip(Squad.Generation)(value)).toEqual(value)
  })

  test("SessionEntry", () => {
    const value = {
      generationID: "gen-1",
      name: "ATLAS",
      role: "worker",
      provider: "kimi",
      model: "k3.1-pro",
      variant: "high",
      location: { directory: "/w/atlas" },
      branch: "feature/y",
      sessionID: "ses_1",
      state: "verified",
      productive: false,
      createdAt: 0,
      updatedAt: 0,
    }
    expect(roundtrip(Squad.SessionEntry)(value)).toEqual(value)
  })

  test("Dispatch", () => {
    const value = {
      id: "d1",
      generationID: "gen-1",
      orqID: "ORQ-gen-1-001",
      seq: 1,
      scope: "scope",
      owner: "ORQUESTRADORA",
      base: "main",
      head: "feature/x",
      dor: "dor",
      dod: "dod",
      proof: "proof",
      exclusions: ["a"],
      exigidos: ["ci", "merge"],
      milestone: "M1",
      validation: "unknown",
      state: "open",
      createdAt: 0,
    }
    expect(roundtrip(Squad.Dispatch)(value)).toEqual(value)
  })

  test("Checkpoint", () => {
    const value = { generationID: "gen-1", name: "ATLAS", sha256: "sha", body: "body", bytes: 4, createdAt: 0 }
    expect(roundtrip(Squad.Checkpoint)(value)).toEqual(value)
  })

  test("AuditEntry", () => {
    const value = {
      id: 1,
      at: 0,
      kind: "send",
      generation: "gen-1",
      target: "ATLAS",
      messageID: "msg_1",
      messageSha256: "sha",
      delivery: "queue",
      result: "accepted",
      actor: "ORQUESTRADORA",
      prevHash: "prev",
    }
    expect(roundtrip(Squad.AuditEntry)(value)).toEqual(value)
  })

  test("DispatchInput rejects empty exclusions", () => {
    const input = {
      scope: "s",
      owner: "O",
      base: "b",
      head: "h",
      dor: "d",
      dod: "d",
      proof: "p",
      exclusions: [],
      exigidos: ["ci"],
      milestone: "m",
    }
    expect(Schema.is(Squad.DispatchInput)(input)).toBe(false)
  })
})
