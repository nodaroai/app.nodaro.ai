import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { detail, emit, success, dim, warn, table, type OutputOpts } from "../output.js"
import { resolveParams } from "../params.js"
import { collectVariadic, watchUntilTerminal } from "../util.js"
import { pickFromList, isInteractive } from "../interactive.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

export async function pickNodeInteractively(client: ReturnType<typeof buildClient>): Promise<string> {
  if (!isInteractive()) {
    warn("missing <type> and stdin is not a TTY — provide a node type or pipe input")
    process.exit(2)
  }
  const result = await client.nodes.list()
  if (result.data.length === 0) {
    warn("no node types available (server returned an empty list)")
    process.exit(1)
  }
  return pickFromList<string>({
    message: "Pick a node type to run:",
    choices: result.data.map((n) => ({
      name: `${n.label} — ${n.type}`,
      value: n.type,
      description: `${n.category} → ${n.outputType}${n.creditCost ? ` (${n.creditCost} cr)` : ""}`,
    })),
  })
}

/**
 * Catch a common mistake: `nodaro nodes run generate-image "{prompt:'cli'}"`.
 * Commander will silently swallow the extra positional, the request body
 * ends up empty, and the backend returns a confusing validation_error.
 * If we see one, exit with a pointed message.
 */
function rejectPositionalParams(extras: string[], example: { cmd: string; key: string }): void {
  if (!extras || extras.length === 0) return
  const looksLikeObject = extras[0].trim().startsWith("{")
  if (looksLikeObject) {
    warn(`Unexpected positional argument: ${JSON.stringify(extras[0])}`)
    warn(`Pass parameters via --param flags or a JSON file:`)
    warn(`  ${example.cmd} --param ${example.key}="..."`)
    warn(`  ${example.cmd} --params-file body.json`)
  } else {
    warn(`Unexpected positional argument(s): ${extras.map((e) => JSON.stringify(e)).join(" ")}`)
    warn(`Did you forget --param? Try: ${example.cmd} --param ${example.key}=...`)
  }
  process.exit(1)
}

export function nodesCommand(): Command {
  const cmd = new Command("nodes").description("list available node types and run a single node directly (no workflow)")

  cmd
    .command("list")
    .description("list all known node types — same data the editor uses")
    .option("--category <name>", "filter to one category (input/parameter/ai/processing/output/utility)")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { category?: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.nodes.list()
        const filtered = opts.category
          ? result.data.filter((n) => n.category === opts.category)
          : result.data
        if (opts.json) {
          emit(filtered, opts)
          return
        }
        table(
          filtered.map((n) => ({
            type: n.type,
            label: n.label,
            category: n.category,
            outputType: n.outputType,
            credits: n.creditCost ?? "",
            providers: n.providers ? n.providers.length : "",
          })),
          ["type", "label", "category", "outputType", "credits", "providers"],
        )
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("get <type>")
    .description("show one node descriptor (full input schema, providers, capabilities)")
    .option("--profile <name>")
    .option("--json")
    .action(async (type: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.nodes.get(type)
        if (opts.json) emit(result.data, opts)
        else detail(result.data)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("run [type] [extras...]")
    .description("run a single node directly — no workflow, no DAG. Inputs go through --param k=v (repeat) or --params-file body.json. Omit <type> for an interactive picker.")
    .option("--param <pairs...>", "input value, repeat or space-separate (e.g. --param prompt=\"a leopard\" --param resolution=2K)", collectVariadic)
    .option("--params-file <path>", "JSON file with the full input body (--param flags override matching keys)")
    .option("--watch", "if the response includes a jobId, poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Examples:
  $ nodaro nodes run generate-image --param prompt="a snow leopard" --watch
  $ nodaro nodes run generate-image --param prompt="hi" --param provider=flux --param resolution=2K --watch
  $ echo '{"prompt":"hi","provider":"flux"}' > body.json
  $ nodaro nodes run generate-image --params-file body.json --watch

Tip: \`nodaro nodes get <type>\` shows the full input schema (required fields, providers, capabilities).`)
    .action(
      async (
        type: string | undefined,
        extras: string[],
        opts: { param?: string[]; paramsFile?: string; watch?: boolean; pollInterval: number } & GlobalOpts,
      ) => {
        rejectPositionalParams(extras, { cmd: `nodaro nodes run ${type ?? "<type>"}`, key: "prompt" })
        try {
          const client = buildClient(opts.profile)
          const resolvedType = type ?? (await pickNodeInteractively(client))
          const params = resolveParams(opts.param, opts.paramsFile)
          const result = await client.nodes.run(resolvedType, params)
          const jobId = typeof result === "object" && result && "jobId" in result ? (result.jobId as string) : null

          if (opts.json && !opts.watch) {
            emit(result, opts)
            return
          }

          if (!jobId) {
            // Inline node (combine-text/split-text/composite) — synchronous result body.
            success(`${resolvedType} completed (inline)`)
            detail(result)
            return
          }

          success(`job ${jobId} queued`)
          if (!opts.watch) {
            dim(`follow: nodaro jobs get ${jobId}`)
            return
          }
          await watchUntilTerminal({
            fetch: () => client.jobs.get(jobId),
            label: jobId,
            intervalMs: opts.pollInterval,
            ...opts,
          })
        } catch (err) {
          handleError(err)
        }
      },
    )

  return cmd
}
