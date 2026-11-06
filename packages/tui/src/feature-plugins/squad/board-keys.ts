import type { KeymapLayer } from "@opencode/plugin/tui/context"

export type BoardKeyHandlers = {
  down(): void
  up(): void
  left(): void
  right(): void
  open(): void
  close(): void
  refresh(): void
  help(): void
}

export function boardKeys(handlers: BoardKeyHandlers): KeymapLayer {
  return {
    commands: [
      { bind: "j", title: "próximo card", run: handlers.down },
      { bind: "k", title: "card anterior", run: handlers.up },
      { bind: "h", title: "coluna anterior", run: handlers.left },
      { bind: "l", title: "próxima coluna", run: handlers.right },
      { bind: "enter", title: "abrir detalhe", run: handlers.open },
      { bind: "esc", title: "voltar", run: handlers.close },
      { bind: "r", title: "atualizar", run: handlers.refresh },
      { bind: "?", title: "ajuda", run: handlers.help },
    ],
  }
}
