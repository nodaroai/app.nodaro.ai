import { Command } from "commander"
import type { GalleryMediaType } from "@nodaro/sdk"
import { buildClient, handleError } from "../client.js"
import { dim, emit, info, success, table, type OutputOpts } from "../output.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

interface BrowseOpts extends GlobalOpts {
  type?: string
  user?: string
  favorites?: boolean
  limit?: string
  cursor?: string
}

const MEDIA_TYPES: readonly GalleryMediaType[] = ["image", "video", "audio"]

function mediaType(value: string | undefined): GalleryMediaType | undefined {
  if (value === undefined) return undefined
  if (!(MEDIA_TYPES as readonly string[]).includes(value)) {
    throw new Error(`--type takes ${MEDIA_TYPES.join(", ")} (got "${value}")`)
  }
  return value as GalleryMediaType
}

export function galleryCommand(): Command {
  const cmd = new Command("gallery").description("the public gallery, and your favorites")

  cmd
    .command("browse")
    .description("the public gallery, newest first — or one person's work with --user, or your favorites with --favorites")
    .option("--type <type>", "image, video or audio")
    .option("--user <id>", "only this person's work (your own id includes your private items)")
    .option("--favorites", "only your own items that you favorited")
    .option("--limit <n>", "page size (1-50)")
    .option("--cursor <cursor>", "the previous page's nextCursor")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: BrowseOpts) => {
      try {
        const type = mediaType(opts.type)
        // The gallery lists your own favorites only (another person's are
        // refused), so --favorites asks who you are rather than taking --user.
        if (opts.favorites && opts.user) throw new Error("--favorites lists your own favorites: drop --user")
        const client = buildClient(opts.profile)
        const userId = opts.favorites ? (await client.me()).id : opts.user
        const page = await client.gallery.browse({
          type,
          userId,
          favoritesOnly: opts.favorites,
          limit: opts.limit ? Number(opts.limit) : undefined,
          cursor: opts.cursor,
        })
        if (opts.json) {
          emit(page, opts)
          return
        }
        table(
          page.data.map((item) => ({ id: item.id, type: item.type, url: item.outputUrl, created: item.createdAt })),
          ["id", "type", "url", "created"],
        )
        if (page.nextCursor) dim(`next: --cursor ${page.nextCursor}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("favorite <jobId>")
    .description("favorite a job (your own, or a public one) — or remove it from your favorites when it is one")
    .option("--profile <name>")
    .option("--json")
    .action(async (jobId: string, opts: GlobalOpts) => {
      try {
        const result = await buildClient(opts.profile).gallery.toggleFavorite(jobId)
        if (opts.json) emit(result, opts)
        else success(result.favorited ? `favorited job ${jobId}` : `removed job ${jobId} from your favorites`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("favorites")
    .description("your favorited job ids, newest first")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: GlobalOpts) => {
      try {
        const ids = await buildClient(opts.profile).gallery.favorites()
        if (opts.json) emit(ids, opts)
        else for (const id of ids) info(id)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}
