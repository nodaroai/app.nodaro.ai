import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { detail, dim, emit, success, table, type OutputOpts } from "../output.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

/** Comma- or space-separated ids from one option value. */
function idList(value: string): string[] {
  return value.split(/[\s,]+/).filter(Boolean)
}

export function sessionsCommand(): Command {
  const cmd = new Command("sessions").description(
    "generation sessions inside projects: list, read, create, rename, archive, import, remove, delete",
  )

  cmd
    .command("list")
    .description("your sessions, newest first")
    .option("--project <id>", "only this project's sessions (none: the sessions with no project)")
    .option("--tool <tool>", "only this tool's sessions, e.g. create-image")
    .option("--archived", "include archived sessions")
    .option("--limit <n>", "page size (1-100)")
    .option("--cursor <cursor>", "the previous page's next")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { project?: string; tool?: string; archived?: boolean; limit?: string; cursor?: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const page = await client.sessions.list({
          projectId: opts.project,
          tool: opts.tool,
          includeArchived: opts.archived,
          limit: opts.limit ? Number(opts.limit) : undefined,
          cursor: opts.cursor,
        })
        if (opts.json) {
          emit(page, opts)
          return
        }
        table(
          page.data.map((s) => ({
            id: s.id,
            title: s.title ?? "(untitled)",
            tool: s.tool,
            items: s.itemCount,
            updatedAt: s.updatedAt,
          })),
          ["id", "title", "tool", "items", "updatedAt"],
        )
        if (page.next) dim(`next: --cursor ${page.next}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("get <id>")
    .description("show one session")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const result = await buildClient(opts.profile).sessions.get(id)
        if (opts.json) emit(result.data, opts)
        else detail(result.data)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("items <id>")
    .description("a session's items, born-in and imported, newest first")
    .option("--removed", "the items removed from it (its Trash) instead")
    .option("--limit <n>", "page size (1-100)")
    .option("--cursor <cursor>", "the previous page's next")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { removed?: boolean; limit?: string; cursor?: string } & GlobalOpts) => {
      try {
        const page = await buildClient(opts.profile).sessions.items(id, {
          removed: opts.removed,
          limit: opts.limit ? Number(opts.limit) : undefined,
          cursor: opts.cursor,
        })
        if (opts.json) {
          emit(page, opts)
          return
        }
        table(
          page.data.map((i) => ({
            jobId: i.jobId,
            status: i.job.status,
            imported: i.imported ? `from ${i.importedFrom?.title ?? i.importedFrom?.sessionId ?? "?"}` : "",
            ...(opts.removed ? { removedAt: i.removedAt ?? "" } : { addedAt: i.addedAt }),
          })),
          ["jobId", "status", "imported", opts.removed ? "removedAt" : "addedAt"],
        )
        if (page.next) dim(`next: --cursor ${page.next}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("create")
    .description("open a session (its project is fixed once set)")
    .requiredOption("--tool <tool>", "the creation tool, e.g. create-image")
    .option("--project <id>", "one of your projects")
    .option("--title <title>")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { tool: string; project?: string; title?: string } & GlobalOpts) => {
      try {
        const result = await buildClient(opts.profile).sessions.create({
          tool: opts.tool,
          projectId: opts.project,
          title: opts.title,
        })
        if (opts.json) {
          emit(result.data, opts)
          return
        }
        success(`created session ${result.data.id}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("update <id>")
    .description("rename or archive a session, or pick its cover")
    .option("--title <title>", "new title")
    .option("--untitled", "clear the title")
    .option("--archive", "archive it")
    .option("--unarchive", "bring it back")
    .option("--cover <jobId>", "one of the session's items to lead its previews")
    .option("--auto-cover", "go back to the automatic cover")
    .option("--profile <name>")
    .option("--json")
    .action(async (
      id: string,
      opts: { title?: string; untitled?: boolean; archive?: boolean; unarchive?: boolean; cover?: string; autoCover?: boolean } & GlobalOpts,
    ) => {
      try {
        const title = opts.untitled ? null : opts.title
        const archived = opts.archive ? true : opts.unarchive ? false : undefined
        const coverJobId = opts.autoCover ? null : opts.cover
        if (title === undefined && archived === undefined && coverJobId === undefined) {
          throw new Error("nothing to update — provide --title, --untitled, --archive, --unarchive, --cover or --auto-cover")
        }
        const result = await buildClient(opts.profile).sessions.update(id, { title, archived, coverJobId })
        if (opts.json) {
          emit(result.data, opts)
          return
        }
        success(`updated session ${result.data.id}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("import <id>")
    .description("import some of your jobs into a session — links, not copies; all-or-nothing")
    .requiredOption("--jobs <ids>", "job ids, comma- or space-separated (up to 100)")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { jobs: string } & GlobalOpts) => {
      try {
        const result = await buildClient(opts.profile).sessions.importItems(id, { jobIds: idList(opts.jobs) })
        if (opts.json) {
          emit(result.data, opts)
          return
        }
        success(`imported ${result.data.imported} of ${result.data.requested}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("move <id>")
    .description("move items of another session into this one, all-or-nothing (the source keeps them in its Trash)")
    .requiredOption("--from <sessionId>", "the session they are in now")
    .requiredOption("--jobs <ids>", "job ids, comma- or space-separated (up to 100)")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { from: string; jobs: string } & GlobalOpts) => {
      try {
        const result = await buildClient(opts.profile).sessions.moveItems(id, { jobIds: idList(opts.jobs), fromSessionId: opts.from })
        if (opts.json) {
          emit(result.data, opts)
          return
        }
        success(`moved ${result.data.moved} into session ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("remove <id> <jobId>")
    .description("remove one item from a session: to its Trash (the job stays); --forever deletes a removed one for good")
    .option("--forever", "delete an item already removed, for good (the job stays)")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, jobId: string, opts: { forever?: boolean } & GlobalOpts) => {
      try {
        await buildClient(opts.profile).sessions.removeItem(id, jobId, { forever: opts.forever })
        if (opts.json) {
          emit({ success: true, id, jobId }, opts)
          return
        }
        success(opts.forever ? `deleted ${jobId} from session ${id} for good` : `removed ${jobId} from session ${id} (in its Trash)`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("restore <id> <jobId>")
    .description("bring a removed item back into its session")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, jobId: string, opts: GlobalOpts) => {
      try {
        await buildClient(opts.profile).sessions.restoreItem(id, jobId)
        if (opts.json) {
          emit({ success: true, id, jobId }, opts)
          return
        }
        success(`restored ${jobId} in session ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("delete <id>")
    .description("delete a session and its links (its jobs are kept)")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        await buildClient(opts.profile).sessions.delete(id)
        if (opts.json) {
          emit({ success: true, id }, opts)
          return
        }
        success(`Deleted session ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}
