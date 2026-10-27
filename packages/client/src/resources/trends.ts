import type { NodaroClientCore } from "../core.js"
import type { CastSwapEngine } from "./cast-swap.js"

/**
 * Trends — ready-made Nodaro Motion recipes. A trend is a short clip with slots
 * (the people, pets, products and place you can replace); fill its slots with
 * your own pictures and run it to get the clip back with them in it.
 *
 * Cloud edition only: `/v1/trends` 404s on self-hosted installs. Only
 * published trends exist here: a draft, unpublished or unknown slug is a 404
 * on every route. `"runs"` and `"tags"` are never slugs (`/v1/trends/runs` is
 * the run list, `/v1/trends/tags` the tag list): the slug methods throw a
 * `TypeError` for them before any request. `run()` answers 202 with a job id; follow it with
 * `client.jobs.get(jobId)` / `client.jobs.getStatus(jobId)` like any other
 * job, or read it back as a trend run with `getRun(jobId)` / `runs()`.
 *
 * Repeats: pass `{ idempotencyKey }` to `run()` and it is sent as the
 * `Idempotency-Key` header. A repeat with the same key answers with the first
 * run's `jobId`; nothing new is started or charged.
 *
 * Refusals (thrown as a `NodaroError` subclass; body `{ error: { code, message } }`):
 * - 400 `validation_error` (the body, a query, or a bad `cursor`);
 *   `estimate()` / `run()` only, before anything is charged:
 *   `missing_slot` (a required slot without pictures, or an optional one
 *   left empty that the chosen example has no pictures for), `unknown_slot`,
 *   `invalid_choice` (a chip the slot's kind does not take),
 *   `chip_not_offered` (a chip of the kind that the slot's
 *   {@link TrendDetailSlot.chips} does not list: the trend fixes it),
 *   `example_out_of_range` (`example` names no example of the trend, or is
 *   sent at all on a trend with none), `preview_unavailable` (the trend offers no
 *   preview), `invalid_slot_mention` (a `{slot:<key>}` in `details` naming no
 *   slot), `prompt_too_long` (shorten `details`), `draft_unsupported`
 *   (`draft: true` on a trend whose `engine` has no draft: Nodaro Motion Pulse),
 *   `resolution_unsupported` (a `resolution` not in the trend's
 *   `resolutions`), `too_many_images` (a Nodaro Motion Pulse trend's run would send more
 *   than 10 pictures: send fewer per slot). The slot errors carry the
 *   slot's key as `slot` (in `NodaroError.details`), and `chip_not_offered`
 *   the chip as `chip` too.
 * - 401 `unauthorized`.
 * - 404 `not_found`: the trend is not published (every method), or `run()`'s
 *   `sessionId` is not a session you may use.
 * - 409 `trend_unavailable` (`estimate()` / `run()`): the trend's setup is out
 *   of date — it cannot run until it is updated, so a retry gets the same answer.
 * - 502 `engine_error` (`estimate()` / `run()`).
 * - 503 `engine_unsupported` (this platform version cannot run trends yet),
 *   `trend_unavailable` (`estimate()` / `run()`), `not_available` (this
 *   server has no trend catalog yet).
 * - `estimate()` / `run()` answer the video engine's refusals with the trend
 *   routes' OWN codes and fixed messages — never the engine's text or
 *   `issues`: 400 `trend_run_rejected` (the inputs could not run), or
 *   `clip_out_of_range` / `preview_out_of_range` / `video_unreadable` (this
 *   trend's clip), `unsafe_url` (a picture is not a public http(s) address),
 *   `raw_reference_token` (`details` holds `{image:` / `{video:` /
 *   `{audio:`); 402 `insufficient_credits` (or a workspace cap) as given;
 *   413 `storage_limit_exceeded`; 422 `job_blocked` (the job policy
 *   blocked it); 429 `rate_limited`; 503 `engine_unsupported`,
 *   `estimate_unavailable`; 502 `engine_error` for anything else. `run()`
 *   also answers 400 `validation_error` for an `idempotencyKey` outside
 *   8–200 characters.
 */

/** `/v1/trends/runs` is the run list and `/v1/trends/tags` the tag list, so neither can be a trend's slug. */
const RESERVED_SLUGS: Readonly<Record<string, string>> = {
  runs: "the run list; use runs()",
  tags: "the tag list; use tags()",
}

function trendPath(slug: string, rest = ""): string {
  if (Object.hasOwn(RESERVED_SLUGS, slug)) {
    throw new TypeError(`"${slug}" is not a trend slug (it is reserved for ${RESERVED_SLUGS[slug]})`)
  }
  return `/v1/trends/${encodeURIComponent(slug)}${rest}`
}

/** What a slot holds. */
export type TrendSlotKind = "person" | "location" | "product" | "pet"

/** A chip: make this trait anew from your pictures (`"new"`), or keep the clip's (`"original"`). */
export type TrendChoice = "new" | "original"

/**
 * The chips a slot can take, by its kind: a person `body` / `outfit` / `hair`,
 * a pet `body` / `coat`, a product `shape` / `finish`, a location none.
 */
export interface TrendChips {
  body?: TrendChoice
  outfit?: TrendChoice
  hair?: TrendChoice
  coat?: TrendChoice
  shape?: TrendChoice
  finish?: TrendChoice
}

/** A chip's name: `body`, `outfit`, `hair`, `coat`, `shape` or `finish`. */
export type TrendChipKey = keyof TrendChips

export type TrendResolution = "480p" | "720p" | "1080p"

/**
 * The engine a trend runs on, by its public id ({@link CastSwapEngine}):
 * `"motion-prism"` (Nodaro Motion Prism) or `"motion-pulse"` (Nodaro Motion Pulse).
 * The trend chooses it, never the person running it.
 */
export type TrendEngine = CastSwapEngine

/** A trend in the catalog (`list()`). Text is in the resolved locale. */
export interface TrendCard {
  id: string
  slug: string
  name: string
  description?: string
  tags: string[]
  /** e.g. `"trending"`, `"new"`. */
  badges: string[]
  /**
   * The trend's first example, else (a trend with no example) its original's
   * display copy, as {@link TrendDetail.original}.
   */
  cover: { videoUrl: string; posterUrl?: string; width: number; height: number }
  /** How many slots of each kind the trend has. */
  needs: Record<TrendSlotKind, number>
  /** The length of a full run, in seconds. */
  durationSec: number
  isFavorite: boolean
}

/** One slot of a trend: what it asks you for. */
export interface TrendDetailSlot {
  /** The key to fill in {@link TrendRunRequest.slots}, and to mention in `details` as `{slot:<key>}`. */
  key: string
  label: string
  kind: TrendSlotKind
  /**
   * A required slot needs pictures; an optional one left empty takes the
   * chosen example's, or, on a trend with no example, stays as in the original.
   */
  required: boolean
  hint?: string
  /**
   * A picture showing who or what this slot is in the original (e.g. a frame
   * of that actor), when the trend has one. Show it on an empty slot; a run
   * never sends it.
   */
  hintImageUrl?: string
  /**
   * The chips you may set on this slot, in its kind's order; `[]` = none (show
   * no chips row). A chip of the kind that is not listed is fixed by the
   * trend: sending it is refused with `400 chip_not_offered`.
   */
  chips: TrendChipKey[]
  /** The starting value of the chips in {@link chips} (only those). */
  defaults?: TrendChips
}

/** A finished run shown on a trend's page, with the pictures it used per slot. */
export interface TrendExample {
  videoUrl: string
  posterUrl?: string
  width: number
  height: number
  /** Slot key → the pictures this example used for it. */
  slots: Record<string, string[]>
}

/**
 * The clip a trend recasts, as you may show it: a browser-safe copy (H.264
 * MP4) of the clip every run starts from. Its fields parallel
 * {@link TrendExample}'s.
 */
export interface TrendOriginal {
  videoUrl: string
  posterUrl?: string
  width: number
  height: number
  /** The copy's length, in seconds. */
  durationSec: number
  /**
   * Where the 4-second preview starts in the clip, in seconds (`0` included),
   * when the trend offers one ({@link TrendDetail.previewSec} is `4`); absent
   * otherwise.
   */
  previewStartSec?: number
}

/** A trend's page (`get()`). */
export interface TrendDetail extends TrendCard {
  /** The published version this page shows. */
  version: number
  /** `4` when the trend offers a 4-second preview run, else `null`. */
  previewSec: 4 | null
  /**
   * The original clip every run starts from, to show beside the examples.
   * Absent only on a version without a display copy (and from an older server).
   */
  original?: TrendOriginal
  /** The engine every run of this trend uses. Absent (an older server) = `"motion-prism"`. */
  engine?: TrendEngine
  /** Its name to show: "Nodaro Motion Prism" or "Nodaro Motion Pulse". Absent from an older server. */
  engineName?: string
  /**
   * The resolutions a run may ask for, the default first. Nodaro Motion Prism:
   * `["480p", "720p", "1080p"]`, where 480p is a draft (show it as one);
   * Nodaro Motion Pulse: `["720p", "1080p"]`, no draft. Offer exactly these.
   */
  resolutions: TrendResolution[]
  slots: TrendDetailSlot[]
  /** Finished runs to show beside the original; may be empty (a trend with only its original). */
  examples: TrendExample[]
}

/** What you put in one slot of a run: 1–3 pictures, and the chips the slot offers ({@link TrendDetailSlot.chips}). */
export interface TrendRunSlot extends TrendChips {
  images?: string[]
}

/** The body of `estimate()` and `run()`. */
export interface TrendRunRequest {
  /**
   * Slot key → what you put in it. Every required slot needs pictures; an
   * optional slot left out takes the chosen example's, or, on a trend with no
   * example, stays as in the original. 1–3 pictures per slot.
   */
  slots: Record<string, TrendRunSlot>
  /**
   * 1-based example whose pictures fill the optional slots you leave empty.
   * Default 1. Leave it out on a trend with no examples: sending one there
   * answers 400 `example_out_of_range` (and `0` is a `validation_error`).
   */
  example?: number
  /** Your own words, at most 1,000 characters. Mention a slot as `{slot:<key>}`. */
  details?: string
  /** `true` runs a 4-second preview (only when the trend's `previewSec` is `4`). */
  preview?: boolean
  /**
   * One of the trend's {@link TrendDetail.resolutions}; default its first
   * (`"480p"` on Nodaro Motion Prism, `"720p"` on Nodaro Motion Pulse). Another answers 400
   * `resolution_unsupported`.
   */
  resolution?: TrendResolution
  /**
   * A draft run, only at 480p on a Nodaro Motion Prism trend. Default `true` at
   * 480p. `true` on a Nodaro Motion Pulse trend answers 400 `draft_unsupported`.
   */
  draft?: boolean
  /**
   * A generation session of yours. Accepted (and checked: one you may not use
   * is a 404), but not yet applied: trend runs are not filed into sessions yet.
   */
  sessionId?: string
  /** Accepted, but not used by the run today. */
  projectId?: string
  /**
   * A full run's own preview: the `jobId` of a completed preview run of this
   * trend that you started. When that preview needed the trend's retry (the
   * clip refused at first), the full run is made that way from the start (the
   * quote includes it). Any other job is ignored, without an error. Must be a uuid
   * (else 400 `validation_error`).
   */
  previewJobId?: string
  /**
   * `run()`: your client app's slug (e.g. `"tools"`: lowercase letters,
   * digits and `-`, 1–40 characters, starting with a letter or digit), as on
   * any job: the run's job carries it as `input_data.origin`, so
   * `client.jobs.list({ origin })` finds it. Not a slug is a 400
   * `validation_error`; without it the run has no origin. `estimate()`
   * ignores it.
   */
  origin?: string
}

/** What a run would cost, in credits (`estimate()`). */
export interface TrendEstimate {
  /** The charge the run is expected to come to. */
  expectedCredits: number
  /** What is reserved when the run starts; the run is charged what it actually costs. */
  holdCredits: number
  /**
   * The parts of the quote, by name, for display only: some are alternatives
   * or sit outside the totals (`privacy`, the retry's, beside
   * `privacyCredits`), so read `expectedCredits` and `holdCredits`, never
   * their sum.
   */
  breakdown: Record<string, number>
  /**
   * Only on a trend that retries a clip the video model refuses: the extra
   * credits charged if that retry runs. Not included in `expectedCredits` or
   * `holdCredits`. 0 (or absent) when there is nothing extra to charge.
   */
  privacyCredits?: number
  /** @deprecated read {@link privacyCredits} (an older server answered this name). */
  maskingCredits?: number
}

/** Per-call options for {@link TrendsResource.run}. */
export interface TrendRunOptions {
  /**
   * Sent as the `Idempotency-Key` header, unchanged (an empty string sends no
   * header). The server takes 8–200 characters and answers 400 for any other
   * length. Reuse it when retrying the same run.
   */
  idempotencyKey?: string
}

/** One slot of a past run, as it was run. Labels are English. */
export interface TrendRunDisplaySlot extends TrendChips {
  key: string
  label: string
  kind: TrendSlotKind
  images: string[]
  /**
   * `true` when the slot was left empty and the example's pictures filled it.
   * `false` with no `images`: left empty on a trend with no example, so it
   * stayed as in the original.
   */
  fromExample: boolean
}

/**
 * One of your trend runs (`runs()`, `getRun()`). Stays readable after the
 * trend moves on or is unpublished.
 *
 * A Full Quality version of a draft is a run of its own, with its own status,
 * result and charge: `fullQualityOf` names the draft it was made from, and it
 * stays listed after that draft is deleted.
 */
export interface TrendRun {
  jobId: string
  status: string
  progress: number | null
  /**
   * Why a failed or cancelled run did not finish; `null` otherwise. `code` is
   * `safety-block` or `policy-block` when the job was blocked, `credits` when
   * it ran out of credits partway (it was refunded: ask the person to top up,
   * then run it again), else `cancelled` or `failed`. `message` is the same
   * fixed sentence for every code — branch on `code`, not on the text.
   */
  error: { code?: string; message: string } | null
  createdAt: string
  completedAt: string | null
  /** The trend and version it ran (name in English). */
  trend: { id: string; slug: string; version: number; name: string }
  /**
   * The 1-based example used for empty optional slots; `0` = the trend had no
   * example (none was used: never show it as "Example 0").
   */
  example: number
  slots: TrendRunDisplaySlot[]
  details?: string
  preview: boolean
  resolution: string
  draft: boolean
  /** The engine the run was made on. Absent (an older server) = `"motion-prism"`. */
  engine?: TrendEngine
  /** Its name to show: "Nodaro Motion Prism" or "Nodaro Motion Pulse". Absent from an older server. */
  engineName?: string
  /** The result, once completed. */
  videoUrl: string | null
  posterUrl: string | null
  /**
   * What the run was charged once settled, every step it ran included (its
   * reference preparation, mask and video); `null` until the run's own hold
   * settles. A step adds its charge once it settles.
   */
  creditsCharged: number | null
  /** The run's hold: its own plus its steps'. Absent from an older server. */
  creditsHeld?: number | null
  /** What went back from `creditsHeld` once every hold in the run settled; `null` until then. Absent from an older server. */
  creditsReleased?: number | null
  /** A Full Quality version: the job id of the run (a draft, or a Nodaro Motion Pulse 720p run) it was made from. `null` for any other run. */
  fullQualityOf: string | null
  /**
   * A draft's (or Nodaro Motion Pulse 720p run's) newest Full Quality try, if one was started: a pointer only,
   * to know an upgrade exists and how it is going. Its video and charge are on
   * that run, listed on its own (its `fullQualityOf` is this run's `jobId`) —
   * read it there (`getRun(fullQuality.jobId)`). Older tries of the draft (a
   * failed or cancelled one tried again) are not listed by `runs()`;
   * `getRun()` still reads one by its id.
   */
  fullQuality: { jobId: string; status: string } | null
  /**
   * Until when a completed run can be redone in Full Quality — a Nodaro Motion
   * Prism draft (the same take at 1080p) or a Nodaro Motion Pulse run at 720p (a new take at
   * 1080p); `null` otherwise.
   */
  fullQualityUntil: string | null
}

export interface ListTrendsParams {
  /** Search text. */
  q?: string
  tag?: string
  /** `true` lists only your favorites. */
  favorites?: boolean
  /** A platform language for names and descriptions; default your profile's, then English. */
  locale?: string
  /** The previous page's `next`. */
  cursor?: string
  /** Page size, 1–60 (server default 30). */
  limit?: number
}

export interface ListTrendRunsParams {
  /** Only runs of this trend (its slug). */
  trend?: string
  /** The previous page's `next`. */
  cursor?: string
  /** Page size, 1–60 (server default 30). */
  limit?: number
}

/** A tag in use on the published catalog (`tags()`). */
export interface TrendTag {
  /** The tag itself: pass it as `list({ tag })`. */
  tag: string
  /** The tag's label in the resolved locale; the tag itself when it has none. */
  label: string
  /** How many published trends carry it. */
  count: number
}

export interface TrendPage<T> {
  data: T[]
  /** Pass back as `cursor` for the next page; `null` on the last one. */
  next: string | null
}

export class TrendsResource {
  constructor(private client: NodaroClientCore) {}

  /** The published catalog in its curated order (`GET /v1/trends`), a page at a time. */
  list(params: ListTrendsParams = {}): Promise<TrendPage<TrendCard>> {
    const query: Record<string, string> = {}
    if (params.q) query.q = params.q
    if (params.tag) query.tag = params.tag
    if (params.favorites) query.favorites = "1"
    if (params.locale) query.locale = params.locale
    if (params.cursor) query.cursor = params.cursor
    if (params.limit !== undefined) query.limit = String(params.limit)
    return this.client.request("GET", "/v1/trends", { query })
  }

  /** A published trend's page (`GET /v1/trends/:slug`). */
  async get(slug: string, params: { locale?: string } = {}): Promise<TrendDetail> {
    const query: Record<string, string> = {}
    if (params.locale) query.locale = params.locale
    const res = await this.client.request<{ data: TrendDetail }>("GET", trendPath(slug), { query })
    return res.data
  }

  /** Quote a run before starting it (`POST /v1/trends/:slug/estimate`); spends nothing. */
  async estimate(slug: string, request: TrendRunRequest): Promise<TrendEstimate> {
    const res = await this.client.request<{ data: TrendEstimate }>(
      "POST",
      trendPath(slug, "/estimate"),
      { body: request },
    )
    return res.data
  }

  /**
   * Start a run (`POST /v1/trends/:slug/runs`, 202). Returns the job to follow.
   * With `options.idempotencyKey` (sent as the `Idempotency-Key` header) a
   * repeat with the same key answers with the first run's `jobId`.
   */
  async run(slug: string, request: TrendRunRequest, options?: TrendRunOptions): Promise<{ jobId: string }> {
    const res = await this.client.request<{ data: { jobId: string } }>(
      "POST",
      trendPath(slug, "/runs"),
      {
        body: request,
        ...(options?.idempotencyKey ? { headers: { "Idempotency-Key": options.idempotencyKey } } : {}),
      },
    )
    return res.data
  }

  /**
   * Your trend runs, newest first (`GET /v1/trends/runs`). A Full Quality
   * version of a draft is listed as its own run (`fullQualityOf`).
   */
  runs(params: ListTrendRunsParams = {}): Promise<TrendPage<TrendRun>> {
    const query: Record<string, string> = {}
    if (params.trend) query.trend = params.trend
    if (params.cursor) query.cursor = params.cursor
    if (params.limit !== undefined) query.limit = String(params.limit)
    return this.client.request("GET", "/v1/trends/runs", { query })
  }

  /**
   * One of your trend runs by its job id (`GET /v1/trends/runs/:jobId`), in
   * the same shape as `runs()`. A job that is not your own trend run is a
   * `NotFoundError`.
   */
  async getRun(jobId: string): Promise<TrendRun> {
    const res = await this.client.request<{ data: TrendRun }>("GET", `/v1/trends/runs/${encodeURIComponent(jobId)}`)
    return res.data
  }

  /**
   * The tags in use on the published catalog, each with its label in the
   * resolved locale (`GET /v1/trends/tags`), most used first.
   */
  async tags(params: { locale?: string } = {}): Promise<TrendTag[]> {
    const query: Record<string, string> = {}
    if (params.locale) query.locale = params.locale
    const res = await this.client.request<{ data: TrendTag[] }>("GET", "/v1/trends/tags", { query })
    return res.data
  }

  /** Add a trend to your favorites (`PUT /v1/trends/:slug/favorite`). */
  async favorite(slug: string): Promise<void> {
    await this.client.request<void>("PUT", trendPath(slug, "/favorite"))
  }

  /** Remove a trend from your favorites (`DELETE /v1/trends/:slug/favorite`). */
  async unfavorite(slug: string): Promise<void> {
    await this.client.request<void>("DELETE", trendPath(slug, "/favorite"))
  }
}
