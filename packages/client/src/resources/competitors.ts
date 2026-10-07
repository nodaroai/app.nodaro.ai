import type { NodaroClient } from "../client.js"
import type {
  CardActionResult,
  CompetitorActionsResult,
  CompetitorCardsResult,
  CompetitorCompareInput,
  CompetitorCompareResult,
  CompetitorDetail,
  CompetitorDiscovery,
  CompetitorHistory,
  CompetitorLessonsResult,
  CompetitorListResult,
  CreateCompetitorInput,
  TrackedCompetitor,
  UpdateCompetitorInput,
} from "@nodaro/shared"

/**
 * Competitors — brands you track (competitors, or your own), their scans and
 * the action cards read from them. Nodaro Cloud.
 *
 * Adding, reading and website lookups are free. A scan costs one Social
 * Search page per search it runs (`TrackedCompetitor.searches`); searches that
 * fail are not charged.
 */
export class CompetitorsResource {
  constructor(private client: NodaroClient) {}

  /** `GET /v1/competitors` → every tracked brand. */
  async list(): Promise<TrackedCompetitor[]> {
    const res = await this.listWithPlan()
    return [...res.data]
  }

  /** `GET /v1/competitors` → every tracked brand, with how many months of scans your plan keeps. */
  listWithPlan(): Promise<CompetitorListResult> {
    return this.client.request<CompetitorListResult>("GET", "/v1/competitors")
  }

  /**
   * `GET /v1/competitors/:id` → one brand with its latest scan (posts and
   * cards) and its scan history; with `scan`, the brand as of that scan.
   */
  get(id: string, options: { readonly scan?: string } = {}): Promise<CompetitorDetail> {
    const query = options.scan ? `?scan=${encodeURIComponent(options.scan)}` : ""
    return this.client.request<CompetitorDetail>("GET", `/v1/competitors/${encodeURIComponent(id)}${query}`)
  }

  /** `GET /v1/competitors/:id/history` → the brand's scans oldest first, per platform what each found and read (free). */
  history(id: string): Promise<CompetitorHistory> {
    return this.client.request<CompetitorHistory>("GET", `/v1/competitors/${encodeURIComponent(id)}/history`)
  }

  /**
   * `GET /v1/competitors/:id/compare` → the brand over a period, and over a
   * second one to compare with (free). A post belongs to a period by its
   * publish date; a period is at most a year.
   */
  compare(id: string, input: CompetitorCompareInput): Promise<CompetitorCompareResult> {
    const params = new URLSearchParams({ from: input.from, to: input.to })
    if (input.vsFrom !== undefined && input.vsTo !== undefined) {
      params.set("vsFrom", input.vsFrom)
      params.set("vsTo", input.vsTo)
    }
    return this.client.request<CompetitorCompareResult>("GET", `/v1/competitors/${encodeURIComponent(id)}/compare?${params.toString()}`)
  }

  /** `POST /v1/competitors` → track a brand. Accounts take handles or links. */
  create(input: CreateCompetitorInput): Promise<TrackedCompetitor> {
    return this.client.request<TrackedCompetitor>("POST", "/v1/competitors", { body: input })
  }

  /**
   * `PATCH /v1/competitors/:id` → change its accounts, platforms, name or schedule.
   * `accounts` replaces the whole set: pass every account to keep. Send
   * `schedule` only to change it (it restarts the brand's schedule). While a
   * scan of the brand runs, a change to its name, accounts, platforms or
   * `isOwn` is refused with `409 scan_running`.
   */
  update(id: string, input: UpdateCompetitorInput): Promise<TrackedCompetitor> {
    return this.client.request<TrackedCompetitor>("PATCH", `/v1/competitors/${encodeURIComponent(id)}`, { body: input })
  }

  /** `DELETE /v1/competitors/:id` → stop tracking it (its scans go too). */
  async delete(id: string): Promise<void> {
    await this.client.request<{ success: true }>("DELETE", `/v1/competitors/${encodeURIComponent(id)}`)
  }

  /** `GET /v1/competitors/cards` → every action card, most urgent first, with the posts they rest on. */
  cards(): Promise<CompetitorCardsResult> {
    return this.client.request<CompetitorCardsResult>("GET", "/v1/competitors/cards")
  }

  /**
   * `GET /v1/competitors/:id/lessons` → what works for a brand: per platform,
   * what its best posts share, measured on its own posts across every stored
   * scan, with the posts each lesson rests on (free). "What works for you" on
   * the brand marked as yours.
   */
  lessons(id: string): Promise<CompetitorLessonsResult> {
    return this.client.request<CompetitorLessonsResult>("GET", `/v1/competitors/${encodeURIComponent(id)}/lessons`)
  }

  /**
   * `GET /v1/competitors/actions` → the cards you marked "I did this", newest
   * first, each with how it went (`outcome`), and your track record per
   * family of advice (free). Each scan of your own brand judges the post that
   * came of a card once it is a few days old; the first verdict stays.
   */
  tried(): Promise<CompetitorActionsResult> {
    return this.client.request<CompetitorActionsResult>("GET", "/v1/competitors/actions")
  }

  /**
   * `POST /v1/competitors/actions` → "I did this" on a card on your wall (its
   * `id` from `cards()`), optionally with the link to your post that came of
   * it. Only cards whose advice ends in a post of yours can be marked
   * (`400 not_measurable`). Marking a marked card returns its mark
   * (`created: false`).
   */
  markDone(cardId: string, options: { postUrl?: string } = {}): Promise<CardActionResult> {
    return this.client.request<CardActionResult>("POST", "/v1/competitors/actions", { body: { cardId, ...(options.postUrl ? { postUrl: options.postUrl } : {}) } })
  }

  /**
   * `PATCH /v1/competitors/actions/:id` → link the post that came of a marked
   * card (the post's full link; a short link is refused with `400
   * short_link`), or `null` to remove the link. Another post is judged afresh.
   */
  linkPost(markId: string, postUrl: string | null): Promise<CardActionResult> {
    return this.client.request<CardActionResult>("PATCH", `/v1/competitors/actions/${encodeURIComponent(markId)}`, { body: { postUrl } })
  }

  /** `PATCH /v1/competitors/actions/:id` with `seen: true` → you have seen its verdict (the app stops announcing it). */
  markSeen(markId: string): Promise<CardActionResult> {
    return this.client.request<CardActionResult>("PATCH", `/v1/competitors/actions/${encodeURIComponent(markId)}`, { body: { seen: true } })
  }

  /** `DELETE /v1/competitors/actions/:id` → undo "I did this" (its verdict leaves your track record). */
  async unmark(markId: string): Promise<void> {
    await this.client.request<{ success: true }>("DELETE", `/v1/competitors/actions/${encodeURIComponent(markId)}`)
  }

  /** `POST /v1/competitor-discover` → a brand's accounts found from its website (free; guesses are marked). */
  discover(website: string): Promise<CompetitorDiscovery> {
    return this.client.request<CompetitorDiscovery>("POST", "/v1/competitor-discover", { body: { website } })
  }

  /**
   * `POST /v1/competitor-scan` → scan a brand now. Answers with a job id;
   * poll `client.jobs.getStatus(jobId)`, then read `get(id)` or `cards()`.
   */
  scan(id: string): Promise<{ jobId: string }> {
    return this.client.request<{ jobId: string }>("POST", "/v1/competitor-scan", { body: { competitorId: id } })
  }
}
