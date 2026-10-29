import { Command, Option } from "commander"
import type { TrendChips, TrendResolution, TrendRunRequest, TrendRunSlot } from "@nodaro/sdk/trends"
import { buildClient, handleError } from "../client.js"
import { detail, dim, emit, info, success, table, terminalSafe, type OutputOpts } from "../output.js"
import { collectVariadic } from "../util.js"
import { neutralQuote, quotePartLabel } from "../quote-parts.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

const RESOLUTIONS: readonly TrendResolution[] = ["480p", "720p", "1080p"]
/** The server's slot-key shape (`SLOT_KEY_RE`). */
const SLOT_KEY_RE = /^[a-z0-9_]{1,32}$/
/** `--slot` pictures are split only where a new URL starts, so a URL holding commas stays whole. */
const URL_SPLIT_RE = /,(?=\s*https?:\/\/)/i
const CHIPS: ReadonlyArray<keyof TrendChips> = ["body", "outfit", "hair", "coat", "shape", "finish"]

/** The flags `estimate` and `run` share: what goes in the run's body. */
interface RunFlags {
  slot?: string[]
  choice?: string[]
  example?: string
  details?: string
  preview?: boolean
  resolution?: TrendResolution
  /** Commander defaults a lone `--no-draft` to `true`; only `false` (the flag given) is sent. */
  draft?: boolean
}

function addRunFlags(cmd: Command): Command {
  return cmd
    .option(
      "--slot <key=url[,url]>",
      "a slot's pictures, 1-3 per slot (repeat for each slot; the same key again adds pictures)",
      collectVariadic,
    )
    .option(
      "--choice <key.chip=new|original>",
      "a slot's chip: make it anew from your pictures or keep the clip's, e.g. person.outfit=original (repeatable; only the chips `trends get` lists for the slot)",
      collectVariadic,
    )
    .option(
      "--example <n>",
      "1-based example, as `trends get` lists its examples, whose pictures fill the optional slots you leave empty (default 1); leave it out on a trend with no example, whose empty optional slots stay as in the original; a Full depth trend uses its default image for the role if one is set, otherwise the original's look",
    )
    .option("--details <text>", "your own words (at most 1,000 characters); mention a slot as {slot:<key>}")
    .option("--preview", "a 4-second preview run (only when the trend offers one)")
    .addOption(
      new Option("--resolution <r>", "one the trend offers (`trends get`); default its first: 480p, or 720p on a Nodaro Motion Pulse trend").choices([...RESOLUTIONS]),
    )
    .option("--no-draft", "a full run instead of a draft (a draft is 480p only, and the default there; a Nodaro Motion Pulse trend has none)")
}

function checkSlotKey(flag: string, spec: string, key: string): void {
  // `__proto__` fits the shape but is no slot: refused here rather than sent.
  if (!SLOT_KEY_RE.test(key) || key === "__proto__") {
    throw new Error(`${flag} ${spec}: "${key}" is not a slot key (lowercase letters, digits and _, up to 32; see \`nodaro trends get <slug>\`)`)
  }
}

/** `key=url[,url]` → the slot key and its pictures. */
function parseSlot(spec: string): { key: string; images: string[] } {
  const eq = spec.indexOf("=")
  const key = eq === -1 ? "" : spec.slice(0, eq).trim()
  const images = eq === -1 ? [] : spec.slice(eq + 1).split(URL_SPLIT_RE).map((u) => u.trim()).filter(Boolean)
  if (!key || images.length === 0) {
    throw new Error(`--slot ${spec}: expected key=url[,url], e.g. --slot person=https://example.com/me.jpg`)
  }
  checkSlotKey("--slot", spec, key)
  return { key, images }
}

/** `key.chip=new|original` → the slot key, the chip and its value. */
function parseChoice(spec: string): { key: string; chip: keyof TrendChips; value: "new" | "original" } {
  const eq = spec.indexOf("=")
  const target = eq === -1 ? "" : spec.slice(0, eq).trim()
  const value = eq === -1 ? "" : spec.slice(eq + 1).trim()
  const dot = target.lastIndexOf(".")
  const key = dot === -1 ? "" : target.slice(0, dot)
  const chip = dot === -1 ? "" : target.slice(dot + 1)
  if (!key || !chip) {
    throw new Error(`--choice ${spec}: expected key.chip=new|original, e.g. --choice person.outfit=original`)
  }
  if (!(CHIPS as readonly string[]).includes(chip)) {
    throw new Error(`--choice ${spec}: the chip must be one of ${CHIPS.slice(0, -1).join(", ")} or ${CHIPS.at(-1)}`)
  }
  if (value !== "new" && value !== "original") {
    throw new Error(`--choice ${spec}: the value must be new or original`)
  }
  checkSlotKey("--choice", spec, key)
  return { key, chip: chip as keyof TrendChips, value }
}

/** `--limit`: a page size of 1-60, as the server takes it. */
function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const n = Number(raw)
  if (!/^\d+$/.test(raw.trim()) || !Number.isInteger(n) || n < 1 || n > 60) {
    throw new Error(`--limit ${raw}: expected a whole number from 1 to 60`)
  }
  return n
}

/** The body of `estimate` / `run` from the shared flags. Only what was given is sent. */
function buildRequest(flags: RunFlags): TrendRunRequest {
  // No prototype: a key is only ever a slot of this run (the keys are checked too).
  const slots: Record<string, TrendRunSlot> = Object.create(null) as Record<string, TrendRunSlot>
  for (const spec of flags.slot ?? []) {
    const { key, images } = parseSlot(spec)
    const slot = (slots[key] ??= {})
    slot.images = [...(slot.images ?? []), ...images]
  }
  for (const spec of flags.choice ?? []) {
    const { key, chip, value } = parseChoice(spec)
    ;(slots[key] ??= {})[chip] = value
  }
  const request: TrendRunRequest = { slots }
  if (flags.example !== undefined) {
    const n = Number(flags.example)
    if (!Number.isInteger(n) || n < 1) throw new Error(`--example ${flags.example}: expected a whole number from 1`)
    request.example = n
  }
  if (flags.details !== undefined) request.details = flags.details
  if (flags.preview) request.preview = true
  if (flags.resolution) request.resolution = flags.resolution
  if (flags.draft === false) request.draft = false
  return request
}

export function trendsCommand(): Command {
  const cmd = new Command("trends").description(
    "trends — ready-made Nodaro Motion recipes: browse, quote, run with your own pictures, favorite (Cloud edition)",
  )

  cmd
    .command("list")
    .description("the published trend catalog, in its curated order")
    .option("--search <text>", "search text")
    .option("--tag <tag>", "only trends with this tag")
    .option("--favorites", "only your favorites")
    .option("--locale <locale>", "language of names and descriptions (default your profile's, then English)")
    .option("--limit <n>", "page size (1-60)")
    .option("--cursor <cursor>", "the previous page's next")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { search?: string; tag?: string; favorites?: boolean; locale?: string; limit?: string; cursor?: string } & GlobalOpts) => {
      try {
        const limit = parseLimit(opts.limit)
        const client = buildClient(opts.profile)
        const page = await client.trends.list({
          q: opts.search,
          tag: opts.tag,
          favorites: opts.favorites,
          locale: opts.locale,
          limit,
          cursor: opts.cursor,
        })
        if (opts.json) {
          emit(page, opts)
          return
        }
        table(
          page.data.map((t) => ({
            slug: t.slug,
            name: t.name,
            needs: Object.entries(t.needs)
              .filter(([, n]) => n > 0)
              .map(([kind, n]) => `${n} ${kind}`)
              .join(", "),
            seconds: t.durationSec,
            tags: t.tags.join(", "),
            favorite: t.isFavorite ? "★" : "",
          })),
          ["slug", "name", "needs", "seconds", "tags", "favorite"],
        )
        if (page.next) dim(`next: --cursor ${page.next}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("get <slug>")
    .description("a trend's page: its original, slots, examples, preview, engine and resolutions")
    .option("--locale <locale>", "language of names and descriptions")
    .option("--profile <name>")
    .option("--json")
    .action(async (slug: string, opts: { locale?: string } & GlobalOpts) => {
      try {
        const trend = await buildClient(opts.profile).trends.get(slug, { locale: opts.locale })
        if (opts.json) emit(trend, opts)
        else detail(trend)
      } catch (err) {
        handleError(err)
      }
    })

  addRunFlags(
    cmd
      .command("estimate <slug>")
      .description("quote a run before starting it (free)"),
  )
    .option("--profile <name>")
    .option("--json")
    .action(async (slug: string, opts: RunFlags & GlobalOpts) => {
      try {
        const request = buildRequest(opts)
        const quote = neutralQuote(await buildClient(opts.profile).trends.estimate(slug, request))
        if (opts.json) {
          emit(quote, opts)
          return
        }
        info(
          `about ${quote.expectedCredits} credits` +
            (quote.holdCredits !== quote.expectedCredits ? ` (up to ${quote.holdCredits} held while it runs)` : ""),
        )
        for (const [part, credits] of Object.entries(quote.breakdown)) dim(`  ${terminalSafe(quotePartLabel(part))}: ${credits}`)
      } catch (err) {
        handleError(err)
      }
    })

  addRunFlags(
    cmd
      .command("run <slug>")
      .description("start a run — SPENDS CREDITS; run `estimate` first. Prints the job to follow"),
  )
    .option("--session <id>", "a generation session of yours (accepted; not yet applied: trend runs are not filed into sessions yet)")
    .option("--idempotency-key <key>", "8-200 characters; a retry with the same key returns the first run's job")
    .option("--profile <name>")
    .option("--json")
    .action(async (slug: string, opts: RunFlags & { session?: string; idempotencyKey?: string } & GlobalOpts) => {
      try {
        const request = buildRequest(opts)
        if (opts.session) request.sessionId = opts.session
        const result = await buildClient(opts.profile).trends.run(
          slug,
          request,
          opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {},
        )
        if (opts.json) {
          emit(result, opts)
          return
        }
        success(`started trend run — job ${result.jobId}`)
        dim(`follow it: nodaro jobs get ${result.jobId}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("runs")
    .description("your trend runs, newest first")
    .option("--trend <slug>", "only runs of this trend")
    .option("--limit <n>", "page size (1-60)")
    .option("--cursor <cursor>", "the previous page's next")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: { trend?: string; limit?: string; cursor?: string } & GlobalOpts) => {
      try {
        const limit = parseLimit(opts.limit)
        const page = await buildClient(opts.profile).trends.runs({
          trend: opts.trend,
          cursor: opts.cursor,
          limit,
        })
        if (opts.json) {
          emit(page, opts)
          return
        }
        table(
          page.data.map((r) => ({
            jobId: r.jobId,
            trend: r.trend.slug,
            status: r.status,
            resolution: r.preview ? `${r.resolution} preview` : r.resolution,
            draft: r.draft,
            credits: r.creditsCharged,
            createdAt: r.createdAt,
            video: r.videoUrl,
          })),
          ["jobId", "trend", "status", "resolution", "draft", "credits", "createdAt", "video"],
        )
        if (page.next) dim(`next: --cursor ${page.next}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("favorite <slug>")
    .description("add a trend to your favorites")
    .option("--profile <name>")
    .option("--json")
    .action(async (slug: string, opts: GlobalOpts) => {
      try {
        await buildClient(opts.profile).trends.favorite(slug)
        if (opts.json) {
          emit({ success: true, slug }, opts)
          return
        }
        success(`added ${terminalSafe(slug)} to your favorites`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("unfavorite <slug>")
    .description("remove a trend from your favorites")
    .option("--profile <name>")
    .option("--json")
    .action(async (slug: string, opts: GlobalOpts) => {
      try {
        await buildClient(opts.profile).trends.unfavorite(slug)
        if (opts.json) {
          emit({ success: true, slug }, opts)
          return
        }
        success(`removed ${terminalSafe(slug)} from your favorites`)
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}
