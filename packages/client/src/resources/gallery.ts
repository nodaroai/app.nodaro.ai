import type { NodaroClientCore } from "../core.js"

export type GalleryMediaType = "image" | "video" | "audio"

/**
 * One gallery card (`GET /v1/gallery`): a completed generation with media.
 * Mirrors the route's item shape — never whose it is.
 */
export interface GalleryItem {
  /** The job id — pass it to `toggleFavorite`, or `client.jobs.get`. */
  readonly id: string
  readonly type: GalleryMediaType
  /** The kind of job that made it (`generate-image`, `image-to-video`, …). */
  readonly jobName: string
  readonly outputUrl: string
  readonly thumbnailUrl: string | null
  /** When the job completed. */
  readonly createdAt: string
  readonly prompt: string | null
  readonly model: string | null
  /** A private 720p Preview render (Apply EDL at proxy quality). Present only when true. */
  readonly preview?: true
}

export interface BrowseGalleryParams {
  /** Only this media kind. */
  readonly type?: GalleryMediaType
  /**
   * Only this person's work. Your own id lists your own items, private ones
   * included; anyone else's lists their public ones.
   */
  readonly userId?: string
  /**
   * With YOUR OWN `userId` (from `client.me()`): only the items you
   * favorited. Anyone else's favorites are refused — `UnauthorizedError`
   * without a token, `ForbiddenError` with another person's `userId` or none.
   */
  readonly favoritesOnly?: boolean
  /** Page size, 1–50 (default 20). */
  readonly limit?: number
  /** The previous page's `nextCursor`. */
  readonly cursor?: string
}

export interface GalleryPage {
  readonly data: GalleryItem[]
  /** Pass back as `cursor` for the next page; `null` on the last one. */
  readonly nextCursor: string | null
  /** Counted on the first page only (no cursor). */
  readonly totalCount?: number
}

/** What {@link GalleryResource.toggleFavorite} answers: whether the job is now a favorite. */
export interface ToggleFavoriteResult {
  readonly favorited: boolean
}

/**
 * Gallery — the public gallery of completed generations, and your favorites.
 *
 * A favorite is a bookmark on a generation: one of your own, or anyone's in
 * the public gallery. Your jobs carry it as `Job.favorited`, and
 * `client.jobs.list({ favorited: true })` lists them. Not available on a
 * deployment that hides the gallery (the routes answer 404 there).
 */
export class GalleryResource {
  constructor(private client: NodaroClientCore) {}

  /**
   * `GET /v1/gallery` → a page of the public gallery, newest first (no auth
   * needed), or one person's work with `userId`.
   */
  browse(params: BrowseGalleryParams = {}): Promise<GalleryPage> {
    return this.client.request<GalleryPage>("GET", "/v1/gallery", {
      query: {
        type: params.type,
        userId: params.userId,
        favoritesOnly: params.favoritesOnly,
        limit: params.limit,
        cursor: params.cursor,
      },
    })
  }

  /**
   * Favorite a job, or un-favorite it when it already is
   * (`POST /v1/gallery/favorite`). You can favorite your own jobs and public
   * ones; another person's private job is a `NotFoundError`. OAuth apps need
   * the `assets:write` scope.
   */
  toggleFavorite(jobId: string): Promise<ToggleFavoriteResult> {
    return this.client.request<ToggleFavoriteResult>("POST", "/v1/gallery/favorite", { body: { jobId } })
  }

  /**
   * Your favorited job ids, newest first (`GET /v1/gallery/favorites`). OAuth
   * apps need the `assets:read` or `jobs:read` scope.
   */
  async favorites(): Promise<string[]> {
    const res = await this.client.request<{ data: string[] }>("GET", "/v1/gallery/favorites")
    return res.data
  }
}
