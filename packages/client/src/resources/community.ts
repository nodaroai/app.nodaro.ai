import type { NodaroClient } from "../client.js"

/** The kind of shared asset a community listing wraps. */
export type CommunityEntityType = "character" | "location" | "object"

/** How `browse` orders results. `newest` (default) or most-cloned first. */
export type CommunitySort = "newest" | "popular"

/**
 * Why a listing is being reported. Mirrors the backend's accepted reasons —
 * any other value is rejected with a validation error.
 */
export type CommunityReportReason =
  | "real_person_no_consent"
  | "inappropriate"
  | "ip_violation"
  | "other"

/**
 * A public community listing — a shared character, location, or object that
 * other users can browse, favorite, and clone into their own library. Field
 * names mirror the backend row shape (snake_case) exactly.
 */
export interface CommunityCard {
  id: string
  entity_type: CommunityEntityType
  /** Display name of the creator who published the listing. */
  creator_display_name: string | null
  /** URL-safe identifier used by {@link CommunityResource.get}. */
  slug: string
  title: string
  description: string | null
  category: string | null
  style: string | null
  tags: string[]
  /** Primary preview (a video for animated assets, else the main image). */
  preview_media_url: string | null
  /** Additional preview images shown in the detail/clone gallery. */
  preview_images: { url: string }[]
  /** Number of times this listing has been cloned. */
  clone_count: number
  /** Number of users who have favorited this listing. */
  favorite_count: number
  created_at: string
}

export interface BrowseCommunityParams {
  /** Filter to a single asset kind. */
  entityType?: CommunityEntityType
  /** Full-text search across title/description/tags. */
  q?: string
  /** Filter to a single category. */
  category?: string
  /** Order results. Defaults to `newest`. */
  sort?: CommunitySort
  /** Cursor token returned by the previous page. */
  cursor?: string
  /** Page size; the backend caps at 50 (default 20). */
  limit?: number
}

export interface BrowseCommunityResult {
  data: CommunityCard[]
  /** Token for the next page, or `null` when there are no more results. */
  nextCursor: string | null
}

/** Result of cloning a listing — the new asset's kind and id in your library. */
export interface CloneListingResult {
  entityType: CommunityEntityType
  id: string
}

/** Result of toggling a favorite — the listing's new favorited state. */
export interface FavoriteListingResult {
  favorited: boolean
}

/** Result of reporting a listing. */
export interface ReportListingResult {
  ok: boolean
}

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
