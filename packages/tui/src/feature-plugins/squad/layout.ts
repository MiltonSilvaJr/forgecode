export type LayoutMode = "columns" | "stacked" | "minimal"

export function mode(_width: number): LayoutMode {
  return "stacked"
}
