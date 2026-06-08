import type {
  CommunityEntityType, CommunitySort, CommunityReportReason, CommunityCard,
  CommunityFullDetail,
  BrowseCommunityParams, BrowseCommunityResult, CloneListingResult,
  FavoriteListingResult, ReportListingResult,
  PublishListingParams, PublishListingResult, SharedListing,
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
  CommunityFullDetail,
  BrowseCommunityParams, BrowseCommunityResult, CloneListingResult,
  FavoriteListingResult, ReportListingResult,
  PublishListingParams, PublishListingResult, SharedListing,
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

  /**
   * `GET /v1/community/detail/:slug/full` → the full read-only detail (card
   * identity + the stored public snapshot). Like {@link get}, but includes the
   * snapshot asset/voice/text blob needed to render the full cross-user view.
   */
  getFull(slug: string): Promise<{ data: CommunityFullDetail }> {
    return this.client.request(
      "GET",
      `/v1/community/detail/${encodeURIComponent(slug)}/full`,
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

  /**
   * `POST /v1/admin/community/:entityType/:id/publish` → share one of YOUR
   * entities to the community, returning the new listing's `slug` + `id`.
   *
   * **Requires an admin token** (the route is `requireAdmin`) AND the caller
   * must own the source entity. Personal/OAuth tokens without admin role get a
   * 401. For `character` listings, `params.likenessAttestation` must be `true`.
   */
  publish(
    entityType: CommunityEntityType,
    entityId: string,
    params: PublishListingParams,
  ): Promise<PublishListingResult> {
    return this.client.request(
      "POST",
      `/v1/admin/community/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/publish`,
      { body: params },
    )
  }

  /**
   * `DELETE /v1/admin/community/listings/:id` → unshare (deactivate) a listing
   * you published. **Requires an admin token** (the route is `requireAdmin`).
   */
  unpublish(listingId: string): Promise<{ ok: boolean }> {
    return this.client.request(
      "DELETE",
      `/v1/admin/community/listings/${encodeURIComponent(listingId)}`,
    )
  }

  /**
   * `GET /v1/admin/community/by-source/:entityType/:sourceId` → look up YOUR
   * existing listing (if any) for a source entity. Returns `{ data: null }`
   * when the entity hasn't been shared. **Requires an admin token** (the route
   * is `requireAdmin`); only returns listings created by the caller.
   */
  sharedListing(
    entityType: CommunityEntityType,
    sourceId: string,
  ): Promise<{ data: SharedListing | null }> {
    return this.client.request(
      "GET",
      `/v1/admin/community/by-source/${encodeURIComponent(entityType)}/${encodeURIComponent(sourceId)}`,
    )
  }
}
