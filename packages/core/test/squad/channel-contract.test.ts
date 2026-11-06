import { describe, expect } from "bun:test"
import { and, eq } from "drizzle-orm"
import { Effect, Layer, LayerMap } from "effect"
import type { FileSystem } from "@opencode/core/filesystem"
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { EventTable } from "@opencode/core/event/sql"
import { Image } from "@opencode/core/image"
import { Location } from "@opencode/core/location"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import type { LocationServices } from "@opencode/core/location-services"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Project } from "@opencode/core/project"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionInbox } from "@opencode/core/session/inbox"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { Skill } from "@opencode/core/skill"
import { Snapshot } from "@opencode/core/snapshot"
import { SquadChannel } from "@opencode/core/squad/channel"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { globalProjectNode } from "../lib/project"
import { testEffect } from "../lib/effect"

// The channel runs against the real core admission and delivery primitives, not against `fakeSessionServer`
// (a fast double). If the core changes how `id` makes admission idempotent or when an item stops being
// pending, this file breaks and the double is what gets corrected.
const locations = makeGlobalNode({
  service: LocationServiceMap.Service,
  layer: Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      return yield* LayerMap.make(
        () =>
          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
          Layer.mergeAll(
            Config.testLayer([]),
            LayerNode.compile(LayerNode.group([PluginHooks.node, Skill.node]), {
              replacements: [Bus.node.replace(Layer.succeed(Bus.Service, bus))],
            }),
            Layer.mock(Image.Service, { normalize: (_resource, content) => Effect.succeed(content) }),
            Layer.mock(Snapshot.Service, { capture: () => Effect.undefined, restore: () => Effect.void }),
            Layer.mock(Plugin.Service, { awaitActivation: Effect.void }),
          ).pipe(Layer.fresh) as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>,
      )
    }),
  ),
  deps: [Bus.node],
})

const core = AppNodeBuilder.build(
  LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
  [
    Bus.node.replace(Bus.configured({ persist: true })),
    Project.node.replace(globalProjectNode),
    LocationServiceMap.node.replace(locations),
  ],
)

const it = testEffect(
  SquadChannel.layer.pipe(Layer.provideMerge(Layer.merge(core, SessionExecution.noopLayer))),
)

const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

const countEvents = (sessionID: Session.ID, type: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const rows = yield* db
      .select({ id: EventTable.id })
      .from(EventTable)
      .where(and(eq(EventTable.aggregate_id, sessionID), eq(EventTable.type, Bus.versionedType(type, 1))))
      .all()
    return rows.length
  })

describe("SquadChannel against the real core inbox", () => {
  it.live("the same idempotency key admits one inbox row, and the first admission wins", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const channel = yield* SquadChannel.Service
      const target = yield* sessions.create({ location })

      const first = yield* channel.enqueue({ sessionID: target.id, text: "first", delivery: "queue", idempotencyKey: "k1" })
      const retry = yield* channel.enqueue({ sessionID: target.id, text: "retried", delivery: "steer", idempotencyKey: "k1" })
      expect(retry.messageID).toBe(first.messageID)

      const pending = yield* channel.pending(target.id)
      expect(pending.map((item) => item.id)).toEqual([first.messageID])
      expect(pending[0]?.delivery).toBe("queue")
      const rows = yield* sessions.inbox(target.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ id: first.messageID, payload: { text: "first" } })
      expect(yield* countEvents(target.id, SessionEvent.InboxEnqueued.type)).toBe(1)

      yield* channel.enqueue({ sessionID: target.id, text: "other", idempotencyKey: "k2" })
      expect(yield* channel.pending(target.id)).toHaveLength(2)
    }),
  )

  it.live("a message stops being pending once the core records session.inbox.delivered", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const channel = yield* SquadChannel.Service
      const { db } = yield* Database.Service
      const bus = yield* Bus.Service
      const target = yield* sessions.create({ location })
      const untouched = yield* sessions.create({ location })

      const sent = yield* channel.enqueue({ sessionID: target.id, text: "go", delivery: "queue", idempotencyKey: "k1" })
      yield* channel.enqueue({ sessionID: untouched.id, text: "wait", delivery: "queue", idempotencyKey: "k1" })
      expect((yield* channel.pending(target.id)).map((item) => item.id)).toEqual([sent.messageID])

      yield* SessionInbox.promote(db, bus, target.id, "input")

      expect(yield* countEvents(target.id, SessionEvent.InboxDelivered.type)).toBe(1)
      expect(yield* channel.pending(target.id)).toEqual([])
      expect(yield* channel.pending(untouched.id)).toHaveLength(1)

      // A retry after delivery is still the first admission: no new row, nothing pending again.
      const retry = yield* channel.enqueue({ sessionID: target.id, text: "go", delivery: "queue", idempotencyKey: "k1" })
      expect(retry.messageID).toBe(sent.messageID)
      expect(yield* channel.pending(target.id)).toEqual([])
    }),
  )
})
