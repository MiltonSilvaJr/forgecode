# CLI and TUI development guide

- Use `@opencode/client` and the location-scoped data in `packages/tui/src/context/data.tsx`.
- Preserve established TUI behavior unless the task intentionally changes it.

## ForgeQueue — per-session queue commands

The `forgecode queue` command (invoked as `opencode queue`, since this fork keeps the upstream
binary name) admits a message to one session's durable inbox. There is no global message bus:
the queue is per session, and the command's confirmation proves only that the message was
enqueued — never that it was read, delivered, or processed.

### Enqueue

Writes require a feature flag and an idempotency key:

```
experimental.forgequeue.enabled: true   # in opencode.json
```

```
forgecode queue --thread <session-id> --message "dispatch" --idempotency-key dispatch-42
forgecode queue --to <session-name> --message "dispatch" --idempotency-key dispatch-42
forgecode queue --all --message-file ./dispatch.md --idempotency-key dispatch-42
```

- `--idempotency-key` is **required** on every write (`--thread`, `--to`, `--all`). It must match
  `^[A-Za-z0-9._-]{1,80}$` and derives the message id `msg_fq_<key>`, so a retry with the same key
  never creates a second item.
- `--delivery queue|steer` (default `queue`). `queue` is promoted at the idle boundary, `steer` at
  the next step boundary.
- `--to` resolves by exact title among non-archived top-level sessions only — the "current
  generation". A name that is absent, ambiguous, or belongs to an archived (previous-generation)
  session fails without enqueueing. `--thread` is the canonical, generation-independent path.
- `--all` broadcasts to every non-archived top-level session except the calling session (add
  `--allow-self` to include it), validates every recipient before the first admission, and reports
  `queued`/`failed` per recipient.
- Enqueueing to the calling session (`OPENCODE_SESSION_ID`) is refused unless `--allow-self` is set.

### Read commands (available with the flag disabled)

```
forgecode queue list --thread <session-id> [--limit 100] [--json]
forgecode queue activity --thread <session-id> [--watch] [--timeout 60000] [--json]
forgecode sessions [--all] [--json]
```

### Exit codes

- `0` success.
- `1` operational failure: server unreachable, session not found, ambiguous or previous-generation
  name, flag disabled, admission failure, `--watch` timeout.
- `2` usage error: invalid flag, mutually exclusive modes, missing or invalid `--idempotency-key`,
  missing destination.

### Audit trail

Every enqueue attempt appends one metadata-only line to `forgequeue/audit.jsonl` under
`Global.Path.data` (`0600`). The message text is never written there; the durable source of the
content is the session inbox. The trail is local to the host, so enqueues made by another client do
not appear — `queue list` joins the live inbox to stay useful despite that limit.
