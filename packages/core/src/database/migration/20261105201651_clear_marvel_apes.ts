import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20261105201651_clear_marvel_apes",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`squad_audit\` (
          \`id\` integer PRIMARY KEY AUTOINCREMENT,
          \`at\` integer NOT NULL,
          \`kind\` text NOT NULL,
          \`generation_id\` text,
          \`target\` text NOT NULL,
          \`session_id\` text,
          \`message_id\` text,
          \`message_sha256\` text,
          \`delivery\` text,
          \`result\` text NOT NULL,
          \`idempotency_key\` text,
          \`actor\` text NOT NULL,
          \`prev_hash\` text NOT NULL,
          \`detail\` text
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`squad_block\` (
          \`generation_id\` text NOT NULL,
          \`name\` text NOT NULL,
          \`waiting_on\` text NOT NULL,
          \`reason\` text NOT NULL,
          \`author\` text NOT NULL,
          \`created_at\` integer NOT NULL,
          \`cleared_at\` integer,
          CONSTRAINT \`squad_block_pk\` PRIMARY KEY(\`generation_id\`, \`name\`)
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`squad_checkpoint\` (
          \`generation_id\` text NOT NULL,
          \`name\` text NOT NULL,
          \`sha256\` text NOT NULL,
          \`body\` text NOT NULL,
          \`bytes\` integer NOT NULL,
          \`created_at\` integer NOT NULL,
          CONSTRAINT \`squad_checkpoint_pk\` PRIMARY KEY(\`generation_id\`, \`name\`, \`sha256\`)
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`squad_dispatch\` (
          \`id\` text PRIMARY KEY,
          \`generation_id\` text NOT NULL,
          \`orq_id\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`scope\` text NOT NULL,
          \`owner\` text NOT NULL,
          \`base\` text NOT NULL,
          \`head\` text NOT NULL,
          \`base_oid\` text,
          \`head_oid\` text,
          \`validation\` text NOT NULL,
          \`dor\` text NOT NULL,
          \`dod\` text NOT NULL,
          \`proof\` text NOT NULL,
          \`exclusions\` text NOT NULL,
          \`exigidos\` text DEFAULT '["ci","merge","acceptance"]' NOT NULL,
          \`milestone\` text NOT NULL,
          \`state\` text DEFAULT 'open' NOT NULL,
          \`accepted_at\` integer,
          \`accepted_by\` text,
          \`created_at\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`squad_generation\` (
          \`id\` text PRIMARY KEY,
          \`run_id\` text NOT NULL UNIQUE,
          \`state\` text NOT NULL,
          \`config_digest\` text,
          \`source_generation_id\` text,
          \`closed_by\` text,
          \`created_at\` integer NOT NULL,
          \`closed_at\` integer
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`squad_idempotency\` (
          \`key\` text PRIMARY KEY,
          \`generation_id\` text NOT NULL,
          \`kind\` text NOT NULL,
          \`result_ref\` text NOT NULL,
          \`created_at\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`squad_session\` (
          \`generation_id\` text NOT NULL,
          \`name\` text NOT NULL,
          \`role\` text NOT NULL,
          \`provider\` text NOT NULL,
          \`model\` text NOT NULL,
          \`variant\` text,
          \`location\` text NOT NULL,
          \`branch\` text,
          \`session_id\` text,
          \`adopted_at\` integer,
          \`state\` text NOT NULL,
          \`marker\` text,
          \`prompt_sha256\` text,
          \`checkpoint_sha256\` text,
          \`productive\` integer DEFAULT false NOT NULL,
          \`last_error\` text,
          \`created_at\` integer NOT NULL,
          \`updated_at\` integer NOT NULL,
          CONSTRAINT \`squad_session_pk\` PRIMARY KEY(\`generation_id\`, \`name\`)
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`squad_transition_entry\` (
          \`source_generation_id\` text NOT NULL,
          \`name\` text NOT NULL,
          \`session_id\` text,
          \`checkpoint_sha256\` text,
          \`closed_at\` integer,
          CONSTRAINT \`squad_transition_entry_pk\` PRIMARY KEY(\`source_generation_id\`, \`name\`)
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`squad_transition\` (
          \`source_generation_id\` text PRIMARY KEY,
          \`target_generation_id\` text,
          \`source_registry_digest\` text NOT NULL,
          \`previous_sessions_closed\` integer NOT NULL,
          \`previous_orchestrator_kept_open\` integer NOT NULL,
          \`closed_by\` text,
          \`created_at\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`squad_tree_owner\` (
          \`id\` text PRIMARY KEY,
          \`tree_key\` text NOT NULL,
          \`tree_scope\` text NOT NULL,
          \`generation_id\` text NOT NULL,
          \`owner_name\` text NOT NULL,
          \`acquired_via\` text NOT NULL,
          \`since\` integer NOT NULL,
          \`released_at\` integer
        );
      `)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`squad_dispatch_orq_idx\` ON \`squad_dispatch\` (\`generation_id\`,\`orq_id\`);`,
      )
      yield* tx.run(`CREATE UNIQUE INDEX \`squad_dispatch_seq_idx\` ON \`squad_dispatch\` (\`generation_id\`,\`seq\`);`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`squad_generation_active_idx\` ON \`squad_generation\` (\`state\`) WHERE "squad_generation"."state" = 'active';`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`squad_session_session_id_idx\` ON \`squad_session\` (\`generation_id\`,\`session_id\`) WHERE "squad_session"."session_id" is not null;`,
      )
      yield* tx.run(`CREATE INDEX \`squad_session_generation_idx\` ON \`squad_session\` (\`generation_id\`);`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`squad_tree_owner_active_idx\` ON \`squad_tree_owner\` (\`tree_key\`) WHERE "squad_tree_owner"."released_at" is null;`,
      )
    })
  },
}

export default migration
