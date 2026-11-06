export type LayoutMode = "columns" | "stacked" | "minimal"

export function mode(width: number): LayoutMode {
  if (width >= 120) return "columns"
  if (width >= 80) return "stacked"
  return "minimal"
}

/** First index of the mounting window that keeps `selected` reachable (NFR-01). */
export function windowStart(length: number, selected: number, size: number): number {
  if (length <= size) return 0
  return Math.max(0, Math.min(selected, length - size))
}
