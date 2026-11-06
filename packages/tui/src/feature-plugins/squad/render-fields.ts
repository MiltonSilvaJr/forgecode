import type { SquadPanelDocument, SquadSessionStatus, SquadStage } from "@opencode/client"

export function renderSessionLine(status: SquadSessionStatus): string {
  return JSON.stringify(status)
}

export function renderStageLine(key: string, stage: SquadStage, exigido: boolean): string {
  return JSON.stringify({ key, stage, exigido })
}

export function formatInstant(ms: number): string {
  return new Date(ms).toISOString()
}

export function formatAge(atualizadoEm: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - atualizadoEm) / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h`
}

export function freshnessLabel(document: SquadPanelDocument, now: number): string {
  return `revisão ${document.revisao} · ${formatAge(document.atualizadoEm, now)} · às ${formatInstant(document.atualizadoEm)}`
}
