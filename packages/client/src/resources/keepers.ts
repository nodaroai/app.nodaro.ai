import type { NodaroClientCore } from "../core.js"

/**
 * Nodaro Keepers — the shared catalog of characters, creatures, locations and
 * objects (`/v1/keepers/catalog`). An admin puts some of their own items on
 * the shelf; everyone browses it (the read takes no credential — a guest
 * sees it too); using one copies it into the caller's own account as a row
 * of their own, editable in Studio. The original is never changed, a later
 * change to it does not reach the copies, and taking it off the shelf
 * removes no copy. No credits for reading or copying.
 */

export const KEEPER_KINDS = ["character", "creature", "location", "object"] as const
export type KeeperKind = (typeof KEEPER_KINDS)[number]

/** One item on the shelf — display fields only. */
export interface KeeperCatalogItem {
  id: string
  kind: KeeperKind
  name: string
  description: string | null
  /** The main image, as stored. */
  imageUrl: string
  /** A 480px-wide copy of it for a tile (the image itself where the CDN does not resize). */
  previewUrl: string
  /** The shelf heading the admin filed it under, if any. */
  category: string | null
  /** The shelf order, lowest first. */
  sort: number
  createdAt: string
}

export interface KeeperCatalogParams {
  /** One kind only; omitted, the page runs through the kinds in `KEEPER_KINDS` order. */
  kind?: KeeperKind
  /** A previous page's `next`. */
  cursor?: string
  /** 1–200, default 50. */
  limit?: number
}

export interface KeeperCatalogPage {
  data: KeeperCatalogItem[]
  /** The next page's cursor, or null on the last page. */
  next: string | null
}

/** The caller's own copy of a shelf item. */
export interface CopyKeeperResult {
  /** The id of the caller's row — `client.characters.get(id)` and the others read it. */
  id: string
  name: string
  kind: KeeperKind
  /** `false` when the caller already had a copy of this item: that copy is returned, no second one is made. */
  created: boolean
}

/** `client.<kind>.setCatalog(id, input)` — admin only, on the admin's own rows. */
export interface SetKeeperCatalogInput {
  /** On the shelf, or not. */
  catalog: boolean
  /** The shelf order, lowest first (default 0). */
  sort?: number
  /** A shelf heading; `null` clears it. */
  category?: string | null
}

export interface SetKeeperCatalogResult {
  id: string
  kind: KeeperKind
  catalog: boolean
  sort: number
  category: string | null
}

export class KeepersResource {
  constructor(private readonly client: NodaroClientCore) {}

  /**
   * One page of the shelf. Public data: the same for every caller.
   *
   * ```ts
   * const { data, next } = await client.keepers.catalog({ kind: "character" })
   * ```
   */
  catalog(params: KeeperCatalogParams = {}): Promise<KeeperCatalogPage> {
    const query: Record<string, string | undefined> = {}
    if (params.kind) query.kind = params.kind
    if (params.cursor) query.cursor = params.cursor
    if (params.limit !== undefined) query.limit = String(params.limit)
    return this.client.request("GET", "/v1/keepers/catalog", { query })
  }

  /**
   * Use a shelf item: a copy of it in the caller's account — their own row,
   * made like a community clone: the public text, the main image and the
   * variant assets (every file copied into the caller's own storage and
   * counted against it), a custom voice reduced to its name and sample,
   * editable in Studio. Calling again returns the same copy
   * (`created: false`). No credits. A 413 `storage_limit_exceeded` when the
   * files do not fit the caller's storage; `ForbiddenError`
   * `personal_space_disabled` when their organization closed the personal
   * space.
   *
   * ```ts
   * const { id } = await client.keepers.copy("character", item.id)
   * const mine = await client.characters.get(id)
   * ```
   */
  copy(kind: KeeperKind, id: string): Promise<CopyKeeperResult> {
    return this.client.request("POST", `/v1/keepers/catalog/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/copy`)
  }
}
