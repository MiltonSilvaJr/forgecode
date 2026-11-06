import type { SquadPanelDocument, SquadSessionStatus, SquadStage } from "@opencode/client"

export function renderSessionLine(status: SquadSessionStatus): string {
  const liveness = status.liveness
  const parts = [
    `${status.name} · ${status.role} · ${status.state}`,
    `${status.provider}/${status.model}${status.variant ? `/${status.variant}` : ""}`,
    `veredito: ${liveness.verdict}`,
    `medido em ${formatInstant(liveness.measuredAt)}`,
  ]
  if (liveness.lastActivity !== undefined) parts.push(`última atividade em ${formatInstant(liveness.lastActivity)}`)
  if (liveness.source !== undefined) parts.push(`origem: ${liveness.source}`)
  if (liveness.workingStale) parts.push("workingStale")
  if (liveness.presumedDead) parts.push("presumedDead")
  if (liveness.cause !== undefined) parts.push(`causa: ${liveness.cause}`)
  if (status.branch !== undefined) parts.push(`branch: ${status.branch}`)
  if (status.inboxPending > 0) parts.push(`inbox: ${status.inboxPending}`)
  return parts.join(" · ")
}

export function renderStageLine(key: string, stage: SquadStage, exigido: boolean): string {
  const parts = [
    `${key}: ${stage.status}`,
    exigido ? "exigido" : "não exigido",
    `origem: ${stage.source}`,
  ]
  if (stage.evidence) {
    parts.push(`evidência ${stage.evidence.type}: ${stage.evidence.reference}`)
    if (stage.evidence.at !== undefined) parts.push(`em ${formatInstant(stage.evidence.at)}`)
  } else {
    parts.push("sem evidência")
  }
  return parts.join(" · ")
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
