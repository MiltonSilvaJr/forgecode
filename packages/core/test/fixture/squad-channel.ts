import { DateTime, Effect, Layer } from "effect"
import { Session } from "@opencode/core/session"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { SessionMessage } from "@opencode/schema/session-message"

type PromptInput = Parameters<Session.Interface["prompt"]>[0]

/**
 * A fast double of the core inbox, not evidence about it: it copies the core's idempotent admission by message id,
 * and `inbox` never shrinks because delivery is not modeled. Use it to observe the adapter's calls (and, with
 * `fail`, that it does not retry). What the core really does is asserted in squad/channel-contract.test.ts.
 */
export const fakeSessionServer = (options: { fail?: boolean } = {}) => {
  const calls: PromptInput[] = []
  const admitted = new Map<string, SessionInbox.User>()

  const layer = Layer.mock(Session.Service, {
    prompt: (input: PromptInput) =>
      Effect.suspend(() => {
        calls.push(input)
        if (options.fail) return Effect.die(new Error("inbox unavailable"))
        const id = input.id ?? SessionMessage.ID.create()
        const existing = admitted.get(id)
        if (existing) return Effect.succeed(existing)
        const item = SessionInbox.User.make({
          id,
          sessionID: input.sessionID,
          time: { created: DateTime.makeUnsafe(0) },
          type: "user",
          payload: { text: input.text },
          delivery: input.delivery ?? "steer",
        })
        admitted.set(id, item)
        return Effect.succeed(item)
      }),
    inbox: (sessionID: PromptInput["sessionID"]) =>
      Effect.succeed([...admitted.values()].filter((item) => item.sessionID === sessionID)),
    revert: {} as Session.Interface["revert"],
  })

  return { layer, calls, admitted }
}
