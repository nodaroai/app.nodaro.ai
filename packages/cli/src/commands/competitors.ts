import { Command } from "commander"
import {
  COMPETITOR_ABOUT_PLATFORMS,
  COMPETITOR_ACCOUNT_KEYS,
  COMPETITOR_SCHEDULES,
  type CompetitorAccountKey,
  type CompetitorAboutPlatform,
  type CompetitorAccounts,
  type CompetitorSchedule,
  type TrackedCompetitor,
} from "@nodaro/shared"
import { buildClient, handleError } from "../client.js"
import { detail, emit, info, success, table, type OutputOpts } from "../output.js"
import { reportQueuedJob } from "../util.js"

interface GlobalOpts extends OutputOpts {
  profile?: string
}

interface AccountFlags {
  tiktok?: string
  instagram?: string
  youtube?: string
  x?: string
  linkedin?: string
  metaAds?: string
}

/** The account flags as the API's `accounts` (only the ones given). */
export function accountsFromFlags(flags: AccountFlags): CompetitorAccounts {
  const pairs: Array<[keyof CompetitorAccounts, string | undefined]> = [
    ["tiktok", flags.tiktok],
    ["instagram", flags.instagram],
    ["youtube", flags.youtube],
    ["x", flags.x],
    ["linkedin", flags.linkedin],
    ["meta_ads", flags.metaAds],
  ]
  return Object.fromEntries(pairs.filter(([, v]) => v !== undefined && v.trim() !== "")) as CompetitorAccounts
}

/** `--clear tiktok,x`: the accounts to remove (`meta-ads` reads as `meta_ads`). */
export function parseClear(raw: string | undefined): CompetitorAccountKey[] {
  if (raw === undefined) return []
  const wanted = raw
    .split(",")
    .map((p) => p.trim().replace(/-/g, "_"))
    .filter(Boolean)
  const bad = wanted.filter((p) => !(COMPETITOR_ACCOUNT_KEYS as readonly string[]).includes(p))
  if (bad.length > 0) throw new Error(`--clear takes ${COMPETITOR_ACCOUNT_KEYS.join(", ")} (got ${bad.join(", ")})`)
  return wanted as CompetitorAccountKey[]
}

/**
 * The brand's accounts after an update. The API replaces the whole set, so
 * the CLI starts from the stored accounts, sets the flags given and removes
 * the cleared ones: `--x newhandle` changes X and keeps the rest.
 */
export function mergeAccounts(current: CompetitorAccounts, set: CompetitorAccounts, clear: readonly CompetitorAccountKey[]): CompetitorAccounts {
  const both = clear.filter((key) => set[key] !== undefined)
  if (both.length > 0) throw new Error(`cannot both set and clear ${both.join(", ")}`)
  const merged: CompetitorAccounts = { ...current, ...set }
  return Object.fromEntries(
    Object.entries(merged).filter(([key, value]) => !clear.includes(key as CompetitorAccountKey) && typeof value === "string" && value.trim() !== ""),
  ) as CompetitorAccounts
}

export function parseAbout(raw: string | undefined): CompetitorAboutPlatform[] | undefined {
  if (raw === undefined) return undefined
  const wanted = raw.split(",").map((p) => p.trim()).filter(Boolean)
  const bad = wanted.filter((p) => !(COMPETITOR_ABOUT_PLATFORMS as readonly string[]).includes(p))
  if (bad.length > 0) throw new Error(`--about takes ${COMPETITOR_ABOUT_PLATFORMS.join(", ")} (got ${bad.join(", ")})`)
  return wanted as CompetitorAboutPlatform[]
}

export function parseSchedule(raw: string | undefined): CompetitorSchedule | undefined {
  if (raw === undefined) return undefined
  if (!(COMPETITOR_SCHEDULES as readonly string[]).includes(raw)) throw new Error(`--schedule takes ${COMPETITOR_SCHEDULES.join(", ")}`)
  return raw as CompetitorSchedule
}

function withAccountFlags(cmd: Command): Command {
  return cmd
    .option("--tiktok <handle>", "TikTok account (handle or link)")
    .option("--instagram <handle>", "Instagram account")
    .option("--youtube <channel>", "YouTube channel (@handle or link)")
    .option("--x <handle>", "X account")
    .option("--linkedin <page>", "LinkedIn company page (link or slug)")
    .option("--meta-ads <advertiser>", "Meta ads advertiser name or page id")
    .option("--about <platforms>", `where to search posts naming it, comma separated: ${COMPETITOR_ABOUT_PLATFORMS.join(",")}`)
    .option("--schedule <when>", `${COMPETITOR_SCHEDULES.join(" | ")} (default weekly)`)
}

function rows(list: readonly TrackedCompetitor[]) {
  return list.map((c) => ({
    id: c.id,
    brand: c.isOwn ? `${c.brand} (yours)` : c.brand,
    searches: c.searches,
    schedule: c.schedule,
    lastScan: c.scanning ? "scanning" : (c.lastScanAt ?? "").slice(0, 10) || "never",
    note: c.lastScanError ?? "",
  }))
}

export function competitorsCommand(): Command {
  const cmd = new Command("competitors").description("brands you track (competitors or your own), their scans and action cards (Nodaro Cloud)")

  cmd
    .command("list")
    .description("list tracked brands")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: GlobalOpts) => {
      try {
        const list = await buildClient(opts.profile).competitors.list()
        if (opts.json) return emit(list, opts)
        table(rows(list), ["id", "brand", "searches", "schedule", "lastScan", "note"])
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("show <id>")
    .description("one brand: accounts, its latest scan and its cards")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const found = await buildClient(opts.profile).competitors.get(id)
        if (opts.json) return emit(found, opts)
        detail({ ...found, latestScan: found.latestScan ? { at: found.latestScan.at, counts: found.latestScan.counts, cards: found.latestScan.cards.map((c) => c.title) } : null })
      } catch (err) {
        handleError(err)
      }
    })

  withAccountFlags(
    cmd
      .command("add")
      .description("track a brand; with --website and no account flags, its accounts are found from the site")
      .option("--brand <name>", "its name (read from the website when left out)")
      .option("--website <url>", "its website")
      .option("--own", "your own brand"),
  )
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: AccountFlags & { brand?: string; website?: string; own?: boolean; about?: string; schedule?: string } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        let accounts = accountsFromFlags(opts)
        let brand = opts.brand?.trim() ?? ""
        let guessed: string[] = []
        if (opts.website && Object.keys(accounts).length === 0) {
          const found = await client.competitors.discover(opts.website)
          brand = brand || found.brand
          accounts = Object.fromEntries(Object.entries(found.accounts).map(([k, v]) => [k, v!.value])) as CompetitorAccounts
          guessed = Object.entries(found.accounts).flatMap(([k, v]) => (v!.from === "guess" ? [k] : []))
        }
        if (!brand) throw new Error("give --brand, or --website to read it from")
        const created = await client.competitors.create({
          brand,
          ...(opts.website ? { website: opts.website } : {}),
          accounts,
          ...(opts.about !== undefined ? { aboutPlatforms: parseAbout(opts.about) } : {}),
          ...(opts.own ? { isOwn: true } : {}),
          ...(opts.schedule !== undefined ? { schedule: parseSchedule(opts.schedule) } : {}),
        })
        if (opts.json) return emit(created, opts)
        success(`tracking ${created.brand} (${created.id}): ${created.searches} searches per scan, ${created.schedule}`)
        if (guessed.length > 0) info(`guessed, check them: ${guessed.join(", ")}`)
      } catch (err) {
        handleError(err)
      }
    })

  withAccountFlags(cmd.command("update <id>").description("change a brand's accounts, platforms or schedule").option("--brand <name>").option("--website <url>"))
    .option("--clear <platforms>", `accounts to remove, comma separated: ${COMPETITOR_ACCOUNT_KEYS.join(",")}`)
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: AccountFlags & { brand?: string; website?: string; about?: string; schedule?: string; clear?: string } & GlobalOpts) => {
      try {
        const set = accountsFromFlags(opts)
        const clear = parseClear(opts.clear)
        const client = buildClient(opts.profile)
        const changesAccounts = Object.keys(set).length > 0 || clear.length > 0
        const input = {
          ...(opts.brand !== undefined ? { brand: opts.brand } : {}),
          ...(opts.website !== undefined ? { website: opts.website } : {}),
          ...(opts.about !== undefined ? { aboutPlatforms: parseAbout(opts.about) } : {}),
          ...(opts.schedule !== undefined ? { schedule: parseSchedule(opts.schedule) } : {}),
        }
        if (!changesAccounts && Object.keys(input).length === 0) throw new Error("nothing to change")
        const accounts = changesAccounts ? mergeAccounts((await client.competitors.get(id)).accounts, set, clear) : undefined
        const updated = await client.competitors.update(id, { ...input, ...(accounts ? { accounts } : {}) })
        if (opts.json) return emit(updated, opts)
        success(`updated ${updated.brand}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("remove <id>")
    .description("stop tracking a brand (its scans go too)")
    .option("--profile <name>")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        await buildClient(opts.profile).competitors.delete(id)
        success(`removed ${id}`)
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("discover <website>")
    .description("find a brand's accounts from its website (free)")
    .option("--profile <name>")
    .option("--json")
    .action(async (website: string, opts: GlobalOpts) => {
      try {
        const found = await buildClient(opts.profile).competitors.discover(website)
        if (opts.json) return emit(found, opts)
        info(`${found.brand} — ${found.website}`)
        table(
          Object.entries(found.accounts).map(([platform, v]) => ({ platform, account: v!.value, from: v!.from })),
          ["platform", "account", "from"],
        )
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("scan <id>")
    .description("scan a brand now (one Social Search page per search; failed searches are not charged)")
    .option("--watch", "wait for the scan to finish")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: { watch?: boolean } & GlobalOpts) => {
      try {
        const client = buildClient(opts.profile)
        const result = await client.competitors.scan(id)
        await reportQueuedJob(result, () => client.jobs.get(result.jobId), { ...opts, note: "competitor scan" })
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("cards")
    .description("what to do now: every action card, most urgent first")
    .option("--profile <name>")
    .option("--json")
    .action(async (opts: GlobalOpts) => {
      try {
        const result = await buildClient(opts.profile).competitors.cards()
        if (opts.json) return emit(result, opts)
        if (result.cards.length === 0) return info("no cards yet: scan a brand first (nodaro competitors scan <id>)")
        for (const card of result.cards) {
          info(`[${card.priority === 1 ? "act now" : card.priority === 2 ? "opening" : "good to know"}] ${card.title}`)
          info(`   ${card.why}`)
          info(`   → ${card.action}`)
          for (const postId of card.evidence) {
            const url = result.posts[postId]?.url
            if (url) info(`   ${url}`)
          }
        }
      } catch (err) {
        handleError(err)
      }
    })

  cmd
    .command("lessons <id>")
    .description("what works for a brand: what its best posts share, per platform (free)")
    .option("--profile <name>")
    .option("--json")
    .action(async (id: string, opts: GlobalOpts) => {
      try {
        const result = await buildClient(opts.profile).competitors.lessons(id)
        if (opts.json) return emit(result, opts)
        const { platforms, minPosts } = result.lessons
        if (platforms.length === 0) return info("no posts of its own yet: add an account and scan (nodaro competitors scan <id>)")
        for (const pl of platforms) {
          if (pl.usual === null) {
            info(`${pl.platform}: ${pl.posts} posts — needs ${minPosts} to tell what works`)
            continue
          }
          info(`${pl.platform}: ${pl.posts} posts, usually ${Math.round(pl.usual)} ${pl.unit}`)
          if (pl.lessons.length === 0) info("   nothing stands out yet")
          for (const lesson of pl.lessons) {
            info(`   • ${lesson.text}`)
            for (const postId of lesson.evidence) {
              const url = result.posts[postId]?.url
              if (url) info(`     ${url}`)
            }
          }
        }
      } catch (err) {
        handleError(err)
      }
    })

  return cmd
}
