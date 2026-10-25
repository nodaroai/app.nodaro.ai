import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { dim, emit, table, type OutputOpts } from "../output.js"

interface TrashOpts extends OutputOpts {
  profile?: string
  project?: string
  tool?: string
  type?: string
  limit?: string
  cursor?: string
}

/** `nodaro trash` — the Trash: items removed from sessions and deleted jobs. */
export function trashCommand(): Command {
  const cmd = new Command("trash").description("the Trash: items removed from sessions, and deleted jobs")

  cmd
    .command("list", { isDefault: true })
    .description("the Trash, newest first (restore: nodaro sessions restore / nodaro jobs restore)")
    .option("--project <id>", "one project's Trash (none: the sessions with no project, and General)")
    .option("--tool <tool>", "what a session of this tool holds or held, e.g. create-image")
    .option("--type <types>", "only these input_data.type values, comma-separated (e.g. generate-image)")
    .option("--limit <n>", "page size (1-100)")
    .option("--cursor <cursor>", "the previous page's next")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: TrashOpts) => {
      try {
        const page = await buildClient(opts.profile).trash.list({
          projectId: opts.project,
          tool: opts.tool,
          type: opts.type,
          limit: opts.limit ? Number(opts.limit) : undefined,
          cursor: opts.cursor,
        })
        if (opts.json) {
          emit(page, opts)
          return
        }
        table(
          page.data.map((e) => ({
            kind: e.kind,
            jobId: e.job.id,
            type: (e.job.input_data as { type?: unknown } | null)?.type ?? e.job.job_type ?? "",
            from: e.kind === "removed" ? (e.session.title ?? e.session.id) : "",
            at: e.kind === "removed" ? e.removedAt : e.deletedAt,
            purgeAt: e.kind === "deleted" ? e.purgeAt : "",
          })),
          ["kind", "jobId", "type", "from", "at", "purgeAt"],
        )
        if (page.next) dim(`next: --cursor ${page.next}`)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}
