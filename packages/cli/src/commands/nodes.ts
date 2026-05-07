import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { emit, success, dim, table, type OutputOpts } from "../output.js"
import { parseParamPairs, loadParamsFile, mergeParams } from "../params.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
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
        else console.log(JSON.stringify(result.data, null, 2))
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("run <type>")
    .description("run a single node directly — no workflow, no DAG; equivalent to the MCP server's verb tools")
    .option("--param <pairs...>", "key=value request body (repeat or space-separate)", collectParams)
    .option("--params-file <path>", "JSON file with the request body (--param overrides)")
    .option("--watch", "if the response includes a jobId, poll until the job completes")
    .option("--poll-interval <ms>", "watch poll interval in ms", (v) => parseInt(v, 10), 2000)
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        type: string,
        opts: { param?: string[]; paramsFile?: string; watch?: boolean; pollInterval: number } & GlobalOpts,
      ) => {
        try {
          const client = buildClient(opts.profile)
          const fromFile = opts.paramsFile ? loadParamsFile(opts.paramsFile) : {}
          const fromFlags = parseParamPairs(opts.param)
          const params = mergeParams(fromFile, fromFlags)
          const result = await client.nodes.run(type, params)
          const jobId = typeof result === "object" && result && "jobId" in result ? (result.jobId as string) : null

          if (opts.json && !opts.watch) {
            emit(result, opts)
            return
          }

          if (!jobId) {
            // Inline node (combine-text/split-text/composite) — synchronous result body.
            success(`${type} completed (inline)`)
            console.log(JSON.stringify(result, null, 2))
            return
          }

          success(`job ${jobId} queued`)
          if (!opts.watch) {
            dim(`follow: nodaro jobs get ${jobId}`)
            return
          }
          await watchJob(client, jobId, opts.pollInterval, opts)
        } catch (err) {
          handleError(err)
        }
      },
    )

  return cmd
}

async function watchJob(
  client: ReturnType<typeof buildClient>,
  jobId: string,
  intervalMs: number,
  opts: OutputOpts,
): Promise<void> {
  const start = Date.now()
  let lastStatus = ""
  for (;;) {
    const result = await client.jobs.get(jobId)
    const status = result.data.status
    if (status !== lastStatus) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1)
      console.log(`[${elapsed}s] ${jobId} → ${status}`)
      lastStatus = status
    }
    if (status === "completed" || status === "failed" || status === "cancelled") {
      if (opts.json) emit(result.data, opts)
      else if (status === "completed") success(`completed in ${((Date.now() - start) / 1000).toFixed(1)}s`)
      else process.exit(status === "failed" ? 2 : 130)
      return
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

function collectParams(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value]
}
