/**
 * The daily run: read every enabled sitemap source for template pages not
 * seen before (each a candidate name), then read every open candidate's
 * public posts once (Social Search, as the runner admin), write the day's
 * reading, and set the candidate's status and label from its readings. A
 * candidate reaching the creator threshold for the first time is announced
 * on Slack when the alert is on.
 *
 * A source or a candidate that fails is noted and skipped — one bad page
 * never stops the run. The search budget (`thresholds.dailySearchBudget`)
 * bounds the day's searches, newest candidates first.
 */
import type { FastifyInstance } from "fastify"
import { config } from "../../../lib/config.js"
import { safeFetch } from "../../../lib/safe-fetch.js"
import { supabase } from "../../../lib/supabase.js"
import { withJobSubmissionContext } from "../../../lib/job-submission-context.js"
import { isSocialPost, type SocialPost } from "@nodaro/shared/social"
import { israelParts } from "../../notifications/israel-time.js"
import { getNotifyConfig } from "../../notifications/notify-config.js"
import { sendSlack } from "../../notifications/slack-client.js"
import { clusterPosts } from "./cluster.js"
import { dayChangePct, labelOf, passesNow, statusOf } from "./labels.js"
import { nameOfSlug, newTemplatePages, parseSitemap, slugOfName, templateSlugOf } from "./sitemap.js"
import {
  countSearch,
  listOpenCandidates,
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
import type { TrendCandidateSearch, TrendRadarLastRun } from "./types.js"

const SITEMAP_MAX_BYTES = 8 * 1024 * 1024
const SITEMAP_CHILDREN_MAX = 20
const SEARCH_WAIT_MS = 150_000
const SEARCH_POLL_MS = 3_000
/** New names a run takes from one source read; the rest are left unseen, so the next read takes them. */
const NEW_NAMES_PER_SOURCE = 25
/** Template slugs remembered per source: what the latest read listed comes first, so a catalog larger than this forgets only pages it no longer lists. */
const SEEN_SLUGS_MAX = 5000

export interface RunDeps {
  /** Reads a public page's text, or throws. The run's own goes through `safeFetch`. */
  fetchText?: (url: string) => Promise<string>
  /** Runs one social search as the runner and answers its posts, or throws. */
  search?: (query: string, runnerUserId: string) => Promise<SocialPost[]>
  /** Whether the search engine suggests the query; `null` when unknown. */
  suggests?: (query: string) => Promise<boolean | null>
  /** Posts one Slack message; the run's own uses the founder webhook. */
  notify?: (text: string) => Promise<void>
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

/** One Social Search for a name, filed as the runner's job, waited to its end. */
export function makeSearch(app: FastifyInstance): (query: string, runnerUserId: string) => Promise<SocialPost[]> {
  return async (query, runnerUserId) => {
    const payload = { platform: "tiktok", mode: "keyword", query, count: 20, period: "month", sort: "popular", userId: runnerUserId }
    const res = await withJobSubmissionContext({ userId: runnerUserId, method: "POST", url: "/v1/social-search" }, () =>
      app.inject({
        method: "POST",
        url: "/v1/social-search",
        headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET, "x-internal-user-id": runnerUserId, "content-type": "application/json" },
        payload,
      }),
    )
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

/** One open candidate: a search, the day's reading, its status and label; the alert on its first pass. */
async function readCandidate(c: Candidate, runner: string, today: string, settings: StoredSettings, deps: Resolved, report: RunReport): Promise<void> {
  try {
    // A search is spent once submitted, whether or not it answers: a failing
    // provider must not read every open candidate for free all day.
    let posts: SocialPost[]
    try {
      posts = await deps.search(`${c.name} ai`, runner)
    } finally {
      report.searchesUsed++
      await countSearch(today).catch(() => undefined)
    }
    const cluster = clusterPosts(posts)
    const readings = await writeReading(c.id, { day: today, creators: cluster.creators, plays: cluster.plays, posts: cluster.posts })
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
      plays: cluster.plays,
      dayChangePct: dayChangePct(readings),
      topPost: cluster.top[0] ?? null,
      posts: cluster.top,
      search,
      ...(passed ? { passedAt: deps.now().toISOString(), event: { event: "passed", detail: `${cluster.creators} creators` } } : {}),
    })
    if (!written) {
      report.skipped.push({ what: `candidate ${c.slug}`, why: "decided by an admin during the run" })
      return
    }
    report.candidatesRead++
    if (passed) {
      report.passed.push(c.name)
      if (settings.alerts.slackNewCandidate) {
        await deps.notify(`:satellite: Trend candidate — ${c.name}: ${cluster.creators} creators, ${formatPlays(cluster.plays)} plays (first seen on ${c.first_seen_name})`).catch(() => undefined)
      }
    }
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e)
    report.skipped.push({ what: `candidate ${c.slug}`, why })
    await updateCandidate(c.id, { event: { event: "read_failed", detail: why.slice(0, 200) } }).catch(() => undefined)
  }
}

/** The whole daily run. Never throws for a source's or a candidate's own failure. */
export async function runTrendRadar(given: RunDeps & { search: (query: string, runnerUserId: string) => Promise<SocialPost[]> }): Promise<RunReport> {
  const deps: Resolved = {
    fetchText: given.fetchText ?? fetchTextDefault,
    search: given.search,
    suggests: given.suggests ?? suggestsDefault,
    notify: given.notify ?? notifyDefault,
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
  // Newest first, so a fresh name is read before the budget runs out.
  const open = (await listOpenCandidates()).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  for (const c of open) {
    if (!runner) report.skipped.push({ what: `candidate ${c.slug}`, why: "no runner: save the settings as an admin once" })
    else if (used + report.searchesUsed >= settings.thresholds.dailySearchBudget) report.skipped.push({ what: `candidate ${c.slug}`, why: "daily search budget spent" })
    else await readCandidate(c, runner, today, settings, deps, report)
  }

  await pruneReadings(settings.retentionDays).catch(() => undefined)
  const lastRun: TrendRadarLastRun = { at: report.at, sourcesRead: report.sourcesRead, namesSeen: report.namesSeen, searchesUsed: report.searchesUsed }
  await writeSettings({ lastRun, lastRunDate: today })
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
