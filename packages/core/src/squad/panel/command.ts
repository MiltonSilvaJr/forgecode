import { execFile } from "node:child_process"
import path from "node:path"
import { Effect } from "effect"

export type Outcome = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string }

const timeoutMs = 10_000

// Commands run without a shell, so these could only be meant as redirection, chaining or interpolation.
const shellSyntax = /[|&;<>$`\\(){}*?!#~"']/u

const writers = new Set([
  "rm", "rmdir", "mv", "cp", "tee", "dd", "touch", "mkdir", "chmod", "chown", "ln", "truncate", "install",
  "sh", "bash", "zsh", "fish", "dash", "env", "xargs", "sudo", "eval", "exec", "sed", "awk", "perl", "python", "python3", "node", "bun",
])

const gitReaders = new Set(["log", "show", "rev-parse", "rev-list", "merge-base", "ls-remote", "diff", "status", "describe", "cat-file"])
const ghReaders = new Set(["view", "list", "status", "checks"])
const ghWriteFlags = new Set(["-X", "--method", "-f", "-F", "--field", "--raw-field", "--input"])

/** Why a configured adapter command may not run, or undefined when it is read-only as far as its argv can tell. */
export const refusal = (argv: readonly string[]) => {
  const executable = path.basename(argv[0] ?? "")
  if (executable === "") return "refused: empty command"
  if (argv.some((part) => shellSyntax.test(part))) return "refused: shell syntax is not allowed"
  if (writers.has(executable)) return "refused: command can write"
  if (executable === "git" && !gitReaders.has(argv[1] ?? "")) return "refused: git subcommand is not read-only"
  if (executable === "gh") {
    const [group, verb] = [argv[1] ?? "", argv[2] ?? ""]
    if (group === "api" && argv.slice(2).some((part) => ghWriteFlags.has(part))) return "refused: gh api would write"
    if (group !== "api" && !ghReaders.has(verb)) return "refused: gh subcommand is not read-only"
  }
  return undefined
}

/**
 * Runs a read-only adapter command: no shell, a timeout and a bounded output. Failures carry a fixed
 * reason, never the command's stdout, stderr or path, which may hold secrets or the operator's layout.
 */
export const run = (command: string, args: readonly string[]) =>
  Effect.promise(
    () =>
      new Promise<Outcome>((resolve) => {
        const argv = command.trim().split(/\s+/u)
        const refused = refusal(argv)
        if (refused) return resolve({ ok: false, reason: refused })
        execFile(
          argv[0]!,
          [...argv.slice(1), ...args],
          { timeout: timeoutMs, maxBuffer: 1_048_576, windowsHide: true, encoding: "utf8" },
          (error, stdout) => {
            if (error) {
              const code = (error as { code?: unknown; killed?: boolean }).code
              if (code === "ENOENT") return resolve({ ok: false, reason: "command not found" })
              if ((error as { killed?: boolean }).killed) return resolve({ ok: false, reason: "command timed out" })
              return resolve({ ok: false, reason: "command failed" })
            }
            return resolve(parse(stdout))
          },
        )
      }),
  )

export const parse = (text: string): Outcome => {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, reason: "output is not JSON" }
  }
}
