import { DateTime, Effect, Layer } from "effect"
import { Session } from "@opencode/core/session"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { SessionMessage } from "@opencode/schema/session-message"

type PromptInput = Parameters<Session.Interface["prompt"]>[0]

/**
 * Fake inbox server: admission is idempotent by message id, as in the real core, and `fail` makes
 * every admission fail so a test can observe that the adapter does not retry.
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
