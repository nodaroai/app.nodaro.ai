import { Command } from "commander"
import type { GenerateImageBatchResult } from "@nodaro/sdk"
import { buildClient, handleError } from "../client.js"
import { detail, emit, success, dim, info, warn, table, type OutputOpts } from "../output.js"
import { resolveParams } from "../params.js"
import { collectVariadic, watchJobsUntilTerminal, watchUntilTerminal } from "../util.js"
import { pickFromList, isInteractive } from "../interactive.js"

/** The node type `--count` / `--models` belong to. */
const BATCH_NODE_TYPE = "generate-image"

/** `--count` / `--models` onto the body, after `--param` / `--params-file` (the flags win). */
function withBatchFlags(
  type: string,
  params: Record<string, unknown>,
  flags: { count?: string; models?: string },
): Record<string, unknown> {
  if (flags.count === undefined && flags.models === undefined) return params
  if (type !== BATCH_NODE_TYPE) {
    throw new Error(`--count / --models are ${BATCH_NODE_TYPE} options (several images in one call)`)
  }
  const out: Record<string, unknown> = { ...params }
  if (flags.count !== undefined) {
    const count = Number(flags.count)
    if (!/^\d+$/.test(flags.count.trim()) || count < 1) throw new Error(`--count must be a whole number of images, 1 or more (got "${flags.count}")`)
    out.count = count
  }
  if (flags.models !== undefined) {
    out.models = flags.models.split(/[\s,]+/).filter(Boolean)
  }
  return out
}

/** The answer of a call that made several jobs (`count` / `models`), or null. */
function batchOf(result: unknown): GenerateImageBatchResult | null {
  const r = result as Partial<GenerateImageBatchResult> | null
  return r && Array.isArray(r.jobIds) && Array.isArray(r.groups) && typeof r.batchId === "string"
    ? (r as GenerateImageBatchResult)
    : null
}

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
    .option("--category <name>", "filter to one category (input, parameter, ai-image, ai-video, ai-audio, ai-text, processing, composition, output, control, entity, trigger, utility)")
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
    .option("--param <pairs...>", "input value, repeat or space-separate; JSON arrays/objects supported (e.g. --param prompt=\"a leopard\" --param 'targetPickers=[\"person\"]')", collectVariadic)
    .option("--params-file <path>", "JSON file with the full input body (--param flags override matching keys)")
    .option("--watch", "if the response includes a jobId, poll until the job completes (every job of a batch)")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--count <n>", "generate-image: how many images (1-4), each its own job; with --models, per model")
    .option("--models <ids>", "generate-image: run the same request on 2-4 models at once (comma-separated), instead of provider")
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Examples:
  $ nodaro nodes run generate-image --param prompt="a snow leopard" --watch
  $ nodaro nodes run generate-image --param prompt="hi" --param provider=flux --param resolution=2K --watch
  $ nodaro nodes run generate-image --param prompt="a snow leopard" --count 4 --watch
  $ nodaro nodes run generate-image --param prompt="a snow leopard" --models gpt-image-2,flux-2-max --count 2 --watch
  $ echo '{"prompt":"hi","provider":"flux"}' > body.json
  $ nodaro nodes run generate-image --params-file body.json --watch
  $ nodaro nodes run generate-image --param presetId=generate-image/logo-wordmark --param presetVariables='{"BRAND":"Acme"}' --watch
  $ nodaro nodes run text-to-speech --param text="And so it begins." --param previousText="The night before, nobody slept." --param nextText="By noon the harbour was empty." --watch
  $ nodaro nodes run video-depth --param videoUrl=https://cdn.example/clip.mp4 --param colormap=turbo --watch

Structured references (the editor's wired-reference shape) — let a {image:N} prompt
token bind a labeled reference, assembled server-side into @image_N (same as the
canvas/API/MCP/SDK). Pass them via --params-file (arrays need the JSON file, not --param):
  $ cat > body.json <<'JSON'
  {"prompt":"the {image:1:hero} runs","provider":"seedance-2",
   "connectedReferences":[{"id":"h1","defaultName":"hero","source":"manual","url":"https://cdn.example/hero.png"}]}
  JSON
  $ nodaro nodes run generate-video --params-file body.json --watch

Tip: \`nodaro nodes get <type>\` shows the full input schema (required fields, providers, capabilities).`)
    .action(
      async (
        type: string | undefined,
        extras: string[],
        opts: { param?: string[]; paramsFile?: string; watch?: boolean; pollInterval: number; count?: string; models?: string } & GlobalOpts,
      ) => {
        rejectPositionalParams(extras, { cmd: `nodaro nodes run ${type ?? "<type>"}`, key: "prompt" })
        try {
          const client = buildClient(opts.profile)
          const resolvedType = type ?? (await pickNodeInteractively(client))
          const params = withBatchFlags(resolvedType, resolveParams(opts.param, opts.paramsFile), opts)
          const result = await client.nodes.run(resolvedType, params)
          const jobId = typeof result === "object" && result && "jobId" in result ? (result.jobId as string) : null

          if (opts.json && !opts.watch) {
            emit(result, opts)
            return
          }

          // Several jobs from one call (generate-image `count` / `models`).
          const batch = batchOf(result)
          if (batch) {
            success(`${batch.jobIds.length} jobs queued (batch ${batch.batchId})${batch.deduped ? " — already created by an earlier request with this key" : ""}`)
            for (const group of batch.groups) {
              info(`  ${group.model}: ${group.jobIds.join(", ")}${group.credits !== undefined ? ` (${group.credits} credits)` : ""}`)
            }
            if (!opts.watch) {
              dim(`follow: nodaro jobs get <id> for each id above, or run with --watch`)
              return
            }
            await watchJobsUntilTerminal({
              jobIds: batch.jobIds,
              fetchStatus: (id) => client.jobs.getStatus(id),
              intervalMs: opts.pollInterval,
              json: opts.json,
            })
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
