import { Argument, Flag, GlobalFlag } from "effect/cli"
import { Schema } from "effect"
import { CliFlag } from "../framework/flag"
import { Spec } from "../framework/spec"
import { Updater } from "../services/updater"

export const PrintLogs = GlobalFlag.Setting("print-logs")({
  flag: Flag.Boolean("print-logs").pipe(
    Flag.withDescription("Print logs to stderr (server logs require --standalone)"),
    Flag.withDefault(false),
  ),
})

export const Standalone = GlobalFlag.Setting("standalone")({
  flag: Flag.Boolean("standalone").pipe(
    Flag.withDescription("Run with a private server instead of the background service"),
    Flag.withDefault(false),
  ),
})

export const Server = GlobalFlag.Setting("server")({
  flag: Flag.String("server").pipe(
    Flag.withDescription("Connect to a server URL instead of the background service"),
    Flag.optional,
  ),
})

const ServerFlags = [Standalone, Server] as const

declare const OPENCODE_CLI_NAME: string | undefined

const ServerParams = {
  standalone: Standalone.flag,
  server: Server.flag,
}

const PermissionParams = {
  auto: Flag.Boolean("auto").pipe(
    Flag.withDescription("Auto-approve permissions that are not explicitly denied"),
    Flag.withDefault(false),
  ),
  yolo: Flag.Boolean("yolo").pipe(Flag.withDefault(false), Flag.withHidden),
  dangerouslySkipPermissions: Flag.Boolean("dangerously-skip-permissions").pipe(
    Flag.withDefault(false),
    Flag.withHidden,
  ),
}

const Root = Spec.make(typeof OPENCODE_CLI_NAME === "string" ? OPENCODE_CLI_NAME : "opencode", {
  description: "OpenCode command line interface",
  params: {
    ...ServerParams,
    ...PermissionParams,
    directory: Argument.String("directory").pipe(
      Argument.withDescription("Directory to start OpenCode in"),
      Argument.optional,
    ),
    continue: Flag.Boolean("continue").pipe(
      Flag.withAlias("c"),
      Flag.withDescription("Continue the last session"),
      Flag.withDefault(false),
    ),
    session: Flag.String("session").pipe(
      Flag.withAlias("s"),
      Flag.withDescription("Session ID to continue, or to create if it does not exist"),
      Flag.optional,
    ),
    prompt: Flag.String("prompt").pipe(Flag.withDescription("Prompt to use"), Flag.optional),
  },
  commands: [
    Spec.make("upgrade", {
      description: "Upgrade OpenCode to the latest or a specific version",
      aliases: ["update"],
      params: {
        target: Argument.String("target").pipe(
          Argument.withDescription("Version to upgrade to (with or without a leading v)"),
          Argument.optional,
        ),
        method: Flag.Literals("method", Updater.methods).pipe(
          Flag.withAlias("m"),
          Flag.withDescription("Installation method to use"),
          Flag.optional,
        ),
      },
    }),
    Spec.make("uninstall", {
      description: "Uninstall OpenCode, keeping session data, configuration, and state",
      params: {
        dryRun: Flag.Boolean("dry-run").pipe(
          Flag.withDescription("Show what would be removed without removing"),
          Flag.withDefault(false),
        ),
        force: Flag.Boolean("force").pipe(
          Flag.withAlias("f"),
          Flag.withDescription("Skip confirmation prompts"),
          Flag.withDefault(false),
        ),
      },
    }),
    Spec.make("acp", {
      description: "Start an Agent Client Protocol server",
      params: {
        login: Flag.Boolean("login").pipe(
          Flag.withDescription("Run auth login instead of starting the server"),
          Flag.withDefault(false),
        ),
      },
    }),
    Spec.make("api", {
      description: "Make a request to the running server",
      globalFlags: ServerFlags,
      params: {
        request: Argument.String("operation | method path").pipe(
          Argument.withDescription("OpenAPI operation ID, or an HTTP method followed by a path"),
          Argument.variadic({ min: 1, max: 2 }),
        ),
        data: Flag.String("data").pipe(Flag.withAlias("d"), Flag.withDescription("Request body"), Flag.optional),
        header: Flag.String("header").pipe(
          Flag.withAlias("H"),
          Flag.withDescription("Request header in name:value form"),
          Flag.atMost(100),
        ),
        param: Flag.KeyValuePair("param").pipe(Flag.withDescription("OpenAPI path or query parameter"), Flag.optional),
      },
    }),
    Spec.make("debug", {
      description: "Debugging and troubleshooting tools",
      commands: [
        Spec.make("agents", { description: "List all agents", globalFlags: ServerFlags }),
        Spec.make("config", { description: "List configuration sources", globalFlags: ServerFlags }),
        Spec.make("heap-dump", {
          description: "Write a heap snapshot of the running server and print its path",
          globalFlags: [Server],
          params: {
            directory: Flag.String("directory").pipe(
              Flag.withDescription("Directory to write the snapshot into instead of the server's log directory"),
              Flag.optional,
            ),
          },
        }),
        Spec.make("paths", {
          description: "Show global paths (data, config, cache, state)",
          params: {
            name: Argument.Literals("name", [
              "db",
              "home",
              "data",
              "config",
              "cache",
              "state",
              "tmp",
              "bin",
              "log",
              "repos",
            ]).pipe(
              Argument.withDescription(
                "Print only one path: db, home, data, config, cache, state, tmp, bin, log, repos",
              ),
              Argument.optional,
            ),
          },
        }),
      ],
    }),
    Spec.make("auth", {
      description: "manage integrations and credentials",
      globalFlags: ServerFlags,
      commands: [
        Spec.make("list", {
          description: "list integrations and credentials",
          params: {
            format: Flag.Literals("format", ["default", "json"]).pipe(
              Flag.withDescription("Output format"),
              Flag.withDefault("default"),
            ),
          },
        }),
        Spec.make("status", {
          description: "show subscription authentication status",
          params: {
            json: Flag.Boolean("json").pipe(
              Flag.withDescription("Output status as JSON"),
              Flag.withDefault(false),
            ),
            provider: Flag.String("provider").pipe(
              Flag.withDescription("Filter to one provider: claude-code, codex-chatgpt, kimi-code"),
              Flag.optional,
            ),
          },
        }),
        Spec.make("refresh", {
          description: "refresh a subscription credential or session",
          params: {
            target: Argument.String("target").pipe(
              Argument.withDescription("Subscription provider ID: claude-code, codex-chatgpt, kimi-code"),
            ),
          },
        }),
        Spec.make("test", {
          description: "test a subscription provider with one minimal request",
          params: {
            target: Argument.String("target").pipe(
              Argument.withDescription("Subscription provider ID: claude-code, codex-chatgpt, kimi-code"),
            ),
            model: Flag.String("model").pipe(
              Flag.withDescription("Model ID to test"),
              Flag.optional,
            ),
            json: Flag.Boolean("json").pipe(
              Flag.withDescription("Output result as JSON"),
              Flag.withDefault(false),
            ),
          },
        }),
        Spec.make("login", {
          description: "connect an integration",
          params: {
            target: Argument.String("target").pipe(
              Argument.withDescription("Integration ID, name, or well-known provider URL"),
              Argument.optional,
            ),
            method: Flag.String("method").pipe(Flag.withDescription("Authentication method ID"), Flag.optional),
            answer: Flag.String("answer").pipe(
              Flag.withDescription("Provider form answer (key=value; repeat for multiple fields)"),
              Flag.atMost(100),
            ),
            source: Flag.Literals("source", ["managed", "native"]).pipe(
              Flag.withDescription("Subscription source: managed or native"),
              Flag.optional,
            ),
            acceptTos: Flag.Boolean("accept-tos").pipe(
              Flag.withDescription("Accept the subscription terms of use"),
              Flag.withDefault(false),
            ),
          },
        }),
        Spec.make("logout", {
          description: "log out of a saved account or subscription session",
          params: {
            target: Argument.String("target").pipe(
              Argument.withDescription("Integration ID or name"),
              Argument.optional,
            ),
            credential: Argument.String("credential").pipe(
              Argument.withDescription("Credential ID or label (opens an account picker when omitted)"),
              Argument.optional,
            ),
          },
        }),
        Spec.make("export", {
          description: "print stored credentials, including secrets, as JSON",
          params: {
            target: Argument.String("target").pipe(
              Argument.withDescription("Integration ID or name (exports every integration when omitted)"),
              Argument.optional,
            ),
          },
        }),
        Spec.make("import", {
          description: "import credentials exported by auth export",
          params: {
            file: Argument.String("file").pipe(
              Argument.withDescription("JSON file to import (reads stdin when omitted)"),
              Argument.optional,
            ),
          },
        }),
        Spec.make("switch", {
          description: "switch the active account for an integration",
          params: {
            target: Argument.String("target").pipe(
              Argument.withDescription("Integration ID or name"),
              Argument.optional,
            ),
            credential: Argument.String("credential").pipe(
              Argument.withDescription("Credential ID or label (opens an account picker when omitted)"),
              Argument.optional,
            ),
          },
        }),
      ],
    }),
    Spec.make("mcp", {
      description: "Manage MCP (Model Context Protocol) servers",
      commands: [
        Spec.make("list", {
          description: "List configured MCP servers and their status",
          globalFlags: ServerFlags,
        }),
        Spec.make("add", {
          description: "Add an MCP server to your configuration",
          params: {
            name: Argument.String("name").pipe(Argument.withDescription("Name of the MCP server")),
            command: Argument.String("command").pipe(
              Argument.withDescription("Command and arguments for a local server, passed after --"),
              Argument.variadic({ min: 0 }),
            ),
            url: Flag.String("url").pipe(Flag.withDescription("URL for a remote MCP server"), Flag.optional),
            header: Flag.KeyValuePair("header").pipe(
              Flag.withDescription("HTTP header for a remote server, as name=value"),
              Flag.optional,
            ),
            env: Flag.KeyValuePair("env").pipe(
              Flag.withDescription("Environment variable for a local server, as name=value"),
              Flag.optional,
            ),
            global: Flag.Boolean("global").pipe(
              Flag.withDescription("Write to the global config instead of the project config"),
              Flag.withDefault(false),
            ),
          },
        }),
        Spec.make("auth", {
          description: "Authenticate with an OAuth-capable remote MCP server",
          globalFlags: ServerFlags,
          params: {
            name: Argument.String("name").pipe(Argument.withDescription("Name of the MCP server"), Argument.optional),
          },
        }),
        Spec.make("logout", {
          description: "Remove stored OAuth credentials for an MCP server",
          globalFlags: ServerFlags,
          params: { name: Argument.String("name").pipe(Argument.withDescription("Name of the MCP server")) },
        }),
      ],
    }),
    Spec.make("plugin", {
      description: "Manage plugins",
      commands: [
        Spec.make("list", {
          description: "List plugins",
          globalFlags: ServerFlags,
          params: {
            builtin: Flag.Boolean("builtin").pipe(
              Flag.withDescription("Include built-in server plugins"),
              Flag.withDefault(false),
            ),
          },
        }),
        Spec.make("add", {
          description: "Install a plugin and add it to the global configuration",
          params: {
            package: Argument.String("package").pipe(Argument.withDescription("npm registry or Git package specifier")),
          },
        }),
        Spec.make("check", {
          description: "Check package plugins for updates",
          globalFlags: ServerFlags,
          params: {
            target: Argument.String("target").pipe(
              Argument.withDescription("Configured package target"),
              Argument.optional,
            ),
          },
        }),
        Spec.make("update", {
          description: "Update package plugins",
          globalFlags: ServerFlags,
          params: {
            target: Argument.String("target").pipe(
              Argument.withDescription("Configured package target; omit to update all outdated plugins"),
              Argument.optional,
            ),
          },
        }),
        Spec.make("remove", {
          description: "Remove a plugin from global configuration",
          params: {
            package: Argument.String("package").pipe(Argument.withDescription("configured package specifier")),
          },
        }),
      ],
    }),
    Spec.make("models", {
      description: "List all available models",
      globalFlags: ServerFlags,
    }),
    Spec.make("stats", {
      description: "Show shareable usage statistics",
      globalFlags: ServerFlags,
      params: {
        days: Flag.Int("days").pipe(
          Flag.withSchema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
          Flag.withDescription("Show the last N days; 0 means today"),
          Flag.optional,
        ),
        year: Flag.Int("year").pipe(
          Flag.withSchema(Schema.Int.check(Schema.isBetween({ minimum: 1970, maximum: 9_999 }))),
          Flag.withDescription("Show a calendar year"),
          Flag.optional,
        ),
        all: Flag.Boolean("all").pipe(Flag.withDescription("Show lifetime statistics"), Flag.withDefault(false)),
        project: Flag.String("project").pipe(
          Flag.withDescription('Filter by project ID, or use "." for the current project'),
          Flag.optional,
        ),
        models: Flag.Boolean("models").pipe(Flag.withDescription("Show model usage"), Flag.withDefault(false)),
        tools: Flag.Boolean("tools").pipe(Flag.withDescription("Show tool reliability"), Flag.withDefault(false)),
        cost: Flag.Boolean("cost").pipe(Flag.withDescription("Show cost and token details"), Flag.withDefault(false)),
        full: Flag.Boolean("full").pipe(Flag.withDescription("Show every detailed section"), Flag.withDefault(false)),
        limit: Flag.Int("limit").pipe(
          Flag.withSchema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
          Flag.withDescription("Number of rows in detailed sections"),
          Flag.withDefault(5),
        ),
        json: Flag.Boolean("json").pipe(Flag.withDescription("Output statistics as JSON"), Flag.withDefault(false)),
      },
    }),
    Spec.make("mini", {
      description: "Start the minimal interactive interface",
      globalFlags: ServerFlags,
      params: {
        continue: Flag.Boolean("continue").pipe(
          Flag.withAlias("c"),
          Flag.withDescription("Continue the last session"),
          Flag.withDefault(false),
        ),
        session: Flag.String("session").pipe(
          Flag.withAlias("s"),
          Flag.withDescription("Session ID to continue, or to create if it does not exist"),
          Flag.optional,
        ),
        fork: Flag.Boolean("fork").pipe(
          Flag.withDescription("Fork the session when continuing"),
          Flag.withDefault(false),
        ),
        replay: Flag.Boolean("replay").pipe(
          Flag.withDescription("Restore session history on resume and resize (disable with --no-replay)"),
          Flag.optional,
        ),
        replayLimit: Flag.Int("replay-limit").pipe(
          Flag.withDescription("Limit replay to the newest N messages (default: 200)"),
          Flag.optional,
        ),
        model: Flag.String("model").pipe(
          Flag.withAlias("m"),
          Flag.withDescription("Model to use in the format provider/model"),
          Flag.optional,
        ),
        agent: Flag.String("agent").pipe(Flag.withDescription("Agent to use"), Flag.optional),
        prompt: Flag.String("prompt").pipe(Flag.withDescription("Prompt to use"), Flag.optional),
        demo: Flag.Boolean("demo").pipe(Flag.withDefault(false), Flag.withHidden),
      },
    }),
    Spec.make("run", {
      description: "Run OpenCode with a message",
      globalFlags: ServerFlags,
      params: {
        message: Argument.String("message").pipe(
          Argument.withDescription("Message to send"),
          Argument.variadic({ min: 0 }),
        ),
        continue: Flag.Boolean("continue").pipe(
          Flag.withAlias("c"),
          Flag.withDescription("Continue the last session"),
          Flag.withDefault(false),
        ),
        session: Flag.String("session").pipe(
          Flag.withAlias("s"),
          Flag.withDescription("Session ID to continue, or to create if it does not exist"),
          Flag.optional,
        ),
        fork: Flag.Boolean("fork").pipe(
          Flag.withDescription("Fork the session before continuing"),
          Flag.withDefault(false),
        ),
        worktree: CliFlag.optionalValue("worktree", "name").pipe(
          Flag.withAlias("w"),
          Flag.withDescription("Start a new session in a new git worktree, optionally with this name"),
        ),
        model: Flag.String("model").pipe(
          Flag.withAlias("m"),
          Flag.withDescription("Model to use in the format provider/model#variant"),
          Flag.optional,
        ),
        agent: Flag.String("agent").pipe(Flag.withDescription("Agent to use"), Flag.optional),
        format: Flag.Literals("format", ["default", "json"]).pipe(
          Flag.withDescription("Output format"),
          Flag.withDefault("default"),
        ),
        file: Flag.String("file").pipe(
          Flag.withAlias("f"),
          Flag.withDescription("File to attach to the message"),
          Flag.atMost(100),
        ),
        title: Flag.String("title").pipe(Flag.withDescription("Session title"), Flag.optional),
        archived: Flag.Boolean("archived").pipe(
          Flag.withDescription(
            "Create the session archived so it stays out of session lists (useful for scripted or CI runs)",
          ),
          Flag.withDefault(false),
        ),
        thinking: Flag.Boolean("thinking").pipe(Flag.withDescription("Show thinking blocks"), Flag.withDefault(false)),
        ...PermissionParams,
      },
    }),
    Spec.make("session", {
      description: "Manage sessions",
      globalFlags: ServerFlags,
      commands: [
        Spec.make("list", {
          description: "List top-level sessions in the current project, newest first",
          params: {
            maxCount: Flag.Int("max-count").pipe(
              Flag.withAlias("n"),
              Flag.withSchema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
              Flag.withDescription("Limit to N most recent sessions (default: 100)"),
              Flag.optional,
            ),
            format: Flag.Literals("format", ["table", "json"]).pipe(
              Flag.withDescription("Output format"),
              Flag.withDefault("table"),
            ),
          },
        }),
        Spec.make("delete", {
          description: "Delete a session and its child sessions",
          params: {
            sessionID: Argument.String("sessionID").pipe(Argument.withDescription("Session ID to delete")),
          },
        }),
        Spec.make("export", {
          description: "Export session data as JSON",
          params: {
            session: Argument.String("session").pipe(
              Argument.withDescription("Session ID to export"),
              Argument.optional,
            ),
            sanitize: Flag.Boolean("sanitize").pipe(
              Flag.withDescription("Redact sensitive transcript and file data"),
              Flag.withDefault(false),
            ),
          },
        }),
        Spec.make("import", {
          description: "Import session data from a JSON file or URL",
          params: {
            file: Argument.String("file").pipe(Argument.withDescription("JSON file or URL to import")),
            directory: Flag.String("directory").pipe(
              Flag.withDescription("Directory in which to import the session"),
              Flag.optional,
            ),
          },
        }),
      ],
    }),
    Spec.make("squad", {
      description: "Orchestrate multi-session squads",
      commands: [
        Spec.make("init", {
          description: "Create a squad generation from a JSON config file",
          globalFlags: ServerFlags,
          params: {
            generation: Flag.String("generation").pipe(
              Flag.withDescription("Generation ID slug"),
              Flag.optional,
            ),
            config: Flag.String("config").pipe(
              Flag.withDescription("JSON config file declaring the sessions"),
              Flag.optional,
            ),
            replace: Flag.Boolean("replace").pipe(
              Flag.withDescription("Replace the active generation (requires --reason)"),
              Flag.withDefault(false),
            ),
            reason: Flag.String("reason").pipe(Flag.withDescription("Reason for --replace"), Flag.optional),
            idempotencyKey: Flag.String("idempotency-key").pipe(
              Flag.withDescription("Idempotency key (a retry with the same key is a no-op)"),
              Flag.optional,
            ),
            json: Flag.Boolean("json").pipe(Flag.withDescription("Output as JSON"), Flag.withDefault(false)),
          },
        }),
        Spec.make("check", {
          description: "Validate the active generation's sessions without mutating anything",
          globalFlags: ServerFlags,
          params: {
            json: Flag.Boolean("json").pipe(Flag.withDescription("Output as JSON"), Flag.withDefault(false)),
          },
        }),
        Spec.make("plan", {
          description: "Simulate the launch of the active generation with no effect (sem efeito)",
          globalFlags: ServerFlags,
          params: {
            json: Flag.Boolean("json").pipe(Flag.withDescription("Output as JSON"), Flag.withDefault(false)),
          },
        }),
        Spec.make("broadcast", {
          description: "Validate every recipient, then enqueue a message in each verified session of the active generation",
          globalFlags: ServerFlags,
          params: {
            messageFile: Flag.String("message-file").pipe(
              Flag.withDescription("Read the message from a UTF-8 file"),
              Flag.optional,
            ),
            includeSelf: Flag.Boolean("include-self").pipe(
              Flag.withDescription("Include the calling session among the recipients"),
              Flag.withDefault(false),
            ),
            idempotencyKey: Flag.String("idempotency-key").pipe(
              Flag.withDescription("Idempotency key (same key, same message id per recipient)"),
              Flag.optional,
            ),
            json: Flag.Boolean("json").pipe(Flag.withDescription("Output as JSON"), Flag.withDefault(false)),
          },
        }),
        Spec.make("status", {
          description: "Show the active and previous generation with measured activity and liveness (read-only)",
          globalFlags: ServerFlags,
          params: {
            json: Flag.Boolean("json").pipe(Flag.withDescription("Output as JSON"), Flag.withDefault(false)),
          },
        }),
        Spec.make("session", {
          description: "Manage squad sessions",
          commands: [
            Spec.make("replace", {
              description: "Give a session name a new session on another provider, model or variant",
              globalFlags: ServerFlags,
              params: {
                name: Flag.String("name").pipe(Flag.withDescription("Session name in the active generation"), Flag.optional),
                provider: Flag.String("provider").pipe(Flag.withDescription("New provider"), Flag.optional),
                model: Flag.String("model").pipe(Flag.withDescription("New model (defaults to the current one)"), Flag.optional),
                variant: Flag.String("variant").pipe(Flag.withDescription("New variant (defaults to the current one)"), Flag.optional),
                reason: Flag.String("reason").pipe(Flag.withDescription("Why the session is replaced"), Flag.optional),
                json: Flag.Boolean("json").pipe(Flag.withDescription("Output as JSON"), Flag.withDefault(false)),
              },
            }),
          ],
        }),
        Spec.make("block", {
          description: "Declare why a verified session is stopped (human or tool), or clear the declaration",
          globalFlags: ServerFlags,
          params: {
            name: Flag.String("name").pipe(Flag.withDescription("Session name in the active generation"), Flag.optional),
            waiting: Flag.String("waiting").pipe(Flag.withDescription("What the session waits on: human or tool"), Flag.optional),
            reason: Flag.String("reason").pipe(Flag.withDescription("Why the session is blocked"), Flag.optional),
            clear: Flag.Boolean("clear").pipe(Flag.withDescription("Clear the declared block"), Flag.withDefault(false)),
            json: Flag.Boolean("json").pipe(Flag.withDescription("Output as JSON"), Flag.withDefault(false)),
          },
        }),
        Spec.make("launch", {
          description: "Create or adopt the active generation's sessions and verify each by durable evidence",
          globalFlags: ServerFlags,
          params: {
            only: Flag.String("only").pipe(Flag.withDescription("Launch only this session name"), Flag.optional),
            retry: Flag.Boolean("retry").pipe(
              Flag.withDescription("Retry a failed or starting session (requires --reason)"),
              Flag.withDefault(false),
            ),
            reason: Flag.String("reason").pipe(Flag.withDescription("Reason for --retry"), Flag.optional),
            adopt: Flag.String("adopt").pipe(
              Flag.withDescription("Adopt an existing session: name=ses_... (comma separated for several)"),
              Flag.optional,
            ),
            timeout: Flag.String("timeout").pipe(
              Flag.withDescription("Verification timeout in seconds (default: squad.launch.verify_timeout)"),
              Flag.optional,
            ),
            json: Flag.Boolean("json").pipe(Flag.withDescription("Output as JSON"), Flag.withDefault(false)),
          },
        }),
        Spec.make("audit", {
          description: "Inspect the append-only squad audit trail",
          commands: [
            Spec.make("export", {
              description: "Write the audit lines to a file and print the chain digest",
              globalFlags: ServerFlags,
              params: {
                since: Flag.String("since").pipe(Flag.withDescription("ISO instant to start from"), Flag.optional),
                out: Flag.String("out").pipe(Flag.withDescription("File to write the lines to (JSON lines)"), Flag.optional),
                json: Flag.Boolean("json").pipe(Flag.withDescription("Output as JSON"), Flag.withDefault(false)),
              },
            }),
          ],
        }),
        Spec.make("close", {
          description: "Close a squad generation once every session has an intact checkpoint and is idle",
          globalFlags: ServerFlags,
          params: {
            generation: Flag.String("generation").pipe(Flag.withDescription("Generation to close"), Flag.optional),
            by: Flag.String("by").pipe(
              Flag.withDescription("Session (name or id) issuing the close; excluded from the active-execution check (default: the orchestrator)"),
              Flag.optional,
            ),
            force: Flag.Boolean("force").pipe(
              Flag.withDescription("Close despite queued inbox items (requires --reason)"),
              Flag.withDefault(false),
            ),
            reason: Flag.String("reason").pipe(Flag.withDescription("Why --force is used"), Flag.optional),
            idempotencyKey: Flag.String("idempotency-key").pipe(
              Flag.withDescription("Idempotency key (repeating the close returns the same receipt)"),
              Flag.optional,
            ),
            json: Flag.Boolean("json").pipe(Flag.withDescription("Output as JSON"), Flag.withDefault(false)),
          },
        }),
        Spec.make("transition", {
          description: "Bind a closed generation to the active one after checking its receipt and registry digest",
          globalFlags: ServerFlags,
          params: {
            from: Flag.String("from").pipe(Flag.withDescription("Closed generation to transition from"), Flag.optional),
            idempotencyKey: Flag.String("idempotency-key").pipe(
              Flag.withDescription("Idempotency key (repeating with the same target is a no-op)"),
              Flag.optional,
            ),
            json: Flag.Boolean("json").pipe(Flag.withDescription("Output as JSON"), Flag.withDefault(false)),
          },
        }),
        Spec.make("checkpoint", {
          description: "Record a session checkpoint (six required sections, SHA-256, secret scan)",
          globalFlags: ServerFlags,
          params: {
            name: Flag.String("name").pipe(Flag.withDescription("Session name in the active generation"), Flag.optional),
            bodyFile: Flag.String("body-file").pipe(Flag.withDescription("Read the checkpoint from a UTF-8 file"), Flag.optional),
            allowSecretLikeText: Flag.Boolean("allow-secret-like-text").pipe(
              Flag.withDescription("Record the checkpoint even if it looks like it holds a secret (requires --reason)"),
              Flag.withDefault(false),
            ),
            reason: Flag.String("reason").pipe(Flag.withDescription("Why secret-like text is allowed"), Flag.optional),
            exportDir: Flag.String("export-dir").pipe(
              Flag.withDescription("Also write the checkpoint to this directory, which must be outside a git work tree"),
              Flag.optional,
            ),
            json: Flag.Boolean("json").pipe(Flag.withDescription("Output as JSON"), Flag.withDefault(false)),
          },
        }),
        Spec.make("send", {
          description: "Enqueue a message in a squad session's inbox (proof of enqueue, never of reading)",
          globalFlags: ServerFlags,
          params: {
            to: Flag.String("to").pipe(Flag.withDescription("Session name in the active generation"), Flag.optional),
            sessionId: Flag.String("session-id").pipe(Flag.withDescription("Session ID"), Flag.optional),
            messageFile: Flag.String("message-file").pipe(
              Flag.withDescription("Read the message from a UTF-8 file"),
              Flag.optional,
            ),
            delivery: Flag.String("delivery").pipe(
              Flag.withDescription("Delivery mode: queue (default) or steer"),
              Flag.withDefault("queue"),
            ),
            idempotencyKey: Flag.String("idempotency-key").pipe(
              Flag.withDescription("Idempotency key (same key, same message id, one inbox row)"),
              Flag.optional,
            ),
            allowSelf: Flag.Boolean("allow-self").pipe(
              Flag.withDescription("Allow sending to the calling session"),
              Flag.withDefault(false),
            ),
            dispatch: Flag.String("dispatch").pipe(
              Flag.withDescription("Dispatch id (ORQ-...): the target must own the dispatch's tree"),
              Flag.optional,
            ),
            json: Flag.Boolean("json").pipe(Flag.withDescription("Output as JSON"), Flag.withDefault(false)),
          },
        }),
        Spec.make("dispatch", {
          description: "Create and list squad dispatches (ORQ-id, owner, base/head, DoR/DoD)",
          commands: [
            Spec.make("create", {
              description: "Validate and record a dispatch for the active generation",
              globalFlags: ServerFlags,
              params: {
                file: Flag.String("file").pipe(
                  Flag.withDescription("JSON file with scope, base, head, dor, dod, proof, exclusions, milestone"),
                  Flag.optional,
                ),
                to: Flag.String("to").pipe(Flag.withDescription("Owner session name in the active generation"), Flag.optional),
                send: Flag.Boolean("send").pipe(
                  Flag.withDescription("Also deliver the dispatch to its owner through the channel"),
                  Flag.withDefault(false),
                ),
                exigidos: Flag.String("exigidos").pipe(
                  Flag.withDescription("Required stages, comma separated: jira,ci,merge,deploy,acceptance (default ci,merge,acceptance)"),
                  Flag.optional,
                ),
                json: Flag.Boolean("json").pipe(Flag.withDescription("Output as JSON"), Flag.withDefault(false)),
              },
            }),
            Spec.make("list", {
              description: "List the dispatches of the active generation",
              globalFlags: ServerFlags,
              params: {
                json: Flag.Boolean("json").pipe(Flag.withDescription("Output as JSON"), Flag.withDefault(false)),
              },
            }),
            Spec.make("accept", {
              description: "Accept an open dispatch of the active generation",
              globalFlags: ServerFlags,
              params: {
                orq: Flag.String("orq").pipe(Flag.withDescription("Dispatch id (ORQ-<generation>-<NNN>)"), Flag.optional),
                json: Flag.Boolean("json").pipe(Flag.withDescription("Output as JSON"), Flag.withDefault(false)),
              },
            }),
          ],
        }),
        Spec.make("panel", {
          description: "Build and show the squad kanban panel with per-stage evidence (read-only)",
          commands: [
            Spec.make("build", {
              description: "Build the kanban document; prints it, or writes it to --out and prints the path",
              globalFlags: ServerFlags,
              params: {
                out: Flag.String("out").pipe(Flag.withDescription("Write the document to this file"), Flag.optional),
                json: Flag.Boolean("json").pipe(Flag.withDescription("Output as JSON"), Flag.withDefault(false)),
              },
            }),
            Spec.make("show", {
              description: "Summarize the panel by column, naming cards that cannot show progress",
              globalFlags: ServerFlags,
              params: {
                json: Flag.Boolean("json").pipe(Flag.withDescription("Output as JSON"), Flag.withDefault(false)),
              },
            }),
          ],
        }),
        Spec.make("release", {
          description: "Hand the trees owned by one squad session to another (requires the owner's checkpoint)",
          globalFlags: ServerFlags,
          params: {
            from: Flag.String("from").pipe(Flag.withDescription("Current owner session name"), Flag.optional),
            to: Flag.String("to").pipe(Flag.withDescription("New owner session name in the active generation"), Flag.optional),
            reason: Flag.String("reason").pipe(Flag.withDescription("Reason for the handover"), Flag.optional),
            json: Flag.Boolean("json").pipe(Flag.withDescription("Output as JSON"), Flag.withDefault(false)),
          },
        }),
      ],
    }),
    Spec.make("queue", {
      description: "Queue a message for a session's inbox",
      globalFlags: ServerFlags,
      params: {
        thread: Flag.String("thread").pipe(
          Flag.withDescription("Session ID to queue to"),
          Flag.optional,
        ),
        to: Flag.String("to").pipe(
          Flag.withDescription("Session name to resolve in the current generation"),
          Flag.optional,
        ),
        all: Flag.Boolean("all").pipe(
          Flag.withDescription("Queue to every non-archived top-level session"),
          Flag.withDefault(false),
        ),
        message: Flag.String("message").pipe(
          Flag.withDescription("Message text to queue"),
          Flag.optional,
        ),
        messageFile: Flag.String("message-file").pipe(
          Flag.withDescription("Read the message from a UTF-8 file"),
          Flag.optional,
        ),
        delivery: Flag.String("delivery").pipe(
          Flag.withDescription("Delivery mode: queue or steer (queue is promoted at the idle boundary, steer at the next step boundary)"),
          Flag.withDefault("queue"),
        ),
        json: Flag.Boolean("json").pipe(
          Flag.withDescription("Output as JSON"),
          Flag.withDefault(false),
        ),
        idempotencyKey: Flag.String("idempotency-key").pipe(
          Flag.withDescription("Required idempotency key (derives the message id)"),
          Flag.optional,
        ),
        allowSelf: Flag.Boolean("allow-self").pipe(
          Flag.withDescription("Allow queueing to the calling session"),
          Flag.withDefault(false),
        ),
      },
      commands: [
        Spec.make("list", {
          description: "List queue items and derived state for a session",
          globalFlags: ServerFlags,
          params: {
            thread: Flag.String("thread").pipe(Flag.withDescription("Session ID")),
            limit: Flag.Int("limit").pipe(
              Flag.withSchema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
              Flag.withDescription("Limit to N audit records (default: 100)"),
              Flag.withDefault(100),
            ),
            json: Flag.Boolean("json").pipe(
              Flag.withDescription("Output as JSON"),
              Flag.withDefault(false),
            ),
          },
        }),
        Spec.make("activity", {
          description: "Report measured activity for a session",
          globalFlags: ServerFlags,
          params: {
            thread: Flag.String("thread").pipe(Flag.withDescription("Session ID")),
            watch: Flag.Boolean("watch").pipe(
              Flag.withDescription("Wait for the first durable activity event"),
              Flag.withDefault(false),
            ),
            timeout: Flag.Int("timeout").pipe(
              Flag.withSchema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
              Flag.withDescription("Watch timeout in milliseconds (default: 60000)"),
              Flag.withDefault(60000),
            ),
            json: Flag.Boolean("json").pipe(
              Flag.withDescription("Output as JSON"),
              Flag.withDefault(false),
            ),
          },
        }),
      ],
    }),
    Spec.make("sessions", {
      description: "List top-level sessions with identity and status",
      globalFlags: ServerFlags,
      params: {
        all: Flag.Boolean("all").pipe(
          Flag.withDescription("Include archived sessions"),
          Flag.withDefault(false),
        ),
        json: Flag.Boolean("json").pipe(
          Flag.withDescription("Output as JSON"),
          Flag.withDefault(false),
        ),
      },
    }),
    Spec.make("service", {
      description: "Manage the background server",
      commands: [
        Spec.make("start", { description: "Start the background server" }),
        Spec.make("restart", { description: "Restart the background server" }),
        Spec.make("status", { description: "Show background server status" }),
        Spec.make("stop", { description: "Stop the background server" }),
        Spec.make("get", {
          description: "Get service configuration",
          params: {
            key: Argument.String("key").pipe(Argument.withDescription("Service setting or env"), Argument.optional),
            name: Argument.String("name").pipe(
              Argument.withDescription("Environment variable name"),
              Argument.optional,
            ),
          },
        }),
        Spec.make("set", {
          description: "Set service configuration",
          params: {
            key: Argument.String("key").pipe(Argument.withDescription("Service setting or env")),
            value: Argument.String("value").pipe(
              Argument.withDescription("Setting value or environment variable name"),
            ),
            nestedValue: Argument.String("env-value").pipe(
              Argument.withDescription("Environment variable value"),
              Argument.optional,
            ),
          },
        }),
        Spec.make("unset", {
          description: "Unset service configuration",
          params: {
            key: Argument.String("key").pipe(Argument.withDescription("Service setting or env")),
            name: Argument.String("name").pipe(
              Argument.withDescription("Environment variable name"),
              Argument.optional,
            ),
          },
        }),
      ],
    }),
    Spec.make("reload", {
      description: "Reload configuration",
      globalFlags: ServerFlags,
    }),
    Spec.make("pair", {
      description: "Print one-time links to connect a browser or app",
      params: {
        url: Flag.String("url").pipe(
          Flag.withDescription("Use an external HTTP(S) server URL in pairing links"),
          Flag.mapTryCatch(
            (value) => {
              const url = new URL(value)
              if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
                throw new Error("Invalid pairing URL")
              return url.href.replace(/\/+$/, "")
            },
            () => "Expected an HTTP(S) server URL without credentials, query parameters, or a fragment",
          ),
          Flag.optional,
        ),
        remote: Flag.Boolean("remote").pipe(
          Flag.withDescription(
            "Pair through the OpenTunnel remote address, enabling remote access if needed (exposes the server to the internet)",
          ),
          Flag.withDefault(false),
        ),
        yes: Flag.Boolean("yes").pipe(
          Flag.withAlias("y"),
          Flag.withDescription(
            "Accept exposing the server to the internet when --remote enables remote access for the first time (required without an interactive terminal)",
          ),
          Flag.withDefault(false),
        ),
      },
    }),
    Spec.make("serve", {
      description: "Start the v2 API and web server",
      params: {
        hostname: Flag.String("hostname").pipe(Flag.optional),
        port: Flag.Int("port").pipe(Flag.optional),
        cors: Flag.String("cors").pipe(
          Flag.withSchema(Schema.NonEmptyString),
          Flag.withDescription("Additional allowed CORS origin (repeat for multiple origins)"),
          Flag.atLeast(0),
        ),
        service: Flag.Boolean("service").pipe(Flag.withDefault(false)),
        stdio: Flag.Boolean("stdio").pipe(Flag.withDefault(false)),
      },
    }),
  ],
})

export const Commands = Root
