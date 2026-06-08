import type { CreatureAttachColumn, ObjectAspectRatio } from "@nodaro/shared"
import type { NodaroClient } from "../client.js"

/**
 * Re-export the shared `CreatureAttachColumn` union + its runtime tuple so SDK
 * consumers don't have to add `@nodaro/shared` as a second dependency just to
 * typecheck the `attachToColumn` field. Single source of truth lives in
 * `@nodaro/shared/entity-prompts` (`CREATURE_ATTACH_COLUMNS`).
 *
 * `CreatureAspectRatio` is re-exported as an alias of the shared
 * `ObjectAspectRatio` — `generateMotion`'s `aspectRatio` field is the 5-value
 * object enum (1:1 / 3:4 / 16:9 / 9:16 / 4:3). The creature motion route
 * deliberately REUSES `OBJECT_ASPECT_OPTIONS` server-side (a creature reference
 * clip is centered product-showcase framing, not cinematic 16:9), so the SDK
 * surfaces the same enum under a creature-friendly name. The runtime tuple is
 * re-exported as `CREATURE_ASPECT_OPTIONS` / `CREATURE_ASPECT_DEFAULTS` aliases.
 */
export type { CreatureAttachColumn } from "@nodaro/shared"
export { CREATURE_ATTACH_COLUMNS } from "@nodaro/shared"
export type { ObjectAspectRatio as CreatureAspectRatio } from "@nodaro/shared"
export {
  OBJECT_ASPECT_OPTIONS as CREATURE_ASPECT_OPTIONS,
  OBJECT_ASPECT_DEFAULTS as CREATURE_ASPECT_DEFAULTS,
} from "@nodaro/shared"

/**
 * Creature asset-type enum — the kinds of variant a user can generate off a
 * creature's anchor main image. Mirrors the literal accepted by
 * `POST /v1/generate-creature-asset` (`backend/src/routes/generate-creature-asset.ts`).
 *
 * Delta vs `ObjectAssetType`: object's `materials` becomes `poses` (a creature
 * has poses, not materials), and there is NO `motion` value — creature motion
 * variants flow through the dedicated `/v1/generate-creature-motion` endpoint
 * (worker-side a different BullMQ job type). `custom` is the free-form bucket;
 * callers must supply `attachToColumn` explicitly since the worker can't infer
 * the destination from the asset type.
 *
 * The shared `@nodaro/shared` package does NOT export a `CREATURE_ASSET_TYPES`
 * tuple (the route validates an inline Zod enum), so the SDK defines its own
 * single-source-of-truth tuple here.
 */
export const CREATURE_ASSET_TYPES = ["angles", "poses", "variations", "custom"] as const
export type CreatureAssetType = (typeof CREATURE_ASSET_TYPES)[number]

/**
 * Reference-photo kind discriminator — the mood-board roles a user can attach
 * to a creature. Mirrors the `reference_photos.kind` field accepted by
 * `backend/src/routes/creatures.ts` (the route accepts open strings; this SDK
 * type narrows to the 6 canonical roles surfaced by the Studio). `other` is
 * the free-form bucket.
 */
export type CreatureReferencePhotoKind =
  | "front"
  | "side"
  | "detail"
  | "context"
  | "moodBoard"
  | "other"

export interface CreatureReferencePhoto {
  url: string
  kind: CreatureReferencePhotoKind
}

/**
 * A creature record returned by Nodaro's REST API. Mirrors the camelCase
 * shape produced by `backend/src/routes/creatures.ts::toCamel()`.
 *
 * Asset buckets (`angles`, `poses`, `variations`, `motionClips`) are
 * independent JSONB arrays keyed by a human-readable variant name (e.g.
 * `"front"`, `"walking"`, `"scarred"`). Each entry's `url` points at an
 * R2-hosted asset.
 *
 * Creature delta vs object:
 *   - `species` — free-text creature type (e.g. `"dragon"`, `"wolf"`). This is
 *     the subject of the establishing-shot prompt and the primary creature
 *     differentiator (object has no equivalent).
 *   - `poses` (where object has `materials`) — the pose-variant asset bucket.
 *   - `category` is free-text (NOT object's fixed 10-value enum) — a creature
 *     can be any animal/type.
 *
 * Identity-foundation fields:
 *   - `referencePhotos` — caller-supplied mood-board refs (cap 20).
 *   - `canonicalDescription` — ~80–120-word LLM-authored visual caption,
 *     populated by `approveMainImage()` / `recaption()`. The wire still sends
 *     `""` on caption sub-failure, but `get()` normalizes `""` → `null` so
 *     consumers see the same `string | null` semantics as characters.
 *   - `styleLock` — whether asset gens should anchor to the canonical style
 *     captured at approval time. Defaults to `true` on new rows.
 */
export interface Creature {
  id: string
  userId: string
  nodeId: string
  projectId: string | null
  name: string
  description: string | null
  /** Free-text creature type/species (e.g. "dragon", "wolf") — the creature
   *  delta vs object. `null` when unset. */
  species: string | null
  category: string | null
  style: string | null
  sourceImageUrl: string | null
  /** MODEL_CATALOG image-model id the main image was generated with (or `null`).
   *  Set on create + editable via the update route. */
  imageProvider: string | null
  angles: Array<{ name: string; url: string }>
  poses: Array<{ name: string; url: string }>
  variations: Array<{ name: string; url: string }>
  motionClips: Array<{ name: string; url: string }>
  referencePhotos: CreatureReferencePhoto[]
  /** `null` when no caption is set (or the LLM caption sub-failed) — the wire
   *  sends `""`, normalized to `null` in `get()` to match character semantics. */
  canonicalDescription: string | null
  styleLock: boolean
  /** The user's chosen DEFAULT asset take per variant (Studio version history).
   *  OPAQUE map: key `"<bucket>:<variant>"` (e.g. `"angles:front"`) → the chosen
   *  asset URL (one already present in that bucket). Stored verbatim — keys are
   *  NOT normalized; soft-capped server-side at 200 keys / 2048-char values
   *  (overflow dropped silently). Defaults to `{}`. */
  selectedAssetByVariant?: Record<string, string> | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * GET /v1/creatures/:id may append a `pendingJobs` bucket the studio uses to
 * rehydrate spinners after a reload. Optional on the SDK surface — it doesn't
 * appear on `list()` rows.
 */
export interface CreatureDetail extends Creature {
  pendingJobs?: Array<{
    jobId: string
    assetType: string
    name: string
    status: string
  }>
}

/**
 * Body for `client.creatures.create()`. Mirrors the INSERT branch of
 * `upsertCreatureBody` in `backend/src/routes/creatures.ts`. `name` + `nodeId`
 * are required on create.
 */
export interface CreateCreatureInput {
  nodeId: string
  name: string
  description?: string
  /** Free-text creature type/species (the creature delta vs object). */
  species?: string
  /** Free-text category (NOT object's fixed enum — a creature can be anything). */
  category?: string
  style?: string
  workflowId?: string
  projectId?: string
  sourceImageUrl?: string
  /** Persistent image-model id (a MODEL_CATALOG image model). Validated
   *  server-side — unknown / non-image / "" is stored as `null`. */
  imageProvider?: string | null
  referencePhotos?: CreatureReferencePhoto[]
  canonicalDescription?: string
  styleLock?: boolean
  /** The user's chosen DEFAULT asset take per variant. OPAQUE
   *  `"<bucket>:<variant>"` → chosen-URL map; a write REPLACES the whole map.
   *  Keys stored verbatim; soft-capped server-side at 200 keys / 2048-char values. */
  selectedAssetByVariant?: Record<string, string>
}

/**
 * Body for `client.creatures.update()`. Mirrors the UPDATE branch of
 * `upsertCreatureBody` in `backend/src/routes/creatures.ts`.
 *
 * Worker-owned asset buckets (`angles` / `poses` / `variations` /
 * `motionClips`) are deliberately omitted — the route drops them on UPDATE
 * so a Studio auto-save with a stale snapshot cannot clobber the worker's
 * atomic `append_creature_asset()` writes.
 *
 * `expectedUpdatedAt` is the optimistic-concurrency token: when present, the
 * UPDATE only succeeds if the row's `updated_at` still matches; on mismatch
 * the route returns 409 so the studio can re-fetch + merge.
 */
export interface UpdateCreatureInput {
  name?: string
  description?: string
  /** Free-text creature type/species (the creature delta vs object). */
  species?: string
  category?: string
  style?: string
  sourceImageUrl?: string
  /** Persistent image-model id (a MODEL_CATALOG image model). Validated
   *  server-side — unknown / non-image / "" is stored as `null`. */
  imageProvider?: string | null
  referencePhotos?: CreatureReferencePhoto[]
  canonicalDescription?: string
  styleLock?: boolean
  /** The user's chosen DEFAULT asset take per variant. OPAQUE
   *  `"<bucket>:<variant>"` → chosen-URL map; a write REPLACES the whole map
   *  (omit to leave untouched). Keys stored verbatim; soft-capped server-side
   *  at 200 keys / 2048-char values. */
  selectedAssetByVariant?: Record<string, string>
  expectedUpdatedAt?: string
}

export interface UpdateCreatureResult {
  id: string
  updatedAt: string
}

/**
 * Combined create + update body (parameter for both branches). Exported for
 * callers that want to drive a single `upsert` flow without picking between
 * `Create*` and `Update*`. Mirrors the `upsertCreatureBody` Zod schema in
 * `backend/src/routes/creatures.ts`. `nodeId` + `name` are required on INSERT;
 * `id` flips the route into UPDATE mode.
 */
export interface UpsertCreatureInput extends CreateCreatureInput {
  id?: string
  expectedUpdatedAt?: string
}

export type UpsertCreatureResult = { id: string } | UpdateCreatureResult

export interface ListCreaturesParams {
  /** When true, return archived creatures instead of active ones. */
  archived?: boolean
  /** Optional project filter — server-scoped to the caller's user. */
  projectId?: string
}

/**
 * Input for `client.creatures.generate()` — fires the
 * `POST /v1/generate-creature` route. Produces 1–10 candidate
 * main images; each lands as one `jobs` row in `pending` state and is then
 * enqueued for the worker.
 *
 * When `attachToCreatureId` is set AND `count === 1`, the worker writes the
 * resulting URL directly to `creatures.source_image_url` on completion —
 * caller doesn't need a separate `approveMainImage` call. Multi-candidate
 * batches MUST go through explicit approval so the user picks the winner.
 *
 * `seedPromptHint` flows the parameter-picker's prompt fragment through to the
 * worker so a catalog selection (e.g. "armored frost dragon") gets appended to
 * the generated prompt context.
 */
export interface GenerateCreatureInput {
  name: string
  description?: string
  userPrompt?: string
  /** Free-text creature type/species (the creature delta vs object). */
  species?: string
  category?: string
  style?: "realistic" | "anime" | "3d-pixar" | "illustration"
  sourceImageUrl?: string
  provider?: string
  /** Number of candidate images to generate (1–10; server-validated). */
  count?: number
  /** Auto-attach the result to this creature row (single-candidate only). */
  attachToCreatureId?: string
  /** Parameter-picker prompt-fragment pass-through. */
  seedPromptHint?: string
  /** Optional name to set on the attached row alongside the main image. */
  attachName?: string
  /** Optimistic-concurrency token for the single-candidate auto-attach path. */
  expectedUpdatedAt?: string
}

/**
 * `generate()` response — `jobIds` is ALWAYS present (the harmonized contract,
 * matching characters). `jobId` is a deprecated back-compat alias populated only
 * on `count === 1`; prefer `jobIds`. (Will be removed on the next major.)
 */
export interface GenerateCreatureResult {
  jobIds: string[]
  /** @deprecated count===1 back-compat alias — use `jobIds`. */
  jobId?: string
}

/**
 * Input for `client.creatures.generateAsset()` — fires the
 * `POST /v1/generate-creature-asset` route. Produces a single
 * angles / poses / variations / custom variant.
 *
 * When all three studio-path fields are set (`attachToCreatureId` +
 * `attachToColumn` + `attachName`), the worker appends
 * `{ name: attachName, url: <result> }` to the named JSONB array column on
 * the user's creature row on completion. `attachToColumn` is REQUIRED for
 * `assetType === "custom"` — the worker can't infer the bucket from the
 * asset type.
 */
export interface GenerateCreatureAssetInput {
  assetType: CreatureAssetType
  variant: string
  name: string
  description?: string
  userPrompt?: string
  category?: string
  style?: string
  sourceImageUrl?: string
  provider?: string
  attachToCreatureId?: string
  attachToColumn?: CreatureAttachColumn
  attachName?: string
  /** Parameter-picker prompt-fragment pass-through. */
  seedPromptHint?: string
}

export interface GenerateCreatureAssetResult {
  jobId: string
}

/**
 * Input for `client.creatures.generateMotion()` — fires the
 * `POST /v1/generate-creature-motion` route. Produces a single motion clip
 * (idle, prowl, attack, etc.) animated FROM a static creature-shot image.
 *
 * Mirrors `client.objects.generateMotion()` — the creature motion route reuses
 * the entity-agnostic object motion helpers server-side. The route hardcodes
 * the attach column to `motion_clips` — callers supply `attachToCreatureId` +
 * `attachName` only.
 *
 * `sourceImageUrl` is REQUIRED — image-to-video needs a source frame and the
 * route has no fallback (the studio path supplies the canonical creature-shot
 * URL explicitly).
 *
 * Defaults vs location:
 *   - `provider` defaults to `"kling-turbo"` (not location's `"kling"`)
 *   - `aspectRatio` defaults to `"1:1"` server-side via
 *     `resolveObjectAspectRatio({ assetType: "motion" })` — creatures use
 *     centered reference framing, not cinematic establishing shots.
 *
 * When the studio path is set (`attachToCreatureId` + `attachName`), the
 * worker appends `{ name: attachName, url: <result> }` to the creature row's
 * `motion_clips` JSONB column on completion.
 */
export interface GenerateCreatureMotionInput {
  motionPrompt: string
  sourceImageUrl: string
  provider?: string
  name: string
  /** Source clip URL — when set, worker routes to video-to-video refine. */
  refineFromVideoUrl?: string
  category?: string
  style?: "realistic" | "anime" | "3d-pixar" | "illustration"
  canonicalDescription?: string
  /** Parameter-picker prompt-fragment pass-through. */
  seedPromptHint?: string
  attachToCreatureId?: string
  attachName?: string
  /**
   * Optional aspect ratio override. Defaults to 1:1 server-side. One of the
   * 5-value `CreatureAspectRatio` union (1:1 / 3:4 / 16:9 / 9:16 / 4:3) — the
   * creature route reuses the object aspect enum.
   */
  aspectRatio?: ObjectAspectRatio
}

export interface GenerateCreatureMotionResult {
  jobId: string
}

export interface ApproveCreatureMainImageResult {
  sourceImageUrl: string
  /**
   * LLM-authored caption. `null` when the LLM caption sub-failed — the wire
   * sends `""`, normalized to `null` here so consumers see the same
   * `string | null` semantics as characters. The main image is still set; call
   * `recaption()` to retry.
   */
  canonicalDescription: string | null
}

export interface RecaptionCreatureResult {
  canonicalDescription: string
}

export class CreaturesResource {
  constructor(private client: NodaroClient) {}

  /**
   * List the caller's creatures. By default returns active creatures only;
   * pass `archived: true` to fetch soft-deleted rows for an "archive" view.
   * Optional `projectId` scopes the result to a single project.
   */
  list(params: ListCreaturesParams = {}): Promise<{ creatures: Creature[] }> {
    const query: Record<string, string | undefined> = {}
    if (params.archived) query.archived = "true"
    if (params.projectId) query.projectId = params.projectId
    return this.client.request("GET", "/v1/creatures", { query })
  }

  /**
   * Convenience wrapper for `list({ archived: true })`. Returns soft-deleted
   * rows so callers can drive a UI "Archived" tab without re-encoding the
   * query param.
   *
   * `archived` is omitted from the param type — it's always set to `true` here.
   */
  listArchived(params: Omit<ListCreaturesParams, "archived"> = {}): Promise<{ creatures: Creature[] }> {
    return this.list({ ...params, archived: true })
  }

  /**
   * Fetch a single creature including in-flight asset job state. Soft-deleted
   * (archived) rows are NOT returned by id — the route enforces
   * `deleted_at IS NULL` so archived creatures 404 (uniform "not_found" — does
   * not leak the deleted vs non-existent distinction).
   */
  async get(id: string): Promise<CreatureDetail> {
    const res = await this.client.request<CreatureDetail>(
      "GET",
      `/v1/creatures/${encodeURIComponent(id)}`,
    )
    // Normalize the wire `""` caption (DB null / LLM sub-failure) → null so
    // consumers see the same `string | null` semantics as characters. New
    // object — never mutate the response.
    return { ...res, canonicalDescription: res.canonicalDescription || null }
  }

  /**
   * Create a new creature. `name` + `nodeId` are required — the route 400s
   * otherwise. Returns the new row's id.
   *
   * Note: the underlying route is the same `POST /v1/creatures` upsert that
   * powers `update()`. This convenience wrapper enforces the INSERT-required
   * fields at the type level and never sends an `id`.
   */
  create(data: CreateCreatureInput): Promise<{ id: string }> {
    return this.client.request("POST", "/v1/creatures", { body: data })
  }

  /**
   * Update a creature. Only the fields you pass are written — undefined keys
   * are NOT touched on the row. Worker-owned asset buckets are intentionally
   * not exposed on this surface (see `UpdateCreatureInput` for the rationale).
   *
   * Optimistic-concurrency: pass `expectedUpdatedAt` to require the row's
   * `updated_at` still matches; on mismatch the route returns 409
   * `concurrent_modification` carrying the fresh `updatedAt`. The SDK
   * surfaces that as a generic `NodaroError` with the same code.
   */
  update(id: string, data: UpdateCreatureInput): Promise<UpdateCreatureResult> {
    return this.client.request("POST", "/v1/creatures", {
      body: { id, ...data },
    })
  }

  /**
   * Soft-delete (archive) a creature. The row is hidden from `list()` by
   * default but recoverable via `restore(id)` or visible under
   * `listArchived()`. Idempotent — repeating a delete on an already-archived
   * row is a no-op.
   */
  delete(id: string): Promise<{ success: true; archived: true }> {
    return this.client.request("DELETE", `/v1/creatures/${encodeURIComponent(id)}`)
  }

  /**
   * Hard-delete (permanent) a creature — the row + every R2 asset it
   * references. Archived rows ONLY: active creatures return 400 `not_archived`.
   * Call `delete()` first to archive, then `permanentDelete()` to destroy.
   *
   * Mirrors the `app_runs` permanent-delete pattern (archive-first) so a
   * stray SDK / curl caller cannot bypass the studio's archive-first UI
   * flow.
   */
  permanentDelete(id: string): Promise<{ success: true; permanent: true }> {
    return this.client.request("DELETE", `/v1/creatures/${encodeURIComponent(id)}`, {
      query: { permanent: "true" },
    })
  }

  /**
   * Un-archive a creature. If the original name now collides (case-
   * insensitive) with an active row, the server auto-suffixes "(restored)"
   * and returns the effective name.
   */
  restore(id: string): Promise<{ id: string; name: string }> {
    return this.client.request("POST", `/v1/creatures/${encodeURIComponent(id)}/restore`)
  }

  /**
   * Fire `POST /v1/generate-creature` to produce one or more candidate main
   * images. With `count > 1`, all jobs are reserved up-front before any
   * is enqueued — mid-batch failures roll back atomically.
   *
   * When `attachToCreatureId` is set AND `count === 1`, the worker writes
   * the result directly to the row's `source_image_url`; otherwise you must
   * call `approveMainImage()` after picking a candidate.
   */
  async generate(data: GenerateCreatureInput): Promise<GenerateCreatureResult> {
    const res = await this.client.request<{ jobId?: string; jobIds?: string[] }>(
      "POST", "/v1/generate-creature", { body: data },
    )
    // Tolerate the legacy `{ jobId }`-only shape (older server): synthesize jobIds.
    const jobIds = res.jobIds ?? (res.jobId ? [res.jobId] : [])
    return res.jobId ? { jobIds, jobId: res.jobId } : { jobIds }
  }

  /**
   * Fire `POST /v1/generate-creature-asset` to produce a single variant.
   * When the studio path is set (`attachToCreatureId` + `attachToColumn` +
   * `attachName`), the worker appends `{ name: attachName, url: <result> }`
   * to the named JSONB array column on completion.
   *
   * Note: `attachToColumn` is REQUIRED for `assetType === "custom"` — the
   * worker can't infer the bucket from the asset type. For canonical asset
   * types (`angles` / `poses` / `variations`), the column is derived
   * automatically by the route.
   */
  generateAsset(
    data: GenerateCreatureAssetInput,
  ): Promise<GenerateCreatureAssetResult> {
    return this.client.request("POST", "/v1/generate-creature-asset", { body: data })
  }

  /**
   * Fire `POST /v1/generate-creature-motion` to animate the creature's main
   * image into a motion clip. Image-to-video, single clip per call; the
   * attach column is hardcoded to `motion_clips` server-side (creatures have a
   * single motion bucket so the caller doesn't supply `attachToColumn`).
   * When the studio path is set (`attachToCreatureId` + `attachName`), the
   * worker appends `{ name: attachName, url: <result> }` to the row's
   * `motion_clips` column on completion.
   *
   * Defaults: `provider` → `"kling-turbo"`, `aspectRatio` → `"1:1"` (set
   * server-side via `resolveObjectAspectRatio({ assetType: "motion" })`).
   */
  generateMotion(
    data: GenerateCreatureMotionInput,
  ): Promise<GenerateCreatureMotionResult> {
    return this.client.request("POST", "/v1/generate-creature-motion", { body: data })
  }

  /**
   * Approve a completed `generate-creature` job as the creature's main image.
   * Sets `source_image_url` and fires the LLM caption (Claude Sonnet vision)
   * inline. Returns the new main-image URL plus the caption.
   *
   * Caption-failure semantics: the route still sends `""` on LLM sub-failure,
   * but the SDK normalizes `""` → `null` here so `canonicalDescription` carries
   * the same `string | null` semantics as characters. The main image is still
   * set; call `recaption()` to retry.
   *
   * Optimistic-concurrency: pass `expectedUpdatedAt` to gate the update on
   * the row's current `updated_at`; on mismatch the route returns 409
   * `concurrent_modification` carrying the fresh token.
   */
  async approveMainImage(
    id: string,
    candidateJobId: string,
    expectedUpdatedAt?: string,
  ): Promise<ApproveCreatureMainImageResult> {
    const res = await this.client.request<{ sourceImageUrl: string; canonicalDescription: string | null }>(
      "POST",
      `/v1/creatures/${encodeURIComponent(id)}/approve-main-image`,
      { body: { candidateJobId, expectedUpdatedAt } },
    )
    // Normalize the wire `""` (LLM sub-failure) → null; build a new object
    // rather than mutating the response.
    return { sourceImageUrl: res.sourceImageUrl, canonicalDescription: res.canonicalDescription || null }
  }

  /**
   * Re-fire the LLM caption against the creature's current main image. 502s
   * on LLM failure (unlike `approveMainImage` which preserves the side-effect
   * and returns ""); returns 400 `main_image_required` if no main image is
   * set yet.
   *
   * The route is a pure idempotent retry — it does NOT accept an
   * `expectedUpdatedAt` token (backend route is idempotent retry, not gated on
   * optimistic-concurrency).
   */
  recaption(id: string): Promise<RecaptionCreatureResult> {
    return this.client.request(
      "POST",
      `/v1/creatures/${encodeURIComponent(id)}/llm-caption`,
    )
  }
}
