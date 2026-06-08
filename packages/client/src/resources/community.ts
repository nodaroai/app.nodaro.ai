import type {
  CommunityEntityType, CommunitySort, CommunityReportReason, CommunityCard,
  BrowseCommunityParams, BrowseCommunityResult, CloneListingResult,
  FavoriteListingResult, ReportListingResult,
} from "@nodaro/shared"
import type { NodaroClient } from "../client.js"

/**
 * The community-listing types are the single source of truth in
 * `@nodaro/shared` (re-used by the backend, frontend, and CLI). Re-export them
 * here so SDK consumers don't have to add `@nodaro/shared` as a second
 * dependency just to typecheck `browse`/`clone`/`favorite`/`report`.
 */
export type {
  CommunityEntityType, CommunitySort, CommunityReportReason, CommunityCard,
  BrowseCommunityParams, BrowseCommunityResult, CloneListingResult,
  FavoriteListingResult, ReportListingResult,
} from "@nodaro/shared"

/**
 * Community — browse, favorite, clone, and report shared characters,
 * locations, and objects.
 *
 * Publishing is intentionally NOT exposed here: it is admin-only via the
 * editor, and the publish route rejects personal access tokens (which is what
 * the SDK uses).
 */
export class CommunityResource {
  constructor(private client: NodaroClient) {}

  /**
   * `GET /v1/community/browse` → a page of public listings plus a `nextCursor`.
   * Pass the returned `nextCursor` back as `cursor` to fetch the next page.
   */
  browse(params: BrowseCommunityParams = {}): Promise<BrowseCommunityResult> {
    const qs = new URLSearchParams()
    if (params.entityType) qs.set("entityType", params.entityType)
    if (params.q) qs.set("q", params.q)
    if (params.category) qs.set("category", params.category)
    if (params.sort) qs.set("sort", params.sort)
    if (params.cursor) qs.set("cursor", params.cursor)
    if (params.limit !== undefined) qs.set("limit", String(params.limit))
    const query = qs.toString()
    return this.client.request(
      "GET",
      `/v1/community/browse${query ? `?${query}` : ""}`,
    )
  }

  /** `GET /v1/community/detail/:slug` → a single listing by its slug. */
  get(slug: string): Promise<{ data: CommunityCard }> {
    return this.client.request(
      "GET",
      `/v1/community/detail/${encodeURIComponent(slug)}`,
    )
  }

  /** `GET /v1/community/favorites` → the listings you've favorited. */
  favorites(): Promise<{ data: CommunityCard[] }> {
    return this.client.request("GET", "/v1/community/favorites")
  }

  /**
   * `POST /v1/community/listings/:id/clone` → copy a listing into your library.
   * Returns the new asset's `entityType` and `id`. Requires the `assets:write`
   * scope when called with an OAuth app token.
   */
  clone(id: string, entityType: CommunityEntityType): Promise<CloneListingResult> {
    return this.client.request(
      "POST",
      `/v1/community/listings/${encodeURIComponent(id)}/clone`,
      { body: { entityType } },
    )
  }

  /**
   * `POST /v1/community/listings/:id/favorite` → toggle a favorite. Returns the
   * resulting `favorited` state (`true` after adding, `false` after removing).
   */
  favorite(id: string): Promise<FavoriteListingResult> {
    return this.client.request(
      "POST",
      `/v1/community/listings/${encodeURIComponent(id)}/favorite`,
    )
  }

  /**
   * `POST /v1/community/listings/:id/report` → flag a listing for moderation.
   * `reason` must be one of {@link CommunityReportReason}.
   */
  report(id: string, reason: CommunityReportReason): Promise<ReportListingResult> {
    return this.client.request(
      "POST",
      `/v1/community/listings/${encodeURIComponent(id)}/report`,
      { body: { reason } },
    )
  }
}
