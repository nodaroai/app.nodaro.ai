import { readFileSync, writeFileSync } from "node:fs"
import { Command } from "commander"
import type { RunWorkflowParams } from "@nodaro/sdk/workflows"
import { ContinuationPreviewPendingError } from "@nodaro/sdk/errors"
import type { WorkflowExport } from "@nodaro/shared/workflow"
import { PREVIEW_RENDER_NODE_TYPES } from "@nodaro/shared/nodes"
import { buildClient, handleError } from "../client.js"
import { detail, emit, success, table, dim, warn, type OutputOpts } from "../output.js"
import { collectVariadic, parseOverridePairs, watchUntilTerminal } from "../util.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

/** Read a file and parse it as a JSON object. Throws a user-facing error on read/parse failure. */
function readJsonObject(path: string, flag: string): Record<string, unknown> {
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (err) {
    throw new Error(`cannot read ${flag} ${path}: ${(err as Error).message}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`${flag} ${path} is not valid JSON: ${(err as Error).message}`)
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${flag} ${path} must contain a JSON object at the top level`)
  }
  return parsed as Record<string, unknown>
}

/**
 * A word as one POSIX shell argument: as is when it is plain, else
 * single-quoted, each `'` closed, escaped and reopened. A word that starts
 * with `=` is quoted too: zsh expands `=cmd` to the command's path.
 */
export function shellQuote(word: string): string {
  if (!word.startsWith("=") && /^[A-Za-z0-9_.:/=@%+-]+$/.test(word)) return word
  return `'${word.replace(/'/g, `'\\''`)}'`
}

/**
 * The `next` a held continuation names (`continuation_preview_pending`), read
 * from `--next`: inline JSON, a file, or `-` for stdin. Sent exactly as read —
 * every field it carries — once it has the run's shape: the execution it
 * continues and the nodes it runs (`inputOverrides`, when present, an object).
 */
function readNextBody(value: string): Record<string, unknown> {
  const raw = value === "-" ? readFileSync(0, "utf8") : value.trim().startsWith("{") ? value : null
  let parsed: unknown
  if (raw === null) {
    parsed = readJsonObject(value, "--next")
  } else {
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      throw new Error(`--next is not valid JSON: ${(err as Error).message}`)
    }
  }
  const next = parsed as Record<string, unknown> | null
  const shape =
    "--next takes the `next` of a continuation_preview_pending answer: { continueFromExecutionId, nodeIds, inputOverrides }"
  if (typeof next !== "object" || next === null || Array.isArray(next)) throw new Error(shape)
  if (typeof next.continueFromExecutionId !== "string" || next.continueFromExecutionId.length === 0) throw new Error(shape)
  if (!Array.isArray(next.nodeIds) || next.nodeIds.length === 0 || !next.nodeIds.every((id) => typeof id === "string")) {
    throw new Error(shape)
  }
  if (next.inputOverrides !== undefined && (typeof next.inputOverrides !== "object" || next.inputOverrides === null || Array.isArray(next.inputOverrides))) {
    throw new Error(shape)
  }
  // A `next` is a run of named nodes: one that names a mode is another run.
  for (const key of ["continueMode", "renderFinal"] as const) {
    if (next[key] !== undefined && next[key] !== null) {
      throw new Error(`--next is the run a held continuation names, which never carries ${key}: use --from-failed or workflows render-final for that run`)
    }
  }
  return next
}

/**
 * What a `workflows run` refused with `continuation_preview_pending` prints
 * next: the command that finishes the held continuation, exactly. One held
 * render and nothing else → its `render-final`; otherwise the run the server
 * named in `next`, sent as is with `--next`.
 */
export function previewPendingCommand(workflowId: string, err: ContinuationPreviewPendingError): string | null {
  if (err.renderNodeIds.length === 1 && err.reviewNodeIds.length === 0) {
    return `nodaro workflows render-final ${shellQuote(workflowId)} --from ${shellQuote(err.executionId)} --render ${shellQuote(err.renderNodeIds[0]!)}`
  }
  if (!err.next) return null
  return `nodaro workflows run ${shellQuote(workflowId)} --next ${shellQuote(JSON.stringify(err.next))}`
}

/** The render a `render-final` without `--render` finalizes: the workflow's only render, else a refusal naming them. */
function soleRenderOf(nodes: ReadonlyArray<{ id: string; type?: string }> | undefined): string {
  const renders = (nodes ?? []).filter((n) => PREVIEW_RENDER_NODE_TYPES.has(n.type ?? ""))
  if (renders.length === 1) return renders[0]!.id
  if (renders.length === 0) throw new Error("this workflow has no render node to finalize")
  throw new Error(`this workflow has ${renders.length} renders — name one with --render: ${renders.map((n) => n.id).join(", ")}`)
}

export function workflowsCommand(): Command {
  const cmd = new Command("workflows").description("list, run, and manage workflows")

  cmd
    .command("list")
    .description("list workflows in a project")
    .requiredOption("--project <projectId>", "project id (run `nodaro projects list` to find it)")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { project: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.workflows.list({ projectId: opts.project })
        if (opts.json) {
          emit(result.data, opts)
          return
        }
        table(
          result.data.map((w) => ({
            id: w.id,
            name: w.name,
            updatedAt: w.updatedAt,
          })),
          ["id", "name", "updatedAt"],
        )
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("get <id>")
    .description("show one workflow by id (includes nodes/edges)")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.workflows.get(id)
        if (opts.json) emit(result.data, opts)
        else detail(result.data)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("create")
    .description("create a workflow in a project (optionally from an exported JSON bundle)")
    .requiredOption("--project <projectId>", "project id (run `nodaro projects list` to find it)")
    .requiredOption("--name <name>", "workflow name")
    .option("--file <jsonPath>", "path to a WorkflowExport JSON bundle to import as the new workflow")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { project: string; name: string; file?: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        let result: { data: { id: string; name: string } }
        if (opts.file) {
          const bundle = readJsonObject(opts.file, "--file")
          result = await client.workflows.import({
            ...(bundle as unknown as WorkflowExport),
            name: opts.name,
            projectId: opts.project,
          })
        } else {
          result = await client.workflows.create({ projectId: opts.project, name: opts.name })
        }
        if (opts.json) {
          emit(result.data, opts)
          return
        }
        success(`created workflow ${result.data.id} (${result.data.name})`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("update <id>")
    .description("update a workflow's name and/or its nodes/edges/settings from a JSON file")
    .option("--name <name>", "new workflow name")
    .option("--file <jsonPath>", "path to a JSON file with `nodes`/`edges`/`settings` to write")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { name?: string; file?: string } & GlobalOpts) => {
      try {
        if (opts.name === undefined && !opts.file) {
          throw new Error("nothing to update — pass --name and/or --file")
        }
        const client = buildClient(opts.profile)
        const body: Record<string, unknown> = {}
        if (opts.name !== undefined) body.name = opts.name
        if (opts.file) {
          const parsed = readJsonObject(opts.file, "--file")
          if (parsed.nodes !== undefined) body.nodes = parsed.nodes
          if (parsed.edges !== undefined) body.edges = parsed.edges
          if (parsed.settings !== undefined) body.settings = parsed.settings
        }
        const result = await client.workflows.update(id, body)
        if (opts.json) emit(result.data, opts)
        else success(`updated workflow ${result.data.id} (${result.data.name})`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("delete <id>")
    .description("delete a workflow")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        await client.workflows.delete(id)
        if (opts.json) emit({ id, deleted: true }, opts)
        else success(`deleted workflow ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("export <id>")
    .description("export a workflow as a portable JSON bundle")
    .option("--with-assets", "include character/object/location entity data in the bundle")
    .option("--output <path>", "write the bundle to this file instead of stdout")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { withAssets?: boolean; output?: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.workflows.export(id, { assets: opts.withAssets ?? false })
        if (opts.output) {
          writeFileSync(opts.output, JSON.stringify(result.data, null, 2) + "\n")
          success(`exported workflow ${id} → ${opts.output}`)
          return
        }
        // No --output: print the bundle to stdout (also covers --json).
        detail(result.data)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("import <file>")
    .description("import a WorkflowExport JSON bundle into a project")
    .requiredOption("--project <projectId>", "project id (run `nodaro projects list` to find it)")
    .option("--profile <name>")
    .option("--json")
    .action(async (file: string, opts: { project: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const bundle = readJsonObject(file, "<file>")
        const result = await client.workflows.import({
          ...(bundle as unknown as WorkflowExport),
          projectId: opts.project,
        })
        if (opts.json) {
          emit(result.data, opts)
          return
        }
        success(`imported workflow ${result.data.id} (${result.data.name})`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("run <id>")
    .description("trigger a workflow run; prints execution id (use --watch to follow)")
    .option("--profile <name>")
    .option("--json")
    .option("--watch", "poll execution status until completion")
    .option("--node <ids...>", "execute only these node ids (space-separated)")
    .option(
      "--continue-from <executionId>",
      "continue an earlier execution of this workflow: nodes not run hand on its outputs (needs --node, unless --from-failed)",
    )
    .option(
      "--from-failed",
      "with --continue-from: resume that FAILED run from where it stopped — runs only what it did not complete (of --node; default: the nodes its chain was first started on, every node for a full run, plus what it left failed), and each --node no run of its chain ever ran (charged; never a source, trigger or skipped node)",
    )
    .option(
      "--override <pairs...>",
      "per-node override for this run only, nodeId.field=value (repeat); values that parse as JSON are sent as JSON, e.g. --override cut.quality=final",
      collectVariadic,
    )
    .option(
      "--next <json|file|->",
      "send the `next` a continuation_preview_pending answer names, exactly as given (inline JSON, a file, or - for stdin); not combinable with --node, --continue-from, --from-failed or --override",
    )
    .option(
      "--idempotency-key <key>",
      "sent as Idempotency-Key (8+ characters): a retry with the same key answers the run already started",
    )
    .action(
      async (
        id: string,
        opts: GlobalOpts & {
          watch?: boolean
          node?: string[]
          continueFrom?: string
          fromFailed?: boolean
          override?: string[]
          next?: string
          idempotencyKey?: string
        },
      ) => {
      try {
        if (opts.fromFailed && !opts.continueFrom) {
          throw new Error("--from-failed needs --continue-from <executionId> (the run that failed)")
        }
        // `next` is a whole run: mixing in another flag would send a different one.
        if (opts.next !== undefined && (opts.node || opts.continueFrom || opts.fromFailed || opts.override)) {
          throw new Error("--next is the whole run: do not combine it with --node, --continue-from, --from-failed or --override")
        }
        // The server ignores a shorter key, so a retry would start a second run.
        if (opts.idempotencyKey !== undefined && opts.idempotencyKey.trim().length < 8) {
          throw new Error("--idempotency-key must be at least 8 characters (the server ignores a shorter one)")
        }
        const params: RunWorkflowParams =
          opts.next !== undefined
            ? (readNextBody(opts.next) as unknown as RunWorkflowParams)
            : {
                ...(opts.node ? { nodeIds: opts.node } : {}),
                ...(opts.override ? { inputOverrides: parseOverridePairs(opts.override) } : {}),
                ...(opts.continueFrom ? { continueFromExecutionId: opts.continueFrom } : {}),
                ...(opts.fromFailed ? { continueMode: "from-failed" as const } : {}),
              }
        const client = buildClient(opts.profile)
        const result = opts.idempotencyKey
          ? await client.workflows.run(id, params, { idempotencyKey: opts.idempotencyKey })
          : await client.workflows.run(id, params)
        if (opts.json && !opts.watch) {
          emit(result, opts)
          return
        }
        success(`execution ${result.executionId} (${result.status})${result.deduped ? " — already started by an earlier request with this key" : ""}`)
        // Built on a later continuation of the run asked for: say where its states came from.
        if (result.continuedFrom && result.continuedFrom !== opts.continueFrom) {
          dim(`continued from ${result.continuedFrom}, a later continuation of ${opts.continueFrom} — only what it left runs`)
        }
        if (!opts.watch) {
          dim(`follow: nodaro executions get ${result.executionId} --watch`)
          return
        }
        await watchExecution(client, result.executionId, opts)
      } catch (err) {
        // A held continuation: print the command that finishes it, exactly (stderr, so --json stdout stays clean).
        if (err instanceof ContinuationPreviewPendingError) {
          const next = previewPendingCommand(id, err)
          if (next) {
            warn("once the preview is reviewed, finish it first, then continue again:")
            warn(`  ${next}`)
          }
        }
        handleError(err)
      }
      },
    )

  cmd
    .command("render-final <workflowId>")
    .description(
      "render the final of a run that stopped at a Preview render: the render at Final and every node after it, continuing that run (the server works out which nodes run)",
    )
    .requiredOption("--from <executionId>", "the run that stopped at the preview (your own completed run of this workflow)")
    .option("--render <nodeId>", "the render node to finalize (default: the workflow's only render)")
    .option("--estimate", "quote it only: the nodes it runs and its estimated credits; nothing is created or charged")
    .option("--watch", "poll execution status until completion")
    .option("--profile <name>")
    .option("--json")
    .action(async (workflowId: string, opts: GlobalOpts & { from: string; render?: string; estimate?: boolean; watch?: boolean }) => {
      try {
        const client = buildClient(opts.profile)
        const renderNodeId = opts.render ?? soleRenderOf((await client.workflows.get(workflowId)).data.nodes)
        const params = { renderNodeId, continueFromExecutionId: opts.from }
        if (opts.estimate) {
          const { data: quote } = await client.workflows.estimateRenderFinal(workflowId, params)
          if (opts.json) {
            emit(quote, opts)
            return
          }
          success(`Render final of ${renderNodeId} runs ${quote.nodeIds.join(", ")}`)
          if (quote.estimatedCredits !== null) {
            dim(
              // `≈`: an LLM node in the run is charged its actual usage, so the figure is an estimate.
              `estimated ${quote.estimatedCreditsIsEstimate ? "≈" : ""}${quote.estimatedCredits} credits` +
                (quote.sufficient === false
                  ? ` — not covered` +
                    // The balance is checked against what the run holds while it renders: named when it is more than the price.
                    (typeof quote.holdCredits === "number" && quote.holdCredits > quote.estimatedCredits ? `: holds up to about ${quote.holdCredits} credits while it renders` : "") +
                    (quote.available !== null ? ` (${quote.available} available)` : "")
                  : ""),
            )
          }
          return
        }
        const result = await client.workflows.renderFinal(workflowId, params)
        if (opts.json && !opts.watch) {
          emit(result, opts)
          return
        }
        success(`execution ${result.executionId} (${result.status}) — Render final of ${renderNodeId}`)
        if (!opts.watch) {
          dim(`follow: nodaro executions get ${result.executionId} --watch`)
          return
        }
        await watchExecution(client, result.executionId, opts)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("share <id>")
    .description("set a workflow's visibility: workspace (everyone in its workspace) or private (creator + named collaborators)")
    .option("--visibility <level>", "workspace | private", "workspace")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { visibility: string } & GlobalOpts) => {
      try {
        if (opts.visibility !== "workspace" && opts.visibility !== "private") {
          throw new Error("--visibility must be `workspace` or `private`")
        }
        const client = buildClient(opts.profile)
        const result = await client.workflows.setVisibility(id, opts.visibility)
        if (opts.json) emit(result.data, opts)
        else success(`workflow ${id} is now ${opts.visibility}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("move <id>")
    .description("move a workflow to another project")
    .requiredOption("--project <projectId>", "destination project id")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { project: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.workflows.move(id, { projectId: opts.project })
        if (opts.json) {
          emit(result, opts)
          return
        }
        success(`moved workflow ${id} → project ${opts.project}`)
        if (result.droppedCollaborators.length > 0) {
          dim(
            `${result.droppedCollaborators.length} collaborator grant(s) were dropped — they came from the workspace this workflow just left`,
          )
        }
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("shared-with-me")
    .description("list workflows other people shared with you")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.workflows.sharedWithMe()
        if (opts.json) {
          emit(result.data, opts)
          return
        }
        table(
          result.data.map((w) => ({ id: w.id, name: w.name, role: w.grantedRole, updatedAt: w.updatedAt })),
          ["id", "name", "role", "updatedAt"],
        )
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("mcp-conversations")
    .description("list your MCP conversations of one month — each a flow an assistant built")
    .option("--month <YYYY-MM>", "the month to list (default: the latest month that has conversations)")
    .option("--source <list>", "only these sources, comma-separated (claude, claude-code, chatgpt, ...)")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { month?: string; source?: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const sources = opts.source?.split(",").map((s) => s.trim()).filter(Boolean)
        const result = await client.workflows.listMcpConversations({ month: opts.month, sources })
        if (opts.json) {
          emit(result, opts)
          return
        }
        table(
          result.data.map((c) => ({
            id: c.id,
            name: c.name,
            source: c.clientLabel,
            nodes: c.nodeCount,
            credits: c.credits ?? "",
            startedAt: c.startedAt,
          })),
          ["id", "name", "source", "nodes", "credits", "startedAt"],
        )
      } catch (err) {
        handleError(err)
      }
    })

  cmd.addCommand(collaboratorsCommand())

  return cmd
}

/** `nodaro workflows collaborators …` — the people a workflow is shared with. */
function collaboratorsCommand(): Command {
  const cmd = new Command("collaborators").description("manage who a workflow is shared with")

  cmd
    .command("list <id>")
    .description("list a workflow's collaborators")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.workflows.collaborators.list(id)
        if (opts.json) emit(result.data, opts)
        else table(result.data.map((c) => ({ userId: c.userId, name: c.name ?? "", role: c.role })), ["userId", "name", "role"])
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("add <id>")
    .description("share a workflow with a person by user id or email")
    .option("--user <userId>", "the collaborator's user id")
    .option("--email <email>", "the collaborator's email (any address; they need not have an account yet)")
    .requiredOption("--role <role>", "viewer | editor")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { user?: string; email?: string; role: string } & GlobalOpts) => {
      try {
        if ((opts.user === undefined) === (opts.email === undefined)) {
          throw new Error("provide exactly one of --user or --email")
        }
        if (opts.role !== "viewer" && opts.role !== "editor") {
          throw new Error("--role must be `viewer` or `editor`")
        }
        const client = buildClient(opts.profile)
        const result = await client.workflows.collaborators.add(id, {
          ...(opts.user ? { userId: opts.user } : { email: opts.email }),
          role: opts.role,
        })
        if (opts.json) emit(result.data, opts)
        else success(`shared workflow ${id} with ${opts.user ?? opts.email} as ${opts.role}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("update <id> <userId>")
    .description("change a collaborator's role")
    .requiredOption("--role <role>", "viewer | editor")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, userId: string, opts: { role: string } & GlobalOpts) => {
      try {
        if (opts.role !== "viewer" && opts.role !== "editor") {
          throw new Error("--role must be `viewer` or `editor`")
        }
        const client = buildClient(opts.profile)
        const result = await client.workflows.collaborators.update(id, userId, { role: opts.role })
        if (opts.json) emit(result.data, opts)
        else success(`${userId} is now ${opts.role} on workflow ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("remove <id> <userId>")
    .description("remove a collaborator (or yourself)")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, userId: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        await client.workflows.collaborators.remove(id, userId)
        if (opts.json) emit({ workflowId: id, userId, removed: true }, opts)
        else success(`removed ${userId} from workflow ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}

export async function watchExecution(
  client: ReturnType<typeof buildClient>,
  executionId: string,
  opts: OutputOpts,
): Promise<void> {
  await watchUntilTerminal({
    fetch: () => client.executions.get(executionId),
    label: executionId,
    ...opts,
  })
}
