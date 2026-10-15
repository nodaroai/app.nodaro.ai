import { Command } from "commander"
import { buildClient, handleError } from "../client.js"
import { detail, dim, emit, success, table, type OutputOpts } from "../output.js"
import { collectVariadic } from "../util.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

/** `--image <url>` or `--image "<url>|<caption>"` → one moodboard image. */
function imageOf(value: string): { url: string; caption?: string } {
  const bar = value.indexOf("|")
  if (bar === -1) return { url: value.trim() }
  const url = value.slice(0, bar).trim()
  const caption = value.slice(bar + 1).trim()
  return caption ? { url, caption } : { url }
}

export function moodboardsCommand(): Command {
  const cmd = new Command("moodboards").description(
    "your moodboards — use one on generate-image as direction.style \"moodboard:<id>\" (its description joins the prompt, its images go as style references)",
  )

  cmd
    .command("list")
    .description("your moodboards, newest first")
    .option("--limit <n>", "page size (1-100)")
    .option("--cursor <cursor>", "the previous page's nextCursor")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { limit?: string; cursor?: string } & GlobalOpts) => {
      try {
        const page = await buildClient(opts.profile).moodboards.list({
          limit: opts.limit ? Number(opts.limit) : undefined,
          cursor: opts.cursor,
        })
        if (opts.json) {
          emit(page, opts)
          return
        }
        table(
          page.data.map((m) => ({ id: m.id, name: m.name, images: m.images.length, updatedAt: m.updatedAt })),
          ["id", "name", "images", "updatedAt"],
        )
        if (page.nextCursor) dim(`next: --cursor ${page.nextCursor}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("get <id>")
    .description("show one moodboard with its images")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const board = await buildClient(opts.profile).moodboards.get(id)
        if (opts.json) emit(board, opts)
        else detail(board)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("create")
    .description("create a moodboard (1-12 images)")
    .requiredOption("--name <name>", "1-80 characters")
    .option("--image <url[|caption]>", 'image link, repeat per image (1-12); add "|caption" to describe it', collectVariadic)
    .option("--description <text>", "the words a run puts into the prompt (up to 1000 characters)")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { name: string; image?: string[]; description?: string } & GlobalOpts) => {
      try {
        if (!opts.image || opts.image.length === 0) throw new Error("a moodboard needs at least one --image")
        const board = await buildClient(opts.profile).moodboards.create({
          name: opts.name,
          ...(opts.description !== undefined ? { description: opts.description } : {}),
          images: opts.image.map(imageOf),
        })
        if (opts.json) {
          emit(board, opts)
          return
        }
        success(`created moodboard ${board.id} — use it as direction.style "moodboard:${board.id}"`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("update <id>")
    .description("change a moodboard: only what you pass is written; --image replaces every image")
    .option("--name <name>")
    .option("--description <text>")
    .option("--clear-description", "remove the description")
    .option("--image <url[|caption]>", "replace the images (repeat per image, 1-12)", collectVariadic)
    .option("--profile <name>")
    .option("--json")
    .action(
      async (
        id: string,
        opts: { name?: string; description?: string; clearDescription?: boolean; image?: string[] } & GlobalOpts,
      ) => {
        try {
          const input = {
            ...(opts.name !== undefined ? { name: opts.name } : {}),
            ...(opts.clearDescription ? { description: null } : opts.description !== undefined ? { description: opts.description } : {}),
            ...(opts.image && opts.image.length > 0 ? { images: opts.image.map(imageOf) } : {}),
          }
          if (Object.keys(input).length === 0) {
            throw new Error("nothing to update — provide --name, --description, --clear-description or --image")
          }
          const board = await buildClient(opts.profile).moodboards.update(id, input)
          if (opts.json) {
            emit(board, opts)
            return
          }
          success(`updated moodboard ${board.id}`)
        } catch (err) {
          handleError(err)
        }
      },
    )

  cmd
    .command("delete <id>")
    .description("delete a moodboard (the images it links to are untouched)")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        await buildClient(opts.profile).moodboards.delete(id)
        if (opts.json) {
          emit({ success: true, id }, opts)
          return
        }
        success(`deleted moodboard ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}
