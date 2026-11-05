export type ConfigEntryInfo = {
  type: string
  info?: { experimental?: { forgequeue?: { enabled?: boolean } } }
}

/** Resolve the effective `experimental.forgequeue.enabled` across config documents, lowest to highest priority. */
export function resolveForgeQueueEnabled(entries: ReadonlyArray<ConfigEntryInfo>): boolean {
  let enabled = false
  for (const entry of entries) {
    if (entry.type !== "document") continue
    const forgequeue = entry.info?.experimental?.forgequeue
    if (forgequeue?.enabled !== undefined) enabled = forgequeue.enabled
  }
  return enabled
}
