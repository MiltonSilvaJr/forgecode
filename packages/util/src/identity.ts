/**
 * Product identity for this fork.
 *
 * `forgecode` is the native name. The `opencode` spellings stay readable so an
 * existing install keeps working after the rebrand: config discovery, global
 * paths, environment variables, and the desktop app id all fall back to them.
 */

export const APP = "forgecode"

/** Reverse-DNS identity used by platform integrations (MDM, desktop bundles). */
export const SYSTEM_ID = "ai.forgecode"
export const LEGACY_SYSTEM_ID = "ai.opencode"

/**
 * Reads the ForgeCode spelling first and the legacy OpenCode spelling second.
 * New settings belong to `FORGECODE_*`; `OPENCODE_*` is accepted for
 * compatibility and never overrides it.
 */
export function env(name: string) {
  return process.env[`FORGECODE_${name}`] ?? process.env[`OPENCODE_${name}`]
}

/**
 * Projects every `FORGECODE_*` value onto its legacy `OPENCODE_*` spelling.
 *
 * Call once at process start, before anything reads the environment. It keeps
 * the many existing `OPENCODE_*` reads working while `FORGECODE_*` becomes the
 * documented, native name; the new spelling wins when both are set.
 */
export function installEnvAliases() {
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || !key.startsWith("FORGECODE_")) continue
    process.env[`OPENCODE_${key.slice("FORGECODE_".length)}`] = value
  }
}
