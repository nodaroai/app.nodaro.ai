import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { emit, success, table, info, dim, type OutputOpts } from "../output.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

export function workflowsCommand(): Command {
  const cmd = new Command("workflows").description("list and run workflows")

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
        else console.log(JSON.stringify(result.data, null, 2))
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
    .action(async (id: string, opts: GlobalOpts & { watch?: boolean; node?: string[] }) => {
      try {
        const client = buildClient(opts.profile)
        const params = opts.node ? { nodeIds: opts.node } : {}
        const result = await client.workflows.run(id, params)
        if (opts.json && !opts.watch) {
          emit(result, opts)
          return
        }
        success(`execution ${result.executionId} (${result.status})`)
        if (!opts.watch) {
          dim(`follow: nodaro executions get ${result.executionId} --watch`)
          return
        }
        await watchExecution(client, result.executionId, opts)
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
  const start = Date.now()
  let lastStatus = ""
  for (;;) {
    const result = await client.executions.get(executionId)
    const status = result.data.status
    if (status !== lastStatus) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1)
      info(`[${elapsed}s] ${executionId} → ${status}`)
      lastStatus = status
    }
    if (status === "completed" || status === "failed" || status === "cancelled") {
      if (opts.json) emit(result.data, opts)
      else if (status === "completed") success(`completed in ${((Date.now() - start) / 1000).toFixed(1)}s`)
      else process.exit(status === "failed" ? 2 : 130)
      return
    }
    await sleep(2000)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
