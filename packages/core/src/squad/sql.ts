import { sql } from "drizzle-orm"
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

export const SquadGenerationTable = sqliteTable(
  "squad_generation",
  {
    id: text().primaryKey(),
    run_id: text().notNull().unique(),
    state: text().$type<"active" | "closed">().notNull(),
    config_digest: text(),
    source_generation_id: text(),
    closed_by: text(),
    created_at: integer().notNull(),
    closed_at: integer(),
  },
  (table) => [
    uniqueIndex("squad_generation_active_idx")
      .on(table.state)
      .where(sql`${table.state} = 'active'`),
  ],
)

export const SquadSessionTable = sqliteTable(
  "squad_session",
  {
    generation_id: text().notNull(),
    name: text().notNull(),
    role: text().$type<"orchestrator" | "worker">().notNull(),
    provider: text().notNull(),
    model: text().notNull(),
    variant: text(),
    location: text({ mode: "json" }).$type<{ directory: string; workspaceID?: string }>().notNull(),
    branch: text(),
    session_id: text(),
    adopted_at: integer(),
    state: text().$type<"creating" | "starting" | "verified" | "closed" | "failed">().notNull(),
    marker: text(),
    prompt_sha256: text(),
    checkpoint_sha256: text(),
    productive: integer({ mode: "boolean" }).notNull().default(false),
    last_error: text(),
    created_at: integer().notNull(),
    updated_at: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.generation_id, table.name] }),
    uniqueIndex("squad_session_session_id_idx")
      .on(table.generation_id, table.session_id)
      .where(sql`${table.session_id} is not null`),
    index("squad_session_generation_idx").on(table.generation_id),
  ],
)

export const SquadTreeOwnerTable = sqliteTable(
  "squad_tree_owner",
  {
    id: text().primaryKey(),
    tree_key: text().notNull(),
    tree_scope: text().$type<"worktree" | "repository">().notNull(),
    generation_id: text().notNull(),
    owner_name: text().notNull(),
    acquired_via: text().$type<"launch" | "dispatch">().notNull(),
    since: integer().notNull(),
    released_at: integer(),
  },
  (table) => [
    uniqueIndex("squad_tree_owner_active_idx")
      .on(table.tree_key)
      .where(sql`${table.released_at} is null`),
  ],
)

export const SquadCheckpointTable = sqliteTable(
  "squad_checkpoint",
  {
    generation_id: text().notNull(),
    name: text().notNull(),
    sha256: text().notNull(),
    body: text().notNull(),
    bytes: integer().notNull(),
    created_at: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.generation_id, table.name, table.sha256] })],
)

export const SquadTransitionTable = sqliteTable("squad_transition", {
  source_generation_id: text().primaryKey(),
  target_generation_id: text(),
  source_registry_digest: text().notNull(),
  previous_sessions_closed: integer({ mode: "boolean" }).notNull(),
  previous_orchestrator_kept_open: integer({ mode: "boolean" }).notNull(),
  closed_by: text(),
  created_at: integer().notNull(),
})

export const SquadTransitionEntryTable = sqliteTable(
  "squad_transition_entry",
  {
    source_generation_id: text().notNull(),
    name: text().notNull(),
    session_id: text(),
    checkpoint_sha256: text(),
    closed_at: integer(),
  },
  (table) => [primaryKey({ columns: [table.source_generation_id, table.name] })],
)

export const SquadDispatchTable = sqliteTable(
  "squad_dispatch",
  {
    id: text().primaryKey(),
    generation_id: text().notNull(),
    orq_id: text().notNull(),
    seq: integer().notNull(),
    scope: text().notNull(),
    owner: text().notNull(),
    base: text().notNull(),
    head: text().notNull(),
    base_oid: text(),
    head_oid: text(),
    validation: text().$type<"verified" | "unknown" | "failed">().notNull(),
    dor: text().notNull(),
    dod: text().notNull(),
    proof: text().notNull(),
    exclusions: text({ mode: "json" }).$type<string[]>().notNull(),
    exigidos: text({ mode: "json" }).$type<string[]>().notNull().default(["ci", "merge", "acceptance"]),
    milestone: text().notNull(),
    state: text().$type<"open" | "accepted" | "done" | "blocked">().notNull().default("open"),
    accepted_at: integer(),
    accepted_by: text(),
    created_at: integer().notNull(),
  },
  (table) => [
    uniqueIndex("squad_dispatch_orq_idx").on(table.generation_id, table.orq_id),
    uniqueIndex("squad_dispatch_seq_idx").on(table.generation_id, table.seq),
  ],
)

export const SquadAuditTable = sqliteTable("squad_audit", {
  id: integer().primaryKey({ autoIncrement: true }),
  at: integer().notNull(),
  kind: text().notNull(),
  generation_id: text(),
  target: text().notNull(),
  session_id: text(),
  message_id: text(),
  message_sha256: text(),
  delivery: text().$type<"steer" | "queue">(),
  result: text().notNull(),
  idempotency_key: text(),
  actor: text().notNull(),
  prev_hash: text().notNull(),
  detail: text(),
})

export const SquadIdempotencyTable = sqliteTable("squad_idempotency", {
  key: text().primaryKey(),
  generation_id: text().notNull(),
  kind: text().notNull(),
  result_ref: text().notNull(),
  created_at: integer().notNull(),
})

export const SquadBlockTable = sqliteTable(
  "squad_block",
  {
    generation_id: text().notNull(),
    name: text().notNull(),
    waiting_on: text().$type<"human" | "tool">().notNull(),
    reason: text().notNull(),
    author: text().notNull(),
    created_at: integer().notNull(),
    cleared_at: integer(),
  },
  (table) => [primaryKey({ columns: [table.generation_id, table.name] })],
)
