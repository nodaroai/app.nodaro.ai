/**
 * Shared community-sharing types — the public "listing" shape for shared
 * characters/locations/objects, re-used by the backend API response, the
 * `@nodaro/client` SDK, the frontend, and the CLI so they can't drift.
 */

/** The kind of shared asset a community listing wraps. */
export type CommunityEntityType = "character" | "location" | "object"

/** How `browse` orders results. `newest` (default) or most-cloned first. */
export type CommunitySort = "newest" | "popular"

/** Why a listing is being reported. Mirrors the backend's accepted reasons. */
export type CommunityReportReason =
  | "real_person_no_consent"
  | "inappropriate"
  | "ip_violation"
  | "other"

/**
 * A public community listing. Field names mirror the backend row shape
 * (snake_case) exactly — this is the single source of truth for that shape.
 */
export interface CommunityCard {
  id: string
  entity_type: CommunityEntityType
  creator_display_name: string | null
  slug: string
  title: string
  description: string | null
  category: string | null
  style: string | null
  tags: string[]
  preview_media_url: string | null
  preview_images: { url: string }[]
  clone_count: number
  favorite_count: number
  created_at: string
}

export interface BrowseCommunityParams {
  entityType?: CommunityEntityType
  q?: string
  category?: string
  sort?: CommunitySort
  cursor?: string
  limit?: number
}

export interface BrowseCommunityResult {
  data: CommunityCard[]
  nextCursor: string | null
}

export interface CloneListingResult {
  entityType: CommunityEntityType
  id: string
}

export interface FavoriteListingResult {
  favorited: boolean
}

export interface ReportListingResult {
  ok: boolean
}

/** Body for publishing (sharing) an entity to the community. */
export interface PublishListingParams {
  title: string
  description?: string
  category?: string
  style?: string
  tags?: string[]
  attestation: true
  likenessAttestation?: boolean
}

/** Result of publishing — the new listing's slug + id. */
export interface PublishListingResult {
  slug: string
  id: string
}

/** A creator's own listing for one source entity (from the by-source lookup). */
export interface SharedListing {
  id: string
  slug: string
  entity_type: CommunityEntityType
  title: string
  is_active: boolean
  is_listed: boolean
  clone_count: number
  favorite_count: number
  created_at: string
  updated_at: string
}
