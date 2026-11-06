import { describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { DateTime, Effect, Layer } from "effect"
import { PanelCi } from "@opencode/core/squad/panel/ci"
import { PanelJira } from "@opencode/core/squad/panel/jira"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { Git } from "@opencode/core/git"
import { SquadAudit } from "@opencode/core/squad/audit"
import { SquadChannel } from "@opencode/core/squad/channel"
import { SquadDispatch } from "@opencode/core/squad/dispatch"
import { SquadPanel } from "@opencode/core/squad/panel"
import { SquadRegistry } from "@opencode/core/squad/registry"
import { SquadStore } from "@opencode/core/squad/store"
import { Document, Info } from "@opencode/schema/config"
import { ConfigSquad } from "@opencode/schema/config/squad"
import { Global } from "@opencode/util/global"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

const head = "b".repeat(40)
const secret = "SENTINEL-SECRET-TOKEN-123"

const script = (directory: string, name: string, body: string) =>
  Effect.promise(async () => {
    const file = path.join(directory, name)
    await fs.writeFile(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
    return file
  })

const checks = (list: unknown) => `echo '${JSON.stringify({ checks: list })}'`

describe("PanelCi", () => {
  it.live("is unknown, with a reason, when nothing is configured, the command is missing or it fails", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const none = yield* PanelCi.read({ command: undefined, evidence: undefined, name: "ci", headOid: head })
          expect(none.status).toBe("unknown")
          const missing = yield* PanelCi.read({ command: path.join(dir.path, "absent"), evidence: undefined, name: "ci", headOid: head })
          expect(missing.status).toBe("unknown")
          const failing = yield* PanelCi.read({
            command: yield* script(dir.path, "fail.sh", `echo ${secret} >&2; exit 3`),
            evidence: undefined,
            name: "ci",
            headOid: head,
          })
          expect(failing.status).toBe("unknown")
          expect(failing.evidence).toBeNull()
          expect(JSON.stringify([none, missing, failing])).not.toContain(secret)
          expect(JSON.stringify([none, missing, failing])).not.toContain(dir.path)
        }),
      ),
    ),
  )

  it.live("verifies only the named check, successful, at the same head_oid", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const read = (list: unknown) =>
            script(dir.path, "ci.sh", checks(list)).pipe(
              Effect.flatMap((command) => PanelCi.read({ command, evidence: undefined, name: "ci", headOid: head })),
            )
          const good = yield* read([{ name: "ci", conclusion: "success", head_oid: head }])
          expect(good.status).toBe("verified")
          expect(good.evidence?.type).toBe("ci")
          expect(good.evidence?.reference).toContain("ci@")
          const otherRef = yield* read([{ name: "ci", conclusion: "success", head_oid: "c".repeat(40) }])
          expect(otherRef.status).toBe("unknown")
          const otherName = yield* read([{ name: "lint", conclusion: "success", head_oid: head }])
          expect(otherName.status).toBe("unknown")
          const red = yield* read([{ name: "ci", conclusion: "failure", head_oid: head }])
          expect(red.status).toBe("failed")
          const pending = yield* read([{ name: "ci", conclusion: null, head_oid: head }])
          expect(pending.status).toBe("unknown")
        }),
      ),
    ),
  )

  it.live("reads an evidence file and never leaks its path or extra fields", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const file = path.join(dir.path, "ci.json")
          yield* Effect.promise(() =>
            fs.writeFile(file, JSON.stringify({ checks: [{ name: "ci", conclusion: "success", head_oid: head, log: secret }] })),
          )
          const stage = yield* PanelCi.read({ command: undefined, evidence: file, name: "ci", headOid: head })
          expect(stage.status).toBe("verified")
          expect(JSON.stringify(stage)).not.toContain(secret)
          expect(JSON.stringify(stage)).not.toContain(dir.path)
          const absent = yield* PanelCi.read({ command: undefined, evidence: path.join(dir.path, "nope.json"), name: "ci", headOid: head })
          expect(absent.status).toBe("unknown")
        }),
      ),
    ),
  )

  it.live("refuses a command that would write, without running it", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const target = path.join(dir.path, "written")
          const stage = yield* PanelCi.read({ command: `touch ${target}`, evidence: undefined, name: "ci", headOid: head })
          expect(stage.status).toBe("unknown")
          expect(stage.source).toContain("refused")
          const viaShell = yield* PanelCi.read({ command: `echo x > ${target}`, evidence: undefined, name: "ci", headOid: head })
          expect(viaShell.status).toBe("unknown")
          expect(yield* Effect.promise(() => fs.access(target).then(() => true, () => false))).toBe(false)
        }),
      ),
    ),
  )
})

describe("PanelJira", () => {
  const since = Date.parse("2026-01-01T00:00:00Z")

  it.live("promotes only when the snapshot is newer than the dispatch", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const read = (updated: string) =>
            script(dir.path, "jira.sh", `echo '${JSON.stringify({ key: "ABC-1", updated, description: secret })}'`).pipe(
              Effect.flatMap((command) => PanelJira.read({ command, orq: "ORQ-gen-1-001", head: "feature/x", since })),
            )
          const fresh = yield* read("2026-02-01T00:00:00Z")
          expect(fresh.status).toBe("verified")
          expect(fresh.evidence?.reference).toBe("ABC-1")
          expect(fresh.evidence?.at && DateTime.toEpochMillis(fresh.evidence.at)).toBe(Date.parse("2026-02-01T00:00:00Z"))
          expect(JSON.stringify(fresh)).not.toContain(secret)
          const stale = yield* read("2025-12-01T00:00:00Z")
          expect(stale.status).toBe("unknown")
          expect(stale.evidence).toBeNull()
        }),
      ),
    ),
  )

  it.live("is unknown when unconfigured, failing or refused", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const base = { orq: "ORQ-gen-1-001", head: "feature/x", since }
          expect((yield* PanelJira.read({ ...base, command: undefined })).status).toBe("unknown")
          expect((yield* PanelJira.read({ ...base, command: path.join(dir.path, "absent") })).status).toBe("unknown")
          const bad = yield* script(dir.path, "bad.sh", "echo not-json")
          expect((yield* PanelJira.read({ ...base, command: bad })).status).toBe("unknown")
          const target = path.join(dir.path, "written")
          const refused = yield* PanelJira.read({ ...base, command: `rm -f ${target}` })
          expect(refused.status).toBe("unknown")
          expect(refused.source).toContain("refused")
        }),
      ),
    ),
  )
})

describe("SquadPanel with adapters", () => {
  const git = Layer.succeed(
    Git.Service,
    {
      repo: {
        discover: () =>
          Effect.succeed(
            Git.Repository.make({
              worktree: "/squad/ATLAS" as never,
              gitDirectory: "/squad/ATLAS/.git" as never,
              commonDirectory: "/squad/ATLAS/.git" as never,
            }),
          ),
      },
      history: {
        resolve: (_repository: unknown, ref: string) => Effect.succeed(ref === "dev" ? "a".repeat(40) : head),
        isAncestor: () => Effect.succeed(undefined),
      },
    } as unknown as Git.Interface,
  )
  const layer = (directory: string, panel: ConfigSquad.Info["panel"]) =>
    Layer.mergeAll(
      SquadRegistry.layer,
      SquadStore.layer,
      SquadAudit.layer,
      Layer.succeed(
        SquadChannel.Service,
        SquadChannel.Service.of({ enqueue: () => Effect.die("unexpected enqueue"), pending: () => Effect.succeed([]) }),
      ),
      git,
      Database.layer({ path: path.join(directory, "opencode.db") }).pipe(
        Layer.provide(
          Global.layerWith({ data: directory, cache: directory, config: directory, state: directory, tmp: directory, bin: directory, log: directory, repos: directory }),
        ),
      ),
      Config.testLayer([new Document({ type: "document", info: new Info({ squad: new ConfigSquad.Info({ enabled: true, panel }) }) })]),
    )

  it.live("a green check on this head and a fresh Jira snapshot fill their stages; a broken command stays unknown", () =>
    tmpdirScoped().pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const evidence = path.join(dir.path, "ci.json")
          yield* Effect.promise(() => fs.writeFile(evidence, JSON.stringify({ checks: [{ name: "ci", conclusion: "success", head_oid: head }] })))
          const jira = yield* script(dir.path, "jira.sh", `echo '{"key":"ABC-9","updated":"2999-01-01T00:00:00Z"}'`)
          const broken = yield* script(dir.path, "broken.sh", "exit 1")
          const dispatch = Effect.gen(function* () {
            const registry = yield* SquadRegistry.Service
            yield* registry.init({
              generation: "gen-1",
              sessions: [{ name: "ATLAS", role: "worker", provider: "p", model: "m", location: { directory: "/squad/ATLAS" } }],
            })
            return yield* SquadDispatch.create({
              scope: "s", owner: "ATLAS", base: "dev", head: "feature/x", dor: "d", dod: "d", proof: "ci", exclusions: ["n"], milestone: "M1",
            })
          })
          yield* Effect.gen(function* () {
            const created = yield* dispatch
            const card = (yield* SquadPanel.build()).cards[created.orqID]!
            expect(card.estagios.jira.status).toBe("verified")
            expect(card.estagios.ci.status).toBe("verified")
            expect(card.desconhecido).toEqual(["merge", "deploy", "acceptance"])
            expect(JSON.stringify(card)).not.toContain(dir.path)
          }).pipe(Effect.provide(layer(dir.path, { jira_command: jira, ci_evidence: evidence })))
          yield* Effect.gen(function* () {
            const [card] = Object.values((yield* SquadPanel.build()).cards)
            expect(card?.estagios.jira.status).toBe("unknown")
            expect(card?.estagios.ci.status).toBe("unknown")
            expect(card?.progressa).toBe(false)
          }).pipe(Effect.provide(layer(dir.path, { jira_command: broken, ci_command: broken })))
        }),
      ),
    ),
  )
})
