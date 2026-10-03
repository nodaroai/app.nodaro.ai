import type { NodaroClient } from "../client.js"
import type {
  CompetitorCardsResult,
  CompetitorDetail,
  CompetitorDiscovery,
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
    const res = await this.client.request<{ data: TrackedCompetitor[] }>("GET", "/v1/competitors")
    return res.data
  }

  /** `GET /v1/competitors/:id` → one brand with its latest scan (posts and cards) and its scan history. */
  get(id: string): Promise<CompetitorDetail> {
    return this.client.request<CompetitorDetail>("GET", `/v1/competitors/${encodeURIComponent(id)}`)
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
