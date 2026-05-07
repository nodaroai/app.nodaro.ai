import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { emit, success, dim, table, type OutputOpts } from "../output.js"
import { parseParamPairs, loadParamsFile, mergeParams } from "../params.js"
import { watchExecution } from "./workflows.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

export function appsCommand(): Command {
  const cmd = new Command("apps").description("browse and run published apps (workflows wrapped in a curated UI)")

  cmd
    .command("list")
    .description("browse published apps (paginated)")
    .option("--search <query>", "substring match on name/description")
    .option("--limit <n>", "page size (max 50)", (v) => parseInt(v, 10))
    .option("--cursor <token>", "pagination cursor from a previous page")
    .option("--category <slug>", "filter to a single category")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { search?: string; limit?: number; cursor?: string; category?: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.apps.list({
          search: opts.search,
          limit: opts.limit,
          cursor: opts.cursor,
          category: opts.category,
        })
        if (opts.json) {
          emit(result, opts)
          return
        }
        table(
          result.data.map((a) => ({
            slug: a.slug,
            name: a.name,
            creator: a.creatorName ?? a.creatorId,
            runs: a.runCount ?? 0,
          })),
          ["slug", "name", "creator", "runs"],
        )
        if (result.nextCursor) dim(`next page: --cursor ${result.nextCursor}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("get <slug>")
    .description("show one app's metadata + input schema")
    .option("--profile <name>")
    .option("--json")
    .action(async (slug: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.apps.get(slug)
        if (opts.json) emit(result.data, opts)
        else console.log(JSON.stringify(result.data, null, 2))
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("run <slug>")
    .description("trigger an app run — pass inputs via --input k=v or --params-file f.json")
    .option("--input <pairs...>", "key=value input pairs (repeat or space-separate)", collectInputs)
    .option("--params-file <path>", "JSON file with the inputs object (--input flags override)")
    .option("--watch", "follow the resulting execution until completion")
    .option("--profile <name>")
    .option("--json")
    .action(async (slug: string, opts: { input?: string[]; paramsFile?: string; watch?: boolean } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const fromFile = opts.paramsFile ? loadParamsFile(opts.paramsFile) : {}
        const fromFlags = parseParamPairs(opts.input)
        const inputs = mergeParams(fromFile, fromFlags)
        const result = await client.apps.run(slug, inputs)
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

  cmd
    .command("runs <slug>")
    .description("list past runs of an app (caller must own the app or the runs)")
    .option("--limit <n>", "page size", (v) => parseInt(v, 10))
    .option("--cursor <token>")
    .option("--profile <name>")
    .option("--json")
    .action(async (slug: string, opts: { limit?: number; cursor?: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.apps.listRuns(slug, { limit: opts.limit, cursor: opts.cursor })
        if (opts.json) {
          emit(result, opts)
          return
        }
        table(
          result.data.map((r) => ({
            id: r.id,
            status: r.status,
            executionId: r.executionId,
            startedAt: r.startedAt,
          })),
          ["id", "status", "executionId", "startedAt"],
        )
        if (result.nextCursor) dim(`next page: --cursor ${result.nextCursor}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("run-get <slug> <runId>")
    .description("show one app-run by id")
    .option("--profile <name>")
    .option("--json")
    .action(async (slug: string, runId: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.apps.getRun(slug, runId)
        if (opts.json) emit(result.data, opts)
        else console.log(JSON.stringify(result.data, null, 2))
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}

// commander's variadic option arity collects values into an array; this helper
// makes the type explicit so the action handler sees `string[]` cleanly.
function collectInputs(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value]
}
