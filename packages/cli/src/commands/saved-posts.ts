import { readFileSync } from "node:fs"
import { Command } from "commander"
import { SOCIAL_PLATFORMS, isSocialPost, type SocialPlatform, type SocialPost } from "@nodaro/shared"
import { buildClient, handleError } from "../client.js"
import { emit, success, table, type OutputOpts } from "../output.js"
import { collectVariadic } from "../util.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

/**
 * The post to save from a JSON file: one post, or a list of posts (a Social
 * Search run's `output_data.json`) with `index` choosing one.
 */
export function postFromJson(value: unknown, index = 0): SocialPost {
  const candidate = Array.isArray(value) ? value[index] : value
  if (!isSocialPost(candidate)) {
    throw new Error(
      Array.isArray(value)
        ? `item ${index} of the file is not a Social Search post`
        : "the file is not a Social Search post (or a list of them)",
    )
  }
  return candidate
}

function readJson(path: string): unknown {
  let raw: string
  try {
    raw = readFileSync(path === "-" ? 0 : path, "utf8")
  } catch (err) {
    throw new Error(`cannot read ${path}: ${(err as Error).message}`)
  }
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${(err as Error).message}`)
  }
}

function parsePlatform(raw: string | undefined): SocialPlatform | undefined {
  if (raw === undefined) return undefined
  if (!(SOCIAL_PLATFORMS as readonly string[]).includes(raw)) {
    throw new Error(`--platform must be one of ${SOCIAL_PLATFORMS.join(", ")}`)
  }
  return raw as SocialPlatform
}

function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export function savedPostsCommand(): Command {
  const cmd = new Command("saved-posts").description(
    "your inspiration wall: posts saved from Social Search, with notes and tags",
  )

  cmd
    .command("list")
    .description("list your saved posts, newest first")
    .option("--platform <platform>", `one of ${SOCIAL_PLATFORMS.join(", ")}`)
    .option("--tag <tag>", "only saves with this tag")
    .option("--q <words>", "words in the note or the post")
    .option("--limit <n>", "page size, 1-100 (default 40)")
    .option("--cursor <cursor>", "the next cursor printed by the previous page")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { platform?: string; tag?: string; q?: string; limit?: string; cursor?: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const page = await client.savedPosts.list({
          platform: parsePlatform(opts.platform),
          tag: opts.tag,
          q: opts.q,
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
            platform: s.platform,
            author: s.post.author.handle ? `@${s.post.author.handle.replace(/^@/, "")}` : s.post.author.name,
            saved: s.createdAt.slice(0, 10),
            note: shorten(s.note, 40),
            tags: s.tags.join(","),
            url: s.url,
          })),
          ["id", "platform", "author", "saved", "note", "tags", "url"],
        )
        if (page.nextCursor) success(`more: --cursor "${page.nextCursor}"`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("save")
    .description("save a post from a JSON file (one post, or a Social Search output list with --index)")
    .requiredOption("--file <path>", "the post as JSON; - reads stdin")
    .option("--index <n>", "which post of a list to save (default 0)")
    .option("--note <text>", "why it is worth keeping")
    .option("--tag <tag>", "a tag (repeat for more)", collectVariadic)
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { file: string; index?: string; note?: string; tag?: string[] } & GlobalOpts) => {
      try {
        const post = postFromJson(readJson(opts.file), opts.index ? Number(opts.index) : 0)
        const client = buildClient(opts.profile)
        const save = await client.savedPosts.save({ post, note: opts.note, tags: opts.tag, source: "manual" })
        if (opts.json) {
          emit(save, opts)
          return
        }
        success(`saved ${save.url} (id ${save.id})`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("update <id>")
    .description("change a save's note or tags (the tags you give replace the old ones)")
    .option("--note <text>", "the new note; an empty string clears it")
    .option("--tag <tag>", "a tag (repeat for more)", collectVariadic)
    .option("--clear-tags", "remove every tag")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { note?: string; tag?: string[]; clearTags?: boolean } & GlobalOpts) => {
      try {
        const tags = opts.clearTags ? [] : opts.tag
        if (opts.note === undefined && tags === undefined) {
          throw new Error("nothing to change: give --note, --tag or --clear-tags")
        }
        const client = buildClient(opts.profile)
        const save = await client.savedPosts.update(id, { note: opts.note, tags })
        if (opts.json) {
          emit(save, opts)
          return
        }
        success(`updated ${save.id}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("delete <id>")
    .description("remove a save and its copied still")
    .option("--profile <name>")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        await client.savedPosts.delete(id)
        success(`deleted ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}
