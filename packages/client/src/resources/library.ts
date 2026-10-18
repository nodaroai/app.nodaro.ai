import type { NodaroClientCore } from "../core.js"

/**
 * A media asset in the caller's library (`GET /v1/library`). Mirrors the route's
 * camelCase row shape (`backend/src/routes/library.ts`), the source of truth —
 * keep in sync if that response changes. Covers BOTH uploaded files and saved
 * generations; `type` discriminates the media kind.
 */
export interface LibraryAsset {
  readonly id: string
  /** Media kind — filter the list with the same values via `type`. */
  readonly type: "image" | "video" | "audio"
  /** Display filename (server override or the original); `null` if unknown. */
  readonly filename: string | null
  readonly mimeType: string | null
  readonly sizeBytes: number | null
  /** Public R2 URL of the asset. */
  readonly url: string
  /** Generated thumbnail URL (images/video); `null` for audio or when absent. */
  readonly thumbnailUrl: string | null
  readonly metadata: Record<string, unknown>
  /** True when promoted to the shared (admin) library. */
  readonly isLibraryItem: boolean
  /** How the asset entered storage (e.g. "manual_upload" | "generated"). */
  readonly uploadSource: string
  /**
   * WHICH SURFACE the media came from — `"internal" | "mcp" | "app" | "cli" |
   * "sdk" | "extension" | "web" | "api"`. Distinct from `uploadSource`, which
   * says how it entered storage (uploaded vs generated), not who was calling.
   * `null` on assets created before origin tracking existed — render as
   * "unknown", don't infer.
   */
  readonly source: string | null
  /** Specific identity within `source` (origin host, `extension/<name>`, `sdk/<version>`, MCP client, app id). */
  readonly sourceDetail: string | null
  /**
   * The job that made the file, when known: `null` for an upload or once that
   * job's history was deleted. Optional because servers before this field
   * leave it out.
   */
  readonly jobId?: string | null
  readonly createdAt: string
}

export interface ListLibraryParams {
  /** Filter by media kind; `"all"` (default) returns every kind. */
  readonly type?: "all" | "image" | "video" | "audio"
  /**
   * Search words: only the assets whose filename contains every word (split
   * on spaces, the first 5), ignoring case. Each word is matched as written
   * (`%`, `_` and `*` are not wildcards); blank means no search; up to 200
   * characters.
   */
  readonly q?: string
  /**
   * @deprecated Use `q`. The original name of the filename search, still
   * accepted; when both are given, `q` is sent and `search` is not.
   */
  readonly search?: string
  /** Page size, 1–100 (default 40). */
  readonly limit?: number
  /** Opaque cursor from a prior page's `nextCursor` (fetches the next page). */
  readonly cursor?: string
  /**
   * `true` → EVERY asset the caller owns (the "Storage" view: uploads +
   * generations, regardless of the in-library flag). `false` (default) → only
   * assets explicitly saved to the library plus shared items (the in-editor
   * Media Library picker).
   */
  readonly owned?: boolean
  /**
   * Filter to media that originated from one surface (see
   * {@link LibraryAsset.source}) — e.g. `"extension"` for everything a
   * browser extension produced. Assets predating origin tracking have a null
   * source and match no value, so they appear only when this is omitted.
   */
  readonly source?: "internal" | "mcp" | "app" | "cli" | "sdk" | "extension" | "web" | "api"
}

export interface ListLibraryResult {
  readonly data: LibraryAsset[]
  /** Pass back as `cursor` for the next page; `null` when there are no more. */
  readonly nextCursor: string | null
  /** Exact total (first page only — omitted on cursor-paged requests). */
  readonly totalCount?: number
}

/**
 * Library — the caller's media assets (uploaded files + saved generations).
 *
 * Read surface over `GET /v1/library`: a cursor-paginated, type-filterable,
 * filename-searchable list. This is the "bring from your media" source for
 * pickers that also offer upload + in-production stills. Writes (saving a
 * generation, promoting/removing) stay on their dedicated routes — not exposed
 * here until a consumer needs them.
 */
export class LibraryResource {
  constructor(private client: NodaroClientCore) {}

  /**
   * `GET /v1/library` → a page of the caller's media assets (newest first) plus
   * a `nextCursor`. Pass the returned `nextCursor` back as `cursor` for the next
   * page. Filter by `type` and search the filename with `q`; `owned: true`
   * returns the full Storage set (uploads + generations), the default only
   * library-saved + shared items.
   */
  list(params: ListLibraryParams = {}): Promise<ListLibraryResult> {
    const qs = new URLSearchParams()
    if (params.type) qs.set("type", params.type)
    // `search` alone keeps its own name on the wire, so a server older than
    // `q` still filters.
    if (params.q) qs.set("q", params.q)
    else if (params.search) qs.set("search", params.search)
    if (params.limit !== undefined) qs.set("limit", String(params.limit))
    if (params.cursor) qs.set("cursor", params.cursor)
    if (params.owned !== undefined) qs.set("owned", String(params.owned))
    if (params.source) qs.set("source", params.source)
    const query = qs.toString()
    return this.client.request("GET", `/v1/library${query ? `?${query}` : ""}`)
  }
}
