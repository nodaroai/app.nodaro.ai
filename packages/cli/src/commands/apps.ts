import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { emit, success, dim, warn, table, type OutputOpts } from "../output.js"
import { resolveParams } from "../params.js"
import { collectVariadic } from "../util.js"
import { watchExecution } from "./workflows.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

function rejectPositionalInputs(extras: string[], slug: string): void {
  if (!extras || extras.length === 0) return
  const looksLikeObject = extras[0].trim().startsWith("{")
  if (looksLikeObject) {
    warn(`Unexpected positional argument: ${JSON.stringify(extras[0])}`)
    warn(`Pass inputs via --input flags or a JSON file:`)
    warn(`  nodaro apps run ${slug} --input prompt="..."`)
    warn(`  nodaro apps run ${slug} --params-file inputs.json`)
  } else {
    warn(`Unexpected positional argument(s): ${extras.map((e) => JSON.stringify(e)).join(" ")}`)
    warn(`Did you forget --input? Try: nodaro apps run ${slug} --input prompt=...`)
  }
  process.exit(1)
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
    .command("run <slug> [extras...]")
    .description("trigger an app run. Inputs go through --input k=v (repeat) or --params-file inputs.json")
    .option("--input <pairs...>", "input value, repeat or space-separate (e.g. --input prompt=\"hi\" --input duration=8)", collectVariadic)
    .option("--params-file <path>", "JSON file with the full inputs object (--input flags override matching keys)")
    .option("--watch", "follow the resulting execution until completion")
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Examples:
  $ nodaro apps run hair-styler-dd3erw --input prompt="curly red hair" --watch
  $ echo '{"prompt":"hi","duration":8}' > inputs.json
  $ nodaro apps run hair-styler-dd3erw --params-file inputs.json --watch

Tip: \`nodaro apps get <slug>\` shows the input schema for that app.`)
    .action(async (slug: string, extras: string[], opts: { input?: string[]; paramsFile?: string; watch?: boolean } & GlobalOpts) => {
      rejectPositionalInputs(extras, slug)
      try {
        const client = buildClient(opts.profile)
        const inputs = resolveParams(opts.input, opts.paramsFile)
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
