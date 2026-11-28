/**
 * The daily run: read every enabled sitemap source for template pages not
 * seen before (each a candidate name), then read open candidates' public
 * posts (Social Search on TikTok, Instagram and YouTube, as the runner
 * admin), write the day's reading, and set the candidate's status and label
 * from its readings. A candidate reaching the creator threshold for the first
 * time is announced on Slack when the alert is on.
 *
 * A source or a candidate that fails is noted and skipped — one bad page
 * never stops the run; one platform failing keeps the others. The search
 * budget (`thresholds.dailySearchBudget`) bounds the day's searches: a
 * candidate is read only when the budget covers all of its searches, never
 * read candidates first (newest first), then the longest unread. A platform
 * whose search came back full is searched again in other orders while the
 * budget lasts (`DEEP_SORTS`), so a big trend's people are counted past one
 * search's ceiling.
 */
import type { FastifyInstance } from "fastify"
import { config } from "../../../lib/config.js"
import { safeFetch } from "../../../lib/safe-fetch.js"
import { supabase } from "../../../lib/supabase.js"
import { withJobSubmissionContext } from "../../../lib/job-submission-context.js"
import { isSocialPost, SOCIAL_SEARCH_PAGED_MODES, socialSearchMaxCount, type SocialPost, type SocialSearchCount } from "@nodaro/shared/social"
import { israelParts } from "../../notifications/israel-time.js"
import { getNotifyConfig } from "../../notifications/notify-config.js"
import { sendSlack } from "../../notifications/slack-client.js"
import { clusterPosts, panelGrowthPct } from "./cluster.js"
import { dayChangePct, labelOf, passesNow, statusOf } from "./labels.js"
import { nameOfSlug, newTemplatePages, parseSitemap, slugOfName, templateSlugOf } from "./sitemap.js"
import { keepStill, keptStills, withKeptStill, type KeepStill } from "./stills.js"
import {
  countSearch,
  listOpenCandidates,
  listReadings,
  listSources,
  markSourceRead,
  pruneReadings,
  readSettings,
  updateCandidate,
  updateOpenCandidate,
  upsertCandidate,
  writeReading,
  writeSettings,
  type StoredSettings,
} from "./store.js"
import { TREND_CANDIDATE_PLATFORMS, type TrendCandidatePlatform, type TrendCandidatePlatforms, type TrendCandidateReading, type TrendCandidateSearch, type TrendRadarLastRun } from "./types.js"

const SITEMAP_MAX_BYTES = 8 * 1024 * 1024
const SITEMAP_CHILDREN_MAX = 20
const SEARCH_WAIT_MS = 150_000
const SEARCH_POLL_MS = 3_000
/** New names a run takes from one source read; the rest are left unseen, so the next read takes them. */
const NEW_NAMES_PER_SOURCE = 25
/** Template slugs remembered per source: what the latest read listed comes first, so a catalog larger than this forgets only pages it no longer lists. */
const SEEN_SLUGS_MAX = 5000
const DAY_MS = 86_400_000

/**
 * The searches one candidate read makes: a keyword search on each platform,
 * for as many posts as the platform's keyword search can return (the shared
 * Social Search table: 60 on TikTok and Instagram, 20 on YouTube).
 */
export const RADAR_SEARCHES: ReadonlyArray<{ platform: TrendCandidatePlatform; count: SocialSearchCount }> = TREND_CANDIDATE_PLATFORMS.map((platform) => ({
  platform,
  count: socialSearchMaxCount(platform, "keyword"),
}))

/**
 * The deeper count. One search finds at most its count of posts, so a big
 * trend's people stop at that ceiling (60 on TikTok and Instagram). A platform
 * whose first search came back full is searched again in these orders, and
 * the posts the searches found are counted once each: people the first order
 * did not reach are counted too. Only platforms whose search can return more
 * than one page are deepened (YouTube's keyword search returns one page
 * whatever the order). The extra searches come out of the same daily budget.
 */
export const DEEP_SORTS = ["newest", "relevance"] as const
export type RadarSort = "popular" | (typeof DEEP_SORTS)[number]

const DEEP_PLATFORMS: ReadonlySet<TrendCandidatePlatform> = new Set(
  RADAR_SEARCHES.filter((s) => SOCIAL_SEARCH_PAGED_MODES[s.platform].includes("keyword")).map((s) => s.platform),
)

/** The most extra searches one candidate's deeper count makes. */
export const DEEP_SEARCHES_MAX = DEEP_PLATFORMS.size * DEEP_SORTS.length

/**
 * The account the run searches as cannot pay for a search (the search answered
 * 402). Every later search of the day would be refused the same way, so the
 * run stops reading and leaves the rest for tomorrow.
 */
export class RunnerOutOfCreditsError extends Error {
  constructor(detail: string) {
    super(`the account the run searches as is out of credits${detail ? `: ${detail}` : ""}`)
    this.name = "RunnerOutOfCreditsError"
  }
}

export const OUT_OF_CREDITS_STOP = "The account the run searches as ran out of credits; the remaining candidates wait for the next run."

export type RadarSearch = (query: string, runnerUserId: string, platform: TrendCandidatePlatform, count: SocialSearchCount, sort: RadarSort) => Promise<SocialPost[]>

export interface RunDeps {
  /** Reads a public page's text, or throws. The run's own goes through `safeFetch`. */
  fetchText?: (url: string) => Promise<string>
  /** Runs one social search as the runner and answers its posts, or throws. */
  search?: RadarSearch
  /** Whether the search engine suggests the query; `null` when unknown. */
  suggests?: (query: string) => Promise<boolean | null>
  /** Posts one Slack message; the run's own uses the founder webhook. */
  notify?: (text: string) => Promise<void>
  /** Copies a post's still into storage (`stills.ts`); its address there, or `null`. */
  keepStill?: KeepStill
  now?: () => Date
}

export interface RunReport extends TrendRadarLastRun {
  candidatesRead: number
  passed: string[]
  skipped: Array<{ what: string; why: string }>
}

type Resolved = Required<RunDeps>

async function fetchTextDefault(url: string): Promise<string> {
  const res = await safeFetch(url, { timeoutMs: 20_000, headers: { accept: "application/xml,text/xml;q=0.9,*/*;q=0.5" } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const length = Number(res.headers.get("content-length") ?? 0)
  if (length > SITEMAP_MAX_BYTES) throw new Error("sitemap too large")
  const text = await res.text()
  if (text.length > SITEMAP_MAX_BYTES) throw new Error("sitemap too large")
  return text
}

async function suggestsDefault(query: string): Promise<boolean | null> {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=${encodeURIComponent(query)}`
    const res = await safeFetch(url, { timeoutMs: 8_000 })
    if (!res.ok) return null
    const parsed = (await res.json()) as unknown
    if (!Array.isArray(parsed) || !Array.isArray(parsed[1])) return null
    const wanted = query.toLowerCase()
    return (parsed[1] as unknown[]).some((s) => typeof s === "string" && s.toLowerCase().includes(wanted))
  } catch {
    return null
  }
}

async function notifyDefault(text: string): Promise<void> {
  const cfg = await getNotifyConfig()
  if (!cfg.slackWebhookUrl) return
  await sendSlack(cfg.slackWebhookUrl, { text, noUnfurl: true })
}

/** Every page of a sitemap, following a sitemap index one level down. */
async function readSitemapPages(url: string, fetchText: (u: string) => Promise<string>) {
  const first = parseSitemap(await fetchText(url))
  if (first.urls.length || !first.sitemaps.length) return first.urls
  const pages = []
  for (const child of first.sitemaps.slice(0, SITEMAP_CHILDREN_MAX)) {
    try {
      pages.push(...parseSitemap(await fetchText(child)).urls)
    } catch {
      /* a child that cannot be read is skipped */
    }
  }
  return pages
}

/** One Social Search for a name on one platform, filed as the runner's job, waited to its end. */
export function makeSearch(app: FastifyInstance): RadarSearch {
  return async (query, runnerUserId, platform, count, sort) => {
    // A trend is a short clip: on YouTube that is a Short.
    const payload = { platform, mode: "keyword", query, count, period: "month", sort, ...(platform === "youtube" ? { videoKind: "shorts" } : {}), userId: runnerUserId }
    const res = await withJobSubmissionContext({ userId: runnerUserId, method: "POST", url: "/v1/social-search" }, () =>
      app.inject({
        method: "POST",
        url: "/v1/social-search",
        headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET, "x-internal-user-id": runnerUserId, "content-type": "application/json" },
        payload,
      }),
    )
    if (res.statusCode === 402) throw new RunnerOutOfCreditsError(res.body.slice(0, 200))
    if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`social search refused: ${res.statusCode} ${res.body.slice(0, 200)}`)
    const jobId = jobIdOf(res.body)
    if (!jobId) throw new Error("social search answered no job id")
    return waitForSearchPosts(jobId)
  }
}

function jobIdOf(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { jobId?: unknown; data?: { jobId?: unknown } }
    return typeof parsed.jobId === "string" ? parsed.jobId : typeof parsed.data?.jobId === "string" ? parsed.data.jobId : null
  } catch {
    return null
  }
}

async function waitForSearchPosts(jobId: string): Promise<SocialPost[]> {
  const deadline = Date.now() + SEARCH_WAIT_MS
  while (Date.now() < deadline) {
    // trash-read: polls the search job the run itself just submitted; it is not a user-facing listing.
    const { data, error } = await supabase.from("jobs").select("status, output_data, error_message").eq("id", jobId).maybeSingle()
    if (error) throw new Error(`job read failed: ${error.message}`)
    const row = data as { status: string; output_data: { json?: unknown } | null; error_message: string | null } | null
    if (row?.status === "completed") {
      const json = row.output_data?.json
      const list = Array.isArray(json) ? json : json && typeof json === "object" && Array.isArray((json as { posts?: unknown }).posts) ? (json as { posts: unknown[] }).posts : []
      return list.filter(isSocialPost)
    }
    if (row?.status === "failed" || row?.status === "cancelled") throw new Error(`social search failed: ${row.error_message ?? row.status}`)
    await new Promise((r) => setTimeout(r, SEARCH_POLL_MS))
  }
  throw new Error("social search did not finish in time")
}

type Source = Awaited<ReturnType<typeof listSources>>[number]
type Candidate = Awaited<ReturnType<typeof listOpenCandidates>>[number]

/** One sitemap source: its new template pages become candidates (after its baseline read). */
async function readSource(source: Source, deps: Resolved, report: RunReport): Promise<void> {
  try {
    const pages = await readSitemapPages(source.url!, deps.fetchText)
    const fresh = newTemplatePages(pages, new Set(source.seenSlugs))
    report.sourcesRead++
    report.namesSeen += pages.length
    // The first read that lists anything is the baseline: a site's whole
    // catalog is not "new today". Only later reads make candidates. (A
    // failed first read leaves the baseline unset, so the next one takes it.)
    const baseline = source.seenSlugs.length === 0
    const taken = baseline ? [] : fresh.slice(0, NEW_NAMES_PER_SOURCE)
    // Fresh pages beyond the day's share stay unseen: tomorrow's read takes them.
    const deferred = new Set(baseline ? [] : fresh.slice(NEW_NAMES_PER_SOURCE).map((f) => f.slug))
    for (const page of taken) {
      const slug = slugOfName(page.name)
      try {
        await upsertCandidate({
          name: page.name,
          slug,
          firstSeen: { kind: "template-site", name: source.name, url: page.url },
          templatesElsewhere: [{ site: source.name, url: page.url, since: page.lastmod, note: null }],
        })
      } catch (e) {
        report.skipped.push({ what: `candidate ${slug}`, why: e instanceof Error ? e.message : String(e) })
      }
    }
    // Only template pages are remembered (the same slugs `newTemplatePages`
    // compares against), the latest listing first: a catalog over the cap
    // forgets pages it no longer lists, never ones it still does.
    const listed = pages
      .map((p) => templateSlugOf(p.url))
      .filter((s): s is string => s !== null && !deferred.has(s))
    const seenSlugs = Array.from(new Set([...listed, ...source.seenSlugs])).slice(0, SEEN_SLUGS_MAX)
    await markSourceRead(source.id, { pages: pages.length, newToday: baseline ? 0 : taken.length, lastError: null, seenSlugs })
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e)
    report.skipped.push({ what: `source ${source.name}`, why })
    await markSourceRead(source.id, { pages: null, newToday: null, lastError: why }).catch(() => undefined)
  }
}

interface PlatformAnswer {
  platform: TrendCandidatePlatform
  count: SocialSearchCount
  posts: SocialPost[]
  /** Every search of this platform came back full: more people posted it than were counted. */
  capped: boolean
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * The candidate's searches, one per platform. Each is spent before it is
 * sent, whether or not it answers — a failing provider must not read every
 * open candidate for free all day — and counted one at a time (the day's
 * counter is a read-then-write). A platform that fails is noted and the
 * others kept; all failing fails the read.
 */
async function spend(searches: number, today: string, report: RunReport): Promise<void> {
  for (let i = 0; i < searches; i++) {
    report.searchesUsed++
    await countSearch(today).catch(() => undefined)
  }
}

async function searchPlatforms(c: Candidate, runner: string, today: string, deps: Resolved, report: RunReport): Promise<PlatformAnswer[]> {
  await spend(RADAR_SEARCHES.length, today, report)
  const query = `${c.name} ai`
  const settled = await Promise.allSettled(RADAR_SEARCHES.map((s) => Promise.resolve().then(() => deps.search(query, runner, s.platform, s.count, "popular"))))
  // Out of credits ends the day's reading: a partial reading is not kept.
  const broke = settled.find((r): r is PromiseRejectedResult => r.status === "rejected" && r.reason instanceof RunnerOutOfCreditsError)
  if (broke) throw broke.reason
  const answers: PlatformAnswer[] = []
  const failures: Array<{ platform: TrendCandidatePlatform; why: string }> = []
  settled.forEach((result, i) => {
    const s = RADAR_SEARCHES[i]!
    if (result.status === "fulfilled") answers.push({ ...s, posts: result.value, capped: result.value.length >= s.count })
    else failures.push({ platform: s.platform, why: messageOf(result.reason) })
  })
  if (answers.length === 0) throw new Error(failures.map((f) => `${f.platform}: ${f.why}`).join("; "))
  for (const f of failures) report.skipped.push({ what: `candidate ${c.slug} (${f.platform})`, why: f.why })
  return answers
}

/** Each post once, the first time it was found. */
function distinctPosts(posts: readonly SocialPost[]): SocialPost[] {
  const seen = new Set<string>()
  return posts.filter((p) => {
    const key = `${p.platform}:${p.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * The deeper count (`DEEP_SORTS`): each platform whose search came back full
 * is searched again in the other orders, as far as the day's budget
 * (`searchesLeft`) covers, and its posts become every distinct post found. A
 * platform stays capped while every one of its searches came back full. An
 * order that finds no post the platform's earlier searches did not stops
 * that platform's deeper count: the next order would not find one either,
 * and a search is not spent on nothing. A deeper search that fails is noted
 * and the answers so far kept; one the account cannot pay for ends the day
 * like any other. One search at a time, so each is spent before it is sent.
 */
async function deepen(c: Candidate, runner: string, today: string, answers: readonly PlatformAnswer[], searchesLeft: number, deps: Resolved, report: RunReport): Promise<PlatformAnswer[]> {
  const query = `${c.name} ai`
  let left = searchesLeft
  const deepened: PlatformAnswer[] = []
  for (const a of answers) {
    if (!a.capped || !DEEP_PLATFORMS.has(a.platform)) {
      deepened.push(a)
      continue
    }
    let posts = a.posts
    let capped: boolean = a.capped
    for (const sort of DEEP_SORTS) {
      if (left <= 0) break
      left--
      await spend(1, today, report)
      let found: SocialPost[]
      try {
        found = await deps.search(query, runner, a.platform, a.count, sort)
      } catch (e) {
        if (e instanceof RunnerOutOfCreditsError) throw e
        report.skipped.push({ what: `candidate ${c.slug} (${a.platform}, ${sort})`, why: messageOf(e) })
        continue
      }
      const merged = distinctPosts([...posts, ...found])
      const added = merged.length - posts.length
      posts = merged
      capped = capped && found.length >= a.count
      if (added === 0) break
    }
    deepened.push({ ...a, posts, capped })
  }
  return deepened
}

/**
 * The reading's growth over the posts the stored panel and this reading both
 * saw, per day since the previous reading. A second read on the same day
 * finds today's own panel stored, so it keeps the growth today's first read
 * measured.
 */
function readingGrowth(c: Candidate, panel: Record<string, number>, prior: readonly TrendCandidateReading[], today: string): number | null {
  if (c.last_read_at && israelParts(new Date(c.last_read_at)).date === today) {
    return prior.find((r) => r.date === today)?.growthPct ?? null
  }
  const previous = [...prior].reverse().find((r) => r.date < today)
  if (!previous) return null
  return panelGrowthPct(c.panel, panel, (Date.parse(today) - Date.parse(previous.date)) / DAY_MS)
}

function earliestOf(a: string | null | undefined, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return Date.parse(a) <= Date.parse(b) ? a : b
}

/** One open candidate: its searches, the day's reading, its status and label; the alert on its first pass. */
async function readCandidate(c: Candidate, runner: string, today: string, settings: StoredSettings, searchesLeft: () => number, deps: Resolved, report: RunReport): Promise<void> {
  try {
    const first = await searchPlatforms(c, runner, today, deps, report)
    const answers = await deepen(c, runner, today, first, searchesLeft(), deps, report)
    const cluster = clusterPosts(answers.flatMap((a) => a.posts))
    // A platform whose searches all returned as many posts as they may hides more creators.
    const cappedBy = new Set(answers.filter((a) => a.capped).map((a) => a.platform))
    const withCapped: TrendCandidatePlatforms = Object.fromEntries(
      Object.entries(cluster.platforms).map(([platform, share]) => [platform, { ...share, capped: cappedBy.has(platform as TrendCandidatePlatform) }]),
    )
    // The platforms' stills stop answering within hours: keep a copy of each
    // top post's while its link still answers (admin review only).
    const kept = await keptStills(cluster.top, Array.isArray(c.posts) ? c.posts : [], deps.keepStill)
    const top = cluster.top.map((p) => withKeptStill(p, kept))
    const platforms: TrendCandidatePlatforms = Object.fromEntries(
      Object.entries(withCapped).map(([platform, share]) => [platform, { ...share, top: share.top ? withKeptStill(share.top, kept) : null }]),
    )
    const creatorsCapped = cappedBy.size > 0
    const creatorsText = `${cluster.creators}${creatorsCapped ? "+" : ""} creators`
    const prior = await listReadings(c.id)
    const growthPct = readingGrowth(c, cluster.panel, prior, today)
    const readings = await writeReading(c.id, { day: today, creators: cluster.creators, plays: cluster.plays, posts: cluster.posts, growthPct })
    const status = statusOf(c.status, readings, settings.thresholds)
    const label = labelOf(readings, settings.thresholds)
    const passed = passesNow(readings, settings.thresholds)
    let search: TrendCandidateSearch | null = c.search
    if (passed || (status === "candidate" && !search)) {
      search = { suggest: await deps.suggests(`${c.name} ai`), interest7d: null, checkedAt: deps.now().toISOString() }
    }
    // Lands only while the candidate is still open: an admin's decision made
    // during the search (approve, reject) stays, and the day's reading is kept.
    const written = await updateOpenCandidate(c.id, {
      status,
      label,
      soundName: cluster.soundName ?? c.sound_name,
      durationSec: cluster.durationSec ?? c.duration_sec,
      creators: cluster.creators,
      creatorsCapped,
      plays: cluster.plays,
      dayChangePct: dayChangePct(readings),
      topPost: top[0] ?? null,
      posts: top,
      platforms,
      firstPostedAt: earliestOf(c.first_posted_at, cluster.firstPostedAt),
      lastReadAt: deps.now().toISOString(),
      panel: cluster.panel,
      search,
      ...(passed ? { passedAt: deps.now().toISOString(), event: { event: "passed", detail: creatorsText } } : {}),
    })
    if (!written) {
      report.skipped.push({ what: `candidate ${c.slug}`, why: "decided by an admin during the run" })
      return
    }
    report.candidatesRead++
    if (passed) {
      report.passed.push(c.name)
      if (settings.alerts.slackNewCandidate) {
        await deps.notify(`:satellite: Trend candidate — ${c.name}: ${creatorsText}, ${formatPlays(cluster.plays)} plays (first seen on ${c.first_seen_name})`).catch(() => undefined)
      }
    }
  } catch (e) {
    if (e instanceof RunnerOutOfCreditsError) throw e
    const why = e instanceof Error ? e.message : String(e)
    report.skipped.push({ what: `candidate ${c.slug}`, why })
    await updateCandidate(c.id, { event: { event: "read_failed", detail: why.slice(0, 200) } }).catch(() => undefined)
  }
}

/**
 * The order the run reads open candidates in: never read first (newest first
 * among them, so a fresh name is read before the budget runs out), then the
 * longest unread — every open candidate gets its turn. On a database without
 * `last_read_at` (staging ahead of migration 735), newest first, as before.
 */
export function readingOrder<T extends { created_at: string; last_read_at?: string | null }>(rows: readonly T[]): T[] {
  const newestFirst = (a: T, b: T) => Date.parse(b.created_at) - Date.parse(a.created_at)
  if (!rows.every((r) => "last_read_at" in r)) return [...rows].sort(newestFirst)
  const never = rows.filter((r) => !r.last_read_at).sort(newestFirst)
  const read = rows.filter((r) => !!r.last_read_at).sort((a, b) => Date.parse(a.last_read_at!) - Date.parse(b.last_read_at!))
  return [...never, ...read]
}

/** The whole daily run. Never throws for a source's or a candidate's own failure. */
export async function runTrendRadar(given: RunDeps & { search: RadarSearch }): Promise<RunReport> {
  const deps: Resolved = {
    fetchText: given.fetchText ?? fetchTextDefault,
    search: given.search,
    suggests: given.suggests ?? suggestsDefault,
    notify: given.notify ?? notifyDefault,
    keepStill: given.keepStill ?? keepStill,
    now: given.now ?? (() => new Date()),
  }
  const startedAt = deps.now()
  const today = israelParts(startedAt).date
  const settings = await readSettings()
  const report: RunReport = { at: startedAt.toISOString(), sourcesRead: 0, namesSeen: 0, searchesUsed: 0, candidatesRead: 0, passed: [], skipped: [] }

  for (const source of await listSources()) {
    if (source.enabled && source.kind === "sitemap" && source.url) await readSource(source, deps, report)
  }

  const runner = settings.runnerUserId
  const used = settings.searchesDate === today ? settings.searchesToday : 0
  const open = readingOrder(await listOpenCandidates())
  const searchesLeft = () => settings.thresholds.dailySearchBudget - used - report.searchesUsed
  let stoppedEarly: string | null = null
  for (const c of open) {
    if (stoppedEarly) report.skipped.push({ what: `candidate ${c.slug}`, why: "the account the run searches as is out of credits" })
    else if (!runner) report.skipped.push({ what: `candidate ${c.slug}`, why: "no runner: save the settings as an admin once" })
    // A candidate is read whole or not at all: a reading of one platform is not comparable with yesterday's three.
    else if (searchesLeft() < RADAR_SEARCHES.length) report.skipped.push({ what: `candidate ${c.slug}`, why: "daily search budget spent" })
    else {
      try {
        await readCandidate(c, runner, today, settings, searchesLeft, deps, report)
      } catch (e) {
        if (!(e instanceof RunnerOutOfCreditsError)) throw e
        stoppedEarly = OUT_OF_CREDITS_STOP
        report.skipped.push({ what: `candidate ${c.slug}`, why: e.message })
      }
    }
  }

  await pruneReadings(settings.retentionDays).catch(() => undefined)
  const lastRun: TrendRadarLastRun = { at: report.at, sourcesRead: report.sourcesRead, namesSeen: report.namesSeen, searchesUsed: report.searchesUsed, stoppedEarly }
  await writeSettings({ lastRun, lastRunDate: today })
  if (stoppedEarly && (settings.alerts.slackNewCandidate || settings.alerts.slackDailySummary)) {
    await deps.notify(`:warning: Trend Radar stopped early: the account it searches as is out of credits. ${report.candidatesRead} candidates were read; the rest wait for the next run. Add credits to that account or lower the daily search budget.`).catch(() => undefined)
  }
  if (settings.alerts.slackDailySummary) {
    await deps.notify(`:satellite: Trend Radar — ${report.sourcesRead} sources, ${report.candidatesRead} candidates read, ${report.passed.length} passed, ${report.skipped.length} skipped`).catch(() => undefined)
  }
  return report
}

function formatPlays(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

/** Whether the daily run is due now: the run hour has come today and no run was recorded today. */
export function runDue(settings: { runAt: string; lastRunDate: string | null }, now: Date): boolean {
  const parts = israelParts(now)
  const [h, m] = settings.runAt.split(":").map((x) => Number.parseInt(x, 10))
  const minuteOfDay = Math.floor(parts.secondsOfDay / 60)
  const dueAt = (Number.isFinite(h) ? h! : 6) * 60 + (Number.isFinite(m) ? m! : 0)
  return minuteOfDay >= dueAt && settings.lastRunDate !== parts.date
}

export { nameOfSlug }
