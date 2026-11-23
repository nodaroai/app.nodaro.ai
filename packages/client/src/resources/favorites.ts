import type { NodaroClientCore } from "../core.js"

/**
 * Every kind of favorite a person keeps. Mirrors `GET /v1/favorites`
 * (`backend/src/routes/favorites.ts`), the source of truth.
 */
export type FavoriteKind = "job" | "asset" | "voice" | "preset" | "catalog"

/** One favorite of the combined list. Exactly one of the detail fields is present, the one its `kind` names. */
export interface FavoriteItem {
  readonly kind: FavoriteKind
  /** What it points at: the job id, the asset id, the voice id, the preset id, or `<catalog>/<optionId>`. */
  readonly id: string
  /** When it was starred. */
  readonly favoritedAt: string
  /** kind `job`: the generation. */
  readonly job?: {
    readonly id: string
    readonly type: string | null
    readonly status: string | null
    readonly mediaType: "image" | "video" | "audio" | null
    readonly url: string | null
    readonly thumbnailUrl: string | null
    readonly createdAt: string | null
  }
  /** kind `asset`: an uploaded file, or a library file whose job was in the Trash when starred (any other file a job made lists as its `job`). */
  readonly asset?: {
    readonly id: string
    readonly type: string
    readonly filename: string | null
    readonly url: string
    readonly thumbnailUrl: string | null
    readonly createdAt: string
  }
  /** kind `voice`: the voice as it was starred (`client.voices` favorites). */
  readonly voice?: {
    readonly voiceId: string
    readonly voiceType: string
    readonly name: string
    readonly previewUrl: string | null
  }
  /** kind `preset`: a node preset, factory or yours (`client.presets` favorites). */
  readonly preset?: { readonly nodeType: string; readonly presetId: string }
  /** kind `catalog`: a picker option ({@link FavoritesResource.addCatalog}). */
  readonly catalog?: { readonly catalog: string; readonly optionId: string; readonly label: string | null }
}

export interface ListFavoritesParams {
  /** Only these kinds; default every kind (for an OAuth app: every kind its grant reads). */
  readonly kinds?: readonly FavoriteKind[]
  /** Page size, 1–100 (default 50). */
  readonly limit?: number
  /** A prior page's `nextCursor`. */
  readonly cursor?: string
}

export interface ListFavoritesResult {
  readonly data: FavoriteItem[]
  /**
   * Pass back as `cursor` for the next page; `null` when there are no more.
   * It can be set on a page with fewer than `limit` items, even none.
   */
  readonly nextCursor: string | null
}

/** A favorite picker option. */
export interface CatalogFavorite {
  /** The catalog's id: a picker catalog's `catalogId` (`client.pickerCatalogs`), `shot-shapes` or `style-presets`. */
  readonly catalog: string
  /** The option's id; a per-field option of a multi-field catalog is `<field>:<id>` (`genre:jazz`). */
  readonly optionId: string
  /** The option's label now; `null` when its catalog no longer has it. */
  readonly label: string | null
  readonly createdAt: string
}

/** What {@link FavoritesResource.addCatalog} answers: the option in its stored spelling. */
export interface AddCatalogFavoriteResult {
  readonly catalog: string
  readonly optionId: string
  readonly label: string
  readonly favorited: true
  readonly createdAt: string | null
}

/** What {@link FavoritesResource.removeCatalog} answers. */
export interface RemoveCatalogFavoriteResult {
  readonly catalog: string
  readonly optionId: string
  readonly favorited: false
}

/**
 * Favorites — everything a person keeps, in one list, and the favorite picker
 * options.
 *
 * Each kind is starred where it lives: a generation with
 * `client.gallery.toggleFavorite`, a library file (an upload too) with
 * `client.library.favorite`, a voice and a preset through their resources, a
 * picker option here ({@link addCatalog}). {@link list} reads them all back,
 * newest first, with one cursor.
 */
export class FavoritesResource {
  constructor(private client: NodaroClientCore) {}

  /**
   * `GET /v1/favorites` → a page of your favorites of every kind (or of
   * `kinds`), newest first. Pass `nextCursor` back as `cursor` for the next
   * page, until it is `null`. A page can hold fewer than `limit` items — even
   * none — while `nextCursor` is set: a favorite you may no longer see (a job
   * made private or in the Trash, a deleted file) is left out of its page. Page
   * on `nextCursor`, never on `data.length`. The list is not counted.
   */
  list(params: ListFavoritesParams = {}): Promise<ListFavoritesResult> {
    const qs = new URLSearchParams()
    if (params.kinds && params.kinds.length > 0) qs.set("kinds", params.kinds.join(","))
    if (params.limit !== undefined) qs.set("limit", String(params.limit))
    if (params.cursor) qs.set("cursor", params.cursor)
    const query = qs.toString()
    return this.client.request("GET", `/v1/favorites${query ? `?${query}` : ""}`)
  }

  /**
   * `GET /v1/favorites/catalog` → your favorite picker options, newest first;
   * one catalog's with `catalog` (its node type is accepted too).
   */
  async listCatalog(catalog?: string): Promise<CatalogFavorite[]> {
    const qs = catalog ? `?${new URLSearchParams({ catalog }).toString()}` : ""
    const res = await this.client.request<{ data: CatalogFavorite[] }>("GET", `/v1/favorites/catalog${qs}`)
    return res.data
  }

  /**
   * `PUT /v1/favorites/catalog/:catalog/:optionId` → star a picker option (a
   * style, a mood, a camera move, a music genre, a Person setting, a shot
   * shape, ...). Both ids are checked against the catalogs the server serves
   * (`ValidationError` otherwise). Idempotent. At most 1000 favorite options,
   * held even for stars sent at once: past that a 409 `limit_reached`.
   */
  async addCatalog(catalog: string, optionId: string): Promise<AddCatalogFavoriteResult> {
    const res = await this.client.request<{ data: AddCatalogFavoriteResult }>(
      "PUT",
      `/v1/favorites/catalog/${encodeURIComponent(catalog)}/${encodeURIComponent(optionId)}`,
    )
    return res.data
  }

  /** `DELETE /v1/favorites/catalog/:catalog/:optionId` → unstar a picker option. Idempotent. */
  async removeCatalog(catalog: string, optionId: string): Promise<RemoveCatalogFavoriteResult> {
    const res = await this.client.request<{ data: RemoveCatalogFavoriteResult }>(
      "DELETE",
      `/v1/favorites/catalog/${encodeURIComponent(catalog)}/${encodeURIComponent(optionId)}`,
    )
    return res.data
  }
}
