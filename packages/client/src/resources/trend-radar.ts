import type { NodaroClientCore } from "../core.js"

/**
 * Trend Radar — the daily run that finds candidate trends (a short clip
 * several different creators recast within a few weeks) on Nodaro Cloud, and
 * the admin's decisions on them. Mirrors `/v1/trend-radar/*`
 * (`backend/src/ee/routes/trend-radar.ts`, shapes in
 * `backend/src/ee/lib/trend-radar/types.ts`): keep the two in step.
 *
 * Every method answers a SIGNED-IN ADMIN SESSION only (`supabaseAuth`, the
 * credential a first-party web app holds): an API key or an app's OAuth
 * token gets `403 forbidden` (`ForbiddenError`), a signed-in non-admin too.
 * A self-hosted instance has no radar (`NotFoundError`); Nodaro Cloud before
 * its storage exists answers `503 not_available`.
 */

export type TrendCandidateStatus = "watching" | "candidate" | "slowing" | "approved" | "rejected" | "archived"
export type TrendCandidateLabel = "new" | "watching" | "rising" | "hot" | "slowing"
export type TrendCandidateSort = "creators" | "dayChange" | "firstSeen" | "plays"
export type TrendRadarSourceKind = "sitemap" | "social" | "suggest"
export type TrendCandidatePlatform = "tiktok" | "instagram" | "youtube"

/** Where a candidate was first seen: a template site's page, or a public post. */
export interface TrendCandidateSource {
  kind: "template-site" | "social"
  name: string
  url: string | null
  firstSeenAt: string
}

/** One public post as a link and its public counts. */
export interface TrendCandidatePost {
  platform: TrendCandidatePlatform
  url: string
  author: string
  postedAt: string | null
  /** `null` where the platform hides views to a logged-out reader (Instagram): read `likes`. */
  plays: number | null
  likes: number | null
  soundName: string | null
  /** A small copy of the post's still kept on the deployment's storage; else the platform's own still, a link that stops answering within hours. */
  stillUrl: string | null
  /** The platform's own player for the post (`<iframe src>`), when it has one. */
  embedUrl: string | null
  durationSec: number | null
}

/** One day's reading: distinct creators, summed plays, posts returned. */
export interface TrendCandidateReading {
  /** `YYYY-MM-DD`, Israel time. */
  date: string
  creators: number
  plays: number
  posts: number
  /**
   * Plays growth per day, percent, over the posts this reading and the
   * previous one both saw (the same posts, not two different search answers);
   * `null` on the first reading, when no post was seen twice, or on a reading
   * from before it was measured.
   */
  growthPct: number | null
}

/** One platform's share of a candidate's last reading. */
export interface TrendCandidatePlatformStats {
  posts: number
  creators: number
  plays: number
  /** The search returned as many posts as it may: more creators likely posted it than were counted. */
  capped: boolean
  /** Its most-played post. */
  top: TrendCandidatePost | null
}

/** The platforms the last reading found posts on; empty before a read that searched them. */
export type TrendCandidatePlatforms = Partial<Record<TrendCandidatePlatform, TrendCandidatePlatformStats>>

export interface TrendCandidateCard {
  id: string
  name: string
  slug: string
  status: TrendCandidateStatus
  label: TrendCandidateLabel
  soundName: string | null
  durationSec: number | null
  /** Distinct creators across every platform the last reading searched. */
  creators: number
  /** A platform's search returned its most posts: the true count is likely higher (show it as "n+"). */
  creatorsCapped: boolean
  plays: number
  /**
   * Plays growth per day, percent, of the latest reading — over the posts it
   * and the previous reading both saw (`TrendCandidateReading.growthPct`), or,
   * for a reading from before that was measured, the change in summed plays;
   * `null` before two readings.
   */
  dayChangePct: number | null
  firstSeen: TrendCandidateSource
  /** The most-played post across every platform. */
  topPost: TrendCandidatePost | null
  /** Per platform: its posts, creators, plays and top post. */
  platforms: TrendCandidatePlatforms
  /** The earliest post date the readings saw: how old the trend is. `null` before a read found a dated post. */
  firstPostedAt: string | null
  /** When the daily run last read the candidate's posts. */
  lastReadAt: string | null
  /** When the candidate first reached the creator threshold. */
  passedAt: string | null
  /** The draft trend an approval created. */
  trendId: string | null
  createdAt: string
  updatedAt: string
}

export interface TrendCandidateTemplate {
  site: string
  url: string
  since: string | null
  note: string | null
}

export interface TrendCandidateSearch {
  /** Whether the search engine suggests "<name> ai"; `null` when not checked. */
  suggest: boolean | null
  interest7d: { from: number; to: number } | null
  checkedAt: string
}

export interface TrendCandidateEvent {
  at: string
  event: string
  detail: string | null
}

/** A threshold the candidate is held to; `auto` is whether the last reading met it (`null`: not read yet). */
export interface TrendCandidateCheck {
  key: string
  label: string
  hint: string | null
  auto: boolean | null
}

export interface TrendCandidate extends TrendCandidateCard {
  summary: string | null
  posts: TrendCandidatePost[]
  /** Oldest first. */
  readings: TrendCandidateReading[]
  templatesElsewhere: TrendCandidateTemplate[]
  search: TrendCandidateSearch | null
  /** Oldest first. */
  history: TrendCandidateEvent[]
  checklist: TrendCandidateCheck[]
  rejectReason: string | null
}

export interface TrendRadarSource {
  id: string
  name: string
  kind: TrendRadarSourceKind
  url: string | null
  enabled: boolean
  lastReadAt: string | null
  pages: number | null
  newToday: number | null
  lastError: string | null
}

export interface TrendRadarThresholds {
  minCreators: number
  windowDays: number
  risingPct: number
  slowingPct: number
  maxClipSec: number
  dailySearchBudget: number
}

export interface TrendRadarAlerts {
  slackNewCandidate: boolean
  slackDailySummary: boolean
}

export interface TrendRadarLastRun {
  at: string
  sourcesRead: number
  namesSeen: number
  searchesUsed: number
  /** Why the run stopped before every candidate it could afford was read (the search account ran out of credits); absent when it did not. */
  stoppedEarly?: string | null
}

export interface TrendRadarSettings {
  sources: TrendRadarSource[]
  thresholds: TrendRadarThresholds
  alerts: TrendRadarAlerts
  retentionDays: number
  /** `HH:MM`, Israel time. */
  runAt: string
}

/** A source as {@link TrendRadarResource.updateSettings} takes it: without `id` it is added, with one it is updated, and one left out is removed. */
export interface TrendRadarSourceInput {
  id?: string
  name: string
  kind: TrendRadarSourceKind
  url: string | null
  enabled: boolean
}

export interface TrendRadarSettingsPatch {
  sources?: TrendRadarSourceInput[]
  thresholds?: Partial<TrendRadarThresholds>
  alerts?: Partial<TrendRadarAlerts>
  retentionDays?: number
  runAt?: string
}

/** What a day's reading costs, so the budget can be set in candidates and credits rather than searches. */
export interface TrendRadarReadingCost {
  /** Searches one candidate's reading takes: one per platform. */
  searchesPerRead: number
  /** Credits one candidate's reading is charged to the account the run searches as; null when the price could not be read. */
  creditsPerRead: number | null
  /** Credits that account holds now; null when there is no runner yet or the balance could not be read. */
  runnerCredits: number | null
  /** The highest daily search budget the settings take. */
  maxSearchesPerDay: number
  /** Extra searches at most one candidate's deeper count makes (a platform whose search came back full, searched again in other orders); they come out of the same daily budget. */
  deepSearchesMax: number
  /** Credits one of those extra searches is charged; null when the price could not be read. */
  creditsPerDeepSearch: number | null
}

export interface TrendRadarSummary {
  lastRun: TrendRadarLastRun | null
  counts: { candidates: number; watching: number; slowing: number }
  searchesToday: number
  dailySearchBudget: number
  /** What reading costs; absent from a server older than this field. */
  reading?: TrendRadarReadingCost
}

export interface ListTrendCandidatesParams {
  /** One status; left out = every candidate but the rejected and archived. */
  status?: TrendCandidateStatus
  /** Default `creators`. */
  sort?: TrendCandidateSort
  /** `next` of the previous page. */
  cursor?: string
  /** 1–200, default 50. */
  limit?: number
}

export interface TrendCandidatePage {
  data: TrendCandidateCard[]
  next: string | null
}

/** What an approval made: the draft trend, and whether its source clip is on its way. */
export interface TrendCandidateApproval {
  trendId: string
  clip: "attaching" | "none"
}

export class TrendRadarResource {
  constructor(private client: NodaroClientCore) {}

  /** `GET /v1/trend-radar/summary` → the last run and the queue's counts. */
  async summary(): Promise<TrendRadarSummary> {
    const res = await this.client.request<{ data: TrendRadarSummary }>("GET", "/v1/trend-radar/summary")
    return res.data
  }

  /** `GET /v1/trend-radar/candidates` → a page of candidate cards. */
  candidates(params: ListTrendCandidatesParams = {}): Promise<TrendCandidatePage> {
    const qs = new URLSearchParams()
    if (params.status) qs.set("status", params.status)
    if (params.sort) qs.set("sort", params.sort)
    if (params.cursor) qs.set("cursor", params.cursor)
    if (params.limit !== undefined) qs.set("limit", String(params.limit))
    const query = qs.toString()
    return this.client.request("GET", `/v1/trend-radar/candidates${query ? `?${query}` : ""}`)
  }

  /** `GET /v1/trend-radar/candidates/:id` → one candidate with its readings, posts and checklist. */
  async candidate(id: string): Promise<TrendCandidate> {
    const res = await this.client.request<{ data: TrendCandidate }>("GET", `/v1/trend-radar/candidates/${encodeURIComponent(id)}`)
    return res.data
  }

  /**
   * `POST /v1/trend-radar/candidates/:id/approve` → `{ trendId, clip }`:
   * creates a DRAFT trend named after the candidate and marks the candidate
   * approved. `clip` is `"attaching"` when the top post is being downloaded
   * (as the approving admin) and stored as the draft's source clip in the
   * background — the candidate's `history` then says `source_attached` or
   * `source_failed` with why — and `"none"` when there is no top post or the
   * candidate was approved before. Approving again answers the same trend.
   *
   * The clip's download is an import of a link: pass the `confirmationId`
   * from `contentRights.confirm({ url: candidate.topPost.url, declarationVersion })` so the
   * download is made under the admin's confirmation (required once the
   * deployment turns `content_rights_required` on; without one then, the
   * draft is still created and the clip is left out, `source_failed` saying why).
   */
  async approve(id: string, options: { confirmationId?: string } = {}): Promise<TrendCandidateApproval> {
    const res = await this.client.request<{ data: TrendCandidateApproval }>("POST", `/v1/trend-radar/candidates/${encodeURIComponent(id)}/approve`, {
      body: options.confirmationId ? { confirmationId: options.confirmationId } : {},
    })
    return res.data
  }

  /** `POST /v1/trend-radar/candidates/:id/watch` → the card, back to `watching`. */
  async watch(id: string): Promise<TrendCandidateCard> {
    const res = await this.client.request<{ data: TrendCandidateCard }>("POST", `/v1/trend-radar/candidates/${encodeURIComponent(id)}/watch`)
    return res.data
  }

  /** `POST /v1/trend-radar/candidates/:id/reject` → the card, `rejected` with the reason (1–500 characters). */
  async reject(id: string, body: { reason: string }): Promise<TrendCandidateCard> {
    const res = await this.client.request<{ data: TrendCandidateCard }>("POST", `/v1/trend-radar/candidates/${encodeURIComponent(id)}/reject`, { body })
    return res.data
  }

  /** `GET /v1/trend-radar/settings` → the sources, thresholds, alerts, retention and run time. */
  async settings(): Promise<TrendRadarSettings> {
    const res = await this.client.request<{ data: TrendRadarSettings }>("GET", "/v1/trend-radar/settings")
    return res.data
  }

  /**
   * `PUT /v1/trend-radar/settings` → the settings after the change. Only the
   * keys sent change; `sources` replaces the list whole. Whoever saves becomes
   * the account the daily searches run as.
   */
  async updateSettings(patch: TrendRadarSettingsPatch): Promise<TrendRadarSettings> {
    const res = await this.client.request<{ data: TrendRadarSettings }>("PUT", "/v1/trend-radar/settings", { body: patch })
    return res.data
  }

  /** `POST /v1/trend-radar/run` → `{ runId, startedAt }`: starts today's run now (one at a time). */
  async run(): Promise<{ runId: string; startedAt: string }> {
    const res = await this.client.request<{ data: { runId: string; startedAt: string } }>("POST", "/v1/trend-radar/run")
    return res.data
  }
}
