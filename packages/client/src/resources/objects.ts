import type {
  ObjectAssetType,
  ObjectAttachColumn,
  ObjectAspectRatio,
} from "@nodaro/shared"
import type { NodaroClient } from "../client.js"

/**
 * Re-export the shared `ObjectAssetType` / `ObjectAttachColumn` unions and
 * their runtime tuples so SDK consumers don't have to add `@nodaro/shared` as
 * a second dependency just to typecheck the `assetType` / `attachToColumn`
 * fields. Single source of truth lives in `@nodaro/shared/entity-prompts`.
 *
 * `ObjectAspectRatio` is re-exported alongside them — `generateMotion`'s
 * `aspectRatio` field is the 5-value object enum (1:1 / 3:4 / 16:9 / 9:16 /
 * 4:3) from `@nodaro/shared/object-aspect-defaults`. Distinct from
 * `CharacterAspectRatio` because objects support an extra 4:3 framing for
 * product-showcase shots.
 */
export type { ObjectAssetType, ObjectAttachColumn } from "@nodaro/shared"
export { OBJECT_ASSET_TYPES, OBJECT_ATTACH_COLUMNS } from "@nodaro/shared"
export type { ObjectAspectRatio } from "@nodaro/shared"
export { OBJECT_ASPECT_OPTIONS, OBJECT_ASPECT_DEFAULTS } from "@nodaro/shared"

/**
 * Reference-photo kind discriminator — the mood-board roles a user can attach
 * to an object. Mirrors the `reference_photos.kind` field accepted by
 * `backend/src/routes/objects.ts` (the route accepts open strings; this SDK
 * type narrows to the 6 canonical roles surfaced by the Studio). `other` is
 * the free-form bucket.
 */
export type ObjectReferencePhotoKind =
  | "front"
  | "side"
  | "detail"
  | "context"
  | "moodBoard"
  | "other"

export interface ObjectReferencePhoto {
  url: string
  kind: ObjectReferencePhotoKind
}

/**
 * An object record returned by Nodaro's REST API. Mirrors the camelCase
 * shape produced by `backend/src/routes/objects.ts::toCamel()`.
 *
 * Asset buckets (`angles`, `materials`, `variations`, `motionClips`) are
 * independent JSONB arrays keyed by a human-readable variant name (e.g.
 * `"front"`, `"wood"`, `"weathered"`). Each entry's `url` points at an
 * R2-hosted asset.
 *
 * Identity-foundation fields:
 *   - `referencePhotos` — caller-supplied mood-board refs (cap 20). Objects
 *     do NOT carry a `piiConsentAt` field (location Phase 2 #7 only).
 *   - `canonicalDescription` — ~80–120-word LLM-authored visual caption,
 *     populated by `approveMainImage()` / `recaption()`. Coerced from DB null
 *     to "" on the wire so consumers don't need to defensively `?? ""`.
 *   - `styleLock` — whether asset gens should anchor to the canonical style
 *     captured at approval time. Defaults to `true` on new rows.
 *
 * `Object` shadows the JS global, which TypeScript handles cleanly via
 * local-scope resolution. Consumers who need both can alias as
 * `import type { Object as NodaroObject } from "@nodaro/client"`.
 */
export interface Object {
  id: string
  userId: string
  nodeId: string
  projectId: string | null
  name: string
  description: string | null
  category: string | null
  style: string | null
  sourceImageUrl: string | null
  angles: Array<{ name: string; url: string }>
  materials: Array<{ name: string; url: string }>
  variations: Array<{ name: string; url: string }>
  motionClips: Array<{ name: string; url: string }>
  referencePhotos: ObjectReferencePhoto[]
  canonicalDescription: string
  styleLock: boolean
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * GET /v1/objects/:id may append a `pendingJobs` bucket the studio uses to
 * rehydrate spinners after a reload. Optional on the SDK surface — it doesn't
 * appear on `list()` rows.
 */
export interface ObjectDetail extends Object {
  pendingJobs?: Array<{
    jobId: string
    assetType: string
    name: string
    status: string
  }>
}

/**
 * Body for `client.objects.create()`. Mirrors the INSERT branch of
 * `upsertObjectBody` in `backend/src/routes/objects.ts`. `name` + `nodeId`
 * are required on create.
 */
export interface CreateObjectInput {
  nodeId: string
  name: string
  description?: string
  category?: ObjectCategory
  style?: string
  workflowId?: string
  projectId?: string
  sourceImageUrl?: string
  referencePhotos?: ObjectReferencePhoto[]
  canonicalDescription?: string
  styleLock?: boolean
}

/**
 * The 10-value Object category enum. Mirrors the literal accepted by
 * `POST /v1/generate-object` and surfaced in the Object Studio category
 * picker. Distinct from location's geography-based set.
 */
export type ObjectCategory =
  | "furniture"
  | "vehicle"
  | "weapon"
  | "food"
  | "clothing"
  | "electronics"
  | "nature"
  | "tool"
  | "animal"
  | "other"

/**
 * Body for `client.objects.update()`. Mirrors the UPDATE branch of
 * `upsertObjectBody` in `backend/src/routes/objects.ts`.
 *
 * Worker-owned asset buckets (`angles` / `materials` / `variations` /
 * `motionClips`) are deliberately omitted — the route drops them on UPDATE
 * so a Studio auto-save with a stale snapshot cannot clobber the worker's
 * atomic `append_object_asset()` writes.
 *
 * `expectedUpdatedAt` is the optimistic-concurrency token: when present, the
 * UPDATE only succeeds if the row's `updated_at` still matches; on mismatch
 * the route returns 409 so the studio can re-fetch + merge.
 */
export interface UpdateObjectInput {
  name?: string
  description?: string
  category?: ObjectCategory
  style?: string
  sourceImageUrl?: string
  referencePhotos?: ObjectReferencePhoto[]
  canonicalDescription?: string
  styleLock?: boolean
  expectedUpdatedAt?: string
}

export interface UpdateObjectResult {
  id: string
  updatedAt: string
}

/**
 * Combined create + update body (parameter for both branches). Exported for
 * callers that want to drive a single `upsert` flow without picking between
 * `Create*` and `Update*`. Mirrors the `upsertObjectBody` Zod schema in
 * `backend/src/routes/objects.ts`. `nodeId` + `name` are required on INSERT;
 * `id` flips the route into UPDATE mode.
 */
export interface UpsertObjectInput extends CreateObjectInput {
  id?: string
  expectedUpdatedAt?: string
}

export type UpsertObjectResult = { id: string } | UpdateObjectResult

export interface ListObjectsParams {
  /** When true, return archived objects instead of active ones. */
  archived?: boolean
  /** Optional project filter — server-scoped to the caller's user. */
  projectId?: string
}

/**
 * Input for `client.objects.generate()` — fires the
 * `POST /v1/generate-object` route. Produces 1, 2, or 4 candidate
 * main images; each lands as one `jobs` row in `pending` state and is then
 * enqueued for the worker.
 *
 * When `attachToObjectId` is set AND `count === 1`, the worker writes the
 * resulting URL directly to `objects.source_image_url` on completion —
 * caller doesn't need a separate `approveMainImage` call. Multi-candidate
 * batches MUST go through explicit approval so the user picks the winner.
 *
 * `seedPromptHint` (Pass 7 F-77) flows the parameter-picker's prompt fragment
 * through to the worker so a catalog selection (e.g. "antique brass lantern")
 * gets appended to the generated prompt context.
 */
export interface GenerateObjectInput {
  name: string
  description?: string
  userPrompt?: string
  category?: ObjectCategory
  style?: "realistic" | "anime" | "3d-pixar" | "illustration"
  sourceImageUrl?: string
  provider?: string
  /** 1, 2, 3, or 4 candidate main images. */
  count?: 1 | 2 | 3 | 4
  /** Auto-attach the result to this object row (single-candidate only). */
  attachToObjectId?: string
  /** Parameter-picker prompt-fragment pass-through. */
  seedPromptHint?: string
  /** Optional name to set on the attached row alongside the main image. */
  attachName?: string
  /** Optimistic-concurrency token for the single-candidate auto-attach path. */
  expectedUpdatedAt?: string
}

/**
 * `generate()` response — `{ jobId }` on `count === 1` (legacy single-job
 * shape) or `{ jobIds }` on `count === 2 | 4`. SDK consumers can discriminate
 * via `"jobIds" in result`.
 */
export type GenerateObjectResult = { jobId: string } | { jobIds: string[] }

/**
 * Input for `client.objects.generateAsset()` — fires the
 * `POST /v1/generate-object-asset` route. Produces a single
 * angles / materials / variations / custom variant.
 *
 * When all three studio-path fields are set (`attachToObjectId` +
 * `attachToColumn` + `attachName`), the worker appends
 * `{ name: attachName, url: <result> }` to the named JSONB array column on
 * the user's object row on completion. `attachToColumn` is REQUIRED for
 * `assetType === "custom"` — the worker can't infer the bucket from the
 * asset type.
 */
export interface GenerateObjectAssetInput {
  assetType: ObjectAssetType
  variant: string
  name: string
  description?: string
  userPrompt?: string
  category?: string
  style?: "realistic" | "anime" | "3d-pixar" | "illustration"
  sourceImageUrl?: string
  provider?: string
  attachToObjectId?: string
  attachToColumn?: ObjectAttachColumn
  attachName?: string
  /** Parameter-picker prompt-fragment pass-through (Pass 7 F-77). */
  seedPromptHint?: string
}

export interface GenerateObjectAssetResult {
  jobId: string
}

/**
 * Input for `client.objects.generateMotion()` — fires the
 * `POST /v1/generate-object-motion` route. Produces a single motion clip
 * (rotation, orbit, hover, drift, etc.) animated FROM a static product-shot
 * image.
 *
 * Mirrors `client.locations.generateMotion()` minus the location-specific
 * atmospheric fields. The route hardcodes the attach column to `motion_clips`
 * — callers supply `attachToObjectId` + `attachName` only.
 *
 * `sourceImageUrl` is REQUIRED — image-to-video needs a source frame and the
 * route has no fallback (no `source_image_url` column to pull from on the
 * objects row at this point in the flow; the studio path supplies the
 * canonical product-shot URL explicitly).
 *
 * Object-specific defaults vs location:
 *   - `provider` defaults to `"kling-turbo"` (not location's `"kling"`)
 *   - `aspectRatio` defaults to `"1:1"` server-side via
 *     `resolveObjectAspectRatio({ assetType: "motion" })` — objects are
 *     product-showcase framing, not cinematic establishing shots.
 *
 * When the studio path is set (`attachToObjectId` + `attachName`), the
 * worker appends `{ name: attachName, url: <result> }` to the object row's
 * `motion_clips` JSONB column on completion.
 */
export interface GenerateObjectMotionInput {
  motionPrompt: string
  sourceImageUrl: string
  provider?: string
  name: string
  /** Source clip URL — when set, worker routes to video-to-video refine. */
  refineFromVideoUrl?: string
  category?: string
  style?: "realistic" | "anime" | "3d-pixar" | "illustration"
  canonicalDescription?: string
  /** Parameter-picker prompt-fragment pass-through (Pass 7 F-77). */
  seedPromptHint?: string
  attachToObjectId?: string
  attachName?: string
  /**
   * Optional aspect ratio override. Defaults to 1:1 server-side. One of the
   * 5-value `ObjectAspectRatio` union (1:1 / 3:4 / 16:9 / 9:16 / 4:3) —
   * objects have their own enum (with 4:3 added) vs the character set.
   */
  aspectRatio?: ObjectAspectRatio
}

export interface GenerateObjectMotionResult {
  jobId: string
}

export interface ApproveObjectMainImageResult {
  sourceImageUrl: string
  /**
   * LLM-authored caption. Coerced to "" (NOT null) when the LLM call
   * sub-failed during the approval — the main image is still set; call
   * `recaption()` to retry.
   */
  canonicalDescription: string
}

export interface RecaptionObjectResult {
  canonicalDescription: string
}

export class ObjectsResource {
  constructor(private client: NodaroClient) {}

  /**
   * List the caller's objects. By default returns active objects only;
   * pass `archived: true` to fetch soft-deleted rows for an "archive" view.
   * Optional `projectId` scopes the result to a single project.
   */
  list(params: ListObjectsParams = {}): Promise<{ objects: Object[] }> {
    const query: Record<string, string | undefined> = {}
    if (params.archived) query.archived = "true"
    if (params.projectId) query.projectId = params.projectId
    return this.client.request("GET", "/v1/objects", { query })
  }

  /**
   * Convenience wrapper for `list({ archived: true })`. Returns soft-deleted
   * rows so callers can drive a UI "Archived" tab without re-encoding the
   * query param.
   *
   * `archived` is omitted from the param type — it's always set to `true` here.
   */
  listArchived(params: Omit<ListObjectsParams, "archived"> = {}): Promise<{ objects: Object[] }> {
    return this.list({ ...params, archived: true })
  }

  /**
   * Fetch a single object including in-flight asset job state. Soft-deleted
   * (archived) rows are NOT returned by id — the route enforces
   * `deleted_at IS NULL` so archived objects 404 (uniform Pass 10 F-90b
   * "not_found" — does not leak the deleted vs non-existent distinction).
   */
  get(id: string): Promise<ObjectDetail> {
    return this.client.request("GET", `/v1/objects/${encodeURIComponent(id)}`)
  }

  /**
   * Create a new object. `name` + `nodeId` are required — the route 400s
   * otherwise. Returns the new row's id.
   *
   * Note: the underlying route is the same `POST /v1/objects` upsert that
   * powers `update()`. This convenience wrapper enforces the INSERT-required
   * fields at the type level and never sends an `id`.
   */
  create(data: CreateObjectInput): Promise<{ id: string }> {
    return this.client.request("POST", "/v1/objects", { body: data })
  }

  /**
   * Update an object. Only the fields you pass are written — undefined keys
   * are NOT touched on the row. Worker-owned asset buckets are intentionally
   * not exposed on this surface (see `UpdateObjectInput` for the rationale).
   *
   * Optimistic-concurrency: pass `expectedUpdatedAt` to require the row's
   * `updated_at` still matches; on mismatch the route returns 409
   * `concurrent_modification` carrying the fresh `updatedAt`. The SDK
   * surfaces that as a generic `NodaroError` with the same code (per Phase
   * E1 calibration finding — error centralization in `throwApiError`).
   */
  update(id: string, data: UpdateObjectInput): Promise<UpdateObjectResult> {
    return this.client.request("POST", "/v1/objects", {
      body: { id, ...data },
    })
  }

  /**
   * Soft-delete (archive) an object. The row is hidden from `list()` by
   * default but recoverable via `restore(id)` or visible under
   * `listArchived()`. Idempotent — repeating a delete on an already-archived
   * row is a no-op.
   */
  delete(id: string): Promise<{ success: true; archived: true }> {
    return this.client.request("DELETE", `/v1/objects/${encodeURIComponent(id)}`)
  }

  /**
   * Hard-delete (permanent) an object — the row + every R2 asset it
   * references. Archived rows ONLY: active objects return 400 `not_archived`.
   * Call `delete()` first to archive, then `permanentDelete()` to destroy.
   *
   * Mirrors the `app_runs` permanent-delete pattern (archive-first) so a
   * stray SDK / curl caller cannot bypass the studio's archive-first UI
   * flow.
   */
  permanentDelete(id: string): Promise<{ success: true; permanent: true }> {
    return this.client.request("DELETE", `/v1/objects/${encodeURIComponent(id)}`, {
      query: { permanent: "true" },
    })
  }

  /**
   * Un-archive an object. If the original name now collides (case-
   * insensitive) with an active row, the server auto-suffixes "(restored)"
   * and returns the effective name.
   */
  restore(id: string): Promise<{ id: string; name: string }> {
    return this.client.request("POST", `/v1/objects/${encodeURIComponent(id)}/restore`)
  }

  /**
   * Fire `POST /v1/generate-object` to produce one or more candidate main
   * images. With `count > 1`, all jobs are reserved up-front before any
   * is enqueued — mid-batch failures roll back atomically.
   *
   * When `attachToObjectId` is set AND `count === 1`, the worker writes
   * the result directly to the row's `source_image_url`; otherwise you must
   * call `approveMainImage()` after picking a candidate.
   */
  generate(data: GenerateObjectInput): Promise<GenerateObjectResult> {
    return this.client.request("POST", "/v1/generate-object", { body: data })
  }

  /**
   * Fire `POST /v1/generate-object-asset` to produce a single variant.
   * When the studio path is set (`attachToObjectId` + `attachToColumn` +
   * `attachName`), the worker appends `{ name: attachName, url: <result> }`
   * to the named JSONB array column on completion.
   *
   * Note: `attachToColumn` is REQUIRED for `assetType === "custom"` — the
   * worker can't infer the bucket from the asset type. For canonical asset
   * types (`angles` / `materials` / `variations` / `motion`), the column is
   * derived automatically by the route.
   */
  generateAsset(
    data: GenerateObjectAssetInput,
  ): Promise<GenerateObjectAssetResult> {
    return this.client.request("POST", "/v1/generate-object-asset", { body: data })
  }

  /**
   * Fire `POST /v1/generate-object-motion` to animate the object's main
   * image into a motion clip. Image-to-video, single clip per call; the
   * attach column is hardcoded to `motion_clips` server-side (objects have a
   * single motion bucket so the caller doesn't supply `attachToColumn`).
   * When the studio path is set (`attachToObjectId` + `attachName`), the
   * worker appends `{ name: attachName, url: <result> }` to the row's
   * `motion_clips` column on completion.
   *
   * Defaults: `provider` → `"kling-turbo"`, `aspectRatio` → `"1:1"` (set
   * server-side via `resolveObjectAspectRatio({ assetType: "motion" })`).
   */
  generateMotion(
    data: GenerateObjectMotionInput,
  ): Promise<GenerateObjectMotionResult> {
    return this.client.request("POST", "/v1/generate-object-motion", { body: data })
  }

  /**
   * Approve a completed `generate-object` job as the object's main image.
   * Sets `source_image_url` and fires the LLM caption (Claude Sonnet vision)
   * inline. Returns the new main-image URL plus the caption.
   *
   * Caption-failure semantics: `canonicalDescription` is coerced to `""`
   * (NOT null) when the LLM call sub-failed — the main image is still set;
   * call `recaption()` to retry.
   *
   * Optimistic-concurrency: pass `expectedUpdatedAt` to gate the update on
   * the row's current `updated_at`; on mismatch the route returns 409
   * `concurrent_modification` carrying the fresh token.
   */
  approveMainImage(
    id: string,
    candidateJobId: string,
    expectedUpdatedAt?: string,
  ): Promise<ApproveObjectMainImageResult> {
    return this.client.request(
      "POST",
      `/v1/objects/${encodeURIComponent(id)}/approve-main-image`,
      { body: { candidateJobId, expectedUpdatedAt } },
    )
  }

  /**
   * Re-fire the LLM caption against the object's current main image. 502s
   * on LLM failure (unlike `approveMainImage` which preserves the side-effect
   * and returns ""); returns 400 `main_image_required` if no main image is
   * set yet.
   *
   * The route is a pure idempotent retry — it does NOT accept an
   * `expectedUpdatedAt` token (per Phase E1 calibration finding: backend
   * route is idempotent retry, not gated on optimistic-concurrency).
   */
  recaption(id: string): Promise<RecaptionObjectResult> {
    return this.client.request(
      "POST",
      `/v1/objects/${encodeURIComponent(id)}/llm-caption`,
    )
  }
}
