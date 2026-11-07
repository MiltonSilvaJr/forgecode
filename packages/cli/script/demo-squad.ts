#!/usr/bin/env bun

// Squad demonstration with a fake model provider: no API key, no external network, no local model.
//
//   bun run script/demo-squad.ts                      starts a private loopback server with the fake provider
//   bun run script/demo-squad.ts --server <url>       runs against a server you already started
//
// With --server the server needs `squad.enabled: true` and a provider named "demo" (the
// password comes from OPENCODE_PASSWORD). Any failure to reach it ends in a readable message and exit code 1.

import { OpenCode } from "@opencode/client"
import { ServerProcess } from "@opencode/server/process"
import { Effect, References } from "effect"
import { HttpServer } from "effect/http"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const flag = process.argv.indexOf("--server")
const attached = flag === -1 ? undefined : process.argv[flag + 1]
if (flag !== -1 && (attached === undefined || attached.startsWith("--"))) fail("--server needs a URL")

const password = process.env.OPENCODE_PASSWORD || "demo-password"
const authorization = "Basic " + btoa(`opencode:${password}`)
const sections = ["Resultado", "Fontes", "Comandos e provas", "Limites", "Próximos passos", "Posse da árvore"]
const checkpointBody = sections.map((title) => `## ${title}\nDemonstração com provider falso.`).join("\n")

function fail(message: string): never {
  console.error(`demo-squad: ${message}`)
  process.exit(1)
}

function step(message: string) {
  console.log(`\n== ${message}`)
}

// OpenAI-compatible chat completions stream that always answers "ok"; it never leaves the process.
function fakeProvider(input: string | URL | Request): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (!url.startsWith("http://fake-provider.invalid/")) return Promise.reject(new Error(`no network in demo: ${url}`))
  const chunk = (delta: object, finish: string | null) => ({
    id: "chatcmpl-demo",
    object: "chat.completion.chunk",
    created: 0,
    model: "demo-model",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })
  const frames = [
    chunk({ role: "assistant", content: "ok" }, null),
    chunk({}, "stop"),
    { ...chunk({}, null), choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
  ]
  const body = frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n"
  return Promise.resolve(new Response(body, { headers: { "content-type": "text/event-stream" } }))
}

const config = JSON.stringify({
  squad: { enabled: true },
  provider: {
    demo: {
      npm: "@ai-sdk/openai-compatible",
      name: "Demo (fake)",
      options: { baseURL: "http://fake-provider.invalid/v1", apiKey: "fake" },
      models: { "demo-model": { name: "Demo model", limit: { context: 200_000, output: 8_000 } } },
    },
  },
})

async function demo(baseUrl: string) {
  const api = OpenCode.make({
    baseUrl,
    headers: { authorization },
  })
  const info = await fetch(new URL("/api/info", baseUrl), { headers: { authorization: authorization }, signal: AbortSignal.timeout(5_000) }).then(
    (response) => response,
    (error: unknown) => fail(`cannot reach a server at ${baseUrl}: ${error instanceof Error ? error.message : String(error)}. Start one with squad.enabled, or run without --server.`),
  )
  if (!info.ok) fail(`the server at ${baseUrl} answered ${info.status} to /api/info; check OPENCODE_PASSWORD.`)

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "demo-squad-"))
  const sessions = ["ATLAS", "BOREAS"].map((name) => ({
    name,
    role: "worker" as const,
    provider: "demo",
    model: "demo-model",
    variant: "default",
    location: { directory: path.join(root, name.toLowerCase()) },
  }))
  await Promise.all(sessions.map((session) => fs.mkdir(session.location.directory, { recursive: true })))

  step("Create generation demo-1 with two sessions on the fake provider")
  const created = await api.experimental.squad.generation.create({ generation: "demo-1", sessions }).catch((error: unknown) =>
    fail(`cannot create the generation: ${error instanceof Error ? error.message : String(error)}`),
  )
  console.log(`generation ${created.id}: ${created.sessions.map((session) => session.name).join(", ")}`)

  step("Check and plan (no effect), then launch")
  const check = await api.experimental.squad.check()
  console.log("(model=fail is expected: the fake provider is injected into the server, not listed in the model catalog)")
  console.log(
    check.sessions
      .map((entry) => `${entry.name}: ${entry.checks.map((item) => `${item.check}=${item.verdict}`).join(" ")}`)
      .join("\n"),
  )
  const plan = await api.experimental.squad.plan()
  console.log(plan.sessions.map((entry) => `${entry.name}: would ${entry.action}`).join("\n"))
  for (const session of sessions) {
    const launched = await api.experimental.squad.session.launch({ sessionRef: session.name, timeout: 20_000 })
    console.log(`${session.name}: ${launched.state}`)
  }

  step("Enqueue a message and watch the delivery event")
  const controller = new AbortController()
  const delivered = (async () => {
    for await (const event of api.event.subscribe({ types: ["session.inbox.delivered"], signal: controller.signal }))
      if (event.type === "session.inbox.delivered") return event
  })().catch(() => undefined)
  const proof = await api.experimental.squad.session.send({ sessionRef: "ATLAS", text: "Hello from the demo", delivery: "queue" })
  console.log(`enqueued ${proof.messageID} for ${proof.name} (proof of enqueue, not of reading)`)
  const event = await Promise.race([delivered, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 20_000))])
  controller.abort()
  console.log(event === undefined ? "no delivery event within 20s" : `event ${event.type} received`)

  step("Checkpoints, close and transition")
  for (const session of sessions) {
    const checkpoint = await api.experimental.squad.checkpoint({ name: session.name, body: checkpointBody })
    console.log(`${session.name}: checkpoint sha256 ${checkpoint.sha256.slice(0, 12)}…`)
  }
  const receipt = await api.experimental.squad.generation.close({ generationID: "demo-1" })
  console.log(`closed demo-1, registry digest ${receipt.sourceRegistryDigest.slice(0, 12)}…`)
  await api.experimental.squad.generation.create({ generation: "demo-2", sessions })
  const bound = await api.experimental.squad.transition({ from: "demo-1" })
  console.log(`transition demo-1 -> ${bound.targetGenerationID}`)
  console.log("\nDemo finished. This demonstration does not release productive execution.")
}

if (attached !== undefined) await demo(attached)
else {
  const database = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "demo-squad-db-")), "opencode.db")
  const run = Effect.scoped(
      Effect.gen(function* () {
        const server = yield* ServerProcess.start<never, never>({
          hostname: "127.0.0.1",
          port: 0,
          password,
          database: { path: database },
          config: { content: config, project: false, claude: false },
          events: { persist: true },
          models: { fetch: false },
          fs: { filewatcher: false },
          fetch: Object.assign(fakeProvider, { preconnect: fetch.preconnect }),
        })
        yield* Effect.promise(() => demo(HttpServer.formatAddress(server.address)))
      }),
  ).pipe(Effect.provideService(References.MinimumLogLevel, "Error"))
  // The server graph is fully provided by ServerProcess.start; the type system still lists its internal service requests.
  await Effect.runPromise(run as Effect.Effect<void, Error>)
}
process.exit(0)
