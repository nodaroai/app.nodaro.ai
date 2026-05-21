import type {
  CharacterAspectRatio,
  LocationAssetType,
  LocationAttachColumn,
} from "@nodaro/shared"
import type { NodaroClient } from "../client.js"

/**
 * Re-export the shared `LocationAssetType` / `LocationAttachColumn` unions and
 * their runtime tuples so SDK consumers don't have to add `@nodaro/shared` as a
 * second dependency just to typecheck the `assetType` / `attachToColumn`
 * fields. Single source of truth lives in `@nodaro/shared/entity-prompts`.
 *
 * `CharacterAspectRatio` is re-exported alongside them — `generateMotion`'s
 * `aspectRatio` field reuses the same 4-value enum (1:1 / 3:4 / 16:9 / 9:16)
 * as characters; the route enforces this with `z.enum(CHARACTER_ASPECT_OPTIONS)`.
 */
export type { LocationAssetType, LocationAttachColumn } from "@nodaro/shared"
export { LOCATION_ASSET_TYPES, LOCATION_ATTACH_COLUMNS } from "@nodaro/shared"
export type { CharacterAspectRatio } from "@nodaro/shared"

/**
 * Reference-photo kind discriminator — the mood-board roles a user can attach
 * to a location. Mirrors the `reference_photos.kind` Zod enum in
 * `backend/src/routes/locations.ts`. `other` is the free-form bucket.
 */
export type LocationReferencePhotoKind =
  | "wide"
  | "interior"
  | "exterior"
  | "detail"
  | "moodBoard"
  | "other"

export interface LocationReferencePhoto {
  url: string
  kind: LocationReferencePhotoKind
}

/**
 * A location record returned by Nodaro's REST API. Mirrors the camelCase
 * shape produced by `backend/src/routes/locations.ts::toCamel()`.
 *
 * Asset buckets (`timeOfDay`, `weather`, `angles`, `lighting`, `seasons`,
 * `atmosphereMotions`) are independent JSONB arrays keyed by a human-readable
 * variant name (e.g. `"dawn"`, `"clear"`, `"wide"`). Each entry's `url` points
 * at an R2-hosted asset.
 *
 * Identity-foundation fields:
 *   - `referencePhotos` — caller-supplied mood-board refs (cap 20).
 *   - `canonicalDescription` — ~80–120-word LLM-authored visual caption,
 *     populated by `approveMainImage()` / `recaption()`. Coerced from DB null
 *     to "" on the wire so consumers don't need to defensively `?? ""`.
 *   - `styleLock` — whether asset gens should anchor to the canonical style
 *     captured at approval time. Defaults to `true` on new rows.
 */
export interface Location {
  id: string
  userId: string
  nodeId: string
  projectId: string | null
  name: string
  description: string | null
  category: string | null
  style: string | null
  sourceImageUrl: string | null
  timeOfDay: Array<{ name: string; url: string }>
  weather: Array<{ name: string; url: string }>
  angles: Array<{ name: string; url: string }>
  lighting: Array<{ name: string; url: string }>
  seasons: Array<{ name: string; url: string }>
  atmosphereMotions: Array<{ name: string; url: string }>
  referencePhotos: LocationReferencePhoto[]
  canonicalDescription: string
  styleLock: boolean
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * GET /v1/locations/:id appends a `pendingJobs` bucket the studio uses to
 * rehydrate spinners after a reload. Optional on the SDK surface — it doesn't
 * appear on `list()` rows.
 */
export interface LocationDetail extends Location {
  pendingJobs?: Array<{
    jobId: string
    assetType: string
    name: string
    status: string
  }>
}

/**
 * Body for `client.locations.create()`. Mirrors the INSERT branch of
 * `upsertLocationBody` in `backend/src/routes/locations.ts`. `name` + `nodeId`
 * are required on create.
 */
export interface CreateLocationInput {
  nodeId: string
  name: string
  description?: string
  category?: string
  style?: string
  workflowId?: string
  projectId?: string
  sourceImageUrl?: string
  referencePhotos?: LocationReferencePhoto[]
  canonicalDescription?: string
  styleLock?: boolean
}

/**
 * Body for `client.locations.update()`. Mirrors the UPDATE branch of
 * `upsertLocationBody` in `backend/src/routes/locations.ts`.
 *
 * Worker-owned asset buckets (`timeOfDay`/`weather`/`angles`/`lighting`/
 * `seasons`/`atmosphereMotions`) are deliberately omitted — the route drops
 * them on UPDATE so a Studio auto-save with a stale snapshot cannot clobber
 * the worker's atomic `append_location_asset()` writes.
 *
 * `expectedUpdatedAt` is the optimistic-concurrency token: when present, the
 * UPDATE only succeeds if the row's `updated_at` still matches; on mismatch
 * the route returns 409 so the studio can re-fetch + merge.
 */
export interface UpdateLocationInput {
  name?: string
  description?: string
  category?: string
  style?: string
  sourceImageUrl?: string
  referencePhotos?: LocationReferencePhoto[]
  canonicalDescription?: string
  styleLock?: boolean
  expectedUpdatedAt?: string
}

export interface UpdateLocationResult {
  id: string
  updatedAt: string
}

export interface ListLocationsParams {
  /** When true, return archived locations instead of active ones. */
  archived?: boolean
}

/**
 * Input for `client.locations.generate()` — fires the
 * `POST /v1/generate-location` route. Produces 1, 2, or 4 candidate
 * establishing shots; each lands as one `jobs` row in `pending` state and
 * is then enqueued for the worker.
 *
 * When `attachToLocationId` is set AND `count === 1`, the worker writes the
 * resulting URL directly to `locations.source_image_url` on completion —
 * caller doesn't need a separate `approveMainImage` call. Multi-candidate
 * batches MUST go through explicit approval so the user picks the winner.
 */
export interface GenerateLocationInput {
  name: string
  description?: string
  userPrompt?: string
  category?: "indoor" | "outdoor" | "urban" | "nature" | "fantasy" | "sci-fi" | "historical" | "futuristic" | "other"
  style?: "realistic" | "anime" | "3d-pixar" | "illustration"
  sourceImageUrl?: string
  provider?: string
  /** 1, 2, or 4 candidate main images. */
  count?: 1 | 2 | 4
  /** Auto-attach the result to this location row (single-candidate only). */
  attachToLocationId?: string
}

/**
 * `generate()` response — `{ jobId }` on `count === 1` (legacy single-job
 * shape) or `{ jobIds }` on `count === 2 | 4`. SDK consumers can discriminate
 * via `"jobIds" in result`.
 */
export type GenerateLocationResult = { jobId: string } | { jobIds: string[] }

/**
 * Input for `client.locations.generateAsset()` — fires the
 * `POST /v1/generate-location-asset` route. Produces a single
 * timeOfDay / weather / seasons / angles / lighting / custom variant.
 *
 * When all three studio-path fields are set (`attachToLocationId` +
 * `attachToColumn` + `attachName`), the worker appends
 * `{ name: attachName, url: <result> }` to the named JSONB array column on
 * the user's location row on completion. `attachToColumn` is REQUIRED for
 * `assetType === "custom"` — the worker can't infer the bucket from the
 * asset type.
 */
export interface GenerateLocationAssetInput {
  assetType: LocationAssetType
  variant: string
  name: string
  description?: string
  userPrompt?: string
  category?: string
  style?: "realistic" | "anime" | "3d-pixar" | "illustration"
  sourceImageUrl?: string
  provider?: string
  attachToLocationId?: string
  attachToColumn?: LocationAttachColumn
  attachName?: string
}

/**
 * Input for `client.locations.generateMotion()` — fires the
 * `POST /v1/generate-location-motion` route. Produces a single atmospheric
 * motion clip (drifting fog, snowfall, rolling waves, etc.) animated FROM a
 * static establishing-shot image.
 *
 * Mirrors `client.characters.generateMotion()` minus the character-specific
 * fields (gender / baseOutfit / realLifeRefs). The route hardcodes the attach
 * column to `atmosphere_motions` — callers supply `attachToLocationId` +
 * `attachName` only.
 *
 * `sourceImageUrl` is REQUIRED — image-to-video needs a source frame and the
 * route has no fallback (no `source_image_url` column to pull from on the
 * locations row; the studio path supplies the canonical establishing-shot URL
 * explicitly).
 *
 * When the studio path is set (`attachToLocationId` + `attachName`), the
 * worker appends `{ name: attachName, url: <result> }` to the location row's
 * `atmosphere_motions` JSONB column on completion.
 */
export interface GenerateLocationMotionInput {
  motionPrompt: string
  sourceImageUrl: string
  provider?: string
  name: string
  category?: string
  style?: "realistic" | "anime" | "3d-pixar" | "illustration"
  canonicalDescription?: string
  attachToLocationId?: string
  attachName?: string
  /**
   * Optional aspect ratio override. Defaults to 16:9 server-side via
   * `resolveLocationAspectRatio` (locations are cinematic establishing shots).
   * One of the 4-value `CharacterAspectRatio` union — locations reuse the
   * character aspect enum since the supported ratios are identical.
   */
  aspectRatio?: CharacterAspectRatio
}

export interface ApproveMainImageResult {
  sourceImageUrl: string
  /**
   * LLM-authored caption. Coerced to "" (NOT null) when the LLM call
   * sub-failed during the approval — the main image is still set; call
   * `recaption()` to retry.
   */
  canonicalDescription: string
}

export interface RecaptionLocationResult {
  canonicalDescription: string
}

export class LocationsResource {
  constructor(private client: NodaroClient) {}

  /**
   * List the caller's locations. By default returns active locations only;
   * pass `archived: true` to fetch soft-deleted rows for an "archive" view.
   */
  list(params: ListLocationsParams = {}): Promise<{ locations: Location[] }> {
    const query: Record<string, string | undefined> = {}
    if (params.archived) query.archived = "true"
    return this.client.request("GET", "/v1/locations", { query })
  }

  /**
   * Convenience wrapper for `list({ archived: true })`. Returns soft-deleted
   * rows so callers can drive a UI "Archived" tab without re-encoding the
   * query param. Mirrors `ObjectsResource.listArchived`.
   */
  listArchived(params: ListLocationsParams = {}): Promise<{ locations: Location[] }> {
    return this.list({ ...params, archived: true })
  }

  /**
   * Fetch a single location including in-flight asset job state. Soft-deleted
   * (archived) rows are returned by id intentionally so canvas nodes that
   * hold a stale `locationDbId` keep loading.
   */
  get(id: string): Promise<LocationDetail> {
    return this.client.request("GET", `/v1/locations/${encodeURIComponent(id)}`)
  }

  /**
   * Create a new location. `name` + `nodeId` are required — the route 400s
   * otherwise. Returns the new row's id.
   *
   * Note: the underlying route is the same `POST /v1/locations` upsert that
   * powers `update()`. This convenience wrapper enforces the INSERT-required
   * fields at the type level and never sends an `id`.
   */
  create(data: CreateLocationInput): Promise<{ id: string }> {
    return this.client.request("POST", "/v1/locations", { body: data })
  }

  /**
   * Update a location. Only the fields you pass are written — undefined keys
   * are NOT touched on the row. Worker-owned asset buckets are intentionally
   * not exposed on this surface (see `UpdateLocationInput` for the rationale).
   *
   * Optimistic-concurrency: pass `expectedUpdatedAt` to require the row's
   * `updated_at` still matches; on mismatch the route returns 409
   * `concurrent_modification`. The SDK surfaces that as a generic
   * `NodaroError` with the same code.
   */
  update(id: string, data: UpdateLocationInput): Promise<UpdateLocationResult> {
    return this.client.request("POST", "/v1/locations", {
      body: { id, ...data },
    })
  }

  /**
   * Soft-delete (archive) a location. The row is hidden from `list()` by
   * default but still loadable via `get(id)` so canvas nodes pointing at it
   * keep working. Restore with `restore(id)`.
   */
  delete(id: string): Promise<{ success: true; archived: true }> {
    return this.client.request("DELETE", `/v1/locations/${encodeURIComponent(id)}`)
  }

  /**
   * Un-archive a location. If the original name now collides (case-
   * insensitive) with an active row, the server auto-suffixes "(restored)"
   * and returns the effective name.
   */
  restore(id: string): Promise<{ id: string; name: string }> {
    return this.client.request("POST", `/v1/locations/${encodeURIComponent(id)}/restore`)
  }

  /**
   * Fire `POST /v1/generate-location` to produce one or more candidate main
   * images. With `count > 1`, all jobs are reserved up-front before any
   * is enqueued — mid-batch failures roll back atomically.
   *
   * When `attachToLocationId` is set AND `count === 1`, the worker writes
   * the result directly to the row's `source_image_url`; otherwise you must
   * call `approveMainImage()` after picking a candidate.
   */
  generate(data: GenerateLocationInput): Promise<GenerateLocationResult> {
    return this.client.request("POST", "/v1/generate-location", { body: data })
  }

  /**
   * Fire `POST /v1/generate-location-asset` to produce a single variant.
   * When the studio path is set (`attachToLocationId` + `attachToColumn` +
   * `attachName`), the worker appends `{ name: attachName, url: <result> }`
   * to the named JSONB array column on completion.
   */
  generateAsset(data: GenerateLocationAssetInput): Promise<{ jobId: string }> {
    return this.client.request("POST", "/v1/generate-location-asset", { body: data })
  }

  /**
   * Fire `POST /v1/generate-location-motion` to animate the location's
   * establishing shot into an atmospheric motion clip. Image-to-video, single
   * clip per call; the attach column is hardcoded to `atmosphere_motions`
   * server-side (locations have a single motion bucket so the caller doesn't
   * supply `attachToColumn`). When the studio path is set
   * (`attachToLocationId` + `attachName`), the worker appends
   * `{ name: attachName, url: <result> }` to the row's `atmosphere_motions`
   * column on completion.
   */
  generateMotion(data: GenerateLocationMotionInput): Promise<{ jobId: string }> {
    return this.client.request("POST", "/v1/generate-location-motion", { body: data })
  }

  /**
   * Approve a completed `generate-location` job as the location's main image.
   * Sets `source_image_url` and fires the LLM caption (Claude Sonnet vision)
   * inline. Returns the new main-image URL plus the caption.
   *
   * Caption-failure semantics: `canonicalDescription` is coerced to `""`
   * (NOT null) when the LLM call sub-failed — the main image is still set;
   * call `recaption()` to retry.
   */
  approveMainImage(id: string, candidateJobId: string): Promise<ApproveMainImageResult> {
    return this.client.request(
      "POST",
      `/v1/locations/${encodeURIComponent(id)}/approve-main-image`,
      { body: { candidateJobId } },
    )
  }

  /**
   * Re-fire the LLM caption against the location's current main image. 502s
   * on LLM failure (unlike `approveMainImage` which preserves the side-effect
   * and returns ""); returns 400 `no_source_image` if no main image is set
   * yet.
   */
  recaption(id: string): Promise<RecaptionLocationResult> {
    return this.client.request(
      "POST",
      `/v1/locations/${encodeURIComponent(id)}/llm-caption`,
    )
  }
}
