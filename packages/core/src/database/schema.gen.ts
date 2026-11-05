import { Effect } from "effect"
import type { DatabaseMigration } from "./migration.js"

const schema: Omit<DatabaseMigration.Migration, "id"> = {
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE \`account_state\` (
          \`id\` integer PRIMARY KEY,
          \`active_account_id\` text,
          \`active_org_id\` text,
          CONSTRAINT \`fk_account_state_active_account_id_account_id_fk\` FOREIGN KEY (\`active_account_id\`) REFERENCES \`account\`(\`id\`) ON DELETE SET NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`account\` (
          \`id\` text PRIMARY KEY,
          \`email\` text NOT NULL,
          \`url\` text NOT NULL,
          \`access_token\` text NOT NULL,
          \`refresh_token\` text NOT NULL,
          \`token_expiry\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`control_account\` (
          \`email\` text NOT NULL,
          \`url\` text NOT NULL,
          \`access_token\` text NOT NULL,
          \`refresh_token\` text NOT NULL,
          \`token_expiry\` integer,
          \`active\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`control_account_pk\` PRIMARY KEY(\`email\`, \`url\`)
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`credential\` (
          \`id\` text PRIMARY KEY,
          \`integration_id\` text,
          \`label\` text NOT NULL,
          \`value\` text NOT NULL,
          \`connector_id\` text,
          \`method_id\` text,
          \`active\` integer,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`event_sequence\` (
          \`aggregate_id\` text PRIMARY KEY,
          \`seq\` integer NOT NULL,
          \`owner_id\` text
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`event\` (
          \`id\` text PRIMARY KEY,
          \`aggregate_id\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`created\` integer DEFAULT 0 NOT NULL,
          \`type\` text NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_event_aggregate_id_event_sequence_aggregate_id_fk\` FOREIGN KEY (\`aggregate_id\`) REFERENCES \`event_sequence\`(\`aggregate_id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`job\` (
          \`notification_id\` text PRIMARY KEY,
          \`id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`child_session_id\` text,
          \`kind\` text NOT NULL,
          \`title\` text,
          \`status\` text NOT NULL,
          \`output\` text,
          \`error\` text,
          \`recovery\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`kv\` (
          \`key\` text PRIMARY KEY,
          \`value\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`permission\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`action\` text NOT NULL,
          \`resource\` text NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_permission_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`project_directory\` (
          \`project_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`type\` text,
          \`strategy\` text,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`project_directory_pk\` PRIMARY KEY(\`project_id\`, \`directory\`),
          CONSTRAINT \`fk_project_directory_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`project\` (
          \`id\` text PRIMARY KEY,
          \`worktree\` text NOT NULL,
          \`vcs\` text,
          \`name\` text,
          \`icon_url\` text,
          \`icon_url_override\` text,
          \`icon_color\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_initialized\` integer,
          \`time_active\` integer DEFAULT 0 NOT NULL,
          \`time_archived\` integer,
          \`sandboxes\` text NOT NULL,
          \`commands\` text
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`schedule\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text,
          \`name\` text,
          \`action\` text NOT NULL,
          \`check\` text,
          \`when\` text NOT NULL,
          \`tz\` text NOT NULL,
          \`status\` text DEFAULT 'active' NOT NULL,
          \`next_due_at\` integer,
          \`ends_at\` integer,
          \`remaining_runs\` integer,
          \`run_count\` integer DEFAULT 0 NOT NULL,
          \`checks\` integer DEFAULT 0 NOT NULL,
          \`failures\` integer DEFAULT 0 NOT NULL,
          \`last_fired_at\` integer,
          \`last_message_id\` text,
          \`last_outcome\` text,
          \`retry_at\` integer,
          \`state\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`fk_schedule_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`blob_ref\` (
          \`session_id\` text NOT NULL,
          \`message_id\` text NOT NULL,
          \`hash\` text NOT NULL,
          \`seq\` integer NOT NULL,
          CONSTRAINT \`blob_ref_pk\` PRIMARY KEY(\`session_id\`, \`message_id\`, \`hash\`),
          CONSTRAINT \`fk_blob_ref_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_blob_ref_hash_blob_hash_fk\` FOREIGN KEY (\`hash\`) REFERENCES \`blob\`(\`hash\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`blob\` (
          \`hash\` text PRIMARY KEY,
          \`mime\` text NOT NULL,
          \`bytes\` integer NOT NULL,
          \`width\` integer,
          \`height\` integer,
          \`data\` blob NOT NULL,
          \`time_created\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`instruction_blob\` (
          \`hash\` text PRIMARY KEY,
          \`value\` text
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`instruction_entry\` (
          \`session_id\` text NOT NULL,
          \`key\` text NOT NULL,
          \`value\` text,
          \`removed\` integer DEFAULT false NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`instruction_entry_pk\` PRIMARY KEY(\`session_id\`, \`key\`),
          CONSTRAINT \`fk_instruction_entry_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`instruction_state\` (
          \`session_id\` text PRIMARY KEY,
          \`epoch_start\` integer NOT NULL,
          \`through_seq\` integer NOT NULL,
          \`initial_values\` text NOT NULL,
          \`current_values\` text NOT NULL,
          CONSTRAINT \`fk_instruction_state_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_inbox\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`payload\` text NOT NULL,
          \`delivery\` text NOT NULL,
          \`enqueued_seq\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`fk_session_inbox_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_message\` (
          \`id\` text PRIMARY KEY,
          \`session_id\` text NOT NULL,
          \`type\` text NOT NULL,
          \`seq\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`fk_session_message_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_part\` (
          \`message_id\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`ordinal\` integer NOT NULL,
          \`type\` text NOT NULL,
          \`call_id\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`data\` text NOT NULL,
          CONSTRAINT \`session_part_pk\` PRIMARY KEY(\`message_id\`, \`ordinal\`),
          CONSTRAINT \`fk_session_part_message_id_session_message_id_fk\` FOREIGN KEY (\`message_id\`) REFERENCES \`session_message\`(\`id\`) ON DELETE CASCADE,
          CONSTRAINT \`fk_session_part_session_id_session_v2_id_fk\` FOREIGN KEY (\`session_id\`) REFERENCES \`session_v2\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`session_v2\` (
          \`id\` text PRIMARY KEY,
          \`project_id\` text NOT NULL,
          \`workspace_id\` text,
          \`parent_id\` text,
          \`fork_session_id\` text,
          \`fork_boundary\` text,
          \`slug\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`path\` text,
          \`title\` text,
          \`version\` text NOT NULL,
          \`share_url\` text,
          \`summary_additions\` integer,
          \`summary_deletions\` integer,
          \`summary_files\` integer,
          \`summary_diffs\` text,
          \`metadata\` text,
          \`cost\` real DEFAULT 0 NOT NULL,
          \`tokens_input\` integer DEFAULT 0 NOT NULL,
          \`tokens_output\` integer DEFAULT 0 NOT NULL,
          \`tokens_reasoning\` integer DEFAULT 0 NOT NULL,
          \`tokens_cache_read\` integer DEFAULT 0 NOT NULL,
          \`tokens_cache_write\` integer DEFAULT 0 NOT NULL,
          \`revert\` text,
          \`permission\` text,
          \`agent\` text,
          \`model\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          \`time_busy\` integer,
          \`time_idle\` integer,
          \`time_viewed\` integer,
          \`idle_outcome\` text,
          \`time_compacting\` integer,
          \`time_archived\` integer,
          \`time_suspended\` integer,
          \`resume_attempts\` integer DEFAULT 0 NOT NULL,
          CONSTRAINT \`fk_session_v2_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
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
      yield* tx.run(`
        CREATE TABLE \`workspace\` (
          \`id\` text PRIMARY KEY,
          \`provider\` text NOT NULL,
          \`binding\` text,
          \`created_at\` integer NOT NULL,
          \`last_used_at\` integer NOT NULL
        );
      `)
      yield* tx.run(`
        CREATE TABLE \`worktree\` (
          \`project_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`strategy\` text,
          \`time_created\` integer NOT NULL,
          CONSTRAINT \`worktree_pk\` PRIMARY KEY(\`project_id\`, \`directory\`),
          CONSTRAINT \`fk_worktree_project_id_project_id_fk\` FOREIGN KEY (\`project_id\`) REFERENCES \`project\`(\`id\`) ON DELETE CASCADE
        );
      `)
      yield* tx.run(`CREATE UNIQUE INDEX \`event_aggregate_seq_idx\` ON \`event\` (\`aggregate_id\`,\`seq\`);`)
      yield* tx.run(`CREATE INDEX \`event_aggregate_type_seq_idx\` ON \`event\` (\`aggregate_id\`,\`type\`,\`seq\`);`)
      yield* tx.run(`CREATE INDEX \`job_session_idx\` ON \`job\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX \`job_child_session_idx\` ON \`job\` (\`child_session_id\`);`)
      yield* tx.run(`CREATE INDEX \`job_id_idx\` ON \`job\` (\`id\`);`)
      yield* tx.run(
        `CREATE UNIQUE INDEX \`permission_project_action_resource_idx\` ON \`permission\` (\`project_id\`,\`action\`,\`resource\`);`,
      )
      yield* tx.run(`CREATE INDEX \`schedule_session_idx\` ON \`schedule\` (\`session_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`schedule_due_idx\` ON \`schedule\` (\`next_due_at\`) WHERE "schedule"."status" = 'active' and "schedule"."next_due_at" is not null;`,
      )
      yield* tx.run(`CREATE INDEX \`blob_ref_hash_idx\` ON \`blob_ref\` (\`hash\`);`)
      yield* tx.run(`CREATE INDEX \`blob_ref_session_seq_idx\` ON \`blob_ref\` (\`session_id\`,\`seq\`);`)
      yield* tx.run(
        `CREATE INDEX \`session_inbox_session_delivery_seq_idx\` ON \`session_inbox\` (\`session_id\`,\`delivery\`,\`enqueued_seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_inbox_session_enqueued_seq_idx\` ON \`session_inbox\` (\`session_id\`,\`enqueued_seq\`);`,
      )
      yield* tx.run(
        `CREATE UNIQUE INDEX \`session_message_session_seq_idx\` ON \`session_message\` (\`session_id\`,\`seq\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_message_session_type_seq_idx\` ON \`session_message\` (\`session_id\`,\`type\`,\`seq\`);`,
      )
      yield* tx.run(
        `CREATE INDEX \`session_message_session_time_created_id_idx\` ON \`session_message\` (\`session_id\`,\`time_created\`,\`id\`);`,
      )
      yield* tx.run(`CREATE INDEX \`session_message_time_created_idx\` ON \`session_message\` (\`time_created\`);`)
      yield* tx.run(
        `CREATE INDEX \`session_part_session_message_idx\` ON \`session_part\` (\`session_id\`,\`message_id\`,\`ordinal\`);`,
      )
      yield* tx.run(`CREATE INDEX \`session_v2_project_idx\` ON \`session_v2\` (\`project_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_v2_workspace_idx\` ON \`session_v2\` (\`workspace_id\`);`)
      yield* tx.run(`CREATE INDEX \`session_v2_parent_idx\` ON \`session_v2\` (\`parent_id\`);`)
      yield* tx.run(
        `CREATE INDEX \`session_v2_time_suspended_idx\` ON \`session_v2\` (\`time_suspended\`) WHERE "session_v2"."time_suspended" is not null;`,
      )
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

export default schema
