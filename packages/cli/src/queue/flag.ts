export type ConfigEntryInfo = {
  type: string
  info?: { experimental?: { forgequeue?: { enabled?: boolean } } }
}

export function resolveForgeQueueEnabled(_entries: ReadonlyArray<ConfigEntryInfo>): boolean {
  return false
}
