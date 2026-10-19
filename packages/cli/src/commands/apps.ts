import { Command } from "commander"
import { isPreviewRefusalCode } from "@nodaro/shared/nodes"
import { AlreadyRunningError, AppRunVersionChangedError, NodaroError } from "@nodaro/sdk/errors"
import { buildClient, handleError } from "../client.js"
import { detail, emit, success, dim, warn, table, type OutputOpts } from "../output.js"
import { resolveParams } from "../params.js"
import { collectVariadic, parseOverridePairs } from "../util.js"
import { shellQuote, watchExecution } from "./workflows.js"
import { pickFromList, isInteractive } from "../interactive.js"

async function pickAppInteractively(client: ReturnType<typeof buildClient>): Promise<string> {
  if (!isInteractive()) {
    warn("missing <slug> and stdin is not a TTY — provide a slug or pipe input")
    process.exit(2)
  }
  const result = await client.apps.list({ limit: 50 })
  if (result.data.length === 0) {
    warn("no published apps available")
    process.exit(1)
  }
  return pickFromList<string>({
    message: "Pick an app to run:",
    choices: result.data.map((a) => ({
      name: `${a.name} (${a.slug})`,
      value: a.slug,
      description: a.creatorName ?? a.creatorId,
    })),
  })
}

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

export { parseOverridePairs }

/**
 * A whole positive number for `--app-version`, or a refusal naming the flag.
 * (Not `--version`: the root program's `-v, --version` would claim it and
 * print the CLI's version instead of running the command.)
 */
function parseAppVersion(value: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) throw new Error(`--app-version must be a whole number of 1 or more, got ${JSON.stringify(value)}`)
  return n
}

/**
 * What to do instead after a refused Retry, as commands (stderr, so --json
 * stdout stays clean), or `[]` when the refusal names no other way.
 */
export function retryRefusalAdvice(slug: string, runId: string, err: unknown): string[] {
  const startOver = `  start it over (every step runs, and is charged, again): nodaro apps run ${shellQuote(slug)} --input …`
  if (err instanceof AppRunVersionChangedError) {
    const lines = ["the app changed since this run, so it is not continued:", startOver]
    if (err.runVersion !== undefined) {
      lines.push(`  or continue on the run's own version ${err.runVersion}: nodaro apps run-retry ${shellQuote(slug)} ${shellQuote(runId)} --app-version ${err.runVersion}`)
    }
    return lines
  }
  if (err instanceof NodaroError && (err.code === "app_run_version_unavailable" || err.code === "continuation_not_failed")) {
    return [startOver]
  }
  if (err instanceof NodaroError && err.code === "already_running") {
    const live = err instanceof AlreadyRunningError ? `nodaro executions get ${shellQuote(err.executionId)} --watch` : `nodaro apps run-get ${shellQuote(slug)} ${shellQuote(runId)}`
    return [`  follow it: ${live}`]
  }
  // Any of the preview refusal codes (a render held, a review-on use-case node, or both).
  if (err instanceof NodaroError && isPreviewRefusalCode(err.code)) {
    return ["  retry it from the app page instead, where a person can review the Preview it stops at"]
  }
  return []
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
        else detail(result.data)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("run [slug] [extras...]")
    .description("trigger an app run. Inputs go through --input k=v (repeat) or --params-file inputs.json. Omit <slug> for an interactive picker.")
    .option("--input <pairs...>", "input value, repeat or space-separate; JSON arrays/objects supported (e.g. --input prompt=\"hi\" --input 'tags=[\"a\",\"b\"]')", collectVariadic)
    .option("--params-file <path>", "JSON file with the full inputs object (--input flags override matching keys)")
    .option("--override <pairs...>", "advanced: raw node-data override nodeId.field=value (repeat); reaches fields not exposed as inputs, e.g. --override n1.promptPrefix=\"Cinematic still of\"", collectVariadic)
    .option("--watch", "follow the resulting execution until completion")
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
Examples:
  $ nodaro apps run hair-styler-dd3erw --input prompt="curly red hair" --watch
  $ nodaro apps run hair-styler-dd3erw --input prompt="curly red hair" --override n1.promptPrefix="Studio portrait of"
  $ echo '{"prompt":"hi","duration":8}' > inputs.json
  $ nodaro apps run hair-styler-dd3erw --params-file inputs.json --watch

Tip: \`nodaro apps get <slug>\` shows the input schema for that app.`)
    .action(async (slug: string | undefined, extras: string[], opts: { input?: string[]; paramsFile?: string; override?: string[]; watch?: boolean } & GlobalOpts) => {
      rejectPositionalInputs(extras, slug ?? "<slug>")
      try {
        const client = buildClient(opts.profile)
        const resolvedSlug = slug ?? (await pickAppInteractively(client))
        const inputs = resolveParams(opts.input, opts.paramsFile)
        const result = await client.apps.run(resolvedSlug, inputs, {
          inputOverrides: parseOverridePairs(opts.override),
        })
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
        else detail(result.data)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("run-retry <slug> <runId>")
    .description("retry a failed app run from where it stopped: only the steps it did not complete run, and only those are charged")
    .option("--dry-run", "show the steps the Retry would run and what it would charge; start nothing")
    .option("--app-version <n>", "the app version you expect it to run (default: the app's latest); the run's own version continues it after the app changed", parseAppVersion)
    .option("--watch", "follow the Retry's execution until completion")
    .option("--profile <name>")
    .option("--json")
    .addHelpText("after", `
The Retry runs the version the run ran, with the inputs the run applied (it takes none).
To run with other inputs or on the app's current version, start over with \`nodaro apps run\`.

Examples:
  $ nodaro apps run-retry hair-styler-dd3erw 3f0c… --dry-run
  $ nodaro apps run-retry hair-styler-dd3erw 3f0c… --watch`)
    .action(async (slug: string, runId: string, opts: { dryRun?: boolean; appVersion?: number; watch?: boolean } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        if (opts.dryRun) {
          const { data: plan } = await client.apps.resume(slug, runId, { dryRun: true, version: opts.appVersion })
          if (opts.json) {
            emit(plan, opts)
            return
          }
          table(
            plan.steps.map((s) => ({ node: s.nodeId, type: s.type, label: s.label ?? "" })),
            ["node", "type", "label"],
          )
          const price = plan.estimatedCredits === null ? "not billed in credits on this edition" : `about ${plan.estimatedCredits} credits`
          const reused = plan.reusedClips > 0 ? `, ${plan.reusedClips} finished clip(s) handed back at no cost` : ""
          success(`Retry of run ${plan.runId} (app version ${plan.appVersion ?? "?"}): ${plan.steps.length} step(s), ${price}${reused}`)
          if (plan.sufficient === false) {
            // The app credits, when they are what stops it; else the balance.
            warn(
              plan.appCreditsAllowance !== undefined
                ? "you have no app credits left to run apps: the Retry would be refused"
                : `your balance cannot cover it${plan.available !== null ? ` (${plan.available} available)` : ""}: the Retry would be refused`,
            )
          }
          dim(`start it: nodaro apps run-retry ${shellQuote(slug)} ${shellQuote(runId)}${opts.appVersion !== undefined ? ` --app-version ${opts.appVersion}` : ""}`)
          return
        }
        const result = await client.apps.resume(slug, runId, { version: opts.appVersion })
        if (opts.json && !opts.watch) {
          emit(result, opts)
          return
        }
        success(`execution ${result.executionId} (${result.status})${result.deduped ? " — this Retry was already started" : ""}`)
        if (!opts.watch) {
          dim(`follow: nodaro executions get ${result.executionId} --watch`)
          return
        }
        await watchExecution(client, result.executionId, opts)
      } catch (err) {
        for (const line of retryRefusalAdvice(slug, runId, err)) warn(line)
        handleError(err)
      }
    })

  return cmd
}
