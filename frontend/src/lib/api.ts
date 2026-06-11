import { createClient } from "@/lib/supabase"
import { nodaroClient } from "@/lib/nodaro-client"
import type { SubWorkflowRouteSnapshot, SocialConnection } from "@/types/nodes"
import type { PresentationSettings } from "@/hooks/use-workflow-store"
import type { ReduceMeta, ImageCriticMode, WorkflowExport, ReferenceSheet } from "@nodaro/shared"
import type { SheetType, SheetSkin, SheetFlavour, EntityKind } from "@nodaro/shared"
import type { CharacterAttachColumn, ObjectAttachColumn, CreatureAttachColumn, LocationAttachColumn } from "@nodaro/shared"
import type { CommunityCard, CommunitySort } from "@nodaro/shared"
import { FLUX_LORA_CHARACTER_MODEL_ID } from "@nodaro/shared"
import type { ReferencePhotoKind } from "@/lib/reference-photo-routing"
import { withIdempotencyHeader } from "@/lib/idempotency-key"

export const API_BASE_URL = ''

/**
 * Get auth headers with the current session's JWT token.
 * Returns { Authorization: 'Bearer ...' } or {} if no session.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      return { Authorization: `Bearer ${session.access_token}` }
    }
  } catch {
    // Silently fall back to no auth header
  }
  return {}
}

export async function getCurrentUserId(): Promise<string | undefined> {
  try {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    return session?.user?.id
  } catch {
    return undefined
  }
}

export class StorageExceededError extends Error {
  readonly usedBytes: number
  readonly quotaBytes: number
  readonly remainingBytes: number
  readonly tier: string

  constructor(message: string, usedBytes: number, quotaBytes: number, remainingBytes: number, tier: string) {
    super(message)
    this.name = "StorageExceededError"
    this.usedBytes = usedBytes
    this.quotaBytes = quotaBytes
    this.remainingBytes = remainingBytes
    this.tier = tier
  }
}

export class InsufficientCreditsError extends Error {
  readonly code: string
  readonly appCreditsAllowance: number

  constructor(message: string, code: string, appCreditsAllowance: number) {
    super(message)
    this.name = "InsufficientCreditsError"
    this.code = code
    this.appCreditsAllowance = appCreditsAllowance
  }
}

export class TutorialCategoryInUseError extends Error {
  readonly videoCount: number
  readonly flowCount: number

  constructor(message: string, videoCount: number, flowCount: number) {
    super(message)
    this.name = "TutorialCategoryInUseError"
    this.videoCount = videoCount
    this.flowCount = flowCount
  }
}

/**
 * Thrown when an UPDATE call to a studio resource (location, character, etc.)
 * fails the optimistic-concurrency check because the row's `updated_at`
 * advanced between the caller's last fetch and this write. Callers should
 * re-fetch the row, merge, and retry. `updatedAt` is the CURRENT row's
 * server-side updated_at so the caller can rebase against it.
 */
export class ConcurrentModificationError extends Error {
  readonly updatedAt: string

  constructor(message: string, updatedAt: string) {
    super(message)
    this.name = "ConcurrentModificationError"
    this.updatedAt = updatedAt
  }
}

/**
 * Throws StorageExceededError if the parsed error JSON indicates storage_limit_exceeded.
 * Throws InsufficientCreditsError for credit-related 402 errors.
 * Otherwise throws a plain Error with the message (or the given fallback).
 */
function throwApiError(errJson: Record<string, unknown> | null, fallback: string): never {
  const errObj = errJson?.error as Record<string, unknown> | undefined
  if (errObj?.code === "storage_limit_exceeded") {
    throw new StorageExceededError(
      (errObj.message as string) ?? fallback,
      (errObj.usedBytes as number) ?? 0,
      (errObj.quotaBytes as number) ?? 0,
      (errObj.remainingBytes as number) ?? 0,
      (errObj.tier as string) ?? "free",
    )
  }
  if (errObj?.code === "insufficient_app_credits" || errObj?.code === "insufficient_credits") {
    throw new InsufficientCreditsError(
      (errObj.message as string) ?? fallback,
      errObj.code as string,
      (errObj.appCreditsAllowance as number) ?? 0,
    )
  }
  if (errObj?.code === "name_taken") {
    throw new CharacterNameTakenError((errObj.message as string) ?? "Name already in use.")
  }
  if (errObj?.code === "portrait_required") {
    throw new PortraitRequiredError(
      (errObj.message as string) ?? "Generate a portrait first — open the Appearance tab",
    )
  }
  if (errObj?.code === "category_in_use") {
    throw new TutorialCategoryInUseError(
      (errObj.message as string) ?? fallback,
      (errObj.videoCount as number) ?? 0,
      (errObj.flowCount as number) ?? 0,
    )
  }
  if (errObj?.code === "concurrent_modification") {
    throw new ConcurrentModificationError(
      (errObj.message as string) ?? fallback,
      (errObj.updatedAt as string) ?? "",
    )
  }
  if (errObj?.code === "dedup_race_winner_unresolvable") {
    // Structured signal from the backend: the client should retry the
    // same request (same Idempotency-Key) after a short delay; the
    // canonical job will be found on the next attempt. Surfaced as a
    // typed Error so the call-site auto-retry wrapper can detect it.
    throw new DedupRaceRetryableError(
      (errObj.message as string) ?? fallback,
      (errObj.retryAfterSeconds as number) ?? 2,
    )
  }
  throw new Error((errObj?.message as string) ?? fallback)
}

/**
 * Thrown when the backend signals a dedup-race winner-unresolvable
 * condition (HTTP 503 + body code `dedup_race_winner_unresolvable`).
 * The recommended response is to retry the same request with the same
 * Idempotency-Key after `retryAfterSeconds` ± 25% jitter. The
 * `withDedupRaceRetry` wrapper in this module handles this automatically.
 */
export class DedupRaceRetryableError extends Error {
  constructor(
    message: string,
    public readonly retryAfterSeconds: number,
  ) {
    super(message)
    this.name = "DedupRaceRetryableError"
  }
}

/**
 * Wrap an API call so a single `DedupRaceRetryableError` is automatically
 * retried after the backend-advised delay ± 25% jitter. If the retry also
 * throws, the error propagates to the caller. Most generate/run wrappers
 * in api.ts should be wrapped in this helper at their call site (see
 * run-handlers.ts for the workflow Run path).
 */
export async function withDedupRaceRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (!(err instanceof DedupRaceRetryableError)) throw err
    // ±25% jitter on the backend-advised value so concurrent retries
    // from a 503 cluster don't all hit the DB on the same tick.
    const jitterMs = (Math.random() - 0.5) * 0.5 * err.retryAfterSeconds * 1000
    const waitMs = Math.max(0, err.retryAfterSeconds * 1000 + jitterMs)
    await new Promise((r) => setTimeout(r, waitMs))
    return await fn()  // single retry — if this throws, caller handles it
  }
}

// ---------------------------------------------------------------------------
// Workflow context — lets single-node runs tag jobs with a workflowId so they
// appear in the execution history list for that workflow.
// ---------------------------------------------------------------------------

let _currentWorkflowId: string | null = null
let _forcePrivate = false
let _userPromptTemplate: string | undefined = undefined

/** Call from WorkflowEditor on mount/change to set the active workflow. */
export function setCurrentWorkflowId(id: string | null) {
  _currentWorkflowId = id
}

/** Set forcePrivate flag for the next API call (auto-resets after use). */
export function setForcePrivate(value: boolean) {
  _forcePrivate = value
}

/**
 * Set the user-typed prompt template for the next API call (auto-resets).
 * The frontend resolves variables before sending; this captures the
 * unresolved template so it lands in `jobs.input_data.userPrompt` for
 * debugging "what the user typed" vs "what was sent to the AI".
 * Pass `undefined` for executors with no user-typed prompt at this node.
 */
export function setUserPromptTemplate(template: string | undefined) {
  _userPromptTemplate = template
}

/** Spread workflowId / forcePrivate / userPrompt into a body object. */
function withWorkflowId<T extends Record<string, unknown>>(body: T): T {
  let result = body
  if (_currentWorkflowId) {
    result = { ...result, workflowId: _currentWorkflowId }
  }
  if (_forcePrivate) {
    result = { ...result, forcePrivate: true }
    _forcePrivate = false // auto-reset after use
  }
  if (_userPromptTemplate !== undefined) {
    result = { ...result, userPrompt: _userPromptTemplate }
    _userPromptTemplate = undefined // auto-reset after use
  }
  return result
}

/**
 * Shared JSON-fetch envelope for the ~150 same-origin REST calls that POST a
 * JSON body (or GET with none), attach auth + `Content-Type`, and on `!res.ok`
 * route the error through `throwApiError`. Collapses the repeated
 * `fetch → !ok → throwApiError → res.json()` boilerplate into one place.
 *
 * - `body` is JSON-stringified; omit it for body-less calls (no `Content-Type`).
 * - `workflowId: true` wraps the body in `withWorkflowId(...)` (workflowId /
 *   forcePrivate / userPrompt injection) — opt-in so non-job calls don't get it.
 * - `idempotencyKey` adds the `Idempotency-Key` header when present.
 *
 * Behavior is identical to the inline form (pinned by
 * `__tests__/api-{error-dispatch,common-contract,context-injection}.test.ts`).
 * NOT for FormData uploads or SSE/`streamRequest` calls — those stay bespoke.
 */
async function apiJson<T>(
  path: string,
  opts: {
    method?: string
    body?: Record<string, unknown>
    label: string
    workflowId?: boolean
    idempotencyKey?: string
  },
): Promise<T> {
  const { method = "POST", body, label, workflowId, idempotencyKey } = opts
  const hasBody = body !== undefined
  const authHeaders = await getAuthHeaders()
  let headers: Record<string, string> = hasBody
    ? { "Content-Type": "application/json", ...authHeaders }
    : authHeaders
  if (idempotencyKey) headers = withIdempotencyHeader(headers, idempotencyKey)
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    ...(hasBody
      ? { body: JSON.stringify(workflowId ? withWorkflowId(body) : body) }
      : {}),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, label)
  }
  return res.json() as Promise<T>
}


// --- Generate Image (E2E spike) ---

export async function generateImage(
  prompt: string,
  referenceImageUrls?: string[],
  provider?: string,
  characterDescriptions?: string[],
  aspectRatio?: string,
  userId?: string,
  resolution?: string,
  quality?: string,
  negativePrompt?: string,
  seed?: number,
  renderingSpeed?: string,
  styleType?: string,
  expandPrompt?: boolean,
  identity?: {
    /** When true, the backend appends the character's canonical_description
     *  + identity-preserve suffix to the prompt. Requires attachToCharacterId. */
    injectCharacterContext?: boolean
    /** Character row id (uuid). Looked up by the backend scoped to the caller. */
    attachToCharacterId?: string
  },
  /**
   * Internal-only hint for single-node Run of a generate-image node whose
   * single wired character has a successful LoRA. The backend swaps to
   * `flux-lora-character` (3cr) when this is set; the public SDK never sets
   * it. Pair with `provider = "flux-lora-character"`.
   *
   * Carries the character row id — backend looks up the resolved Replicate
   * version + trigger word server-side scoped by `req.userId`.
   */
  internalLora?: { readonly characterId: string },
  /**
   * Optional Idempotency-Key. When supplied, the backend deduplicates POSTs
   * sharing this key — the safe way to protect against React StrictMode
   * double-fires, network retries, and double-clicks WITHOUT collapsing
   * intentional re-runs (the user clicking Generate twice to get two
   * variations gets two different keys → two jobs). Callers should
   * generate ONE UUID per click via `generateIdempotencyKey()` and pass
   * the same value to all retries of that click.
   */
  idempotencyKey?: string,
  /**
   * Inpaint / i2i levers. `baseImageUrl` + `maskUrl` together turn this into
   * an in-place inpaint (white mask = edit region, black = keep). `strength`
   * and `guidanceScale` are provider-gated on the backend. All four are only
   * placed on the body when present (mirrors negativePrompt/seed).
   */
  inpaint?: {
    baseImageUrl?: string
    maskUrl?: string
    strength?: number
    guidanceScale?: number
  },
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { prompt }
  if (referenceImageUrls && referenceImageUrls.length > 0) {
    body.referenceImageUrls = referenceImageUrls
  }
  if (characterDescriptions && characterDescriptions.length > 0) {
    body.characterDescriptions = characterDescriptions
  }
  if (provider) {
    body.provider = provider
  }
  if (aspectRatio) {
    body.aspectRatio = aspectRatio
  }
  if (resolution) {
    body.resolution = resolution
  }
  if (quality) {
    body.quality = quality
  }
  if (negativePrompt) {
    body.negativePrompt = negativePrompt
  }
  if (seed != null) {
    body.seed = seed
  }
  if (renderingSpeed) {
    body.renderingSpeed = renderingSpeed
  }
  if (styleType) {
    body.styleType = styleType
  }
  if (expandPrompt != null) {
    body.expandPrompt = expandPrompt
  }
  if (userId) {
    body.userId = userId
  }
  if (identity?.injectCharacterContext) {
    body.injectCharacterContext = true
  }
  if (identity?.attachToCharacterId) {
    body.attachToCharacterId = identity.attachToCharacterId
  }
  if (internalLora) {
    body._internalLora = internalLora
    body.provider = FLUX_LORA_CHARACTER_MODEL_ID
  }
  if (inpaint?.baseImageUrl) {
    body.baseImageUrl = inpaint.baseImageUrl
  }
  if (inpaint?.maskUrl) {
    body.maskUrl = inpaint.maskUrl
  }
  if (inpaint?.strength != null) {
    body.strength = inpaint.strength
  }
  if (inpaint?.guidanceScale != null) {
    body.guidanceScale = inpaint.guidanceScale
  }
  return apiJson("/v1/generate-image", {
    body,
    workflowId: true,
    idempotencyKey,
    label: "Failed to start image generation",
  })
}

// --- Edit Image (KIE.ai only) ---

export async function editImage(
  imageUrl: string,
  prompt?: string,
  provider?: string,
  userId?: string,
  options?: {
    upscaleFactor?: string
    targetResolution?: string
    aspectRatio?: string
    negativePrompt?: string
    style?: string
    seed?: number
    referenceImageUrls?: string[]
    maskUrl?: string
  }
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { imageUrl }
  if (prompt) {
    body.prompt = prompt
  }
  if (provider) {
    body.provider = provider
  }
  if (userId) {
    body.userId = userId
  }
  if (options?.upscaleFactor) {
    body.upscaleFactor = options.upscaleFactor
  }
  if (options?.targetResolution) {
    body.targetResolution = options.targetResolution
  }
  if (options?.aspectRatio) {
    body.aspectRatio = options.aspectRatio
  }
  if (options?.negativePrompt) {
    body.negativePrompt = options.negativePrompt
  }
  if (options?.style) {
    body.style = options.style
  }
  if (options?.seed != null) {
    body.seed = options.seed
  }
  if (options?.referenceImageUrls?.length) {
    body.referenceImageUrls = options.referenceImageUrls
  }
  if (options?.maskUrl) {
    body.maskUrl = options.maskUrl
  }
  return apiJson("/v1/edit-image", {
    body,
    workflowId: true,
    label: "Failed to start image editing",
  })
}

// --- Image to Image (transform image with prompt) ---

export async function imageToImage(
  imageUrl: string,
  prompt: string,
  provider?: string,
  userId?: string,
  referenceImageUrls?: string[],
  options?: {
    strength?: number
    aspectRatio?: string
    resolution?: string
    quality?: string
    negativePrompt?: string
    seed?: number
    renderingSpeed?: string
    guidanceScale?: number
    maskUrl?: string
    /** Character Studio auto-attach (optional). */
    attachToCharacterId?: string
    attachToColumn?: "expressions" | "poses" | "angles" | "body_angles" | "lighting_variations"
    attachName?: string
    /** When true, the backend appends the character's canonical_description
     *  + identity-preserve suffix to the prompt (non-studio path; studio
     *  path is unaffected — see backend route). Requires attachToCharacterId. */
    injectCharacterContext?: boolean
  }
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { imageUrl, prompt }
  if (provider) {
    body.provider = provider
  }
  if (userId) {
    body.userId = userId
  }
  if (referenceImageUrls && referenceImageUrls.length > 0) {
    body.referenceImageUrls = referenceImageUrls
  }
  if (options?.strength != null) body.strength = options.strength
  if (options?.aspectRatio) body.aspectRatio = options.aspectRatio
  if (options?.resolution) body.resolution = options.resolution
  if (options?.quality) body.quality = options.quality
  if (options?.negativePrompt) body.negativePrompt = options.negativePrompt
  if (options?.seed != null) body.seed = options.seed
  if (options?.renderingSpeed) body.renderingSpeed = options.renderingSpeed
  if (options?.guidanceScale != null) body.guidanceScale = options.guidanceScale
  if (options?.maskUrl) body.maskUrl = options.maskUrl
  if (options?.attachToCharacterId) body.attachToCharacterId = options.attachToCharacterId
  if (options?.attachToColumn) body.attachToColumn = options.attachToColumn
  if (options?.attachName) body.attachName = options.attachName
  if (options?.injectCharacterContext) body.injectCharacterContext = true
  return apiJson("/v1/image-to-image", {
    body,
    workflowId: true,
    label: "Failed to start image transformation",
  })
}

// --- Modify Image (delegates to edit-image or image-to-image backend routes) ---

export async function modifyImage(
  imageUrl: string,
  prompt: string,
  provider?: string,
  userId?: string,
  referenceImageUrls?: string[],
  options?: {
    strength?: number
    aspectRatio?: string
    resolution?: string
    quality?: string
    negativePrompt?: string
    seed?: number
    renderingSpeed?: string
    guidanceScale?: number
    maskUrl?: string
    style?: string
    /** Character Studio auto-attach (only honored on the /v1/image-to-image path —
     *  /v1/edit-image / nano-banana-edit doesn't currently auto-attach). */
    attachToCharacterId?: string
    attachToColumn?: "expressions" | "poses" | "angles" | "body_angles" | "lighting_variations"
    attachName?: string
  }
): Promise<{ jobId: string }> {
  // nano-banana-edit routes through /v1/edit-image
  if (provider === "nano-banana-edit") {
    return editImage(imageUrl, prompt, provider, userId, {
      aspectRatio: options?.aspectRatio,
      negativePrompt: options?.negativePrompt,
      style: options?.style,
      seed: options?.seed,
      referenceImageUrls,
    })
  }
  // All other providers route through /v1/image-to-image
  return imageToImage(imageUrl, prompt, provider, userId, referenceImageUrls, options)
}

// --- Upscale Image (delegates to edit-image backend route) ---

export async function upscaleImage(
  imageUrl: string,
  provider?: string,
  options?: { upscaleFactor?: string; targetResolution?: string }
): Promise<{ jobId: string }> {
  return editImage(imageUrl, undefined, provider ?? "recraft-upscale", undefined, options)
}

// --- Remove Background (delegates to edit-image backend route) ---

export async function removeBackground(
  imageUrl: string,
): Promise<{ jobId: string }> {
  return editImage(imageUrl, undefined, "recraft-remove-bg")
}

export async function generateCharacter(data: {
  name: string
  description?: string
  gender?: string
  style?: string
  baseOutfit?: string
  sourceImageUrl?: string
  provider?: string
  userId?: string
  /** Character Studio: worker writes the resulting URL to this character's source_image_url after generation. */
  attachToCharacterId?: string
  /** Character Studio (Task 6): N-portrait batch (1, 2, or 4). Defaults to 1 server-side. */
  count?: 1 | 2 | 4
  /** Character Studio (Task 6): seed prompt for variant diversification. */
  seedPrompt?: string
  /** Character Studio (Task 6): reference photos tagged by camera angle/kind. */
  referencePhotos?: Array<{
    url: string
    kind: "frontFace" | "sideLeft" | "sideRight" | "threeQuarterLeft" | "threeQuarterRight" | "frontBody" | "other"
  }>
  /** Explicit aspect ratio — wins against everything else. */
  aspectRatio?: "1:1" | "3:4" | "16:9" | "9:16"
  /** Character node toggle — wins against the per-asset default (portrait = 3:4),
   *  loses to `aspectRatio`. Driven by the character node's 4-pill UI. */
  characterNodeAspectRatio?: "1:1" | "3:4" | "16:9" | "9:16"
}): Promise<{ jobId: string; jobIds: string[] }> {
  return apiJson("/v1/generate-character", {
    body: data,
    workflowId: true,
    label: "Failed to start character generation",
  })
}

export async function generateCharacterAsset(data: {
  assetType:
    | "expressions"
    | "poses"
    | "lighting"
    | "angles"
    | "headAngles"
    | "bodyAngles"
    | "custom"
  variant: string
  name: string
  description?: string
  gender?: string
  style?: string
  baseOutfit?: string
  sourceImageUrl?: string
  provider?: string
  userPrompt?: string
  userId?: string
  /** Character Studio auto-attach: when all three are set, the worker appends
   *  {name: attachName, url: <result>} to this column on the user's character row. */
  attachToCharacterId?: string
  // Shared single-source-of-truth union (includes the reference-sheet buckets
  // sheets/detail_closeups/outfit_variations) — kept in lockstep with the
  // backend route + RPC via CHARACTER_ATTACH_COLUMNS in @nodaro/shared.
  attachToColumn?: CharacterAttachColumn
  attachName?: string
  /** Per-asset extras (Identity Foundation v2). When `description` is omitted
   *  the backend asks Claude Sonnet for a draft scoped to the character's
   *  canonical description + assetType/variant. `realLifeRefs` (up to 5) are
   *  passed to the worker to bias the generation. */
  realLifeRefs?: ReadonlyArray<string>
  /** Explicit aspect ratio — wins against everything else. */
  aspectRatio?: "1:1" | "3:4" | "16:9" | "9:16"
  /** Character node toggle — wins against the per-asset-type default
   *  (expressions=1:1, poses=9:16, headAngles=3:4, bodyAngles=9:16,
   *  lighting=3:4, angles=3:4, custom=3:4), loses to `aspectRatio`. */
  characterNodeAspectRatio?: "1:1" | "3:4" | "16:9" | "9:16"
}): Promise<{ jobId: string }> {
  return apiJson("/v1/generate-character-asset", {
    body: data,
    workflowId: true,
    label: "Failed to start character asset generation",
  })
}

/**
 * Kicks off a reference-sheet generation (composited turnaround / variation /
 * detail / full-reference board). Backend route: `POST /v1/reference-sheet`
 * (Zod schema in `backend/src/routes/reference-sheet.ts`). When `entityKind`
 * + `entityDbId` are set the worker attaches the finished sheet to the entity
 * row's `sheets` JSONB column; pass `imageUrl` for an ad-hoc (node) source
 * instead. Returns `{ jobId }` for polling.
 */
export async function generateReferenceSheet(data: {
  type: SheetType
  skin: SheetSkin
  flavour: SheetFlavour
  entityKind?: EntityKind
  entityDbId?: string
  imageUrl?: string
  userId?: string
}): Promise<{ jobId: string }> {
  return apiJson("/v1/reference-sheet", {
    body: data,
    workflowId: true,
    label: "Failed to start reference sheet generation",
  })
}

export async function generateCharacterMotion(params: {
  motionPrompt: string
  /** Optional in the studio path: when `attachToCharacterId` is set the
   *  backend resolves the source frame from the character row (prefers the
   *  `front` body angle, falls back to other body angles, then the anchor
   *  portrait). Required when there is no `attachToCharacterId`. */
  sourceImageUrl?: string
  provider?: string
  name: string
  description?: string
  gender?: string
  style?: string
  baseOutfit?: string
  /** Character Studio auto-attach: target column is implicit ("motions"). */
  attachToCharacterId?: string
  attachName?: string
  /** Per-asset extras (Identity Foundation v2). When `description` and
   *  `motionDescription` are both omitted the backend asks Claude Sonnet for a
   *  combined draft. `realLifeRefs` (up to 5) are passed to the worker to bias
   *  the generation. */
  motionDescription?: string
  realLifeRefs?: ReadonlyArray<string>
  /** Explicit aspect ratio — wins against everything else. */
  aspectRatio?: "1:1" | "3:4" | "16:9" | "9:16"
  /** Character node toggle — wins against the motions default (9:16), loses
   *  to `aspectRatio`. */
  characterNodeAspectRatio?: "1:1" | "3:4" | "16:9" | "9:16"
}): Promise<{ jobId: string }> {
  return apiJson("/v1/generate-character-motion", {
    body: params,
    workflowId: true,
    label: "Failed to generate character motion",
  })
}

export async function saveCharacter(data: {
  id?: string
  userId?: string
  nodeId: string
  workflowId?: string
  projectId?: string
  name: string
  description?: string
  gender?: string
  style?: string
  baseOutfit?: string
  sourceImageUrl?: string
  expressions?: { name: string; url: string }[]
  poses?: { name: string; url: string }[]
  lightingVariations?: { name: string; url: string }[]
  angles?:      { name: string; url: string }[]
  bodyAngles?:  { name: string; url: string }[]
  motions?:     { name: string; url: string }[]
  voice?:       { voiceId: string; voiceName: string; traits: string } | null
  personality?: { mood: string; speechStyle: string; movementStyle: string; behavioralNotes: string } | null
  referencePhotos?: ReadonlyArray<{ url: string; kind: ReferencePhotoKind }>
  seedPrompt?: string
  canonicalDescription?: string
  realLifeRefsByVariant?: Readonly<Record<string, ReadonlyArray<string>>>
}): Promise<{ id: string }> {
  return apiJson("/v1/characters", {
    body: data,
    workflowId: true,
    label: "Failed to save character",
  })
}

/**
 * Fetch a single character row by ID. Used by the Character Studio to refresh
 * staged state with backend-attached assets (results of in-flight generations
 * that landed on the row directly while the studio was closed).
 *
 * `pendingJobs` is a snapshot of in-flight generation jobs still targeting
 * this character — used to re-mount spinners after the studio was closed
 * during generation. Empty for fresh characters with no jobs running.
 */
export async function getCharacter(id: string): Promise<{
  id: string
  name: string
  description: string | null
  gender: string | null
  style: string | null
  baseOutfit: string | null
  sourceImageUrl: string | null
  expressions: { name: string; url: string }[] | null
  poses: { name: string; url: string }[] | null
  lightingVariations: { name: string; url: string }[] | null
  angles: { name: string; url: string }[] | null
  bodyAngles: { name: string; url: string }[] | null
  motions: { name: string; url: string }[] | null
  // Reference-sheet buckets (migration 200) — emitted by the GET routes via
  // `toCamel`. `sheets` holds composited reference sheets; `detailCloseups`
  // holds macro close-up panels; `outfitVariations` holds wardrobe panels.
  sheets?: ReferenceSheet[]
  detailCloseups?: unknown[]
  outfitVariations?: unknown[]
  voice: { voiceId: string; voiceName: string; traits: string } | null
  personality: { mood: string; speechStyle: string; movementStyle: string; behavioralNotes: string } | null
  referencePhotos?: ReadonlyArray<{ url: string; kind: ReferencePhotoKind }>
  seedPrompt?: string
  canonicalDescription?: string
  realLifeRefsByVariant?: Readonly<Record<string, ReadonlyArray<string>>>
  pendingJobs: { jobId: string; assetType: "expressions" | "poses" | "angles" | "bodyAngles" | "lighting" | "motions"; name: string }[]
  readonly portraitCandidates?: ReadonlyArray<{
    readonly jobId: string
    readonly status: string
    readonly progress: number
    readonly url?: string
  }>
  readonly previousCandidates?: ReadonlyArray<{
    readonly jobId: string
    readonly url: string
    readonly createdAt: string
  }>
}> {
  return apiJson(`/v1/characters/${encodeURIComponent(id)}`, {
    method: "GET",
    label: "Failed to load character",
  })
}

// ---------------------------------------------------------------------------
// Character Studio PR 2 — LLM suggest, portrait approval, LLM caption.
// Wrappers for the backend routes introduced in the PR 1 backend:
//   - POST /v1/llm-suggest-description
//   - POST /v1/characters/:id/approve-portrait
//   - POST /v1/characters/:id/llm-caption
// ---------------------------------------------------------------------------

export type LlmSuggestKind = "seed-prompt" | "asset-description" | "motion-description"

export interface LlmSuggestContext {
  // seed-prompt
  readonly personPicker?: Record<string, unknown>
  readonly referencePhotos?: ReadonlyArray<{ readonly url: string; readonly kind: string }>
  readonly gender?: string
  readonly style?: string
  readonly baseOutfit?: string
  // asset-description / motion-description
  readonly assetType?: string
  readonly variant?: string
  readonly userPrompt?: string
  readonly canonicalDescription?: string
  readonly motionPrompt?: string
}

/**
 * Ask the backend's LLM to suggest a description string for a Character Studio
 * field (seed prompt, asset description, or motion description). The shape of
 * `context` depends on `kind` — see `LlmSuggestContext` for the union of
 * permitted fields.
 */
export async function llmSuggestDescription(body: {
  readonly kind: LlmSuggestKind
  readonly context: LlmSuggestContext
}): Promise<{ readonly text: string }> {
  return apiJson("/v1/llm-suggest-description", {
    body,
    label: "Failed to suggest description",
  })
}

/**
 * Approves a portrait candidate (a finished generate-character job) as the
 * character's canonical source image. The backend copies the job's image URL
 * to `characters.source_image_url` and, if no `canonical_description` is set
 * yet, also auto-captions the portrait.
 */
export async function approvePortrait(
  characterId: string,
  candidateJobId: string,
): Promise<{ readonly portraitUrl: string; readonly canonicalDescription: string | null }> {
  return apiJson(
    `/v1/characters/${encodeURIComponent(characterId)}/approve-portrait`,
    { body: { candidateJobId }, label: "Failed to approve portrait" },
  )
}

/**
 * Re-runs the LLM caption pipeline on the character's existing
 * `source_image_url` to refresh `canonical_description`. Used when the user
 * wants a fresh caption without re-generating the portrait.
 */
export async function llmCaptionPortrait(
  characterId: string,
): Promise<{ readonly canonicalDescription: string }> {
  return apiJson(
    `/v1/characters/${encodeURIComponent(characterId)}/llm-caption`,
    { label: "Failed to caption portrait" },
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Character LoRA training (Cloud edition only)
// ─────────────────────────────────────────────────────────────────────────────

export interface TrainingStatus {
  readonly status: "untrained" | "queued" | "training" | "succeeded" | "failed" | "cancelled"
  readonly trainingId: string | null
  readonly error: string | null
  readonly trainedAt: string | null
  readonly version: string | null
  readonly triggerWord: string | null
  readonly imageCount: number | null
}

/**
 * Submit a training. Reserves 150cr; webhook refunds on failure/cancel.
 * Returns 202 with `{ jobId, trainingId, triggerWord }` on success.
 * 409 `already_training_or_not_found` if a training is already in flight.
 * 400 `insufficient_training_images` if < 4 photos.
 */
export async function startCharacterTraining(
  characterId: string,
): Promise<{ readonly jobId: string; readonly trainingId: string; readonly triggerWord: string }> {
  return apiJson(
    `/v1/characters/${encodeURIComponent(characterId)}/train`,
    { body: {}, label: "Failed to start character training" },
  )
}

export async function getCharacterTraining(
  characterId: string,
): Promise<TrainingStatus> {
  return apiJson(
    `/v1/characters/${encodeURIComponent(characterId)}/training`,
    { method: "GET", label: "Failed to fetch training status" },
  )
}

/**
 * Tear down the trained LoRA: cancels in-flight training, refunds reserved
 * credits, deletes the Replicate model, nulls out the LoRA columns.
 */
export async function deleteCharacterLora(
  characterId: string,
): Promise<{ readonly ok: true }> {
  return apiJson(
    `/v1/characters/${encodeURIComponent(characterId)}/lora`,
    { method: "DELETE", label: "Failed to remove trained model" },
  )
}

// Face DB API functions
export async function saveFace(data: {
  id?: string
  userId?: string
  nodeId: string
  workflowId?: string
  projectId?: string
  name: string
  description?: string
  style?: string
  sourceImageUrl?: string
  expressions?: { name: string; url: string }[]
}): Promise<{ id: string }> {
  return apiJson("/v1/faces", {
    body: data,
    workflowId: true,
    label: "Failed to save face",
  })
}

export interface DbFace {
  id: string
  userId: string | null
  nodeId: string
  projectId: string | null
  name: string
  description: string | null
  style: string | null
  sourceImageUrl: string | null
  expressions: { name: string; url: string }[]
  createdAt: string
  updatedAt: string
}

export async function getFaces(projectId?: string, userId?: string): Promise<{ faces: DbFace[] }> {
  const params = new URLSearchParams()
  if (projectId) params.set("projectId", projectId)
  if (userId) params.set("userId", userId)
  const qs = params.toString()
  return apiJson(`/v1/faces${qs ? `?${qs}` : ""}`, {
    method: "GET",
    label: "Failed to fetch faces",
  })
}

export async function deleteFace(faceId: string): Promise<{ success: boolean }> {
  return apiJson(`/v1/faces/${encodeURIComponent(faceId)}`, {
    method: "DELETE",
    label: "Failed to delete face",
  })
}

export async function generateFace(data: {
  name: string
  description?: string
  style?: string
  prompt?: string
  sourceImageUrl?: string
  provider?: string
  userId?: string
}): Promise<{ jobId: string }> {
  return apiJson("/v1/generate-face", {
    body: data,
    workflowId: true,
    label: "Failed to start face headshot generation",
  })
}

/**
 * Archives the character (soft delete). The row stays in the DB and any
 * canvas node pointing at it keeps loading; the library list hides it.
 * Restore via `restoreCharacter(id)`.
 */
export async function deleteCharacter(characterId: string): Promise<{ success: boolean; archived?: boolean }> {
  return apiJson(`/v1/characters/${encodeURIComponent(characterId)}`, {
    method: "DELETE",
    label: "Failed to archive character",
  })
}

export async function restoreCharacter(characterId: string): Promise<{ id: string; name: string }> {
  return apiJson(`/v1/characters/${encodeURIComponent(characterId)}/restore`, {
    label: "Failed to restore character",
  })
}

/**
 * Forks the character into a new row with a " (copy)" suffix. Asset URLs are
 * shared (same R2 references); regenerate to diverge. Pass `nodeId` to bind
 * the new row to the spawning canvas node.
 */
export async function duplicateCharacter(
  characterId: string,
  opts: { nodeId?: string; projectId?: string } = {},
): Promise<{ id: string; name: string }> {
  return apiJson(`/v1/characters/${encodeURIComponent(characterId)}/duplicate`, {
    body: opts,
    label: "Failed to duplicate character",
  })
}

export async function getCharacterUsage(
  characterId: string,
): Promise<{ workflowCount: number; workflows: { id: string; name: string }[] }> {
  return apiJson(`/v1/characters/${encodeURIComponent(characterId)}/usage`, {
    method: "GET",
    label: "Failed to load character usage",
  })
}

/** List of archived characters for the library's "Archive" tab. */
export async function listArchivedCharacters(projectId?: string): Promise<{ characters: DbCharacter[] }> {
  const qs = new URLSearchParams({ archived: "true" })
  if (projectId) qs.set("projectId", projectId)
  return apiJson(`/v1/characters?${qs.toString()}`, {
    method: "GET",
    label: "Failed to load archived characters",
  })
}

/**
 * Thrown by saveCharacter when the backend returns 409 (name conflict —
 * unique-per-user constraint). Callers should show a toast and let the user
 * rename. Subclasses Error so it can be caught with `e instanceof CharacterNameTakenError`.
 */
export class CharacterNameTakenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CharacterNameTakenError"
  }
}

/**
 * Thrown when a character-studio API (generate-character-asset / -motion /
 * image-to-image) returns 400 with code "portrait_required" — the character
 * has no source portrait yet, so downstream variants/motions/edits can't run.
 * Callers can catch this specifically to trigger a UX action (e.g., switch
 * to the Appearance tab); the default behavior is to surface a toast.
 */
export class PortraitRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PortraitRequiredError"
  }
}

export interface DbCharacter {
  id: string
  userId: string | null
  nodeId: string
  projectId: string | null
  name: string
  description: string | null
  gender: string | null
  style: string | null
  baseOutfit: string | null
  sourceImageUrl: string | null
  expressions: { name: string; url: string }[]
  poses: { name: string; url: string }[]
  lightingVariations: { name: string; url: string }[]
  angles?: { name: string; url: string }[]
  motions?: { name: string; url: string }[]
  voice?: { voiceId: string; voiceName: string; traits: string } | null
  personality?: { mood: string; speechStyle: string; movementStyle: string; behavioralNotes: string } | null
  /** Set when a successful LoRA training exists. Drives the `<TrainedPill>` on gallery + autocomplete. */
  loraTrainingStatus?: "queued" | "training" | "succeeded" | "failed" | "cancelled" | null
  loraReplicateVersion?: string | null
  loraTriggerWord?: string | null
  loraTrainedAt?: string | null
  deletedAt?: string | null
  createdAt: string
  updatedAt: string
}

export async function getCharacters(projectId?: string, userId?: string): Promise<{ characters: DbCharacter[] }> {
  const params = new URLSearchParams()
  if (projectId) params.set("projectId", projectId)
  if (userId) params.set("userId", userId)
  const qs = params.toString()
  return apiJson(`/v1/characters${qs ? `?${qs}` : ""}`, {
    method: "GET",
    label: "Failed to fetch characters",
  })
}

export async function getCharacterById(characterId: string): Promise<DbCharacter | null> {
  const res = await fetch(`${API_BASE_URL}/v1/characters/${encodeURIComponent(characterId)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
  })
  if (res.status === 404) {
    return null
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to fetch character")
  }
  return res.json()
}

// ---- Node presets ----

export interface NodePreset {
  id: string
  nodeType: string
  name: string
  description?: string
  data: Record<string, unknown>
  groupId?: string
  tags: string[]
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface NodePresetGroup {
  id: string
  nodeType: string
  name: string
  kind: "folder" | "section"
  sortOrder: number
}

/** Thrown on 409 from create/update so the UI can show a friendly "name taken" message. */
export class NodePresetNameTakenError extends Error {
  constructor() {
    super("name_taken")
    this.name = "NodePresetNameTakenError"
  }
}

export async function listNodePresets(nodeType?: string): Promise<NodePreset[]> {
  const qs = nodeType ? `?nodeType=${encodeURIComponent(nodeType)}` : ""
  const res = await apiJson<{ data: NodePreset[] }>(`/v1/node-presets${qs}`, {
    method: "GET",
    label: "Failed to load presets",
  })
  return res.data
}

// ---- Node preset favorites (per-user; powers the dropdown's Favorites band) ----
// `presetId` is a factory id ("generate-image/character-board") OR a user-preset uuid.

/** The caller's favorited preset ids for a node type, most-recent first. */
export async function listNodePresetFavorites(nodeType: string): Promise<string[]> {
  const res = await apiJson<{ data: string[] }>(
    `/v1/node-presets/favorites?nodeType=${encodeURIComponent(nodeType)}`,
    { method: "GET", label: "Failed to load favorites" },
  )
  return res.data
}

export async function addNodePresetFavorite(nodeType: string, presetId: string): Promise<void> {
  await apiJson(`/v1/node-presets/favorites`, {
    method: "POST",
    body: { nodeType, presetId },
    label: "Failed to favorite preset",
  })
}

export async function removeNodePresetFavorite(nodeType: string, presetId: string): Promise<void> {
  await apiJson(
    `/v1/node-presets/favorites?nodeType=${encodeURIComponent(nodeType)}&presetId=${encodeURIComponent(presetId)}`,
    { method: "DELETE", label: "Failed to unfavorite preset" },
  )
}

export async function createNodePreset(input: {
  nodeType: string
  name: string
  description?: string
  data: Record<string, unknown>
  groupId?: string | null
  tags?: string[]
  sortOrder?: number
}): Promise<NodePreset> {
  const res = await fetch(`${API_BASE_URL}/v1/node-presets`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(input),
  })
  if (res.status === 409) throw new NodePresetNameTakenError()
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to save preset")
  }
  return (await res.json()).data
}

export async function updateNodePreset(
  id: string,
  patch: {
    name?: string
    description?: string
    data?: Record<string, unknown>
    groupId?: string | null
    tags?: string[]
    sortOrder?: number
  },
): Promise<NodePreset> {
  const res = await fetch(`${API_BASE_URL}/v1/node-presets/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(patch),
  })
  if (res.status === 409) throw new NodePresetNameTakenError()
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to update preset")
  }
  return (await res.json()).data
}

export async function deleteNodePreset(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/v1/node-presets/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await getAuthHeaders(),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to delete preset")
  }
}

export async function importNodePresets(
  presets: { nodeType: string; name: string; description?: string; data: Record<string, unknown> }[],
): Promise<number> {
  const res = await apiJson<{ data: { imported: number } }>("/v1/node-presets/import", {
    method: "POST",
    body: { presets },
    label: "Failed to import presets",
  })
  return res.data.imported
}

/** Bulk-apply positions (and preset group membership) after a drag in the Manage dialog. */
export async function reorderNodePresets(input: {
  groups?: { id: string; sortOrder: number }[]
  presets?: { id: string; groupId?: string | null; sortOrder: number }[]
}): Promise<void> {
  await apiJson<{ data: { ok: boolean } }>("/v1/node-presets/reorder", {
    method: "POST",
    body: input,
    label: "Failed to reorder presets",
  })
}

// ---- Node preset groups (folders / sections) ----

export async function listNodePresetGroups(nodeType?: string): Promise<NodePresetGroup[]> {
  const qs = nodeType ? `?nodeType=${encodeURIComponent(nodeType)}` : ""
  const res = await apiJson<{ data: NodePresetGroup[] }>(`/v1/node-preset-groups${qs}`, {
    method: "GET",
    label: "Failed to load preset folders",
  })
  return res.data
}

export async function createNodePresetGroup(input: {
  nodeType: string
  name: string
  kind: "folder" | "section"
  sortOrder?: number
}): Promise<NodePresetGroup> {
  const res = await apiJson<{ data: NodePresetGroup }>("/v1/node-preset-groups", {
    method: "POST",
    body: input,
    label: "Failed to create folder",
  })
  return res.data
}

export async function updateNodePresetGroup(
  id: string,
  patch: { name?: string; sortOrder?: number },
): Promise<NodePresetGroup> {
  const res = await apiJson<{ data: NodePresetGroup }>(`/v1/node-preset-groups/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: patch,
    label: "Failed to update folder",
  })
  return res.data
}

export async function deleteNodePresetGroup(id: string): Promise<void> {
  await apiJson<{ data: { success: boolean } }>(`/v1/node-preset-groups/${encodeURIComponent(id)}`, {
    method: "DELETE",
    label: "Failed to delete folder",
  })
}

***REDACTED-OSS-SCRUB***

export interface PromptSnippet {
  id: string
  name: string
  description?: string
  text: string
  target: "prompt" | "negative"
  media: string[]
  category?: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/** Thrown on 409 from create/update so the UI shows a friendly "name taken". */
export class PromptSnippetNameTakenError extends Error {
  constructor() {
    super("name_taken")
    this.name = "PromptSnippetNameTakenError"
  }
}

export async function listPromptSnippets(): Promise<PromptSnippet[]> {
  const res = await apiJson<{ data: PromptSnippet[] }>(`/v1/prompt-snippets`, {
    method: "GET",
    label: "Failed to load snippets",
  })
  return res.data
}

export async function createPromptSnippet(input: {
  name: string
  description?: string
  text: string
  target: "prompt" | "negative"
  media: string[]
  category?: string
  sortOrder?: number
}): Promise<PromptSnippet> {
  const res = await fetch(`${API_BASE_URL}/v1/prompt-snippets`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(input),
  })
  if (res.status === 409) throw new PromptSnippetNameTakenError()
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to save snippet")
  }
  return (await res.json()).data
}

export async function updatePromptSnippet(
  id: string,
  patch: {
    name?: string
    description?: string | null
    text?: string
    target?: "prompt" | "negative"
    media?: string[]
    category?: string | null
    sortOrder?: number
  },
): Promise<PromptSnippet> {
  const res = await fetch(`${API_BASE_URL}/v1/prompt-snippets/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(patch),
  })
  if (res.status === 409) throw new PromptSnippetNameTakenError()
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to update snippet")
  }
  return (await res.json()).data
}

export async function deletePromptSnippet(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/v1/prompt-snippets/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await getAuthHeaders(),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to delete snippet")
  }
}

// Object API functions
export async function generateObject(data: {
  name: string
  description?: string
  category?: string
  style?: string
  sourceImageUrl?: string
  provider?: string
  userId?: string
  // Phase A (Object Studio) — multi-candidate generation + studio auto-
  // attach + seed-prompt context. Backend returns `{ jobIds: string[] }`
  // when count > 1, `{ jobId }` otherwise.
  count?: 1 | 2 | 4
  attachToObjectId?: string
  attachName?: string
  seedPromptHint?: string
  expectedUpdatedAt?: string
}): Promise<{ jobId: string } | { jobIds: string[] }> {
  return apiJson("/v1/generate-object", {
    body: data,
    workflowId: true,
    label: "Failed to start object generation",
  })
}

export async function generateObjectAsset(data: {
  assetType: "angles" | "materials" | "variations" | "custom"
  variant: string
  name: string
  description?: string
  // Free-form override prompt for assetType === "custom" — backend builds
  // its prompt from `userPrompt` when set, otherwise falls back to a
  // template seeded by `variant`. Mirrors the location route's contract
  // (see backend/src/routes/generate-object-asset.ts schema). Required
  // when the Material catalog browser fires a pick (the variant becomes
  // the catalog label and userPrompt carries the descriptive override).
  userPrompt?: string
  category?: string
  style?: string
  sourceImageUrl: string
  provider?: string
  userId?: string
  // Phase A (Object Studio) — studio auto-attach + seed-prompt context.
  // Worker payload pass-through: when set, the worker appends the
  // generated `{name, url}` to the matching JSONB column on the object
  // row via `append_object_asset` RPC.
  attachToObjectId?: string
  // Shared single-source-of-truth union (includes the reference-sheet buckets
  // sheets/detail_closeups) — kept in lockstep with the backend route + RPC via
  // OBJECT_ATTACH_COLUMNS in @nodaro/shared.
  attachToColumn?: ObjectAttachColumn
  attachName?: string
  seedPromptHint?: string
}): Promise<{ jobId: string }> {
  return apiJson("/v1/generate-object-asset", {
    body: data,
    workflowId: true,
    label: "Failed to start object asset generation",
  })
}

/**
 * Kicks off the Object Studio motion (image-to-video) generation. Mirrors
 * `generateLocationMotion` but for the object motion tab. `sourceImageUrl`
 * is REQUIRED — image-to-video needs a source frame.
 *
 * Backend route: `POST /v1/generate-object-motion` — Zod schema in
 * `backend/src/routes/generate-object-motion.ts`. `provider` defaults to
 * `"kling-turbo"` server-side. When `attachToObjectId` is set the worker
 * appends to the object row's `motion_clips` JSONB column (single attach
 * column; the route sets it implicitly so callers don't supply it). Default
 * aspect-ratio is `1:1` (product-showcase) — resolved server-side via
 * `resolveObjectAspectRatio({ assetType: "motion" })`.
 */
export async function generateObjectMotion(data: {
  motionPrompt: string
  sourceImageUrl: string
  provider?: string
  name: string
  category?: string
  style?: string
  canonicalDescription?: string
  seedPromptHint?: string
  userId?: string
  attachToObjectId?: string
  attachName?: string
  aspectRatio?: "1:1" | "3:4" | "16:9" | "9:16"
}): Promise<{ jobId: string }> {
  return apiJson("/v1/generate-object-motion", {
    body: data,
    workflowId: true,
    label: "Failed to start object motion generation",
  })
}

export async function saveObject(data: {
  id?: string
  userId?: string
  nodeId: string
  projectId?: string
  name: string
  description?: string
  category?: string
  style?: string
  sourceImageUrl?: string
  angles?: { name: string; url: string }[]
  materials?: { name: string; url: string }[]
  variations?: { name: string; url: string }[]
  // Phase A (Object Studio) additions — per spec Pass 13 F-100, frontend
  // stays a dumb pass-through; the backend route owns the INSERT-vs-UPDATE
  // distinction (silently ignores worker-owned async-write columns on
  // UPDATE so a stale studio snapshot can't clobber atomic append-RPC
  // writes).
  motionClips?: { name: string; url: string }[]
  referencePhotos?: { kind: string; url: string }[]
  canonicalDescription?: string
  styleLock?: boolean
  /**
   * Optimistic-concurrency token. When present, the backend gates the
   * UPDATE on the row's current `updated_at` and returns 409 on mismatch
   * → surfaced here as `ConcurrentModificationError` (via the central
   * `throwApiError` helper, which inspects `error.code === "concurrent_modification"`).
   * Mirrors the saveLocation pattern.
   */
  expectedUpdatedAt?: string
}): Promise<{ id: string; updatedAt?: string }> {
  return apiJson("/v1/objects", {
    body: data,
    workflowId: true,
    label: "Failed to save object",
  })
}

/**
 * Approve a candidate-generation job as the object's permanent
 * `source_image_url`. Also fires the Claude Sonnet vision caption inline
 * to populate `canonical_description`. Returns 200 with
 * `canonicalDescription: ""` on caption sub-failure (frontend retries
 * via `recaptionObject`).
 *
 * `expectedUpdatedAt` is the studio's optimistic-concurrency token. When
 * passed, the backend gates the UPDATE on the row's current `updated_at`
 * and returns 409 on mismatch — surfaced here as
 * `ConcurrentModificationError` via the central `throwApiError` helper
 * (matches the location precedent at api.ts:1395).
 *
 * Per spec Pass 10 F-90b, the object route uses a uniform `"not_found"`
 * 404 code for missing/cross-user/archived rows.
 */
export async function approveObjectMainImage(
  objectId: string,
  candidateJobId: string,
  expectedUpdatedAt?: string,
): Promise<{ readonly sourceImageUrl: string; readonly canonicalDescription: string }> {
  const body: Record<string, unknown> = { candidateJobId }
  if (expectedUpdatedAt) body.expectedUpdatedAt = expectedUpdatedAt
  return apiJson(
    `/v1/objects/${encodeURIComponent(objectId)}/approve-main-image`,
    { body, label: "Failed to approve object main image" },
  )
}

/**
 * Re-runs the Claude Sonnet vision caption against the object's existing
 * `source_image_url` and persists the result. Used by the studio's "retry
 * caption" affordance when `approveObjectMainImage` returned an empty
 * canonicalDescription. Mirrors `recaptionLocation` at api.ts:1424.
 *
 * Backend route does NOT accept `expectedUpdatedAt` — it's a pure
 * idempotent retry against the current row state. Throws on 502
 * `caption_failed` so the caller can surface a retry.
 */
export async function recaptionObject(
  objectId: string,
): Promise<{ readonly canonicalDescription: string }> {
  return apiJson(
    `/v1/objects/${encodeURIComponent(objectId)}/llm-caption`,
    { label: "Failed to caption object" },
  )
}

/**
 * Archives the object (soft delete). The row stays in the DB and any canvas
 * node pointing at it keeps loading; the library list hides it. Restore via
 * `restoreObject(id)`.
 *
 * `opts.permanent === true` flips the route into hard-delete mode. The row
 * MUST already be archived — active rows return 400 `not_archived` (per
 * Phase C2b — guards against curl/SDK callers bypassing the UI archive-
 * first flow). Permanent-delete is intentionally NOT mirrored on the SDK
 * (`@nodaro/client`) so programmatic callers can only soft-delete.
 */
export async function deleteObject(
  objectId: string,
  opts?: { permanent?: boolean },
): Promise<{ success: boolean; archived?: boolean; permanent?: boolean }> {
  const path = opts?.permanent
    ? `/v1/objects/${encodeURIComponent(objectId)}?permanent=true`
    : `/v1/objects/${encodeURIComponent(objectId)}`
  return apiJson(path, {
    method: "DELETE",
    label: opts?.permanent ? "Failed to permanently delete object" : "Failed to archive object",
  })
}

/**
 * Un-archive a soft-deleted object (mirror of `restoreLocation` at
 * api.ts:1446). On name collision with an active row, the backend
 * auto-suffixes "(restored)" so the returned name may differ from the
 * original.
 *
 * Per spec Pass 10 F-90b, all failure paths return uniform `"not_found"`
 * 404 (object deliberately diverges from location's per-path codes /
 * idempotent-200-on-already-active so the failure surface doesn't leak
 * which IDs are already-active vs which don't exist).
 */
export async function restoreObject(objectId: string): Promise<{ id: string; name: string }> {
  return apiJson(
    `/v1/objects/${encodeURIComponent(objectId)}/restore`,
    { label: "Failed to restore object" },
  )
}

/**
 * Permanent (hard) delete a soft-deleted object row. UI-only — backed by
 * the existing DELETE route with `?permanent=true`. Mirrors
 * `permanentDeleteLocation` at api.ts:1513.
 *
 * Intentionally NOT mirrored on the SDK surface (`@nodaro/client`) — the
 * SDK's `delete()` always soft-deletes so programmatic callers cannot
 * accidentally destroy data. Permanent-delete is reachable only from the
 * `/library/objects` archive view.
 */
export async function permanentDeleteObject(
  objectId: string,
): Promise<{ success: boolean; permanent: boolean }> {
  const res = (await deleteObject(objectId, { permanent: true })) as {
    success: boolean
    permanent: boolean
  }
  return res
}

export interface DbObject {
  id: string
  userId: string | null
  nodeId: string
  projectId: string | null
  name: string
  description: string | null
  category: string | null
  style: string | null
  sourceImageUrl: string | null
  angles: { name: string; url: string }[]
  materials: { name: string; url: string }[]
  variations: { name: string; url: string }[]
  // Phase A (Object Studio) additions — populated by the backend's
  // mapDbObject helper. JSONB columns are non-null in the DB layer
  // (defaults to `[]`/`""`); the frontend type matches.
  motionClips: { name: string; url: string }[]
  referencePhotos: { kind: string; url: string }[]
  canonicalDescription: string
  styleLock: boolean
  // Reference-sheet buckets (migration 200) — emitted by both the list and
  // GET-by-id routes via `toCamel`. `sheets` holds composited reference sheets;
  // `detailCloseups` holds macro close-up panels. Objects have no
  // `outfitVariations` (character-only dimension).
  sheets?: ReferenceSheet[]
  detailCloseups?: unknown[]
  deletedAt?: string | null
  createdAt: string
  updatedAt: string
  // Only populated by `getObjectById` (the GET single-row route); the
  // list route omits this. In-flight generation jobs targeting this object
  // so the Studio can re-attach spinners on reopen + the canvas can clear
  // stale running-status badges when no jobs remain.
  pendingJobs?: { jobId: string; assetType: string; name: string; status: string }[]
}

export async function getObjects(
  projectId?: string,
  userId?: string,
  opts?: { archived?: boolean },
): Promise<{ objects: DbObject[] }> {
  const params = new URLSearchParams()
  if (projectId) params.set("projectId", projectId)
  if (userId) params.set("userId", userId)
  if (opts?.archived) params.set("archived", "true")
  const qs = params.toString()
  return apiJson(`/v1/objects${qs ? `?${qs}` : ""}`, {
    method: "GET",
    label: "Failed to fetch objects",
  })
}

/**
 * List of archived (soft-deleted) objects for the library's "Archived"
 * tab. Backed by `GET /v1/objects?archived=true` (extended in Phase C2b).
 * Mirrors `listArchivedLocations` at api.ts:1535.
 */
export async function listArchivedObjects(
  projectId?: string,
  userId?: string,
): Promise<{ objects: DbObject[] }> {
  return getObjects(projectId, userId, { archived: true })
}

export async function getObjectById(objectId: string): Promise<DbObject | null> {
  const res = await fetch(`${API_BASE_URL}/v1/objects/${encodeURIComponent(objectId)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
  })
  if (res.status === 404) {
    return null
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to fetch object")
  }
  return res.json()
}

// --- Animal/Creature API functions ---
//
// Mirrors the Object API surface (generateObject / generateCreatureAsset /
// generateCreatureMotion / saveCreature / approve / recaption / delete /
// restore / list / get-by-id) with the creature DELTA:
//   objectName → creatureName, attachToObjectId → attachToCreatureId,
//   materials  → poses, + species (free-text). The reference-sheet *Sheet tab*
//   (sheets / detail_closeups buckets) is the only piece still deferred — the
//   asset (Angles/Poses/Variations) and motion clients below are live and back
//   the Creature Studio tabs (routes: POST /v1/generate-creature-asset and
//   /v1/generate-creature-motion). Auth-header + error handling go through the
//   shared `apiJson` helper / `throwApiError`, identical to object.

export async function generateCreature(data: {
  name: string
  description?: string
  // Creature delta vs object — free-text species/type (e.g. "red fox",
  // "griffin"). Nullable server-side; omitted when blank.
  species?: string
  category?: string
  style?: string
  sourceImageUrl?: string
  provider?: string
  userId?: string
  // Multi-candidate generation + studio auto-attach + seed-prompt context.
  // Backend returns `{ jobIds: string[] }` when count > 1, `{ jobId }`
  // otherwise (matches generate-object).
  count?: 1 | 2 | 4
  attachToCreatureId?: string
  attachName?: string
  seedPromptHint?: string
  expectedUpdatedAt?: string
}): Promise<{ jobId: string } | { jobIds: string[] }> {
  return apiJson("/v1/generate-creature", {
    body: data,
    workflowId: true,
    label: "Failed to start creature generation",
  })
}

/**
 * Kicks off a Creature Studio per-asset (angles / poses / variations / custom)
 * image-to-image generation. Mirrors `generateObjectAsset` with object →
 * creature substitution (`materials`→`poses`, `attachToObjectId`→
 * `attachToCreatureId`). Worker payload pass-through: when the studio attach
 * fields are set, the worker appends the generated `{name, url}` to the
 * matching JSONB column on the creature row via `append_creature_asset` RPC.
 *
 * Backend route: `POST /v1/generate-creature-asset` — Zod schema in
 * `backend/src/routes/generate-creature-asset.ts`. `provider` defaults to
 * `"nano-banana"` server-side. These are what the Studio Angles / Poses /
 * Variations tabs call.
 */
export async function generateCreatureAsset(data: {
  assetType: "angles" | "poses" | "variations" | "custom"
  variant: string
  name: string
  description?: string
  // Free-form override prompt for assetType === "custom" — backend builds its
  // prompt from `userPrompt` when set, otherwise falls back to a template
  // seeded by `variant`. Mirrors the object route's contract.
  userPrompt?: string
  category?: string
  style?: string
  // Optional — backend Zod is `safeUrlSchema.optional()`. Studio passes the
  // approved main image only when style-lock is on; otherwise omit it
  // (undefined) for text-only generation. Do NOT send "" — an empty string
  // fails URL validation (HTTP 400).
  sourceImageUrl?: string
  provider?: string
  userId?: string
  attachToCreatureId?: string
  // Shared single-source-of-truth union (includes the reference-sheet buckets
  // sheets/detail_closeups) — kept in lockstep with the backend route + RPC
  // via CREATURE_ATTACH_COLUMNS in @nodaro/shared.
  attachToColumn?: CreatureAttachColumn
  attachName?: string
  seedPromptHint?: string
}): Promise<{ jobId: string }> {
  return apiJson("/v1/generate-creature-asset", {
    body: data,
    workflowId: true,
    label: "Failed to start creature asset generation",
  })
}

/**
 * Kicks off the Creature Studio motion (image-to-video) generation. Mirrors
 * `generateObjectMotion` but for the creature motion tab. `sourceImageUrl` is
 * REQUIRED — image-to-video needs a source frame.
 *
 * Backend route: `POST /v1/generate-creature-motion` — Zod schema in
 * `backend/src/routes/generate-creature-motion.ts`. `provider` defaults to
 * `"kling-turbo"` server-side. When `attachToCreatureId` is set the worker
 * appends to the creature row's `motion_clips` JSONB column (single attach
 * column; the route sets it implicitly so callers don't supply it). Default
 * aspect-ratio is `1:1` — resolved server-side via
 * `resolveObjectAspectRatio({ assetType: "motion" })`.
 */
export async function generateCreatureMotion(data: {
  motionPrompt: string
  sourceImageUrl: string
  provider?: string
  name: string
  category?: string
  style?: string
  canonicalDescription?: string
  seedPromptHint?: string
  userId?: string
  attachToCreatureId?: string
  attachName?: string
  aspectRatio?: "1:1" | "3:4" | "16:9" | "9:16" | "4:3"
}): Promise<{ jobId: string }> {
  return apiJson("/v1/generate-creature-motion", {
    body: data,
    workflowId: true,
    label: "Failed to start creature motion generation",
  })
}

export async function saveCreature(data: {
  id?: string
  userId?: string
  nodeId: string
  projectId?: string
  name: string
  description?: string
  // Creature delta vs object — free-text species/type.
  species?: string
  category?: string
  style?: string
  sourceImageUrl?: string
  angles?: { name: string; url: string }[]
  // Creature delta vs object — `poses` replaces object's `materials`.
  poses?: { name: string; url: string }[]
  variations?: { name: string; url: string }[]
  // Mirrors saveObject — frontend stays a dumb pass-through; the backend route
  // owns the INSERT-vs-UPDATE distinction (silently ignores worker-owned
  // async-write columns on UPDATE so a stale studio snapshot can't clobber
  // atomic append-RPC writes).
  motionClips?: { name: string; url: string }[]
  referencePhotos?: { kind: string; url: string }[]
  canonicalDescription?: string
  styleLock?: boolean
  /**
   * Optimistic-concurrency token. When present, the backend gates the UPDATE
   * on the row's current `updated_at` and returns 409 on mismatch → surfaced
   * here as `ConcurrentModificationError` (via the central `throwApiError`
   * helper). Mirrors the saveObject pattern.
   */
  expectedUpdatedAt?: string
}): Promise<{ id: string; updatedAt?: string }> {
  return apiJson("/v1/creatures", {
    body: data,
    workflowId: true,
    label: "Failed to save creature",
  })
}

/**
 * Approve a candidate-generation job as the creature's permanent
 * `source_image_url`. Also fires the vision caption inline to populate
 * `canonical_description`. Returns 200 with `canonicalDescription: ""` on
 * caption sub-failure (frontend retries via `recaptionCreature`). Mirrors
 * `approveObjectMainImage`.
 */
export async function approveCreatureMainImage(
  creatureId: string,
  candidateJobId: string,
  expectedUpdatedAt?: string,
): Promise<{ readonly sourceImageUrl: string; readonly canonicalDescription: string }> {
  const body: Record<string, unknown> = { candidateJobId }
  if (expectedUpdatedAt) body.expectedUpdatedAt = expectedUpdatedAt
  return apiJson(
    `/v1/creatures/${encodeURIComponent(creatureId)}/approve-main-image`,
    { body, label: "Failed to approve creature main image" },
  )
}

/**
 * Re-runs the vision caption against the creature's existing
 * `source_image_url` and persists the result. Mirrors `recaptionObject`.
 */
export async function recaptionCreature(
  creatureId: string,
): Promise<{ readonly canonicalDescription: string }> {
  return apiJson(
    `/v1/creatures/${encodeURIComponent(creatureId)}/llm-caption`,
    { label: "Failed to caption creature" },
  )
}

/**
 * Archives the creature (soft delete). `opts.permanent === true` flips the
 * route into hard-delete mode (the row MUST already be archived). Mirrors
 * `deleteObject`.
 */
export async function deleteCreature(
  creatureId: string,
  opts?: { permanent?: boolean },
): Promise<{ success: boolean; archived?: boolean; permanent?: boolean }> {
  const path = opts?.permanent
    ? `/v1/creatures/${encodeURIComponent(creatureId)}?permanent=true`
    : `/v1/creatures/${encodeURIComponent(creatureId)}`
  return apiJson(path, {
    method: "DELETE",
    label: opts?.permanent ? "Failed to permanently delete creature" : "Failed to archive creature",
  })
}

/**
 * Un-archive a soft-deleted creature (mirror of `restoreObject`). On name
 * collision with an active row, the backend auto-suffixes "(restored)" so the
 * returned name may differ from the original.
 */
export async function restoreCreature(creatureId: string): Promise<{ id: string; name: string }> {
  return apiJson(
    `/v1/creatures/${encodeURIComponent(creatureId)}/restore`,
    { label: "Failed to restore creature" },
  )
}

/**
 * Permanent (hard) delete a soft-deleted creature row. UI-only — backed by the
 * DELETE route with `?permanent=true`. Mirrors `permanentDeleteObject`.
 */
export async function permanentDeleteCreature(
  creatureId: string,
): Promise<{ success: boolean; permanent: boolean }> {
  const res = (await deleteCreature(creatureId, { permanent: true })) as {
    success: boolean
    permanent: boolean
  }
  return res
}

export interface DbCreature {
  id: string
  userId: string | null
  nodeId: string
  projectId: string | null
  name: string
  description: string | null
  // Creature delta vs object — free-text species/type (nullable in DB).
  species: string | null
  category: string | null
  style: string | null
  sourceImageUrl: string | null
  angles: { name: string; url: string }[]
  // Creature delta vs object — `poses` replaces object's `materials`.
  poses: { name: string; url: string }[]
  variations: { name: string; url: string }[]
  motionClips: { name: string; url: string }[]
  referencePhotos: { kind: string; url: string }[]
  canonicalDescription: string
  styleLock: boolean
  // Reference-sheet buckets — carried for forward-compat with the GET routes'
  // shape (Sheet tab DEFERRED this phase). Mirrors DbObject.
  sheets?: ReferenceSheet[]
  detailCloseups?: unknown[]
  deletedAt?: string | null
  createdAt: string
  updatedAt: string
  // Only populated by `getCreatureById` (the GET single-row route); the list
  // route omits this. In-flight generation jobs targeting this creature.
  pendingJobs?: { jobId: string; assetType: string; name: string; status: string }[]
}

export async function getCreatures(
  projectId?: string,
  userId?: string,
  opts?: { archived?: boolean },
): Promise<{ creatures: DbCreature[] }> {
  const params = new URLSearchParams()
  if (projectId) params.set("projectId", projectId)
  if (userId) params.set("userId", userId)
  if (opts?.archived) params.set("archived", "true")
  const qs = params.toString()
  return apiJson(`/v1/creatures${qs ? `?${qs}` : ""}`, {
    method: "GET",
    label: "Failed to fetch creatures",
  })
}

/**
 * List of archived (soft-deleted) creatures for the library's "Archived" tab.
 * Backed by `GET /v1/creatures?archived=true`. Mirrors `listArchivedObjects`.
 */
export async function listArchivedCreatures(
  projectId?: string,
  userId?: string,
): Promise<{ creatures: DbCreature[] }> {
  return getCreatures(projectId, userId, { archived: true })
}

export async function getCreatureById(creatureId: string): Promise<DbCreature | null> {
  const res = await fetch(`${API_BASE_URL}/v1/creatures/${encodeURIComponent(creatureId)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
  })
  if (res.status === 404) {
    return null
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to fetch creature")
  }
  return res.json()
}

// Location API functions
export async function generateLocation(data: {
  name: string
  description?: string
  category?: string
  style?: string
  sourceImageUrl?: string
  provider?: string
  userId?: string
  /** 1 | 2 | 4 — request multi-candidate batch. count=1 keeps the legacy
   *  `{ jobId }` response shape for backward compat; count>1 returns
   *  `{ jobIds: string[] }`. The studio reads `jobIds ?? [jobId]`. */
  count?: 1 | 2 | 4
  /** Auto-attach the resulting URL to this location row on worker completion.
   *  ⚠️ Only honored by the backend when count === 1. For multi-candidate
   *  batches, the studio approves a candidate explicitly via
   *  `approveLocationMainImage`. */
  attachToLocationId?: string
}): Promise<{ jobId?: string; jobIds?: readonly string[] }> {
  return apiJson("/v1/generate-location", {
    body: data,
    workflowId: true,
    label: "Failed to start location generation",
  })
}

export async function generateLocationAsset(data: {
  assetType: "timeOfDay" | "weather" | "seasons" | "angles" | "lighting" | "custom"
  variant: string
  name: string
  description?: string
  userPrompt?: string
  category?: string
  style?: string
  sourceImageUrl?: string
  provider?: string
  userId?: string
  // Location Studio auto-attach (PR-2): when all three are set, the worker
  // appends `{name: attachName, url: <result>}` to the named JSONB array column
  // on the user's location row after generation. `attachToColumn` is required
  // when `assetType === "custom"` (the worker can't infer the bucket).
  attachToLocationId?: string
  // Shared single-source-of-truth union (includes the reference-sheet buckets
  // sheets/detail_closeups) — kept in lockstep with the backend route + RPC via
  // LOCATION_ATTACH_COLUMNS in @nodaro/shared.
  attachToColumn?: LocationAttachColumn
  attachName?: string
}): Promise<{ jobId: string }> {
  return apiJson("/v1/generate-location-asset", {
    body: data,
    workflowId: true,
    label: "Failed to start location asset generation",
  })
}

/**
 * Kicks off the Location Studio atmosphere-motion (image-to-video) generation.
 * Mirrors `generateLocationAsset` but for the video tab — `sourceImageUrl` is
 * REQUIRED (motion needs a source frame) and the worker writes back to the
 * fixed `atmosphere_motions` JSONB column on the locations row when the auto-
 * attach trio is set.
 *
 * Backend route: `POST /v1/generate-location-motion` — Zod schema in
 * `backend/src/routes/generate-location-motion.ts`. `provider` defaults to
 * `"kling"` server-side when omitted.
 */
export async function generateLocationMotion(data: {
  motionPrompt: string
  sourceImageUrl: string
  provider?: string
  name: string
  category?: string
  style?: string
  canonicalDescription?: string
  userId?: string
  attachToLocationId?: string
  attachToColumn?: "atmosphere_motions"
  attachName?: string
  aspectRatio?: "1:1" | "3:4" | "16:9" | "9:16"
}): Promise<{ jobId: string }> {
  return apiJson("/v1/generate-location-motion", {
    body: data,
    workflowId: true,
    label: "Failed to start location motion generation",
  })
}

export async function saveLocation(data: {
  id?: string
  userId?: string
  nodeId: string
  projectId?: string
  name: string
  description?: string
  category?: string
  style?: string
  sourceImageUrl?: string
  timeOfDay?: { name: string; url: string }[]
  weather?: { name: string; url: string }[]
  angles?: { name: string; url: string }[]
  // Phase 2 — Location Studio additions
  lighting?: { name: string; url: string }[]
  seasons?: { name: string; url: string }[]
  atmosphereMotions?: { name: string; url: string }[]
  referencePhotos?: { kind: string; url: string }[]
  canonicalDescription?: string
  styleLock?: boolean
  /**
   * PII consent timestamp (Phase 2 #7). The studio sends `new Date().toISOString()`
   * when the user adds the first reference photo with the consent checkbox
   * ticked. The backend writes it to `locations.pii_consent_at`; subsequent
   * reads return it so the studio knows when consent was given.
   */
  piiConsentAt?: string
  /**
   * Optimistic-concurrency token. When present, the backend only UPDATEs the
   * row if `updated_at` still matches. On mismatch the API returns 409 and
   * this client throws `ConcurrentModificationError` so the caller can
   * re-fetch + merge instead of overwriting a concurrent worker write.
   */
  expectedUpdatedAt?: string
}): Promise<{ id: string; updatedAt?: string }> {
  return apiJson("/v1/locations", {
    body: data,
    workflowId: true,
    label: "Failed to save location",
  })
}

/**
 * Approve a candidate-generation job as the location's permanent
 * source_image_url. Also fires the Claude Sonnet vision caption inline to
 * populate `canonical_description`. Returns 200 with `canonicalDescription:
 * ""` on caption sub-failure (frontend retries via `recaptionLocation`).
 *
 * `expectedUpdatedAt` is the studio's optimistic-concurrency token. When
 * passed, the backend gates the UPDATE on the row's current `updated_at`
 * and returns 409 on mismatch — surfaced here as `ConcurrentModificationError`
 * so callers can refetch + re-stage (same shape as the 409 recovery on
 * `saveLocation`).
 */
export async function approveLocationMainImage(
  locationId: string,
  candidateJobId: string,
  expectedUpdatedAt?: string,
): Promise<{ readonly sourceImageUrl: string; readonly canonicalDescription: string }> {
  const body: Record<string, unknown> = { candidateJobId }
  if (expectedUpdatedAt) body.expectedUpdatedAt = expectedUpdatedAt
  return apiJson(
    `/v1/locations/${encodeURIComponent(locationId)}/approve-main-image`,
    { body, label: "Failed to approve location main image" },
  )
}

/**
 * Re-runs the Claude Sonnet vision caption against the location's existing
 * `source_image_url` and persists the result. Used by the studio's "retry
 * caption" affordance when `approveLocationMainImage` returned an empty
 * canonicalDescription. Throws on 502 caption_failed (caller should surface
 * a retry).
 */
export async function recaptionLocation(
  locationId: string,
): Promise<{ readonly canonicalDescription: string }> {
  return apiJson(
    `/v1/locations/${encodeURIComponent(locationId)}/llm-caption`,
    { label: "Failed to caption location" },
  )
}

/**
 * Un-archive a soft-deleted location (mirror of restoreCharacter). On name
 * collision with an active row, the backend auto-suffixes "(restored)" so
 * the returned name may differ from the original.
 */
export async function restoreLocation(
  locationId: string,
): Promise<{ id: string; name: string }> {
  return apiJson(
    `/v1/locations/${encodeURIComponent(locationId)}/restore`,
    { label: "Failed to restore location" },
  )
}

/**
 * Light batch-status poll for studio UIs (called every ~2s while assets are
 * generating). Returns at most 100 jobs — cross-user / non-existent ids are
 * silently omitted by the backend. Empty input short-circuits to no fetch.
 *
 * Distinct from `getBatchJobStatus`: this hits the GET /v1/jobs/status
 * endpoint (capped at 100, returns `{ jobs: [...] }`) and is the canonical
 * surface for studio batch polling.
 */
export async function getJobStatusBatch(
  jobIds: readonly string[],
): Promise<{
  jobs: ReadonlyArray<{ id: string; status: string; output_data: unknown }>
}> {
  if (jobIds.length === 0) return { jobs: [] }
  const ids = encodeURIComponent(jobIds.join(","))
  return apiJson(`/v1/jobs/status?ids=${ids}`, {
    method: "GET",
    label: "Failed to fetch batch job status",
  })
}

export async function deleteLocation(locationId: string): Promise<{ success: boolean; archived?: boolean }> {
  return apiJson(`/v1/locations/${encodeURIComponent(locationId)}`, {
    method: "DELETE",
    label: "Failed to archive location",
  })
}

/**
 * Permanent (hard) delete a soft-deleted location row. UI-only — the backend
 * route (`DELETE /v1/locations/:id?permanent=true`) is wired by Task 15 of the
 * Location Studio PR-2 plan and removes the DB row + R2-hosted assets.
 *
 * Intentionally NOT mirrored on the SDK surface (`@nodaro/client`) — the SDK's
 * `delete()` always soft-deletes so programmatic callers cannot accidentally
 * destroy data. Permanent-delete is reachable only from the `/library/locations`
 * archive view.
 */
export async function permanentDeleteLocation(
  locationId: string,
): Promise<{ success: boolean; permanent: boolean }> {
  return apiJson(
    `/v1/locations/${encodeURIComponent(locationId)}?permanent=true`,
    { method: "DELETE", label: "Failed to permanently delete location" },
  )
}

/**
 * List of archived (soft-deleted) locations for the library's "Archived" tab.
 * Backed by `GET /v1/locations?archived=true` (extended in PR-1).
 */
export async function listArchivedLocations(
  projectId?: string,
): Promise<{ locations: DbLocation[] }> {
  const qs = new URLSearchParams({ archived: "true" })
  if (projectId) qs.set("projectId", projectId)
  return apiJson(`/v1/locations?${qs.toString()}`, {
    method: "GET",
    label: "Failed to load archived locations",
  })
}

export interface DbLocation {
  id: string
  userId: string | null
  nodeId: string
  projectId: string | null
  name: string
  description: string | null
  category: string | null
  style: string | null
  sourceImageUrl: string | null
  timeOfDay: { name: string; url: string }[]
  weather: { name: string; url: string }[]
  angles: { name: string; url: string }[]
  // Phase 2 — Location Studio additions
  lighting: { name: string; url: string }[]
  seasons: { name: string; url: string }[]
  atmosphereMotions: { name: string; url: string }[]
  referencePhotos: { kind: string; url: string }[]
  canonicalDescription: string
  styleLock: boolean
  // Reference-sheet buckets (migration 200) — emitted by both the list and
  // GET-by-id routes via `toCamel`. `sheets` holds composited reference sheets;
  // `detailCloseups` holds macro close-up panels. Locations have no
  // `outfitVariations` (character-only dimension).
  sheets?: ReferenceSheet[]
  detailCloseups?: unknown[]
  /** Phase 2 #7 — timestamp the user consented that reference photos don't
   *  include PII without rights. NULL = no consent recorded yet (UI shows
   *  the consent checkbox); non-NULL = consent given (UI hides checkbox). */
  piiConsentAt?: string | null
  deletedAt?: string | null
  createdAt: string
  updatedAt: string
  // Only populated by `getLocationById` (the GET single-row route); the list
  // route omits this. In-flight generation jobs targeting this location so the
  // Studio can re-attach spinners on reopen + the canvas can clear stale
  // running-status badges when no jobs remain.
  pendingJobs?: { jobId: string; assetType: string; name: string; status: string }[]
}

export async function getLocations(projectId?: string, userId?: string): Promise<{ locations: DbLocation[] }> {
  const params = new URLSearchParams()
  if (projectId) params.set("projectId", projectId)
  if (userId) params.set("userId", userId)
  const qs = params.toString()
  return apiJson(`/v1/locations${qs ? `?${qs}` : ""}`, {
    method: "GET",
    label: "Failed to fetch locations",
  })
}

export async function getLocationById(locationId: string): Promise<DbLocation | null> {
  const res = await fetch(`${API_BASE_URL}/v1/locations/${encodeURIComponent(locationId)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
  })
  if (res.status === 404) {
    return null
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to fetch location")
  }
  return res.json()
}

export async function splitImage(data: {
  imageUrl: string
  gridCols: number
  gridRows: number
  names: string[]
}): Promise<{ images: { name: string; url: string }[] }> {
  return apiJson("/v1/split-image", {
    body: data,
    workflowId: true,
    label: "Failed to split image",
  })
}

export interface GenerateVideoOptions {
  startFrameUrl: string
  endFrameUrl?: string     // Optional end frame (for providers that support it)
  audioUrl?: string        // Optional audio track to merge
  prompt?: string
  provider?: string
  generateAudio?: boolean
  duration?: number
  mode?: string            // Kling 3.0 quality mode (pro/std)
  sound?: boolean          // Kling 2.6 / 3.0 sound effects
  negativePrompt?: string  // Kling Turbo / Kling Master negative prompt
  cfgScale?: number        // Kling Turbo / Kling Master cfg_scale (0-1)
  aspectRatio?: string     // Kling 3.0 / Seedance aspect ratio
  multiShot?: boolean      // Kling 3.0 multi-shot mode
  shots?: Array<{ prompt: string; duration: number }>     // Kling 3.0 shot list
  elements?: Array<{ name: string; description: string; type: "image" | "video"; urls: string[] }>  // Kling 3.0 elements
  resolution?: string      // Video resolution (various providers)
  grokMode?: string        // Grok I2V mode: fun/normal/spicy
  videoSize?: string       // Video size/quality setting
  seed?: number            // Seed (Wan Turbo, Bytedance)
  cameraFixed?: boolean    // Camera fixed (Bytedance, Seedance)
  referenceImageUrls?: string[]  // Grok I2V (up to 6) / VEO reference mode (up to 3) / Seedance 2 (up to 9)
  referenceVideoUrls?: string[]  // Seedance 2 (up to 3 reference videos)
  referenceAudioUrls?: string[]  // Seedance 2 (up to 3 reference audio files)
  webSearch?: boolean            // Seedance 2 (required field)
  nsfwChecker?: boolean          // Seedance 2 (optional content filter toggle)
  generationType?: string        // VEO: REFERENCE_2_VIDEO
  seedance2InputMode?: "frames" | "references"
  // VEO 3.x: opt out of KIE's auto-translate-to-English (default true).
  enableTranslation?: boolean
  // Smart-loop-cut post-process. Worker runs PSNR-based loop search after
  // generation and trims clip at the best loop point. Replaces legacy
  // `autoLoopTrim` boolean (VEO-3.1-only, fixed 8 frames).
  loopTrim?: {
    enabled: boolean
    framesToTest?: number
    quality?: "lossless" | "precise"
  }
  /** Gemini V2V: trim start/end seconds applied to the reference video before
   *  it is sent to the model. Forwarded to backend POST /v1/generate-video. */
  videoTrimStart?: number
  videoTrimEnd?: number
  /** When true, the backend appends the character's canonical_description +
   *  identity-preserve suffix to the prompt. Requires attachToCharacterId. */
  injectCharacterContext?: boolean
  attachToCharacterId?: string
  /** When set (a non-empty variant label) alongside attachToCharacterId, the
   *  backend appends the completed clip to the character's
   *  reference_videos_by_variant[<label>] on job completion (job-finalize).
   *  Independent of injectCharacterContext — saving the result and injecting
   *  identity are separate opt-ins. */
  attachReferenceVideoVariant?: string
  userId?: string
  /** Per-click idempotency key. Same UUID across retries of one click;
   *  fresh UUID for the next click. See generateIdempotencyKey(). */
  idempotencyKey?: string
}

export async function generateVideo(options: GenerateVideoOptions): Promise<{ jobId: string }>
export async function generateVideo(imageUrl: string, prompt?: string, provider?: string, generateAudio?: boolean, duration?: number, userId?: string): Promise<{ jobId: string }>
export async function generateVideo(
  imageUrlOrOptions: string | GenerateVideoOptions,
  prompt?: string,
  provider?: string,
  generateAudio?: boolean,
  duration?: number,
  userId?: string
): Promise<{ jobId: string }> {
  let body: Record<string, unknown>

  // Handle both old and new API signatures
  if (typeof imageUrlOrOptions === "object") {
    const opts = imageUrlOrOptions
    body = {
      imageUrl: opts.startFrameUrl || undefined,
      endFrameUrl: opts.endFrameUrl || undefined,
      audioUrl: opts.audioUrl || undefined,
      prompt: opts.prompt,
      provider: opts.provider,
      generateAudio: opts.generateAudio,
      duration: opts.duration,
      mode: opts.mode,
      sound: opts.sound,
      negativePrompt: opts.negativePrompt,
      cfgScale: opts.cfgScale,
      aspectRatio: opts.aspectRatio,
      multiShot: opts.multiShot,
      shots: opts.shots,
      elements: opts.elements,
      resolution: opts.resolution,
      grokMode: opts.grokMode,
      videoSize: opts.videoSize,
      seed: opts.seed,
      cameraFixed: opts.cameraFixed,
      referenceImageUrls: opts.referenceImageUrls,
      referenceVideoUrls: opts.referenceVideoUrls,
      referenceAudioUrls: opts.referenceAudioUrls,
      webSearch: opts.webSearch,
      nsfwChecker: opts.nsfwChecker,
      generationType: opts.generationType,
      seedance2InputMode: opts.seedance2InputMode,
      enableTranslation: opts.enableTranslation,
      loopTrim: opts.loopTrim,
      videoTrimStart: opts.videoTrimStart,
      videoTrimEnd: opts.videoTrimEnd,
    }
    if (opts.injectCharacterContext) {
      body.injectCharacterContext = true
    }
    if (opts.attachToCharacterId) {
      body.attachToCharacterId = opts.attachToCharacterId
    }
    if (opts.attachReferenceVideoVariant) {
      body.attachReferenceVideoVariant = opts.attachReferenceVideoVariant
    }
    if (opts.userId) {
      body.userId = opts.userId
    }
  } else {
    // Legacy signature for backward compatibility
    body = { imageUrl: imageUrlOrOptions, prompt, provider, generateAudio, duration }
    if (userId) {
      body.userId = userId
    }
  }

  const idempotencyKey =
    typeof imageUrlOrOptions === "string" ? undefined : imageUrlOrOptions.idempotencyKey
  return apiJson("/v1/generate-video", {
    body,
    workflowId: true,
    idempotencyKey,
    label: "Failed to start video generation",
  })
}

export async function videoToVideo(videoUrl: string, prompt?: string, provider?: string, userId?: string, options?: {
  duration?: string
  resolution?: string
  audio?: boolean
  multiShots?: boolean
  aspectRatio?: string
  seed?: number
  referenceImageUrl?: string
  // Wan video edit (wan-videoedit) params
  negativePrompt?: string
  videoEditDuration?: string
  audioSetting?: string
  promptExtend?: boolean
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl, prompt, provider, ...options }
  if (userId) body.userId = userId
  return apiJson("/v1/video-to-video", {
    body,
    workflowId: true,
    label: "Failed to start video-to-video generation",
  })
}

export async function textToVideo(prompt: string, provider?: string, userId?: string, options?: {
  duration?: number
  mode?: string
  sound?: boolean
  negativePrompt?: string
  cfgScale?: number
  aspectRatio?: string
  multiShot?: boolean
  shots?: Array<{ prompt: string; duration: number }>
  elements?: Array<{ name: string; description: string; type: "image" | "video"; urls: string[] }>
  seed?: number
  // Seedance 2.0 options
  resolution?: string
  generateAudio?: boolean
  referenceImageUrls?: string[]
  referenceVideoUrls?: string[]
  referenceAudioUrls?: string[]
  webSearch?: boolean
  nsfwChecker?: boolean
  // VEO 3.x: opt out of KIE's auto-translate-to-English (default true).
  enableTranslation?: boolean
  /** Per-click idempotency key. See generateIdempotencyKey(). */
  idempotencyKey?: string
}): Promise<{ jobId: string }> {
  const { idempotencyKey, ...bodyOptions } = options ?? {}
  const body: Record<string, unknown> = { prompt, provider, ...bodyOptions }
  if (userId) {
    body.userId = userId
  }
  return apiJson("/v1/text-to-video", {
    body,
    workflowId: true,
    idempotencyKey,
    label: "Failed to start text-to-video generation",
  })
}

export async function textToSpeech(
  text: string,
  voice?: string,
  provider?: string,
  userId?: string,
  options?: {
    stability?: number
    similarityBoost?: number
    style?: number
    speed?: number
    languageCode?: string
    voiceType?: "premade" | "custom" | "library"
  }
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { text, voice, provider }
  if (userId) body.userId = userId
  if (options?.stability != null) body.stability = options.stability
  if (options?.similarityBoost != null) body.similarityBoost = options.similarityBoost
  if (options?.style != null) body.style = options.style
  if (options?.speed != null) body.speed = options.speed
  if (options?.languageCode) body.languageCode = options.languageCode
  if (options?.voiceType) body.voiceType = options.voiceType
  return apiJson("/v1/text-to-speech", {
    body,
    workflowId: true,
    label: "Failed to start text-to-speech generation",
  })
}

export async function generateScriptApi(params: {
  prompt: string
  sceneCount?: number
  tone?: string
  targetDuration?: number
  provider?: string
  llmModel?: string
  userId?: string
}): Promise<{ jobId: string }> {
  return apiJson("/v1/generate-script", {
    body: params,
    workflowId: true,
    label: "Failed to start script generation",
  })
}

export async function combineVideos(
  videoUrls: string[],
  transition: string = "cut",
  transitionDuration: number = 0.5,
  audioMode: "keep" | "crossfade" | "remove" = "crossfade",
  userId?: string,
  trimStartFrames?: number,
  trimEndFrames?: number,
  /** Same length and order as videoUrls; included only when ALL entries are positive numbers. */
  upstreamDurations?: ReadonlyArray<number | undefined>,
  audioCrossfadeCurve?: string,
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrls, transition, transitionDuration, audioMode }
  if (userId) {
    body.userId = userId
  }
  if (trimStartFrames && trimStartFrames > 0) body.trimStartFrames = trimStartFrames
  if (trimEndFrames && trimEndFrames > 0) body.trimEndFrames = trimEndFrames
  if (audioCrossfadeCurve) body.audioCrossfadeCurve = audioCrossfadeCurve
  if (
    upstreamDurations &&
    upstreamDurations.length === videoUrls.length &&
    upstreamDurations.every((d) => typeof d === "number" && d > 0)
  ) {
    body.upstreamDurations = upstreamDurations
  }
  return apiJson("/v1/combine-videos", {
    body,
    workflowId: true,
    label: "Failed to start video combination",
  })
}

export async function mergeVideoAudioApi(
  videoUrl: string,
  audioTracks: { url: string; startTime: number; volume?: number; sourceType?: "audio" | "video" }[],
  backgroundVolume?: number,
  keepOriginalAudio?: boolean,
  userId?: string,
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl, audioTracks, backgroundVolume, keepOriginalAudio }
  if (userId) {
    body.userId = userId
  }
  return apiJson("/v1/merge-video-audio", {
    body,
    workflowId: true,
    label: "Failed to start merge-video-audio",
  })
}

export async function trimAudioApi(videoUrl: string, audioFormat?: string, userId?: string, startTime?: number, endTime?: number): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl, audioFormat, startTime, endTime }
  if (userId) {
    body.userId = userId
  }
  return apiJson("/v1/trim-audio", {
    body,
    workflowId: true,
    label: "Failed to start trim-audio",
  })
}

export async function splitMediaApi(opts: { videoUrl?: string; audioUrl?: string; chunkDuration?: number; audioFormat?: string; userId?: string }): Promise<{ jobId: string }> {
  const { userId, ...rest } = opts
  const body: Record<string, unknown> = { ...rest }
  if (userId) {
    body.userId = userId
  }
  return apiJson("/v1/split-media", {
    body,
    workflowId: true,
    label: "Failed to start split-media",
  })
}

export async function extractAudioApi(videoUrl: string, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl }
  if (userId) {
    body.userId = userId
  }
  return apiJson("/v1/extract-audio", {
    body,
    workflowId: true,
    label: "Failed to start extract-audio",
  })
}

export async function removeAudioApi(videoUrl: string, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl }
  if (userId) {
    body.userId = userId
  }
  return apiJson("/v1/remove-audio", {
    body,
    workflowId: true,
    label: "Failed to start remove-audio",
  })
}

export async function trimVideoApi(
  videoUrl: string,
  startTime: number,
  endTime?: number,
  userId?: string,
  outputSilentVideo?: boolean,
  extras?: {
    /** Frame-based trim. When set, overrides startTime/endTime. */
    trimStartFrames?: number
    trimEndFrames?: number
    /** Seconds-mirror of trim*Frames. When set, overrides startTime/endTime. */
    trimStartSeconds?: number
    trimEndSeconds?: number
    /** Keep only the first/last N seconds (overrides start/end). */
    keepFirstSeconds?: number
    keepLastSeconds?: number
    /** Smart loop cut: worker picks the trailing frame closest to frame 0. */
    smartLoopCut?: boolean
    smartLoopCutLookback?: number
    /** Trim mode for credit estimator (worker dispatches based on which
     *  fields are set, not this). */
    trimMode?: "time" | "seconds" | "keep-first-seconds" | "keep-last-seconds" | "frames" | "smart-loop-cut"
    /** Upstream video duration (seconds) for credit estimator. */
    upstreamDuration?: number
  },
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl, startTime, endTime, outputSilentVideo }
  if (extras?.trimStartFrames != null) body.trimStartFrames = extras.trimStartFrames
  if (extras?.trimEndFrames != null) body.trimEndFrames = extras.trimEndFrames
  if (extras?.trimStartSeconds != null) body.trimStartSeconds = extras.trimStartSeconds
  if (extras?.trimEndSeconds != null) body.trimEndSeconds = extras.trimEndSeconds
  if (extras?.keepFirstSeconds != null) body.keepFirstSeconds = extras.keepFirstSeconds
  if (extras?.keepLastSeconds != null) body.keepLastSeconds = extras.keepLastSeconds
  if (extras?.smartLoopCut) body.smartLoopCut = true
  if (extras?.smartLoopCutLookback != null) body.smartLoopCutLookback = extras.smartLoopCutLookback
  if (extras?.trimMode) body.trimMode = extras.trimMode
  if (extras?.upstreamDuration != null && extras.upstreamDuration > 0) {
    body.upstreamDuration = extras.upstreamDuration
  }
  if (userId) {
    body.userId = userId
  }
  return apiJson("/v1/trim-video", {
    body,
    workflowId: true,
    label: "Failed to start trim-video",
  })
}

export async function extractFrameApi(
  videoUrl: string,
  mode: "first" | "last" | "timestamp" | "frame-index" | "frame-from-end" | "keyframe" = "first",
  timestamp?: number,
  userId?: string,
  extras?: {
    frameIndex?: number
    framesFromEnd?: number
  },
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl, mode }
  if (timestamp !== undefined) body.timestamp = timestamp
  if (extras?.frameIndex != null) body.frameIndex = extras.frameIndex
  if (extras?.framesFromEnd != null) body.framesFromEnd = extras.framesFromEnd
  if (userId) body.userId = userId
  return apiJson("/v1/extract-frame", {
    body,
    workflowId: true,
    label: "Failed to extract frame",
  })
}

export async function transcodeVideoApi(videoUrl: string, codec?: string, crf?: number, resolution?: string, audioBitrate?: string, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl, codec, crf, resolution, audioBitrate }
  if (userId) {
    body.userId = userId
  }
  return apiJson("/v1/transcode-video", {
    body,
    workflowId: true,
    label: "Failed to start transcode-video",
  })
}

export async function speedRampApi(
  videoUrl: string,
  speed: number,
  adjustAudio?: boolean,
  userId?: string,
  extras?: {
    reverse?: boolean
    audioMode?: "pitch-preserve" | "pitch-shift" | "drop"
    quality?: "fast" | "smooth"
    ramps?: ReadonlyArray<{ start: number; end: number; speed: number }>
  },
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl, speed }
  if (adjustAudio !== undefined) body.adjustAudio = adjustAudio
  if (extras?.reverse !== undefined) body.reverse = extras.reverse
  if (extras?.audioMode !== undefined) body.audioMode = extras.audioMode
  if (extras?.quality !== undefined) body.quality = extras.quality
  if (extras?.ramps && extras.ramps.length > 0) body.ramps = extras.ramps
  if (userId) body.userId = userId
  return apiJson("/v1/speed-ramp", {
    body,
    workflowId: true,
    label: "Failed to start speed-ramp",
  })
}

export async function loopVideoApi(
  videoUrl: string,
  mode: "repeat" | "duration",
  repeatCount?: number,
  targetDuration?: number,
  userId?: string,
  extras?: {
    /** Smart-cut preprocess: trim source to its cleanest loop boundary
     *  before concatenating N copies. */
    smartLoopCutBeforeRepeat?: boolean
    smartLoopCutLookback?: number
    /** Upstream video duration (seconds) for credit estimator. */
    upstreamDuration?: number
  },
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl, mode, repeatCount, targetDuration }
  if (extras?.smartLoopCutBeforeRepeat) body.smartLoopCutBeforeRepeat = true
  if (extras?.smartLoopCutLookback != null) body.smartLoopCutLookback = extras.smartLoopCutLookback
  if (extras?.upstreamDuration != null && extras.upstreamDuration > 0) {
    body.upstreamDuration = extras.upstreamDuration
  }
  if (userId) {
    body.userId = userId
  }
  return apiJson("/v1/loop-video", {
    body,
    workflowId: true,
    label: "Failed to start loop-video",
  })
}

export async function fadeVideoApi(videoUrl: string, fadeIn: boolean, fadeInDuration: number, fadeOut: boolean, fadeOutDuration: number, color: "black" | "white", userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl, fadeIn, fadeInDuration, fadeOut, fadeOutDuration, color }
  if (userId) {
    body.userId = userId
  }
  return apiJson("/v1/fade-video", {
    body,
    workflowId: true,
    label: "Failed to start fade-video",
  })
}

export async function resizeVideoApi(videoUrl: string, targetAspect: string, method: string, padColor?: string, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl, targetAspect, method, padColor }
  if (userId) {
    body.userId = userId
  }
  return apiJson("/v1/resize-video", {
    body,
    workflowId: true,
    label: "Failed to start resize-video",
  })
}

export async function socialMediaFormatApi(
  mediaUrl: string,
  mediaType: "image" | "video",
  specKey: string,
  width: number,
  height: number,
  method: string,
  padColor?: string,
  userId?: string,
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { mediaUrl, mediaType, specKey, width, height, method, padColor }
  if (userId) {
    body.userId = userId
  }
  return apiJson("/v1/social-media-format", {
    body,
    workflowId: true,
    label: "Failed to start social-media-format",
  })
}

export async function adjustVolumeApi(inputUrl: string, inputType: "audio" | "video", volume?: number, normalize?: boolean, fadeIn?: number, fadeOut?: number, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { volume, normalize, fadeIn, fadeOut }
  if (inputType === "video") {
    body.videoUrl = inputUrl
  } else {
    body.audioUrl = inputUrl
  }
  if (userId) {
    body.userId = userId
  }
  return apiJson("/v1/adjust-volume", {
    body,
    workflowId: true,
    label: "Failed to start adjust-volume",
  })
}

export async function addCaptionsApi(videoUrl: string, text: string, style?: string, position?: string, fontSize?: number, color?: string, backgroundColor?: string, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { videoUrl, text, style, position, fontSize, color, backgroundColor }
  if (userId) {
    body.userId = userId
  }
  return apiJson("/v1/add-captions", {
    body,
    workflowId: true,
    label: "Failed to start add-captions",
  })
}

export async function mixAudioApi(audioUrls: string[], trackVolumes?: number[], userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { audioUrls }
  if (trackVolumes?.length) {
    body.trackVolumes = trackVolumes
  }
  if (userId) {
    body.userId = userId
  }
  return apiJson("/v1/mix-audio", {
    body,
    workflowId: true,
    label: "Failed to start mix-audio",
  })
}

export async function combineAudioApi(params: {
  segments: Array<{ url: string; startTime?: number; endTime?: number }>
  userId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { segments: params.segments }
  if (params.userId) {
    body.userId = params.userId
  }
  return apiJson("/v1/combine-audio", {
    body,
    workflowId: true,
    label: "Failed to start combine audio",
  })
}

export function getImageProxyUrl(url: string): string {
  return `${API_BASE_URL}/v1/image-proxy?url=${encodeURIComponent(url)}`
}

export async function uploadImage(file: File | Blob, userId?: string): Promise<{ url: string }> {
  const resolvedUserId = userId ?? await getCurrentUserId()
  const asFile = file instanceof File
    ? file
    : new File([file], "crop.png", { type: file.type || "image/png" })
  const result = await uploadFile(asFile, resolvedUserId)
  return { url: result.url }
}

export async function uploadAudio(file: File, userId?: string): Promise<{ url: string }> {
  const resolvedUserId = userId ?? await getCurrentUserId()
  const result = await uploadFile(file, resolvedUserId)
  return { url: result.url }
}

export interface UploadResult {
  readonly url: string
  readonly thumbnailUrl: string | null
  readonly assetId: string | null
  readonly category: "image" | "video" | "audio"
  readonly filename: string
  readonly mimeType: string
  readonly sizeBytes: number
  readonly metadata: {
    readonly width?: number
    readonly height?: number
    readonly format?: string
    readonly durationSeconds?: number
    readonly codec?: string
    readonly sampleRate?: number
  } | null
  readonly r2Key: string
}

export async function uploadFile(
  file: File,
  userId?: string,
): Promise<UploadResult> {
  const formData = new FormData()
  formData.append("file", file)
  if (userId) {
    formData.append("userId", userId)
  }

  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/v1/upload`, {
    method: "POST",
    headers: authHeaders,
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    if (err?.error?.code === "storage_limit_exceeded") {
      throw new StorageExceededError(
        err.error.message ?? "Storage limit exceeded",
        err.error.usedBytes ?? 0,
        err.error.quotaBytes ?? 0,
        err.error.remainingBytes ?? 0,
        err.error.tier ?? "free",
      )
    }
    const message = err?.error?.message ?? "Upload failed"
    throw new Error(message)
  }
  const json = await res.json()
  return json.data ?? json
}

// ---------- Media Editor ----------

export interface MediaProcessParams {
  sourceUrl: string
  type: "video" | "audio"
  crop?: { x: number; y: number; width: number; height: number }
  trim?: { startTime: number; endTime: number }
  format?: string
}

export interface MediaProcessResult {
  url: string
  thumbnailUrl: string | null
  assetId: string | null
  metadata: Record<string, unknown>
  sizeBytes: number
  mimeType: string
}

export async function processMedia(params: MediaProcessParams): Promise<MediaProcessResult> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/v1/media/process`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? "Media processing failed")
  }
  const json = await res.json()
  return json.data
}

export async function downloadYouTubeAudio(url: string): Promise<{ url: string; thumbnailUrl: string | null }> {
  return apiJson("/v1/youtube-audio", {
    body: { url },
    label: "Failed to extract audio from video",
  })
}

export async function startVideoDownload(url: string): Promise<{ downloadId: string }> {
  return apiJson("/v1/download-video", {
    body: { url },
    label: "Failed to start download. The video may be private or require login.",
  })
}

export interface DownloadProgressEvent {
  phase: "downloading" | "processing" | "uploading" | "completed" | "failed"
  percent: number
  videoUrl?: string
  thumbnailUrl?: string
  error?: string
}

export function subscribeToDownloadProgress(
  downloadId: string,
  onProgress: (event: DownloadProgressEvent) => void,
): () => void {
  const url = `${API_BASE_URL}/v1/download-video/progress/${downloadId}`
  const eventSource = new EventSource(url)

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as DownloadProgressEvent
      onProgress(data)
      if (data.phase === "completed" || data.phase === "failed") {
        eventSource.close()
      }
    } catch {
      // Ignore parse errors
    }
  }

  eventSource.onerror = () => {
    eventSource.close()
    onProgress({ phase: "failed", percent: 0, error: "Connection lost" })
  }

  return () => eventSource.close()
}

export async function textToAudioApi(prompt: string, provider?: string, duration?: number, userId?: string, options?: { loop?: boolean; promptInfluence?: number }): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { prompt }
  if (provider) body.provider = provider
  if (duration !== undefined) body.duration = duration
  if (userId) body.userId = userId
  if (options?.loop != null) body.loop = options.loop
  if (options?.promptInfluence != null) body.promptInfluence = options.promptInfluence
  return apiJson("/v1/text-to-audio", {
    body,
    workflowId: true,
    label: "Failed to start audio generation",
  })
}

export async function audioIsolationApi(audioUrl: string, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { audioUrl }
  if (userId) body.userId = userId
  return apiJson("/v1/audio-isolation", {
    body,
    workflowId: true,
    label: "Failed to start audio isolation",
  })
}

export async function textToDialogueApi(
  dialogue: Array<{ text: string; voice: string }>,
  userId?: string,
  stability?: number,
  languageCode?: string,
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { dialogue }
  if (userId) body.userId = userId
  if (stability != null) body.stability = stability
  if (languageCode) body.languageCode = languageCode
  return apiJson("/v1/text-to-dialogue", {
    body,
    workflowId: true,
    label: "Failed to start dialogue generation",
  })
}

export async function voiceChangerApi(audioUrl: string | undefined, voiceId: string, userId?: string, stability?: number, similarityBoost?: number, style?: number, removeBackgroundNoise?: boolean, videoUrl?: string): Promise<{ jobId: string }> {
  // Audio mode (audioUrl) or video mode (videoUrl → revoiced video + audio).
  // Video wins server-side when both are sent; the caller only sends one.
  const body: Record<string, unknown> = { voiceId }
  if (audioUrl) body.audioUrl = audioUrl
  if (videoUrl) body.videoUrl = videoUrl
  if (userId) body.userId = userId
  if (stability != null) body.stability = stability
  if (similarityBoost != null) body.similarityBoost = similarityBoost
  if (style != null) body.style = style
  if (removeBackgroundNoise != null) body.removeBackgroundNoise = removeBackgroundNoise
  return apiJson("/v1/voice-changer", {
    body,
    workflowId: true,
    label: "Failed to start voice changer",
  })
}

export async function dubbingApi(audioUrl: string, targetLanguage: string, userId?: string, sourceLanguage?: string, numSpeakers?: number): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { audioUrl, targetLanguage }
  if (userId) body.userId = userId
  if (sourceLanguage) body.sourceLanguage = sourceLanguage
  if (numSpeakers) body.numSpeakers = numSpeakers
  return apiJson("/v1/dubbing", {
    body,
    workflowId: true,
    label: "Failed to start dubbing",
  })
}

export async function voiceRemixApi(text: string, voiceDescription: string, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { text, voiceDescription }
  if (userId) body.userId = userId
  return apiJson("/v1/voice-remix", {
    body,
    workflowId: true,
    label: "Failed to start voice remix",
  })
}

export async function voiceDesignApi(
  text: string,
  voiceDescription: string,
  options?: {
    model?: string
    loudness?: number
    guidanceScale?: number
    seed?: number
    quality?: number
    shouldEnhance?: boolean
  },
  userId?: string,
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { text, voiceDescription, ...options }
  if (userId) body.userId = userId
  return apiJson("/v1/voice-design", {
    body,
    workflowId: true,
    label: "Failed to start voice design",
  })
}

export async function forcedAlignmentApi(audioUrl: string, transcript: string, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { audioUrl, transcript }
  if (userId) body.userId = userId
  return apiJson("/v1/forced-alignment", {
    body,
    workflowId: true,
    label: "Failed to start forced alignment",
  })
}

export async function sendWebhookOutput(data: { url: string; payload: Record<string, unknown> }): Promise<{ jobId: string; success: boolean; statusCode: number; responseBody: string }> {
  return apiJson("/v1/webhook-output/send", {
    body: data,
    workflowId: true,
    label: "Failed to send webhook output",
  })
}

export async function webScrape(params: {
  actor: import("@nodaro/shared").ScraperActorId
  url?: string
  mode?: "page" | "site"
  query?: string
  maxResults?: number
  countryCode?: string
  target?: string
  resultsLimit?: number
  workflowId?: string
}): Promise<{ jobId: string; json: unknown }> {
  return apiJson("/v1/web-scrape", {
    body: params,
    workflowId: true,
    label: "Web scrape failed",
  })
}

export async function sunoGenerateApi(params: {
  prompt: string
  model?: string
  lyrics?: string
  style?: string
  title?: string
  negativeStyle?: string
  vocalGender?: string
  styleWeight?: number
  weirdnessConstraint?: number
  audioWeight?: number
  customMode?: boolean
  instrumental?: boolean
  personaId?: string
  personaModel?: "voice_persona" | "style_persona"
  userId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { prompt: params.prompt }
  if (params.model) body.model = params.model
  if (params.lyrics) body.lyrics = params.lyrics
  if (params.style) body.style = params.style
  if (params.title) body.title = params.title
  if (params.negativeStyle) body.negativeStyle = params.negativeStyle
  if (params.vocalGender) body.vocalGender = params.vocalGender
  if (params.styleWeight != null) body.styleWeight = params.styleWeight
  if (params.weirdnessConstraint != null) body.weirdnessConstraint = params.weirdnessConstraint
  if (params.audioWeight != null) body.audioWeight = params.audioWeight
  body.customMode = params.customMode ?? false
  body.instrumental = params.instrumental ?? false
  if (params.personaId) {
    body.personaId = params.personaId
    body.personaModel = params.personaModel ?? "voice_persona"
  }
  if (params.userId) body.userId = params.userId
  return apiJson("/v1/suno/generate", {
    body,
    workflowId: true,
    label: "Failed to start Suno generation",
  })
}

export async function sunoCoverApi(params: {
  prompt: string
  uploadUrl: string
  model?: string
  lyrics?: string
  style?: string
  title?: string
  negativeStyle?: string
  vocalGender?: string
  customMode?: boolean
  instrumental?: boolean
  personaId?: string
  personaModel?: "voice_persona" | "style_persona"
  userId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { prompt: params.prompt, uploadUrl: params.uploadUrl }
  if (params.model) body.model = params.model
  if (params.lyrics) body.lyrics = params.lyrics
  if (params.style) body.style = params.style
  if (params.title) body.title = params.title
  if (params.negativeStyle) body.negativeStyle = params.negativeStyle
  if (params.vocalGender) body.vocalGender = params.vocalGender
  body.customMode = params.customMode ?? false
  body.instrumental = params.instrumental ?? false
  if (params.personaId) {
    body.personaId = params.personaId
    body.personaModel = params.personaModel ?? "voice_persona"
  }
  if (params.userId) body.userId = params.userId
  return apiJson("/v1/suno/cover", {
    body,
    workflowId: true,
    label: "Failed to start Suno cover",
  })
}

export async function sunoExtendApi(params: {
  audioId: string
  defaultParamFlag?: boolean
  prompt?: string
  model?: string
  style?: string
  title?: string
  continueAt?: number
  negativeStyle?: string
  vocalGender?: string
  styleWeight?: number
  weirdnessConstraint?: number
  audioWeight?: number
  personaId?: string
  personaModel?: "voice_persona" | "style_persona"
  userId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = {
    audioId: params.audioId,
    defaultParamFlag: params.defaultParamFlag ?? true,
    model: params.model || "V5",
  }
  if (params.prompt) body.prompt = params.prompt
  if (params.style) body.style = params.style
  if (params.title) body.title = params.title
  if (params.continueAt != null) body.continueAt = params.continueAt
  if (params.negativeStyle) body.negativeStyle = params.negativeStyle
  if (params.vocalGender) body.vocalGender = params.vocalGender
  if (params.styleWeight != null) body.styleWeight = params.styleWeight
  if (params.weirdnessConstraint != null) body.weirdnessConstraint = params.weirdnessConstraint
  if (params.audioWeight != null) body.audioWeight = params.audioWeight
  if (params.personaId) {
    body.personaId = params.personaId
    body.personaModel = params.personaModel ?? "voice_persona"
  }
  if (params.userId) body.userId = params.userId
  return apiJson("/v1/suno/extend", {
    body,
    workflowId: true,
    label: "Failed to start Suno extend",
  })
}

export async function sunoLyricsApi(params: {
  prompt: string
  userId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { prompt: params.prompt }
  if (params.userId) body.userId = params.userId
  return apiJson("/v1/suno/lyrics", {
    body,
    workflowId: true,
    label: "Failed to start Suno lyrics generation",
  })
}

export async function sunoSeparateApi(params: {
  taskId: string
  audioId: string
  type?: "separate_vocal" | "split_stem"
  userId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { taskId: params.taskId, audioId: params.audioId }
  if (params.type) body.type = params.type
  if (params.userId) body.userId = params.userId
  return apiJson("/v1/suno/separate", {
    body,
    workflowId: true,
    label: "Failed to start Suno separate",
  })
}

export async function sunoMusicVideoApi(params: {
  taskId: string
  audioId: string
  userId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { taskId: params.taskId, audioId: params.audioId }
  if (params.userId) body.userId = params.userId
  return apiJson("/v1/suno/music-video", {
    body,
    workflowId: true,
    label: "Failed to start Suno music video",
  })
}

export async function sunoMashupApi(params: {
  uploadUrlList: [string, string]
  model?: string
  customMode?: boolean
  style?: string
  title?: string
  negativeStyle?: string
  vocalGender?: string
  userId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { uploadUrlList: params.uploadUrlList }
  if (params.model) body.model = params.model
  body.customMode = params.customMode ?? false
  if (params.style) body.style = params.style
  if (params.title) body.title = params.title
  if (params.negativeStyle) body.negativeStyle = params.negativeStyle
  if (params.vocalGender) body.vocalGender = params.vocalGender
  if (params.userId) body.userId = params.userId
  return apiJson("/v1/suno/mashup", {
    body,
    workflowId: true,
    label: "Failed to start Suno mashup",
  })
}

export async function sunoReplaceSectionApi(params: {
  taskId: string
  audioId: string
  infillStartS: number
  infillEndS: number
  prompt: string
  tags: string
  title?: string
  userId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { taskId: params.taskId, audioId: params.audioId, infillStartS: params.infillStartS, infillEndS: params.infillEndS, prompt: params.prompt, tags: params.tags }
  if (params.title) body.title = params.title
  if (params.userId) body.userId = params.userId
  return apiJson("/v1/suno/replace-section", {
    body,
    workflowId: true,
    label: "Failed to start Suno replace section",
  })
}

export async function sunoStyleBoostApi(params: {
  content: string
  userId?: string
}): Promise<{ text: string }> {
  const body: Record<string, unknown> = { content: params.content }
  if (params.userId) body.userId = params.userId
  return apiJson("/v1/suno/style-boost", {
    body,
    workflowId: true,
    label: "Failed to start Suno style boost",
  })
}

export async function sunoAddInstrumentalApi(params: {
  taskId: string
  audioId: string
  model?: string
  userId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { taskId: params.taskId, audioId: params.audioId }
  if (params.model) body.model = params.model
  if (params.userId) body.userId = params.userId
  return apiJson("/v1/suno/add-instrumental", {
    body,
    workflowId: true,
    label: "Failed to start Suno add instrumental",
  })
}

export async function sunoAddVocalsApi(params: {
  taskId: string
  audioId: string
  model?: string
  userId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { taskId: params.taskId, audioId: params.audioId }
  if (params.model) body.model = params.model
  if (params.userId) body.userId = params.userId
  return apiJson("/v1/suno/add-vocals", {
    body,
    workflowId: true,
    label: "Failed to start Suno add vocals",
  })
}

export async function sunoConvertWavApi(params: {
  taskId: string
  audioId: string
  userId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { taskId: params.taskId, audioId: params.audioId }
  if (params.userId) body.userId = params.userId
  return apiJson("/v1/suno/convert-wav", {
    body,
    workflowId: true,
    label: "Failed to start Suno WAV conversion",
  })
}

export async function sunoUploadExtendApi(params: {
  uploadUrl: string
  continueAt: number
  prompt?: string
  model?: string
  style?: string
  title?: string
  negativeStyle?: string
  vocalGender?: string
  defaultParamFlag?: boolean
  userId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = {
    uploadUrl: params.uploadUrl,
    continueAt: params.continueAt,
    defaultParamFlag: params.defaultParamFlag ?? true,
    model: params.model || "V5",
  }
  if (params.prompt) body.prompt = params.prompt
  if (params.style) body.style = params.style
  if (params.title) body.title = params.title
  if (params.negativeStyle) body.negativeStyle = params.negativeStyle
  if (params.vocalGender) body.vocalGender = params.vocalGender
  if (params.userId) body.userId = params.userId
  return apiJson("/v1/suno/upload-extend", {
    body,
    workflowId: true,
    label: "Failed to start Suno upload extend",
  })
}

// ───────────────────────────────────────────────────────────────────────────
// Suno Voice Persona — 2-stage human-in-the-loop API
// ───────────────────────────────────────────────────────────────────────────

export type SunoVoiceValidateStatus =
  | "wait_processing"
  | "processing_validate"
  | "processing_validate_fail"
  | "wait_validating"
  | "success"
  | "fail"

export type SunoVoiceRecordStatus = SunoVoiceValidateStatus

export interface SunoVoiceValidateInfo {
  taskId: string
  validateInfo: string | null
  status: SunoVoiceValidateStatus
  errorCode: number | null
  errorMessage: string
}

export interface SunoVoiceRecordInfo {
  taskId: string
  voiceId: string | null
  status: SunoVoiceRecordStatus
  errorCode: number | null
  errorMessage: string
}

export async function sunoVoiceValidateApi(params: {
  voiceUrl: string
  vocalStartS: number
  vocalEndS: number
  language?: "en"|"zh"|"es"|"fr"|"pt"|"de"|"ja"|"ko"|"hi"|"ru"
}): Promise<{ taskId: string }> {
  return apiJson("/v1/suno/voice/validate", {
    body: params,
    label: "Failed to start voice validation",
  })
}

export async function sunoVoiceValidateInfoApi(taskId: string): Promise<SunoVoiceValidateInfo> {
  return apiJson(`/v1/suno/voice/validate-info?taskId=${encodeURIComponent(taskId)}`, {
    method: "GET",
    label: "Failed to fetch validation info",
  })
}

export async function sunoVoiceRegenerateApi(taskId: string): Promise<{ taskId: string }> {
  return apiJson("/v1/suno/voice/regenerate", {
    body: { taskId },
    label: "Failed to regenerate validation phrase",
  })
}

export async function sunoVoiceGenerateApi(params: {
  taskId: string                       // validate taskId from stage 1
  verifyUrl: string                    // user's reading of the validation phrase
  voiceName?: string
  description?: string
  style?: string
  singerSkillLevel?: "beginner"|"intermediate"|"advanced"|"professional"
}): Promise<{ jobId: string; kieTaskId: string }> {
  return apiJson("/v1/suno/voice/generate", {
    body: params,
    label: "Failed to start voice generation",
  })
}

export async function sunoVoiceRecordInfoApi(taskId: string): Promise<SunoVoiceRecordInfo> {
  return apiJson(`/v1/suno/voice/record-info?taskId=${encodeURIComponent(taskId)}`, {
    method: "GET",
    label: "Failed to fetch voice record info",
  })
}

export async function transcribeApi(audioUrl: string, provider?: string, language?: string, userId?: string, diarize?: boolean, tagAudioEvents?: boolean): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { audioUrl }
  if (provider) body.provider = provider
  if (language) body.language = language
  if (userId) body.userId = userId
  if (diarize != null) body.diarize = diarize
  if (tagAudioEvents != null) body.tagAudioEvents = tagAudioEvents
  return apiJson("/v1/transcribe", {
    body,
    workflowId: true,
    label: "Failed to start transcription",
  })
}

export async function imageToTextApi(
  imageUrl: string,
  detailLevel?: "brief" | "detailed" | "structured",
  customPrompt?: string,
  userId?: string,
  llmModel?: string,
): Promise<{ jobId: string; generatedText: string }> {
  const body: Record<string, unknown> = { imageUrl }
  if (detailLevel) body.detailLevel = detailLevel
  if (customPrompt) body.customPrompt = customPrompt
  if (userId) body.userId = userId
  if (llmModel) body.llmModel = llmModel
  return apiJson("/v1/image-to-text/describe", {
    body,
    workflowId: true,
    label: "Failed to describe image",
  })
}

export async function speechToVideoApi(opts: {
  imageUrl: string
  audioUrl: string
  prompt: string
  resolution?: string
  negativePrompt?: string
  seed?: number
  numFrames?: number
  fps?: number
  inferenceSteps?: number
  guidanceScale?: number
  shift?: number
  userId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = {
    imageUrl: opts.imageUrl,
    audioUrl: opts.audioUrl,
    prompt: opts.prompt,
  }
  if (opts.resolution) body.resolution = opts.resolution
  if (opts.negativePrompt) body.negativePrompt = opts.negativePrompt
  if (opts.seed !== undefined) body.seed = opts.seed
  if (opts.numFrames !== undefined) body.numFrames = opts.numFrames
  if (opts.fps !== undefined) body.fps = opts.fps
  if (opts.inferenceSteps !== undefined) body.inferenceSteps = opts.inferenceSteps
  if (opts.guidanceScale !== undefined) body.guidanceScale = opts.guidanceScale
  if (opts.shift !== undefined) body.shift = opts.shift
  if (opts.userId) body.userId = opts.userId
  return apiJson("/v1/speech-to-video", {
    body,
    workflowId: true,
    label: "Failed to start speech-to-video generation",
  })
}

/** TTS engine override as stored on the node (camelCase value fields). */
type AiAvatarTtsEngine =
  | {
      engine_type: "elevenlabs"
      model?: "eleven_multilingual_v2" | "eleven_turbo_v2_5" | "eleven_flash_v2_5" | "eleven_v3"
      stability?: number
      similarityBoost?: number
      style?: number
      useSpeakerBoost?: boolean
    }
  | { engine_type: "fish"; model?: "s1" | "s2-pro"; stability?: number; similarity?: number }
  | { engine_type: "starfish" }

export async function runAiAvatar(input: {
  avatarSource?: "avatar" | "image"
  engine?: "avatar-v" | "avatar-iv"
  avatarId?: string
  imageUrl?: string
  speechMode: "text" | "audio"
  script?: string
  voiceId?: string
  voiceSpeed?: number
  pitch?: number
  volume?: number
  locale?: string
  ttsEngine?: AiAvatarTtsEngine
  audioUrl?: string
  resolution?: "720p" | "1080p" | "4k"
  aspectRatio?: "16:9" | "9:16"
  background?: { type: "color" | "image"; value?: string; url?: string }
  removeBackground?: boolean
  motionPrompt?: string
  expressiveness?: "high" | "medium" | "low"
  fit?: "cover" | "contain"
  outputFormat?: "mp4" | "webm"
  caption?: boolean
  captionStyle?: "default"
  workflowId?: string
  userId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = {
    speechMode: input.speechMode,
  }
  if (input.avatarSource !== undefined) body.avatarSource = input.avatarSource
  if (input.avatarId !== undefined) body.avatarId = input.avatarId
  if (input.imageUrl !== undefined) body.imageUrl = input.imageUrl
  if (input.engine !== undefined) body.engine = input.engine
  if (input.script !== undefined) body.script = input.script
  if (input.voiceId !== undefined) body.voiceId = input.voiceId
  if (input.voiceSpeed !== undefined) body.voiceSpeed = input.voiceSpeed
  if (input.pitch !== undefined) body.pitch = input.pitch
  if (input.volume !== undefined) body.volume = input.volume
  if (input.locale !== undefined) body.locale = input.locale
  if (input.ttsEngine !== undefined) {
    // Map the node's camelCase value fields → the backend's snake_case body.
    const e = input.ttsEngine
    if (e.engine_type === "elevenlabs") {
      const settings: Record<string, unknown> = { engine_type: "elevenlabs" }
      if (e.model !== undefined) settings.model = e.model
      if (e.stability !== undefined) settings.stability = e.stability
      if (e.similarityBoost !== undefined) settings.similarity_boost = e.similarityBoost
      if (e.style !== undefined) settings.style = e.style
      if (e.useSpeakerBoost !== undefined) settings.use_speaker_boost = e.useSpeakerBoost
      body.ttsEngine = settings
    } else if (e.engine_type === "fish") {
      const settings: Record<string, unknown> = { engine_type: "fish" }
      if (e.model !== undefined) settings.model = e.model
      if (e.stability !== undefined) settings.stability = e.stability
      if (e.similarity !== undefined) settings.similarity = e.similarity
      body.ttsEngine = settings
    } else {
      body.ttsEngine = { engine_type: "starfish" }
    }
  }
  if (input.audioUrl !== undefined) body.audioUrl = input.audioUrl
  if (input.resolution !== undefined) body.resolution = input.resolution
  if (input.aspectRatio !== undefined) body.aspectRatio = input.aspectRatio
  if (input.background !== undefined) body.background = input.background
  if (input.removeBackground !== undefined) body.removeBackground = input.removeBackground
  if (input.motionPrompt !== undefined) body.motionPrompt = input.motionPrompt
  if (input.expressiveness !== undefined) body.expressiveness = input.expressiveness
  if (input.fit !== undefined) body.fit = input.fit
  if (input.outputFormat !== undefined) body.outputFormat = input.outputFormat
  if (input.caption !== undefined) body.caption = input.caption
  if (input.captionStyle !== undefined) body.captionStyle = input.captionStyle
  if (input.userId !== undefined) body.userId = input.userId
  return apiJson("/v1/ai-avatar", {
    body,
    workflowId: true,
    label: "Failed to start AI avatar generation",
  })
}

export async function runCinematicAvatar(input: {
  prompt: string
  avatarLooks: string[]
  duration?: number
  autoDuration?: boolean
  aspectRatio?: "16:9" | "9:16" | "1:1"
  resolution?: "720p" | "1080p"
  enhancePrompt?: boolean
  /** Optional reference assets (images/videos/audio) guiding generation. The
   *  `type` is the internal media kind — the backend maps it to HeyGen's
   *  AssetUrl shape. Combined HeyGen caps (enforced backend-side): ≤3 videos,
   *  ≤9 images across avatar looks + image references. */
  references?: Array<{ type: "video" | "image" | "audio"; url: string }>
  userId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = {
    prompt: input.prompt,
    avatarLooks: input.avatarLooks,
  }
  if (input.duration !== undefined) body.duration = input.duration
  if (input.autoDuration !== undefined) body.autoDuration = input.autoDuration
  if (input.aspectRatio !== undefined) body.aspectRatio = input.aspectRatio
  if (input.resolution !== undefined) body.resolution = input.resolution
  if (input.enhancePrompt !== undefined) body.enhancePrompt = input.enhancePrompt
  if (input.references !== undefined && input.references.length > 0) body.references = input.references
  if (input.userId !== undefined) body.userId = input.userId
  return apiJson("/v1/cinematic-avatar", {
    body,
    workflowId: true,
    label: "Failed to start cinematic avatar generation",
  })
}

export async function lipSyncApi(
  imageUrl: string | undefined,
  audioUrl: string,
  prompt?: string,
  provider?: string,
  resolution?: string,
  userId?: string,
  opts: {
    videoUrl?: string
    audioDurationSec?: number
    guidanceScale?: number
    inferenceSteps?: number
    seed?: number
    pads?: string
    smooth?: boolean
    fps?: number
    resizeFactor?: number
    enhancer?: string
    preprocess?: string
    still?: boolean
    poseStyle?: number
    expressionScale?: number
    enableDynamicDuration?: boolean
    disableMusicTrack?: boolean
    enableSpeechEnhancement?: boolean
    syncMode?: string
    temperature?: number
    activeSpeaker?: boolean
  } = {},
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { audioUrl }
  if (imageUrl) body.imageUrl = imageUrl
  if (opts.videoUrl) body.videoUrl = opts.videoUrl
  if (prompt) body.prompt = prompt
  if (provider) body.provider = provider
  if (resolution) body.resolution = resolution
  if (userId) body.userId = userId
  if (opts.audioDurationSec !== undefined) body.audioDurationSec = opts.audioDurationSec
  if (opts.guidanceScale !== undefined) body.guidanceScale = opts.guidanceScale
  if (opts.inferenceSteps !== undefined) body.inferenceSteps = opts.inferenceSteps
  if (opts.seed !== undefined) body.seed = opts.seed
  if (opts.pads !== undefined) body.pads = opts.pads
  if (opts.smooth !== undefined) body.smooth = opts.smooth
  if (opts.fps !== undefined) body.fps = opts.fps
  if (opts.resizeFactor !== undefined) body.resizeFactor = opts.resizeFactor
  if (opts.enhancer) body.enhancer = opts.enhancer
  if (opts.preprocess) body.preprocess = opts.preprocess
  if (opts.still !== undefined) body.still = opts.still
  if (opts.poseStyle !== undefined) body.poseStyle = opts.poseStyle
  if (opts.expressionScale !== undefined) body.expressionScale = opts.expressionScale
  if (opts.enableDynamicDuration !== undefined) body.enableDynamicDuration = opts.enableDynamicDuration
  if (opts.disableMusicTrack !== undefined) body.disableMusicTrack = opts.disableMusicTrack
  if (opts.enableSpeechEnhancement !== undefined) body.enableSpeechEnhancement = opts.enableSpeechEnhancement
  if (opts.syncMode !== undefined) body.syncMode = opts.syncMode
  if (opts.temperature !== undefined) body.temperature = opts.temperature
  if (opts.activeSpeaker !== undefined) body.activeSpeaker = opts.activeSpeaker
  return apiJson("/v1/lip-sync", {
    body,
    workflowId: true,
    label: "Failed to start lip sync generation",
  })
}

export async function generateMusicApi(prompt: string, provider?: string, duration?: number, genre?: string, mood?: string, instrumental?: boolean, lyrics?: string, referenceAudioUrl?: string, userId?: string, modelVersion?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { prompt }
  if (provider) body.provider = provider
  if (duration !== undefined) body.duration = duration
  if (genre) body.genre = genre
  if (mood) body.mood = mood
  if (instrumental !== undefined) body.instrumental = instrumental
  if (lyrics) body.lyrics = lyrics
  if (referenceAudioUrl) body.referenceAudioUrl = referenceAudioUrl
  if (userId) body.userId = userId
  if (modelVersion) body.modelVersion = modelVersion
  return apiJson("/v1/generate-music", {
    body,
    workflowId: true,
    label: "Failed to start music generation",
  })
}

export async function extractYouTubeAudioApi(youtubeUrl: string, userId?: string): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { youtubeUrl }
  if (userId) {
    body.userId = userId
  }
  return apiJson("/v1/extract-youtube-audio", {
    body,
    workflowId: true,
    label: "Failed to start YouTube audio extraction",
  })
}

export interface YouTubeOEmbedData {
  title: string
  thumbnail_url: string
  author_name: string
}

export async function fetchYouTubeOEmbed(url: string): Promise<YouTubeOEmbedData> {
  const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`)
  if (!res.ok) throw new Error("Failed to fetch YouTube metadata")
  return res.json()
}

export interface Job {
  id: string
  status: string
  progress: number
  input_data: {
    type?: string
    prompt?: string
    provider?: string
    referenceImageUrls?: string[]
    imageUrl?: string
    videoUrl?: string
    audioUrl?: string
    text?: string
    [key: string]: unknown
  }
  output_data?: {
    imageUrl?: string
    videoUrl?: string
    audioUrl?: string
    script?: unknown
    // Non-fatal, user-facing notice on an otherwise-successful job (e.g. AI
    // Avatar audio auto-trimmed to the 600s cap). Read by the executor's
    // `extraOutputFields` extractor and surfaced as a banner on the node.
    warningMessage?: string
    [key: string]: unknown
  }
  error_message?: string
  created_at: string
  started_at?: string
  completed_at?: string
  user_id?: string
  // Cost fields - returned differently based on user role:
  // Admin: provider, provider_cost, display_cost
  // Regular user: only cost (= display_cost)
  provider?: string              // Which provider was used (admin only)
  provider_cost?: number         // Actual cost from API response (admin only)
  display_cost?: number          // provider_cost with markup (admin only)
  cost?: number                  // What user pays (regular users)
  credits?: number | null        // Credits reserved/estimated (all users)
  credits_actual?: number | null // Credits actually charged after anomaly correction (admin only)
  job_type?: string | null        // Job type (e.g. "generate-image")
}

/**
 * Lean status shape returned by `GET /v1/jobs/:id/status`. Only the fields a
 * poll loop needs — skips `input_data` JSONB + cost/timestamp columns + the
 * public sanitize pass on the backend.
 */
export type JobStatusLean = {
  id: string
  status: Job["status"]
  progress?: number
  /** True while the reconcile system is self-healing this job (worker
   *  abandoned it post-provider; the cron will complete or refund it). */
  recovering?: boolean
  // Same shape as the full `Job.output_data` so existing poll-loop call sites
  // (`job.output_data?.imageUrl`, etc.) keep their precise field types.
  output_data?: Job["output_data"]
  error_message?: string
}

/**
 * Poll-loop friendly status fetch. Use this (not `getJobStatus`) for in-flight
 * node polling — it hits the lean endpoint and returns far less wire/CPU cost.
 * Delegates to `nodaroClient.jobs.getStatus`.
 */
export async function getJobStatusLean(jobId: string): Promise<JobStatusLean> {
  const { data } = await nodaroClient.jobs.getStatus(jobId)
  return data as unknown as JobStatusLean
}

/** Delegates to `nodaroClient.jobs.get` (Phase 3 SDK dogfooding). */
export async function getJobStatus(jobId: string): Promise<Job> {
  const { data } = await nodaroClient.jobs.get(jobId)
  return data as Job
}

export async function getJobs(userId?: string, cursor?: string, limit?: number): Promise<{
  data: Job[]
  next: string | null
  previous: string | null
}> {
  const params = new URLSearchParams()
  if (userId) params.set("userId", userId)
  if (cursor) params.set("cursor", cursor)
  if (limit) params.set("limit", String(limit))
  const url = params.toString() ? `/v1/jobs?${params.toString()}` : "/v1/jobs"
  return apiJson(url, {
    method: "GET",
    label: "Failed to fetch jobs",
  })
}

export async function deleteJob(jobId: string): Promise<{ success: boolean }> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/v1/jobs/${jobId}`, {
    method: "DELETE",
    headers: authHeaders,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to delete job")
  }
  return { success: true }
}

export interface BatchJobStatus {
  id: string
  status: string
  output_data: { imageUrl?: string; videoUrl?: string; audioUrl?: string; script?: unknown } | null
  error_message: string | null
}

export async function getBatchJobStatus(jobIds: string[]): Promise<BatchJobStatus[]> {
  if (jobIds.length === 0) return []

  let res: Response
  try {
    const authHeaders = await getAuthHeaders()
    res = await fetch(`${API_BASE_URL}/v1/jobs/batch-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ jobIds }),
    })
  } catch {
    // Network error (backend not running) - return empty silently
    return []
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to fetch batch job status")
  }
  const body = await res.json()
  return body.data
}

// --- Generic helpers ---

export interface WorkflowCharacterInfo {
  readonly workflowId: string
  readonly workflowName: string
  readonly characters: readonly CharacterDefinitionRaw[]
}

export interface CharacterDefinitionRaw {
  readonly id: string
  readonly name: string
  readonly type: "reference" | "description"
  readonly referenceImageUrl?: string
  readonly description?: string
}


export async function motionTransferApi(
  imageUrl: string,
  videoUrl: string,
  prompt?: string,
  characterOrientation?: "image" | "video",
  resolution?: "720p" | "1080p" | "480p" | "580p",
  userId?: string,
  provider?: "kling" | "kling-3.0" | "wan-animate-move" | "wan-animate-replace",
  backgroundSource?: "input_video" | "input_image",
  videoDuration?: number,
  negativePrompt?: string,
): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = { imageUrl, videoUrl }
  if (prompt) body.prompt = prompt
  if (negativePrompt) body.negativePrompt = negativePrompt
  if (characterOrientation) body.characterOrientation = characterOrientation
  if (resolution) body.resolution = resolution
  if (userId) body.userId = userId
  if (provider) body.provider = provider
  if (backgroundSource) body.backgroundSource = backgroundSource
  if (videoDuration) body.videoDuration = videoDuration
  return apiJson("/v1/motion-transfer", {
    body,
    workflowId: true,
    label: "Failed to start motion transfer",
  })
}

export async function videoUpscaleApi(opts: {
  videoUrl?: string
  upscaleFactor?: "1" | "2" | "4"
  userId?: string
  provider?: "topaz" | "veo-1080p" | "veo-4k"
  kieTaskId?: string
}): Promise<{ jobId: string }> {
  const body: Record<string, unknown> = {}
  if (opts.videoUrl) body.videoUrl = opts.videoUrl
  if (opts.upscaleFactor) body.upscaleFactor = opts.upscaleFactor
  if (opts.userId) body.userId = opts.userId
  if (opts.provider) body.provider = opts.provider
  if (opts.kieTaskId) body.kieTaskId = opts.kieTaskId
  return apiJson("/v1/video-upscale", {
    body,
    workflowId: true,
    label: "Failed to start video upscale",
  })
}

// --- Extend Video ---

export async function extendVideo(params: {
  // KIE-based providers (veo-extend, runway-extend) require kieTaskId + prompt
  kieTaskId?: string
  prompt?: string
  negativePrompt?: string
  // LTX 2.3 Pro + seedance-2-extend require videoUrl; extendMode is LTX-only
  videoUrl?: string
  extendMode?: "start" | "end"
  duration?: number
  provider: string
  model?: string
  seeds?: number
  quality?: string
  // seedance-2-extend only
  resolution?: "480p" | "720p" | "1080p"
  generateAudio?: boolean
  userId?: string
}): Promise<{ jobId: string }> {
  return apiJson("/v1/extend-video", {
    body: params,
    workflowId: true,
    label: "Failed to start extend video",
  })
}

// --- Video Retake (LTX 2.3 Pro) ---

export async function runVideoRetake(params: {
  videoUrl: string
  prompt?: string
  retakeStartTime: number
  retakeDuration: number
  retakeMode: "replace_audio" | "replace_video" | "replace_audio_and_video"
  aspectRatio: "16:9" | "9:16"
  fps: number
  generateAudio: boolean
  cameraMotion?: string
  userId?: string
}): Promise<{ jobId: string }> {
  return apiJson("/v1/video-retake", {
    body: params,
    workflowId: true,
    label: "Failed to start video retake",
  })
}

export async function faceSwapApi(params: {
  faceImageUrl: string
  videoUrl: string
  provider?: string
}): Promise<{ jobId: string }> {
  return apiJson("/v1/face-swap", {
    body: params,
    workflowId: true,
    label: "Failed to start face swap",
  })
}

// --- Video SFX (Replicate MMAudio) ---

/**
 * Start a Video SFX generation (MMAudio via Replicate). The route generates
 * `versions` (1-4) synchronized SFX takes for the supplied video clip; each
 * take becomes its own `jobs` row so the user can audition them independently.
 *
 * Response shape (load-bearing — see `backend/src/routes/video-sfx.ts`):
 *
 *   versions === 1                   → { jobId: string }
 *   versions  >  1                   → { jobIds: string[] }
 *   anti-double-click dedup hit (10s window, all versions) → { jobId: string, deduped: true }
 *
 * The `deduped: true` branch is set by the core `creditGuard` preHandler
 * (see `backend/src/middleware/credit-guard.ts`) when an identical POST
 * arrives within 10s of a still-pending job from the same user. The route
 * NEVER reaches its own handler in that case, so credits are not reserved
 * twice and the worker is not enqueued. Callers MUST treat this as success
 * and attach polling to the returned `jobId` (the existing in-flight job) —
 * showing an error here would be wrong: the user's original click already
 * succeeded, this is just the dedup short-circuit for a rapid second click.
 */
export async function videoSfx(payload: {
  videoUrl: string
  prompt?: string
  negativePrompt?: string
  cfgStrength?: number
  numSteps?: number
  seed?: number
  versions?: number
}): Promise<{ jobId: string; jobIds?: string[]; deduped?: boolean }> {
  return apiJson("/v1/video-sfx", {
    body: payload,
    workflowId: true,
    label: "Failed to start video SFX",
  })
}

// --- Generate Mask (Grounded SAM segmentation) ---

export async function generateMask(params: {
  imageUrl: string
  prompt: string
  threshold?: number
}): Promise<{ jobId: string }> {
  return apiJson("/v1/generate-mask", {
    body: params,
    workflowId: true,
    label: "Failed to start mask generation",
  })
}

// --- Render Video (Remotion) ---

export async function renderVideoWithSceneGraph(params: {
  sceneGraph: Record<string, unknown>
  userId?: string
}): Promise<{ jobId: string }> {
  return apiJson("/v1/render-video/scene-graph", {
    body: params,
    workflowId: true,
    label: "Failed to start scene graph video render",
  })
}

export async function generateSceneGraph(params: {
  prompt: string
  assets: Array<{ id: string; type: "image" | "video" | "audio"; url: string; label?: string; durationSeconds?: number }>
  fps: number
  aspectRatio: string
  durationSeconds: number
  userId: string
  llmModel?: string
}): Promise<{ jobId: string; sceneGraph: Record<string, unknown> }> {
  return apiJson("/v1/scene-graph/generate", {
    body: params,
    workflowId: true,
    label: "Scene graph generation failed",
  })
}

// --- After Effects ---

export async function generateAfterEffects(params: {
  prompt: string
  inputVideoUrl: string
  fps: number
  width: number
  height: number
  durationSeconds: number
  userId: string
  llmModel?: string
}): Promise<{ jobId: string; effectPlan: Record<string, unknown> }> {
  return apiJson("/v1/after-effects/generate", {
    body: params,
    workflowId: true,
    label: "After effects generation failed",
  })
}

export async function renderVideoWithPlan(params: {
  planType: string
  plan: Record<string, unknown>
  userId?: string
}): Promise<{ jobId: string }> {
  return apiJson("/v1/render-video/plan", {
    body: params,
    workflowId: true,
    label: "Failed to start plan-based video render",
  })
}

// --- Lottie Overlay ---

export async function generateLottieOverlay(params: {
  prompt: string
  inputVideoUrl: string
  fps: number
  durationSeconds: number
  width?: number
  height?: number
  lottieAssets?: Array<{ id: string; url: string; name: string; durationSeconds?: number }>
  userId: string
  llmModel?: string
}): Promise<{ jobId: string; overlayPlan: Record<string, unknown> }> {
  return apiJson("/v1/lottie-overlay/generate", {
    body: params,
    workflowId: true,
    label: "Lottie overlay generation failed",
  })
}

// --- 3D Title ---

export async function generate3DTitle(params: {
  prompt: string
  fps: number
  aspectRatio?: string
  width?: number
  height?: number
  durationSeconds: number
  backgroundColor?: string
  backgroundMediaUrl?: string
  userId: string
  llmModel?: string
}): Promise<{ jobId: string; titlePlan: Record<string, unknown> }> {
  return apiJson("/v1/3d-title/generate", {
    body: params,
    workflowId: true,
    label: "3D title generation failed",
  })
}

// --- Motion Graphics ---

export async function generateMotionGraphics(params: {
  prompt: string
  fps: number
  aspectRatio?: string
  width?: number
  height?: number
  durationSeconds: number
  backgroundColor?: string
  userId: string
  llmModel?: string
  engine?: "elements" | "lottie"
  previousSids?: string[]
}): Promise<{
  jobId: string
  motionPlan?: Record<string, unknown>
  validationErrors?: string[]
  autoFixes?: string[]
}> {
  return apiJson("/v1/motion-graphics/generate", {
    body: params,
    workflowId: true,
    label: "Motion graphics generation failed",
  })
}

// --- Prompt Helper ---

export async function wizardAnalyze(params: {
  nodeType: string
  prompt?: string
  provider?: string
  style?: string
  aspectRatio?: string
  duration?: number
  llmModel?: string
  nodeContext?: {
    connectedInputTypes?: string[]
    referenceImageCount?: number
    referenceImageUrls?: string[]
    hasSourceVideo?: boolean
  }
  userPreference?: string
}): Promise<{
  jobId: string
  questions: Array<{
    category: string
    label: string
    options: Array<{ value: string; label: string; description?: string }>
    selected: string | string[] | null
    allowCustom: boolean
    multi?: boolean
  }>
}> {
  return apiJson("/v1/prompt-helper/wizard", {
    body: { action: "analyze" as const, ...params },
    workflowId: true,
    label: "Prompt analysis failed",
  })
}

export async function wizardGenerate(params: {
  nodeType: string
  provider?: string
  style?: string
  aspectRatio?: string
  duration?: number
  llmModel?: string
  selections: Array<{ category: string; value: string; isCustom: boolean }>
  originalPrompt?: string
  nodeContext?: {
    connectedInputTypes?: string[]
    referenceImageCount?: number
    referenceImageUrls?: string[]
    hasSourceVideo?: boolean
  }
  userPreference?: string
}): Promise<{
  jobId: string
  prompt: string
  recommendedModel?: { provider: string; field: string; label: string; reason: string }
}> {
  return apiJson("/v1/prompt-helper/wizard", {
    body: { action: "generate" as const, ...params },
    workflowId: true,
    label: "Prompt generation failed",
  })
}

// --- LLM SSE Streaming (shared by AI Writer + LLM Chat) ---

async function llmStreamGeneric(
  endpoint: string,
  body: Record<string, unknown>,
  onToken: (token: string) => void,
  signal?: AbortSignal,
): Promise<{ jobId: string; generatedText: string }> {
  let collectedText = ""
  let jobId = ""

  // SSE streaming must bypass the Vite rewrite proxy (which buffers the
  // response body) and call the backend directly so tokens arrive in real-time.
  const sseBaseUrl = import.meta.env.VITE_API_URL || ""

  try {
    const { streamRequest } = await import("@/lib/sse-client")
    const authHeaders = await getAuthHeaders()

    for await (const event of streamRequest(endpoint, {
      body: withWorkflowId(body),
      signal,
      baseUrl: sseBaseUrl || undefined,
      headers: authHeaders,
    })) {
      switch (event.type) {
        case "metadata":
          jobId = (event.data as Record<string, unknown>).jobId as string
          break
        case "token":
          collectedText += event.data as string
          onToken(event.data as string)
          break
        case "done": {
          const done = event.data as Record<string, unknown>
          return {
            jobId: (done.jobId as string) ?? jobId,
            generatedText: (done.generatedText as string) ?? collectedText,
          }
        }
        case "error": {
          const err = event.data as { code: string; message: string }
          throw new Error(err.message)
        }
      }
    }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { jobId, generatedText: collectedText }
    }
    throw err
  }

  throw new Error("Stream ended without completion")
}

export async function generateAIWriterStream(params: {
  systemPrompt: string
  userInput: string
  temperature: number
  maxTokens: number
  userId: string
  llmModel?: string
  onToken: (token: string) => void
  signal?: AbortSignal
}): Promise<{ jobId: string; generatedText: string }> {
  const { onToken, signal, ...body } = params
  return llmStreamGeneric("/v1/ai-writer/generate-stream", body, onToken, signal)
}

export async function llmChatStream(params: {
  systemPrompt: string
  userInput: string
  referenceImageUrls?: string[]
  referenceVideoUrls?: string[]
  referenceAudioUrls?: string[]
  temperature: number
  maxTokens: number
  userId: string
  llmModel?: string
  onToken: (token: string) => void
  signal?: AbortSignal
}): Promise<{ jobId: string; generatedText: string }> {
  const { onToken, signal, ...body } = params
  return llmStreamGeneric("/v1/llm-chat/generate-stream", body, onToken, signal)
}

// Stats types
export interface StatsResponse {
  totalExecutions: number
  successful: number
  failed: number
  cancelled: number
  pending: number
  processing: number
  failureRate: number
  avgImageTime: number | null
  avgVideoTime: number | null
}

export async function getStats(scope: "user" | "platform" = "user", userId?: string): Promise<{ data: StatsResponse }> {
  const params = new URLSearchParams()
  params.set("scope", scope)
  if (userId) params.set("userId", userId)

  return apiJson(`/v1/stats?${params.toString()}`, {
    method: "GET",
    label: "Failed to fetch stats",
  })
}

// Cost summary types
export interface CostBreakdownItem {
  readonly node_type: string
  readonly model: string
  readonly runs: number
  readonly successful: number
  readonly failed: number
  readonly total_credits: number
  readonly total_cost_usd: number
  readonly avg_credits_per_run: number
}

export interface CostSummary {
  readonly total_credits: number
  readonly total_cost_usd: number
  readonly total_jobs: number
  readonly breakdown: readonly CostBreakdownItem[]
}

export async function getWorkflowCostSummary(jobIds: readonly string[]): Promise<{ data: CostSummary }> {
  if (jobIds.length === 0) {
    return { data: { total_credits: 0, total_cost_usd: 0, total_jobs: 0, breakdown: [] } }
  }
  return apiJson("/v1/jobs/cost-summary", {
    body: { jobIds },
    label: "Failed to fetch cost summary",
  })
}

/**
 * Delegates to `nodaroClient.jobs.cancel` (Phase 3 SDK dogfooding).
 * The legacy `userId` parameter is unused — the backend derives ownership
 * from the auth token; left for back-compat with existing callers.
 */
export async function cancelJob(
  jobId: string,
  _userId?: string,
): Promise<{ success: boolean; cancelled: number; inFlight?: boolean }> {
  // `inFlight: true` means the external provider call already went out and the
  // job can't be killed — it runs to completion and lands in My Library, while
  // the canvas detaches the result (see Discard run / shouldAbandonNode).
  return nodaroClient.jobs.cancel(jobId) as Promise<{ success: boolean; cancelled: number; inFlight?: boolean }>
}

export async function cancelAllJobs(userId: string): Promise<{ success: boolean; cancelled: number }> {
  return apiJson("/v1/jobs/cancel-all", {
    body: { userId },
    label: "Failed to cancel jobs",
  })
}

// ============================================================
// Media Library
// ============================================================

export interface LibraryAsset {
  id: string
  type: "image" | "video" | "audio"
  filename: string
  mimeType: string
  sizeBytes: number
  url: string
  thumbnailUrl: string | null
  metadata: Record<string, unknown>
  isLibraryItem: boolean
  uploadSource: string
  createdAt: string
}

export async function getLibraryAssets(params: {
  userId: string
  type?: string
  search?: string
  limit?: number
  cursor?: string
  owned?: boolean
}): Promise<{ data: LibraryAsset[]; nextCursor: string | null; totalCount?: number }> {
  const qs = new URLSearchParams({ userId: params.userId })
  if (params.type && params.type !== "all") qs.set("type", params.type)
  if (params.search) qs.set("search", params.search)
  if (params.limit) qs.set("limit", String(params.limit))
  if (params.cursor) qs.set("cursor", params.cursor)
  if (params.owned) qs.set("owned", "true")

  return apiJson(`/v1/library?${qs.toString()}`, {
    method: "GET",
    label: "Failed to fetch library assets",
  })
}

export async function deleteLibraryAsset(
  assetId: string,
  userId: string,
): Promise<{ success: boolean }> {
  return apiJson(
    `/v1/library/${assetId}?userId=${encodeURIComponent(userId)}&permanent=true`,
    { method: "DELETE", label: "Failed to delete asset" },
  )
}

export async function removeLibraryAsset(
  assetId: string,
  userId: string,
): Promise<{ success: boolean }> {
  return apiJson(
    `/v1/library/${assetId}?userId=${encodeURIComponent(userId)}`,
    { method: "DELETE", label: "Failed to remove from library" },
  )
}

export async function promoteToLibrary(
  assetId: string,
  userId: string,
): Promise<{ success: boolean }> {
  return apiJson(`/v1/library/${assetId}/promote`, {
    body: { userId },
    label: "Failed to promote asset",
  })
}

export async function demoteFromLibrary(
  assetId: string,
  userId: string,
): Promise<{ success: boolean }> {
  return apiJson(
    `/v1/library/${assetId}/demote`,
    { body: { userId }, label: "Failed to demote asset" },
  )
}

export async function saveGeneratedToLibrary(params: {
  userId: string
  url: string
  type: "image" | "video" | "audio"
  filename?: string
  metadata?: Record<string, unknown>
  isLibraryItem?: boolean
}): Promise<{ data: { id: string; isLibraryItem: boolean } }> {
  return apiJson("/v1/library/save-generated", {
    body: params,
    workflowId: true,
    label: "Failed to save to library",
  })
}

// ============================================================
// Credits API
// ============================================================

export interface UserBalance {
  total: number
  subscription: number
  topup: number
  dailySpent: number
  dailyLimit: number | null
  monthlyAllocation: number
  tier: string
  features: Record<string, unknown>
  periodEnd: string | null
  /** Credits earned for app usage (free tier only — earned by running flows) */
  appCreditsAllowance: number
}

export interface CreditCheckResult {
  allowed: boolean
  error?: string
  balance?: number
  required?: number
  creditCost?: number
  dailyLimit?: number
  dailySpent?: number
}

export async function getUserCredits(userId: string): Promise<{ data: UserBalance }> {
  return apiJson(`/v1/user/credits?userId=${encodeURIComponent(userId)}`, {
    method: "GET",
    label: "Failed to get credits",
  })
}

export async function checkCredits(userId: string, model: string): Promise<{ data: CreditCheckResult }> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/v1/credits/check?userId=${encodeURIComponent(userId)}&model=${encodeURIComponent(model)}`, {
    headers: authHeaders,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to check credits")
  }
  return res.json()
}

export async function getModelCreditCost(model: string): Promise<{ data: { model: string; creditCost: number } }> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/v1/credits/model-cost?model=${encodeURIComponent(model)}`, {
    headers: authHeaders,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to get model cost")
  }
  return res.json()
}

export async function getBatchModelCreditCosts(models: string[]): Promise<Record<string, number>> {
  const res = await fetch(`${API_BASE_URL}/v1/credits/model-costs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ models }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to get model costs")
  }
  const body = await res.json() as {
    data: Record<string, number>
    // Per-model fault isolation: identifiers with no pricing row in
    // model_pricing AND no STATIC_CREDIT_COSTS entry are reported here
    // instead of 503'ing the batch. Anything in `missing` is undisplayable
    // until an operator seeds it; the credit-guard hard-fail still triggers
    // at Run time. Surface to devtools so it's not silent.
    missing?: string[]
    errors?: string[]
  }
  if (body.missing?.length) {
    console.warn(
      `[credits] model-costs: ${body.missing.length} unpriced identifier(s) — operator must seed: ${body.missing.join(", ")}`,
    )
  }
  if (body.errors?.length) {
    console.error(
      `[credits] model-costs: lookup failed for ${body.errors.length} identifier(s): ${body.errors.join(", ")}`,
    )
  }
  return body.data
}

// ============================================================
// Billing API
// ============================================================

export interface SubscriptionInfo {
  id: string
  stripe_subscription_id: string
  tier: string
  status: string
  stripe_price_id: string
  current_period_start: string | null
  current_period_end: string | null
  canceled_at: string | null
}

export interface TransactionRecord {
  id: string
  stripe_transaction_id: string
  type: "subscription" | "topup"
  amount_usd: number
  credits_granted: number
  tier: string | null
  created_at: string
}

export async function getSubscription(userId: string): Promise<SubscriptionInfo | null> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(
    `${API_BASE_URL}/v1/billing/subscription?userId=${encodeURIComponent(userId)}`,
    { headers: authHeaders }
  )
  if (!res.ok) return null
  const json = await res.json()
  return json.data ?? json ?? null
}

export async function getTransactions(userId: string): Promise<TransactionRecord[]> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(
    `${API_BASE_URL}/v1/billing/transactions?userId=${encodeURIComponent(userId)}`,
    { headers: authHeaders }
  )
  if (!res.ok) return []
  const json = await res.json()
  return json.data ?? json ?? []
}

export async function getManageSubscriptionUrl(userId: string): Promise<string | null> {
  const res = await fetch(`${API_BASE_URL}/v1/billing/manage-subscription`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify({ userId }),
  })
  if (!res.ok) return null
  const json = await res.json()
  return json.data?.url ?? json.url ?? null
}

export async function changePlan(
  userId: string,
  newPriceId: string
): Promise<{ subscriptionId: string; tier: string }> {
  const res = await fetch(`${API_BASE_URL}/v1/billing/change-plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify({ userId, newPriceId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as Record<string, string>).error ?? "Failed to change plan")
  }
  const json = await res.json()
  return (json as Record<string, unknown>).data as { subscriptionId: string; tier: string }
}

export async function createCheckoutSession(params: {
  priceId: string
  mode?: "subscription" | "payment"
}): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/v1/billing/create-checkout-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as Record<string, string>).error ?? "Failed to create checkout session")
  }
  const json = await res.json()
  return (json as Record<string, unknown>).data
    ? ((json as Record<string, unknown>).data as { url: string }).url
    : (json as { url: string }).url
}

// ============================================================
// Voices (ElevenLabs)
// ============================================================

export interface ElevenLabsVoice {
  voice_id: string
  name: string
  preview_url: string
  gender: string
  accent: string
  age: string
  description: string
  use_case: string
  category: string
}

export async function getVoices(): Promise<ElevenLabsVoice[]> {
  const res = await fetch(`${API_BASE_URL}/v1/voices`)
  if (!res.ok) {
    throw new Error("Failed to fetch voices")
  }
  const body = await res.json()
  return body.voices
}

// ---------------------------------------------------------------------------
// HeyGen catalog — avatar looks + voices (public endpoints)
// ---------------------------------------------------------------------------

/** A single photo-avatar look from /v3/avatars/looks (photo_avatar type only). */
export interface HeygenAvatar {
  avatarId: string
  groupId?: string
  name: string
  gender: string
  previewImageUrl: string
  defaultVoiceId?: string
  preferredOrientation?: string
  /** Engine IDs this avatar supports, e.g. ["avatar_v", "avatar_iv"].
   *  Absent / empty means the backend didn't return engine metadata — treat as
   *  IV-only for filtering purposes (stock avatars often lack the field). */
  supportedEngines?: string[]
}

/** A single voice from /v2/voices. */
export interface HeygenVoice {
  voiceId: string
  name: string
  language: string
  gender: string
  previewAudio: string
  supportPause: boolean
  emotionSupport: boolean
  supportLocale: boolean
}

/**
 * Fetches the list of HeyGen photo-avatar looks.
 * Public endpoint — no auth required.
 * Returns [] when HEYGEN_API_KEY is not configured on the server.
 */
export async function getHeygenAvatars(): Promise<HeygenAvatar[]> {
  const res = await fetch(`${API_BASE_URL}/v1/heygen/avatars`)
  if (!res.ok) {
    throw new Error("Failed to fetch HeyGen avatars")
  }
  const body = await res.json()
  return body.avatars
}

/**
 * Fetches the list of HeyGen voices.
 * Public endpoint — no auth required.
 * Returns [] when HEYGEN_API_KEY is not configured on the server.
 */
export async function getHeygenVoices(): Promise<HeygenVoice[]> {
  const res = await fetch(`${API_BASE_URL}/v1/heygen/voices`)
  if (!res.ok) {
    throw new Error("Failed to fetch HeyGen voices")
  }
  const body = await res.json()
  return body.voices
}

// Voice Library (shared/community voices)

export interface SharedVoice {
  voice_id: string
  name: string
  preview_url: string
  gender: string
  accent: string
  age: string
  description: string
  use_case: string
  category: string
}

export interface VoiceLibraryParams {
  search?: string
  gender?: string
  age?: string
  accent?: string
  language?: string
  category?: string
  use_cases?: string
  descriptives?: string
  featured?: string
  sort?: string
  page?: number
  page_size?: number
}

export interface VoiceLibraryResponse {
  voices: SharedVoice[]
  hasMore: boolean
}

export async function searchVoiceLibrary(params: VoiceLibraryParams): Promise<VoiceLibraryResponse> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v))
  }
  const res = await fetch(`${API_BASE_URL}/v1/voices/library?${qs.toString()}`)
  if (!res.ok) {
    return { voices: [], hasMore: false }
  }
  return res.json()
}

// ─── Voice Clones (custom cloned voices) ───────────────────────────────

export interface VoiceClone {
  id: string
  name: string
  description?: string
  elevenlabsVoiceId: string
  sampleAudioUrl?: string
  previewUrl?: string
  gender?: string
  accent?: string
  createdAt: string
  updatedAt?: string
}

export async function getVoiceClones(): Promise<VoiceClone[]> {
  const res = await fetch(`${API_BASE_URL}/v1/voice-clones`, {
    headers: await getAuthHeaders(),
  })
  if (!res.ok) {
    return []
  }
  const body = await res.json()
  return body.voiceClones
}

export async function createVoiceClone(name: string, file: Blob): Promise<VoiceClone> {
  const formData = new FormData()
  formData.append("name", name)
  formData.append("file", file, "sample.webm")
  const res = await fetch(`${API_BASE_URL}/v1/voice-clones`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to clone voice")
  }
  return res.json()
}

export async function deleteVoiceClone(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/v1/voice-clones/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await getAuthHeaders(),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to delete voice clone")
  }
}

export async function renameVoiceClone(id: string, name: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/v1/voice-clones/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...await getAuthHeaders() },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to rename voice clone")
  }
}

// --- Sub-Workflow APIs ---

interface CallableWorkflow {
  id: string
  name: string
  projectId: string
  projectName: string
  routes: SubWorkflowRouteSnapshot[]
}

export async function getCallableWorkflows(projectId?: string): Promise<CallableWorkflow[]> {
  const params = new URLSearchParams()
  if (projectId) params.set("projectId", projectId)
  const url = `${API_BASE_URL}/v1/workflows/callable${params.toString() ? `?${params}` : ""}`
  const res = await fetch(url, {
    headers: await getAuthHeaders(),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to fetch callable workflows")
  }
  const json = await res.json()
  return json.data
}

export async function getWorkflowInterface(workflowId: string): Promise<{ routes: SubWorkflowRouteSnapshot[] }> {
  const res = await fetch(`${API_BASE_URL}/v1/workflows/${encodeURIComponent(workflowId)}/interface`, {
    headers: await getAuthHeaders(),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to fetch workflow interface")
  }
  const json = await res.json()
  return json.data
}

// ---------------------------------------------------------------------------
// Workflow export / import — delegate the heavy lifting (asset fetch on export,
// asset re-creation + entity-id remapping on import) to the backend instead of
// running DB queries in the browser.
// ---------------------------------------------------------------------------

/** Fetch a portable JSON bundle for a workflow. `assets` includes bundled characters/objects/locations. */
export async function exportWorkflow(
  workflowId: string,
  opts?: { assets?: boolean },
): Promise<WorkflowExport> {
  const assets = opts?.assets ?? false
  return apiJson<WorkflowExport>(
    `/v1/workflows/${encodeURIComponent(workflowId)}/export?assets=${assets}`,
    { method: "GET", label: "Failed to export workflow" },
  )
}

/** Shape returned by `POST /v1/workflows/import` (camelCase, mirrors the backend `WorkflowFull` serializer). */
export interface ImportedWorkflow {
  id: string
  projectId: string
  userId: string
  name: string
  nodes: unknown[]
  edges: unknown[]
  settings: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** Import a workflow bundle into a project — re-creates bundled assets and returns the new workflow. */
export async function importWorkflow(
  input: WorkflowExport & { projectId: string },
): Promise<ImportedWorkflow> {
  const { projectId, ...workflow_json } = input
  const json = await apiRequest<{ data: ImportedWorkflow }>(
    `/v1/workflows/import`,
    "Failed to import workflow",
    { method: "POST", body: { projectId, workflow_json } },
  )
  return json.data
}

// ---------------------------------------------------------------------------
// Workflow execution API
// ---------------------------------------------------------------------------

export interface WorkflowExecution {
  id: string
  workflowId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out' | 'stopping' | 'discarded'
  triggerType: 'manual' | 'webhook' | 'schedule' | 'single-node' | 'app_run' | 'mcp'
  /** MCP client name (e.g. "Claude", "Cursor") when the execution was triggered via the MCP server. */
  mcpClient?: string | null
  triggerData?: Record<string, unknown>
  nodeStates?: Record<string, unknown>
  totalNodes: number
  completedNodes: number
  failedNodes: number
  totalCreditsUsed: number
  errorMessage?: string
  startedAt?: string
  completedAt?: string
  createdAt: string
}

export interface WorkflowTrigger {
  id: string
  workflowId: string
  type: 'webhook' | 'schedule'
  config: Record<string, unknown>
  isActive: boolean
  webhookToken?: string
  webhookUrl?: string
  lastTriggeredAt?: string
  createdAt: string
}

/**
 * Internal helper for simple API requests that follow the standard
 * fetch -> check ok -> throwApiError -> return json pattern.
 */
async function apiRequest<T>(
  path: string,
  errorMessage: string,
  opts?: { method?: string; body?: unknown; skipAuth?: boolean },
): Promise<T> {
  const headers: Record<string, string> = opts?.skipAuth ? {} : { ...(await getAuthHeaders()) }
  if (opts?.body !== undefined) headers["Content-Type"] = "application/json"

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: opts?.method ?? "GET",
    headers,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, errorMessage)
  }
  return res.json() as Promise<T>
}

export class WorkflowAlreadyRunningError extends Error {
  executionId: string
  constructor(executionId: string) {
    super("This workflow already has an active execution")
    this.name = "WorkflowAlreadyRunningError"
    this.executionId = executionId
  }
}

/** Run a workflow (creates execution, enqueues orchestrator). Optionally pass nodeIds for partial execution. */
export async function runWorkflow(
  workflowId: string,
  nodeIds?: string[],
  /** Per-click idempotency key. One UUID per click of the Run button —
   *  the same key on React StrictMode re-fires / network retries collapses
   *  into one execution. A new key on the next click creates a new
   *  execution (intentional re-run). */
  idempotencyKey?: string,
): Promise<{ executionId: string }> {
  let headers: Record<string, string> = { ...(await getAuthHeaders()) }
  let body: string | undefined
  if (nodeIds) {
    headers["Content-Type"] = "application/json"
    body = JSON.stringify({ nodeIds })
  }
  headers = withIdempotencyHeader(headers, idempotencyKey)
  const res = await fetch(`${API_BASE_URL}/v1/workflows/${encodeURIComponent(workflowId)}/run`, {
    method: "POST",
    headers,
    body,
  })
  if (res.status === 409) {
    const body = await res.json().catch(() => null)
    const execId = (body as Record<string, unknown>)?.executionId as string | undefined
    if (execId) throw new WorkflowAlreadyRunningError(execId)
    throwApiError(body as Record<string, unknown> | null, "Failed to run workflow")
  }
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to run workflow")
  }
  return res.json() as Promise<{ executionId: string }>
}

export interface CreatedSubWorkflow {
  readonly id: string
  readonly parentWorkflowId: string
  readonly projectId: string
  readonly name: string
  readonly nodes: readonly unknown[]
  readonly edges: readonly unknown[]
}

/** Create a child sub-workflow under the given parent workflow. */
export async function createChildSubWorkflow(
  parentWorkflowId: string,
  opts: { readonly name?: string } = {},
): Promise<CreatedSubWorkflow> {
  const res = await fetch(`${API_BASE_URL}/v1/workflows/${encodeURIComponent(parentWorkflowId)}/sub-workflows`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify({ name: opts.name ?? "Sub-workflow" }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throwApiError(err, "Failed to create sub-workflow")
  }
  const json = await res.json()
  return json.data as CreatedSubWorkflow
}

/**
 * Get execution status + node states.
 *
 * Delegates to `nodaroClient.executions.get` (Phase 3 SDK dogfooding).
 * The SDK's `WorkflowExecution` type is structurally compatible — the only
 * differences are stricter `errorMessage`/`nodeStates` nullability and an
 * extra `userId`/`updatedAt` — neither of which matters for current call
 * sites. Cast keeps the local `WorkflowExecution` contract stable.
 */
export async function getWorkflowExecution(executionId: string): Promise<WorkflowExecution> {
  const { data } = await nodaroClient.executions.get(executionId)
  return data as unknown as WorkflowExecution
}

/**
 * Cancel an active execution immediately.
 * Delegates to `nodaroClient.executions.cancel` (Phase 3 SDK dogfooding).
 */
export async function cancelWorkflowExecution(executionId: string): Promise<void> {
  await nodaroClient.executions.cancel(executionId)
}

/**
 * Stop after the current node finishes (sets status to "stopping").
 * Delegates to `nodaroClient.executions.cancel` with `mode: "after_current"`.
 */
export async function stopWorkflowExecution(executionId: string): Promise<void> {
  await nodaroClient.executions.cancel(executionId, { mode: "after_current" })
}

/** Discard a run: in-flight jobs finish into My Library; the canvas detaches.
 *  Unlike cancel, this does NOT kill jobs. */
export async function discardWorkflowExecution(executionId: string): Promise<void> {
  await nodaroClient.executions.cancel(executionId, { mode: "discard" })
}

/** Node execution state from the backend orchestrator. */
interface ExecutionNodeState {
  status: "pending" | "running" | "completed" | "failed" | "skipped"
  output?: {
    imageUrl?: string
    videoUrl?: string
    audioUrl?: string
    text?: string
    script?: unknown
    generatedVoiceId?: string
    alignment?: unknown
    vocalUrl?: string
    instrumentalUrl?: string
    splitResults?: string[]
    combinedText?: string
    listResults?: string[]
  }
  error?: string
}

export interface StreamExecutionCallbacks {
  onNodeStatesChanged: (
    nodeStates: Record<string, ExecutionNodeState>,
    meta: { completedNodes?: number; failedNodes?: number; totalNodes?: number; totalCreditsUsed?: number },
  ) => void
  onCompleted: (data: Record<string, unknown>) => void
  onFailed: (data: Record<string, unknown>) => void
  onCancelled: (data: Record<string, unknown>) => void
  onDiscarded?: (data: Record<string, unknown>) => void
}

/**
 * Stream workflow execution updates via SSE.
 * Bypasses Vite proxy (which buffers responses) and calls backend directly.
 */
export async function streamWorkflowExecution(
  executionId: string,
  callbacks: StreamExecutionCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const sseBaseUrl = import.meta.env.VITE_API_URL || ""
  const authHeaders = await getAuthHeaders()

  const { streamGet } = await import("@/lib/sse-client")

  for await (const event of streamGet(
    `/v1/workflow-executions/${encodeURIComponent(executionId)}/stream`,
    {
      signal,
      baseUrl: sseBaseUrl || undefined,
      headers: authHeaders,
    },
  )) {
    if (event.type === "metadata" || event.type === "execution") {
      const d = event.data as Record<string, unknown>
      const nodeStates = (d.nodeStates ?? {}) as Record<string, ExecutionNodeState>
      callbacks.onNodeStatesChanged(nodeStates, {
        completedNodes: d.completedNodes as number | undefined,
        failedNodes: d.failedNodes as number | undefined,
        totalNodes: d.totalNodes as number | undefined,
        totalCreditsUsed: d.totalCreditsUsed as number | undefined,
      })
    } else if (event.type === "done") {
      const d = event.data as Record<string, unknown>
      const nodeStates = (d.nodeStates ?? {}) as Record<string, ExecutionNodeState>
      const eventType = d.eventType as string | undefined
      // A discarded run's final nodeStates must NEVER paint the canvas — the
      // user stopped the run, so its results land in My Library off-canvas.
      // Short-circuit before onNodeStatesChanged so the discarded states are
      // never applied, and route to onDiscarded (not onCompleted).
      if (eventType === "execution:discarded") {
        callbacks.onDiscarded?.(d)
        return
      }
      // Always send the final nodeStates update first
      callbacks.onNodeStatesChanged(nodeStates, {
        completedNodes: d.completedNodes as number | undefined,
        failedNodes: d.failedNodes as number | undefined,
        totalNodes: d.totalNodes as number | undefined,
        totalCreditsUsed: d.totalCreditsUsed as number | undefined,
      })
      if (eventType === "execution:failed") {
        callbacks.onFailed(d)
      } else if (eventType === "execution:cancelled") {
        callbacks.onCancelled(d)
      } else {
        callbacks.onCompleted(d)
      }
      return
    } else if (event.type === "error") {
      const err = event.data as { code: string; message: string }
      throw new Error(err.message)
    }
  }
}

/**
 * List executions for a workflow.
 *
 * Delegates to `nodaroClient.executions.listForWorkflow` (Phase 3 SDK
 * dogfooding). The SDK returns `WorkflowExecutionSummary[]` which is a
 * structural subset of the local `WorkflowExecution[]` shape — the cast
 * preserves the existing return contract for callers.
 */
export async function listWorkflowExecutions(
  workflowId: string,
  opts?: { limit?: number; cursor?: string; status?: string; source?: "editor" | "all" },
): Promise<{ data: WorkflowExecution[]; nextCursor?: string }> {
  const page = await nodaroClient.executions.listForWorkflow(workflowId, opts ?? {})
  return page as unknown as { data: WorkflowExecution[]; nextCursor?: string }
}

// --- Global Executions ---

export interface GlobalExecution extends WorkflowExecution {
  workflowName: string | null
  projectId: string | null
  ownerEmail?: string | null
}

/** List executions across all workflows. */
export function listAllExecutions(
  opts?: { limit?: number; cursor?: string; status?: string; viewAll?: boolean },
): Promise<{ data: GlobalExecution[]; nextCursor?: string }> {
  const params = new URLSearchParams()
  if (opts?.limit) params.set("limit", String(opts.limit))
  if (opts?.cursor) params.set("cursor", opts.cursor)
  if (opts?.status) params.set("status", opts.status)
  if (opts?.viewAll) params.set("viewAll", "true")

  return apiRequest(
    `/v1/executions?${params}`,
    "Failed to list executions",
  )
}

/** Create a workflow trigger (webhook or schedule). */
export async function createWorkflowTrigger(
  workflowId: string,
  type: "webhook" | "schedule",
  config?: Record<string, unknown>,
): Promise<WorkflowTrigger> {
  const json = await apiRequest<{ data: WorkflowTrigger }>(
    `/v1/workflow-triggers`,
    "Failed to create trigger",
    { method: "POST", body: { workflowId, type, config } },
  )
  return json.data
}

/** List triggers for a workflow. */
export async function listWorkflowTriggers(workflowId: string): Promise<WorkflowTrigger[]> {
  const json = await apiRequest<{ data: WorkflowTrigger[] }>(
    `/v1/workflows/${encodeURIComponent(workflowId)}/triggers`,
    "Failed to list triggers",
  )
  return json.data
}

/** Update a workflow trigger. */
export async function updateWorkflowTrigger(
  triggerId: string,
  updates: { isActive?: boolean; config?: Record<string, unknown> },
): Promise<WorkflowTrigger> {
  const json = await apiRequest<{ data: WorkflowTrigger }>(
    `/v1/workflow-triggers/${encodeURIComponent(triggerId)}`,
    "Failed to update trigger",
    { method: "PATCH", body: updates },
  )
  return json.data
}

/** Delete a workflow trigger. */
export function deleteWorkflowTrigger(triggerId: string): Promise<void> {
  return apiRequest(
    `/v1/workflow-triggers/${encodeURIComponent(triggerId)}`,
    "Failed to delete trigger",
    { method: "DELETE" },
  )
}

// ---------------------------------------------------------------------------
// Presentation mode
// ---------------------------------------------------------------------------

/** Enable sharing and get the share token. */
export async function shareWorkflow(workflowId: string): Promise<{ shareToken: string }> {
  const json = await apiRequest<{ shareToken: string }>(
    `/v1/workflows/${encodeURIComponent(workflowId)}/share`,
    "Failed to share workflow",
    { method: "POST" },
  )
  return json
}

/** Disable sharing / revoke share token. */
export function unshareWorkflow(workflowId: string): Promise<void> {
  return apiRequest(
    `/v1/workflows/${encodeURIComponent(workflowId)}/share`,
    "Failed to unshare workflow",
    { method: "DELETE" },
  )
}

/** Get shared workflow data by token. */
export async function getSharedWorkflow(token: string): Promise<{
  workflowId: string
  name: string
  nodes: unknown[]
  edges: unknown[]
  isOwner: boolean
  estimatedCost?: number
  presentationSettings?: PresentationSettings
}> {
  return apiRequest(
    `/v1/present/${encodeURIComponent(token)}`,
    "Failed to load shared workflow",
  )
}

/** Run a shared workflow with input overrides (viewer pays credits). */
export async function runSharedWorkflow(
  token: string,
  inputOverrides?: Record<string, Record<string, unknown>>,
  presentationSettings?: PresentationSettings,
): Promise<{ executionId: string; status: string }> {
  return apiRequest(
    `/v1/present/${encodeURIComponent(token)}/run`,
    "Failed to run shared workflow",
    { method: "POST", body: { inputOverrides, runTarget: presentationSettings?.runTarget, subWorkflowNodeId: presentationSettings?.subWorkflowNodeId, selectedRouteId: presentationSettings?.selectedRouteId } },
  )
}

/** Poll shared workflow execution status. */
export async function getSharedExecutionStatus(
  token: string,
  execId: string,
): Promise<{
  id: string
  status: string
  node_states: Record<string, unknown>
  total_nodes: number
  completed_nodes: number
  failed_nodes: number
  total_credits_used: number
  error_message: string | null
}> {
  return apiRequest(
    `/v1/present/${encodeURIComponent(token)}/status/${encodeURIComponent(execId)}`,
    "Failed to get execution status",
  )
}

// ---------------------------------------------------------------------------
// API Tokens
// ---------------------------------------------------------------------------

export interface ApiToken {
  id: string
  name: string
  prefix: string
  workflowIds: string[]
  rateLimit: number
  isActive: boolean
  lastUsedAt: string | null
  createdAt: string
}

export interface CreateApiTokenResult extends ApiToken {
  /** Plaintext token — shown only once at creation time */
  token: string
}

export async function listApiTokens(): Promise<{ data: ApiToken[] }> {
  return apiRequest("/v1/api-tokens", "Failed to list API tokens")
}

export async function createApiToken(params: {
  name: string
  workflowIds?: string[]
  rateLimit?: number
}): Promise<{ data: CreateApiTokenResult }> {
  return apiRequest("/v1/api-tokens", "Failed to create API token", {
    method: "POST",
    body: params,
  })
}

export async function updateApiToken(
  id: string,
  params: {
    name?: string
    workflowIds?: string[]
    rateLimit?: number
    isActive?: boolean
  },
): Promise<{ data: ApiToken }> {
  return apiRequest(`/v1/api-tokens/${encodeURIComponent(id)}`, "Failed to update API token", {
    method: "PATCH",
    body: params,
  })
}

export async function deleteApiToken(id: string): Promise<{ success: boolean }> {
  return apiRequest(`/v1/api-tokens/${encodeURIComponent(id)}`, "Failed to delete API token", {
    method: "DELETE",
  })
}

// ---------------------------------------------------------------------------
// Developer Apps (OAuth) — delegates to @nodaro/client SDK
// ---------------------------------------------------------------------------

export type {
  DeveloperApp,
  DeveloperAppStatus,
  DeveloperAppScope,
  CreateDeveloperAppInput,
  UpdateDeveloperAppInput,
  CreateDeveloperAppResult,
} from "@nodaro/client"

export function listDeveloperApps() {
  return nodaroClient.developerApps.list()
}

export function getDeveloperApp(id: string) {
  return nodaroClient.developerApps.get(id)
}

export function createDeveloperApp(
  input: import("@nodaro/client").CreateDeveloperAppInput,
) {
  return nodaroClient.developerApps.create(input)
}

export function updateDeveloperApp(
  id: string,
  input: import("@nodaro/client").UpdateDeveloperAppInput,
) {
  return nodaroClient.developerApps.update(id, input)
}

export function deleteDeveloperApp(id: string) {
  return nodaroClient.developerApps.delete(id)
}

export function rotateDeveloperAppSecret(id: string) {
  return nodaroClient.developerApps.rotateSecret(id)
}

// ---------- OAuth Consent Screen ----------

/** Public-safe app metadata returned by GET /v1/oauth/app-info — no secrets, no owner info. */
export interface OAuthAppInfo {
  name: string
  description: string | null
  logoUrl: string | null
  homepageUrl: string | null
  scopesRequested: string[]
  /**
   * How the app was registered. Defaults to "user" for legacy/dashboard-registered apps.
   * "dynamic_mcp" = registered via RFC 7591 Dynamic Client Registration — the consent
   * UI warns the user that the displayed name is self-reported.
   *
   * `& {}` on the fallback string preserves autocomplete for known kinds while
   * allowing forward-compat with future values.
   */
  kind?: "user" | "dynamic_mcp" | "first_party_mcp" | (string & {})
}

/**
 * Fetch public app metadata for the OAuth consent screen.
 * No auth required — client_id is public by OAuth design.
 */
export async function getOAuthAppInfo(clientId: string): Promise<OAuthAppInfo> {
  return apiRequest(
    `/v1/oauth/app-info?client_id=${encodeURIComponent(clientId)}`,
    "Failed to load app info",
    { skipAuth: true },
  )
}

export interface OAuthAuthorizeInput {
  clientId: string
  redirectUri: string
  scopes: string[]
  state?: string
  /** PKCE code_challenge (RFC 7636), forwarded verbatim from the OAuth client. */
  codeChallenge?: string
  /** PKCE code_challenge_method — only "S256" is accepted server-side. */
  codeChallengeMethod?: "S256"
}

export interface OAuthAuthorizeResult {
  code: string
  state: string | null
  redirectUri: string
}

/**
 * Issue an authorization code after the user clicks "Allow" on the consent screen.
 * Requires the user's Supabase JWT (the user must be logged in).
 */
export async function oauthAuthorize(input: OAuthAuthorizeInput): Promise<OAuthAuthorizeResult> {
  return apiRequest(
    "/v1/oauth/authorize",
    "Authorization failed",
    { method: "POST", body: input },
  )
}

// ---------- Social Media ----------

export async function socialPublishApi(params: {
  platform: string
  action: string
  connectionId?: string
  mediaUrl?: string
  mediaItems?: Array<{ type: "photo" | "video"; url: string }>
  caption?: string
  title?: string
  description?: string
  tags?: string[]
  privacy?: string
  chatId?: string
  parseMode?: string
}): Promise<{ jobId: string; success: boolean; platformPostId?: string; platformPostUrl?: string }> {
  const body: Record<string, unknown> = { platform: params.platform, action: params.action }
  if (params.connectionId) body.connectionId = params.connectionId
  if (params.mediaUrl) body.mediaUrl = params.mediaUrl
  if (params.mediaItems && params.mediaItems.length > 0) body.mediaItems = params.mediaItems
  if (params.caption) body.caption = params.caption
  if (params.title) body.title = params.title
  if (params.description) body.description = params.description
  if (params.tags && params.tags.length > 0) body.tags = params.tags
  if (params.privacy) body.privacy = params.privacy
  if (params.chatId) body.chatId = params.chatId
  if (params.parseMode) body.parseMode = params.parseMode

  return apiJson("/v1/social/publish", {
    body,
    workflowId: true,
    label: "Failed to publish to social media",
  })
}

export async function getSocialConnections(): Promise<{ connections: Array<SocialConnection & { created_at: string }> }> {
  return apiJson("/v1/social/connections", {
    method: "GET",
    label: "Failed to fetch social connections",
  })
}

export async function getSocialAuthUrl(platform: string): Promise<{ url: string }> {
  return apiJson(`/v1/social/auth-url?platform=${encodeURIComponent(platform)}`, {
    method: "GET",
    label: "Failed to get auth URL",
  })
}

export async function disconnectSocial(connectionId: string): Promise<{ success: boolean }> {
  return apiJson(`/v1/social/connections/${encodeURIComponent(connectionId)}`, {
    method: "DELETE",
    label: "Failed to disconnect",
  })
}

export async function connectTelegram(botToken: string) {
  return apiJson<{ success: boolean; botName: string; botUsername: string }>(
    "/v1/social/telegram/connect",
    { body: { botToken }, label: "Failed to connect Telegram bot" },
  )
}

export async function activateTelegramTrigger(params: {
  workflowId: string
  connectionId: string
  chatIdFilter?: string
  messageTypeFilters?: string[]
}) {
  return apiJson<{ triggerId: string; webhookToken: string }>(
    "/v1/telegram/triggers",
    { body: params, label: "Failed to activate Telegram trigger" },
  )
}

export async function deactivateTelegramTrigger(triggerId: string) {
  return apiJson<{ success: boolean }>(
    `/v1/telegram/triggers/${encodeURIComponent(triggerId)}`,
    { method: "DELETE", label: "Failed to deactivate Telegram trigger" },
  )
}

// ---------------------------------------------------------------------------
// Published Apps (Mini-Apps)
// ---------------------------------------------------------------------------

export interface AppVersion {
  version: number
  id: string
  createdAt: string
}

export interface PublishedApp {
  id: string
  workflowId: string
  projectId: string | null
  creatorId: string
  version: number
  slug: string
  name: string
  description: string
  iconUrl: string | null
  snapshotNodes: unknown[]
  snapshotEdges: unknown[]
  snapshotSettings: Record<string, unknown>
  isActive: boolean
  isListed: boolean
  isEmbeddable: boolean
  allowedOrigins: string[]
  estimatedCredits: number
  baseEstimatedCredits?: number
  thumbnailNodeId: string | null
  category: string
  outputTypes: string[]
  tags: string[]
  previewMediaUrl: string | null
  previewMediaType: string | null
  supportsRemix: boolean
  creatorDisplayName: string | null
  totalRunCount: number
  favoriteCount: number
  createdAt: string
  runCount?: number
  versions?: AppVersion[]
  monetizationEnabled?: boolean
  monetizationFlatFee?: number
  monetizationPercent?: number
  publishType?: "app" | "component"
  componentMetadata?: Record<string, unknown> | null
  deletedAt: string | null
}

/** Slim card type returned by /v1/apps/browse (no snapshot data) */
export interface AppBrowseCard {
  id: string
  slug: string
  name: string
  description: string
  iconUrl: string | null
  estimatedCredits: number
  category: string
  outputTypes: string[]
  tags: string[]
  previewMediaUrl: string | null
  previewMediaType: string | null
  supportsRemix: boolean
  creatorId: string
  creatorDisplayName: string | null
  totalRunCount: number
  favoriteCount: number
  createdAt: string
  publishType?: "app" | "component"
  componentMetadata?: Record<string, unknown> | null
}

export interface AppRun {
  id: string
  appId: string
  executionId: string | null
  runnerId: string
  creditsUsed: number
  name: string | null
  inputValues: Record<string, Record<string, unknown>> | null
  status: string
  createdAt: string
  version?: number | null
  thumbnailUrl?: string | null
  // Flat fields from list endpoint
  nodeStates?: Record<string, unknown> | null
  completedNodes?: number
  totalNodes?: number
  completedAt?: string | null
  hiddenNodes?: string[] | null
  // Nested execution from detail endpoint
  execution?: {
    status: string
    nodeStates: Record<string, unknown>
    totalNodes: number
    completedNodes: number
    failedNodes: number
    totalCreditsUsed: number | null
    completedAt: string | null
    errorMessage: string | null
  }
}

/** Publish a workflow as a mini-app or component. */
export async function publishApp(data: {
  workflowId: string
  name: string
  slug?: string
  description?: string
  iconUrl?: string
  thumbnailNodeId?: string | null
  category?: string
  outputTypes?: string[]
  tags?: string[]
  previewMediaUrl?: string
  previewMediaType?: string
  supportsRemix?: boolean
  isListed?: boolean
  publishType?: "app" | "component"
  componentMetadata?: Record<string, unknown>
}): Promise<PublishedApp> {
  return apiRequest<PublishedApp>(
    "/v1/apps/publish",
    "Failed to publish app",
    { method: "POST", body: data },
  )
}

/** Get latest published app for a workflow (owner only). Returns null if none. */
export async function getAppByWorkflow(workflowId: string): Promise<PublishedApp | null> {
  try {
    return await apiRequest<PublishedApp>(
      `/v1/apps/by-workflow/${encodeURIComponent(workflowId)}`,
      "Failed to load app",
    )
  } catch {
    return null
  }
}

/** Get the latest version info for a component by slug. */
export async function getLatestComponentVersion(slug: string): Promise<{
  latestVersion: number
  latestVersionId: string
}> {
  return apiRequest(
    `/v1/apps/by-slug/${encodeURIComponent(slug)}/latest-version`,
    "Failed to fetch latest component version",
  )
}

/** List creator's published apps. */
export async function getMyApps(): Promise<PublishedApp[]> {
  return apiRequest<PublishedApp[]>(
    "/v1/apps/mine",
    "Failed to load apps",
  )
}

/** Update published app metadata. */
export async function updateApp(appId: string, data: {
  name?: string
  description?: string
  isActive?: boolean
  isListed?: boolean
  isEmbeddable?: boolean
  allowedOrigins?: string[]
  thumbnailNodeId?: string | null
  category?: string
  outputTypes?: string[]
  tags?: string[]
  previewMediaUrl?: string | null
  previewMediaType?: string | null
  supportsRemix?: boolean
  monetizationEnabled?: boolean
  monetizationFlatFee?: number
  monetizationPercent?: number
}): Promise<PublishedApp> {
  return apiRequest<PublishedApp>(
    `/v1/apps/${encodeURIComponent(appId)}`,
    "Failed to update app",
    { method: "PATCH", body: data },
  )
}

/** Soft-delete a published app (sets deleted_at + is_active=false; restorable via /restore). */
export async function deactivateApp(appId: string): Promise<void> {
  return apiRequest(
    `/v1/apps/${encodeURIComponent(appId)}`,
    "Failed to delete app",
    { method: "DELETE" },
  )
}

/** Restore a soft-deleted app (clears deleted_at, leaves is_active=false). */
export async function restoreApp(appId: string): Promise<{ success: boolean; restored: boolean }> {
  return apiRequest(
    `/v1/apps/${encodeURIComponent(appId)}/restore`,
    "Failed to restore app",
    { method: "POST" },
  )
}

/** Admin-only: hard-delete a soft-deleted app for legal compliance. */
export async function expungeApp(appId: string, reason: string): Promise<{
  success: boolean
  expungedAt: string
  r2KeysCollected: number
  r2KeysDeleted: number
  r2Errors: number
  auditWarning?: string
}> {
  return apiRequest(
    `/v1/admin/apps/${encodeURIComponent(appId)}/expunge`,
    "Failed to expunge app",
    { method: "DELETE", body: { reason } },
  )
}

/** Browse marketplace apps (public). */
export async function browseApps(params: {
  cursor?: string
  limit?: number
  category?: string
  outputType?: string
  tag?: string
  search?: string
  sort?: "popular" | "newest" | "most-favorited"
  creatorId?: string
  favoritesOnly?: boolean
  publishType?: "app" | "component"
}): Promise<{ data: AppBrowseCard[]; nextCursor: string | null }> {
  const qs = new URLSearchParams()
  if (params.cursor) qs.set("cursor", params.cursor)
  if (params.limit) qs.set("limit", String(params.limit))
  if (params.category) qs.set("category", params.category)
  if (params.outputType) qs.set("outputType", params.outputType)
  if (params.tag) qs.set("tag", params.tag)
  if (params.search) qs.set("search", params.search)
  if (params.sort) qs.set("sort", params.sort)
  if (params.creatorId) qs.set("creatorId", params.creatorId)
  if (params.favoritesOnly) qs.set("favoritesOnly", "true")
  if (params.publishType) qs.set("publishType", params.publishType)
  const qsStr = qs.toString()
  const headers: Record<string, string> = params.favoritesOnly ? await getAuthHeaders() : {}
  const res = await fetch(`/v1/apps/browse${qsStr ? `?${qsStr}` : ""}`, { headers })
  if (!res.ok) throw new Error("Failed to browse apps")
  return res.json()
}

/** Toggle favorite on a marketplace app. */
export async function toggleAppFavorite(appId: string): Promise<{ favorited: boolean }> {
  return apiRequest<{ favorited: boolean }>(
    "/v1/apps/favorite",
    "Failed to toggle favorite",
    { method: "POST", body: { appId } },
  )
}

/** Get user's favorited app IDs. */
export async function getAppFavorites(): Promise<string[]> {
  const json = await apiRequest<{ data: string[] }>(
    "/v1/apps/favorites",
    "Failed to fetch favorites",
  )
  return json.data
}

/** Load a published app by slug (public). Optionally load a specific version. */
export async function getPublishedApp(slug: string, version?: number): Promise<PublishedApp> {
  const params = new URLSearchParams()
  if (version) params.set("version", String(version))
  const qs = params.toString()
  return apiRequest<PublishedApp>(
    `/v1/app/${encodeURIComponent(slug)}${qs ? `?${qs}` : ""}`,
    "Failed to load app",
    { skipAuth: true },
  )
}

/** Run a published app (runner pays credits). */
export async function runPublishedApp(
  slug: string,
  inputOverrides?: Record<string, Record<string, unknown>>,
  runId?: string,
  version?: number,
  headless?: boolean,
): Promise<{ executionId: string; runId: string; status: string }> {
  return apiRequest(
    `/v1/app/${encodeURIComponent(slug)}/run`,
    "Failed to run app",
    { method: "POST", body: { inputOverrides, runId, version, headless } },
  )
}

/** Execute a component node — creates a wrapper job and runs the inner workflow. */
export async function executeComponent(params: {
  appSlug: string
  inputOverrides?: Record<string, Record<string, unknown>>
  pinnedVersion?: number
  workflowId?: string
}): Promise<{ jobId: string }> {
  return apiRequest(
    "/v1/component/execute",
    "Failed to execute component",
    { method: "POST", body: params },
  )
}

/** Estimate component credits with setting overrides. */
export async function estimateComponentCredits(params: {
  appSlug: string
  pinnedVersion?: number
  exposedSettings?: Record<string, unknown>
}): Promise<{ estimatedCredits: number }> {
  return apiRequest(
    "/v1/component/estimate-credits",
    "Failed to estimate credits",
    { method: "POST", body: params },
  )
}

/** Create a draft run (before execution). */
export async function createAppRun(
  slug: string,
  inputValues?: Record<string, Record<string, unknown>>,
  version?: number,
): Promise<{ id: string; createdAt: string; inputValues: Record<string, Record<string, unknown>> | null; status: string }> {
  return apiRequest(
    `/v1/app/${encodeURIComponent(slug)}/runs`,
    "Failed to create run",
    { method: "POST", body: { inputValues, version } },
  )
}

/** Update a draft run's input values, name, hidden nodes, and/or edited node states. */
export async function updateAppRunInputs(
  slug: string,
  runId: string,
  inputValues?: Record<string, Record<string, unknown>>,
  name?: string | null,
  hiddenNodes?: string[],
  nodeStates?: Record<string, unknown>,
): Promise<{ id: string; inputValues: Record<string, Record<string, unknown>> }> {
  const body: Record<string, unknown> = {}
  if (inputValues !== undefined) body.inputValues = inputValues
  if (name !== undefined) body.name = name
  if (hiddenNodes !== undefined) body.hiddenNodes = hiddenNodes
  if (nodeStates !== undefined) body.nodeStates = nodeStates
  return apiRequest(
    `/v1/app/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}`,
    "Failed to update run",
    { method: "PATCH", body },
  )
}

/** List runner's past runs for a published app. */
export async function getAppRuns(
  slug: string,
  cursor?: string,
  options?: { archived?: boolean },
): Promise<{ data: AppRun[]; nextCursor: string | null }> {
  const params = new URLSearchParams()
  if (cursor) params.set("cursor", cursor)
  if (options?.archived) params.set("archived", "true")
  const qs = params.toString()
  return apiRequest(
    `/v1/app/${encodeURIComponent(slug)}/runs${qs ? `?${qs}` : ""}`,
    "Failed to load runs",
  )
}

/** Get a specific run's details. */
export async function getAppRun(slug: string, runId: string): Promise<AppRun> {
  return apiRequest<AppRun>(
    `/v1/app/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}`,
    "Failed to load run",
  )
}

/** Soft-delete a run (move to archive). The run can be restored from the archive view. */
export async function deleteAppRun(slug: string, runId: string): Promise<void> {
  return apiRequest(
    `/v1/app/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}`,
    "Failed to archive run",
    { method: "DELETE" },
  )
}

/** Restore a soft-deleted run from the archive. */
export async function restoreAppRun(slug: string, runId: string): Promise<void> {
  return apiRequest(
    `/v1/app/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}/restore`,
    "Failed to restore run",
    { method: "POST", body: {} },
  )
}

/** Permanently delete an archived run. Run must already be soft-deleted. */
export async function permanentlyDeleteAppRun(slug: string, runId: string): Promise<void> {
  return apiRequest(
    `/v1/app/${encodeURIComponent(slug)}/runs/${encodeURIComponent(runId)}/permanent`,
    "Failed to permanently delete run",
    { method: "DELETE" },
  )
}

export interface ArchivedAppRun {
  id: string
  appSlug: string | null
  appName: string | null
  appIconUrl: string | null
  createdAt: string
  deletedAt: string
  name: string | null
  status: string
  creditsUsed: number
  thumbnailUrl: string | null
  completedAt: string | null
}

/** List all archived runs across all apps for the authenticated user. */
export async function getArchivedRuns(cursor?: string): Promise<{ data: ArchivedAppRun[]; nextCursor: string | null }> {
  const params = new URLSearchParams()
  if (cursor) params.set("cursor", cursor)
  const qs = params.toString()
  return apiRequest(
    `/v1/me/archived-runs${qs ? `?${qs}` : ""}`,
    "Failed to load archived runs",
  )
}

/** Poll execution status for an app run (reuses presentation status endpoint pattern). */
export async function getAppExecutionStatus(execId: string): Promise<{
  status: string
  node_states: Record<string, unknown>
  total_nodes: number
  completed_nodes: number
  failed_nodes: number
  error_message: string | null
}> {
  const res = await apiRequest<{ data: Record<string, unknown> }>(
    `/v1/workflow-executions/${encodeURIComponent(execId)}`,
    "Failed to get execution status",
  )
  const d = res.data
  return {
    status: d.status as string,
    node_states: (d.nodeStates ?? {}) as Record<string, unknown>,
    total_nodes: (d.totalNodes ?? 0) as number,
    completed_nodes: (d.completedNodes ?? 0) as number,
    failed_nodes: (d.failedNodes ?? 0) as number,
    error_message: (d.errorMessage ?? null) as string | null,
  }
}

// ---------------------------------------------------------------------------
// App Analytics (Creator)
// ---------------------------------------------------------------------------

export interface AnalyticsPeriod {
  totalRuns: number
  uniqueRunners: number
  totalCredits: number
  successfulRuns: number
  failedRuns: number
}

export interface DailyAnalytics {
  date: string
  totalRuns: number
  uniqueRunners: number
  totalCredits: number
  successfulRuns: number
  failedRuns: number
}

export interface AppAnalytics {
  today: AnalyticsPeriod
  last7Days: AnalyticsPeriod
  last30Days: AnalyticsPeriod
  allTime: AnalyticsPeriod
  daily: DailyAnalytics[]
}

/** Get aggregated analytics for a published app. */
export async function getAppAnalytics(appId: string): Promise<AppAnalytics> {
  return apiRequest<AppAnalytics>(
    `/v1/apps/${encodeURIComponent(appId)}/analytics`,
    "Failed to load analytics",
  )
}

export interface AnalyticsRun {
  id: string
  runnerId: string
  creditsUsed: number
  createdAt: string
  status: string
  completedNodes: number
  totalNodes: number
  completedAt: string | null
}

/** Get paginated run list for creator analytics. */
export async function getAppAnalyticsRuns(appId: string, cursor?: string): Promise<{ data: AnalyticsRun[]; nextCursor: string | null }> {
  const params = new URLSearchParams()
  if (cursor) params.set("cursor", cursor)
  const qs = params.toString()
  return apiRequest(
    `/v1/apps/${encodeURIComponent(appId)}/analytics/runs${qs ? `?${qs}` : ""}`,
    "Failed to load analytics runs",
  )
}

// ---------------------------------------------------------------------------
// Monetization Defaults & Earnings
// ---------------------------------------------------------------------------

/** Get user's default monetization fees. */
export async function getMonetizationDefaults(): Promise<{ flatFee: number; percent: number }> {
  return apiRequest("/v1/user/monetization-defaults", "Failed to get monetization defaults")
}

/** Update user's default monetization fees. */
export async function updateMonetizationDefaults(data: { flatFee: number; percent: number }): Promise<{ flatFee: number; percent: number }> {
  return apiRequest("/v1/user/monetization-defaults", "Failed to update monetization defaults", {
    method: "PUT",
    body: data,
  })
}

/** Get paginated earnings for the current user. */
export async function getUserEarnings(params?: { cursor?: string; limit?: number }): Promise<{
  totalLifetime: number
  thisMonth: number
  last30Days: number
  items: Array<{
    id: string
    appId: string
    appName: string
    runId: string
    runnerId: string
    baseCost: number
    flatFee: number
    percentFee: number
    totalEarned: number
    totalCharged: number
    createdAt: string
  }>
  nextCursor: string | null
}> {
  const query = new URLSearchParams()
  if (params?.cursor) query.set("cursor", params.cursor)
  if (params?.limit) query.set("limit", String(params.limit))
  const qs = query.toString()
  return apiRequest(`/v1/user/earnings${qs ? `?${qs}` : ""}`, "Failed to get earnings")
}

/** Get earnings summary for a specific published app. */
export async function getAppEarnings(appId: string): Promise<{
  totalEarned: number
  paidRuns: number
  thisMonth: number
}> {
  return apiRequest(`/v1/apps/${encodeURIComponent(appId)}/earnings`, "Failed to get app earnings")
}

// ---------- QA Check ----------

export function qaCheckApi(params: {
  content: string
  checkType?: "content" | "quality" | "consistency" | "safety"
  provider?: "claude" | "gpt"
  threshold?: number
  llmModel?: string
}): Promise<{ jobId: string; score: number; approved: boolean; reason: string }> {
  return apiRequest("/v1/qa-check", "QA check failed", {
    method: "POST",
    body: withWorkflowId(params),
  })
}

export function imageCriticApi(params: {
  imageUrl: string
  referenceImageUrl?: string
  prompt?: string
  mode: ImageCriticMode
  threshold?: number
  llmModel?: string
}): Promise<{
  jobId: string
  score: number
  approved: boolean
  feedback: string
  details: {
    perMode?: Partial<Record<Exclude<ImageCriticMode, "all">, { score: number; feedback: string }>>
    issues?: Array<{ category: string; severity: "blocking" | "warning" | "info"; description: string }>
  }
  deduped?: true
}> {
  return apiRequest("/v1/image-critic", "Image critic failed", {
    method: "POST",
    body: withWorkflowId(params),
  })
}

// ---------- Save to Storage ----------

export function saveToStorageApi(params: {
  mediaUrl: string
  filename?: string
  mediaType?: "image" | "video" | "audio"
}): Promise<{ jobId: string; url: string }> {
  return apiRequest("/v1/save-to-storage", "Failed to save to storage", {
    method: "POST",
    body: withWorkflowId(params),
  })
}

// ---------- Reduce (fan-in) ----------

/**
 * Execute a Reduce-strategy job. Aggregates a list of upstream iteration
 * outputs into a single value via the named strategy (concat, vote,
 * pick-best-llm, first-non-empty, merge-json, count, …).
 */
export function executeReduce(input: {
  strategyId: string
  strategyConfig: Record<string, unknown>
  inputs: string[]
}): Promise<{
  jobId: string
  output: string
  meta: ReduceMeta
}> {
  return apiRequest("/v1/reduce", "reduce failed", {
    method: "POST",
    body: withWorkflowId(input),
  })
}

// ---------------------------------------------------------------------------
// Workflow Template Marketplace
// ---------------------------------------------------------------------------

/** Full template with snapshot data */
export interface WorkflowTemplate {
  id: string
  workflowId: string
  creatorId: string
  slug: string
  name: string
  description: string | null
  markdownDescription: string | null
  snapshotNodes: unknown[]
  snapshotEdges: unknown[]
  snapshotSettings: Record<string, unknown>
  nodeTypesUsed: string[]
  providersUsed: string[]
  nodeCount: number
  estimatedCredits: number
  complexity: "simple" | "intermediate" | "advanced"
  category: string
  outputTypes: string[]
  tags: string[]
  previewMediaUrl: string | null
  previewMediaType: string | null
  creatorDisplayName: string | null
  cloneCount: number
  favoriteCount: number
  isActive: boolean
  isListed: boolean
  createdAt: string
  updatedAt: string
}

/** Slim card type returned by /v1/templates/browse (no snapshot data) */
export interface TemplateBrowseCard {
  id: string
  slug: string
  name: string
  description: string | null
  nodeTypesUsed: string[]
  providersUsed: string[]
  nodeCount: number
  estimatedCredits: number
  complexity: "simple" | "intermediate" | "advanced"
  category: string
  outputTypes: string[]
  tags: string[]
  previewMediaUrl: string | null
  previewMediaType: string | null
  creatorId: string
  creatorDisplayName: string | null
  cloneCount: number
  favoriteCount: number
  createdAt: string
}

export async function browseTemplates(params: {
  cursor?: string
  limit?: number
  category?: string
  outputType?: string
  tag?: string
  search?: string
  sort?: "popular" | "newest" | "most-favorited"
  nodeType?: string
  provider?: string
  complexity?: string
  favoritesOnly?: boolean
}): Promise<{ data: TemplateBrowseCard[]; nextCursor: string | null }> {
  const qs = new URLSearchParams()
  if (params.cursor) qs.set("cursor", params.cursor)
  if (params.limit) qs.set("limit", String(params.limit))
  if (params.category) qs.set("category", params.category)
  if (params.outputType) qs.set("outputType", params.outputType)
  if (params.tag) qs.set("tag", params.tag)
  if (params.search) qs.set("search", params.search)
  if (params.sort) qs.set("sort", params.sort)
  if (params.nodeType) qs.set("nodeType", params.nodeType)
  if (params.provider) qs.set("provider", params.provider)
  if (params.complexity) qs.set("complexity", params.complexity)
  if (params.favoritesOnly) qs.set("favoritesOnly", "true")
  const query = qs.toString()
  return apiRequest<{ data: TemplateBrowseCard[]; nextCursor: string | null }>(
    `/v1/templates/browse${query ? `?${query}` : ""}`,
    "Failed to browse templates",
    { skipAuth: !params.favoritesOnly },
  )
}

export async function getTemplateBySlug(slug: string): Promise<WorkflowTemplate> {
  return apiRequest<WorkflowTemplate>(
    `/v1/templates/${encodeURIComponent(slug)}`,
    "Failed to load template",
    { skipAuth: true },
  )
}

export async function publishTemplate(data: {
  workflowId: string
  name: string
  description?: string
  markdownDescription?: string
  slug?: string
  category?: string
  outputTypes?: string[]
  tags?: string[]
  previewMediaUrl?: string
  previewMediaType?: string
  isListed?: boolean
}): Promise<WorkflowTemplate> {
  return apiRequest<WorkflowTemplate>(
    "/v1/templates/publish",
    "Failed to publish template",
    { method: "POST", body: data },
  )
}

export async function getMyTemplates(): Promise<WorkflowTemplate[]> {
  return apiRequest<WorkflowTemplate[]>(
    "/v1/templates/mine",
    "Failed to fetch templates",
  )
}

export async function updateTemplate(id: string, data: Record<string, unknown>): Promise<WorkflowTemplate> {
  return apiRequest<WorkflowTemplate>(
    `/v1/templates/${encodeURIComponent(id)}`,
    "Failed to update template",
    { method: "PATCH", body: data },
  )
}

export async function deleteTemplate(id: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(
    `/v1/templates/${encodeURIComponent(id)}`,
    "Failed to delete template",
    { method: "DELETE" },
  )
}

export async function cloneTemplate(slug: string, projectId: string, name?: string): Promise<{ workflowId: string; projectId: string }> {
  return apiRequest<{ workflowId: string; projectId: string }>(
    `/v1/templates/${encodeURIComponent(slug)}/clone`,
    "Failed to clone template",
    { method: "POST", body: { projectId, ...(name ? { name } : {}) } },
  )
}

export async function toggleTemplateFavorite(templateId: string): Promise<{ favorited: boolean }> {
  return apiRequest<{ favorited: boolean }>(
    "/v1/templates/favorite",
    "Failed to toggle favorite",
    { method: "POST", body: { templateId } },
  )
}

export async function getTemplateFavorites(): Promise<string[]> {
  const res = await apiRequest<{ data: string[] }>(
    "/v1/templates/favorites",
    "Failed to fetch favorites",
  )
  return res.data
}

// --- Community Sharing ---

// Listing shape is the single source of truth in `@nodaro/shared`; re-export so
// existing `@/lib/api` importers of `CommunityCard` keep working.
export type { CommunityCard } from "@nodaro/shared"

export async function browseCommunity(params: {
  entityType?: string; q?: string; category?: string
  sort?: CommunitySort; cursor?: string; limit?: number
}): Promise<{ data: CommunityCard[]; nextCursor: string | null }> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") qs.set(k, String(v))
  const query = qs.toString()
  return apiRequest(`/v1/community/browse${query ? `?${query}` : ""}`, "Failed to browse community")
}

export async function getCommunityListing(slug: string): Promise<{ data: CommunityCard }> {
  return apiRequest(`/v1/community/detail/${encodeURIComponent(slug)}`, "Failed to load listing")
}

export async function cloneCommunityListing(id: string, entityType: string): Promise<{ entityType: string; id: string }> {
  return apiRequest(`/v1/community/listings/${encodeURIComponent(id)}/clone`, "Failed to clone", { method: "POST", body: { entityType } })
}

export async function toggleCommunityFavorite(id: string): Promise<{ favorited: boolean }> {
  return apiRequest(`/v1/community/listings/${encodeURIComponent(id)}/favorite`, "Failed to favorite", { method: "POST", body: {} })
}

export async function getCommunityFavorites(): Promise<{ data: CommunityCard[] }> {
  return apiRequest(`/v1/community/favorites`, "Failed to load favorites")
}

export async function reportCommunityListing(id: string, reason: string): Promise<{ ok: boolean }> {
  return apiRequest(`/v1/community/listings/${encodeURIComponent(id)}/report`, "Failed to report", { method: "POST", body: { reason } })
}

export async function publishToCommunity(entityType: string, id: string, body: {
  title: string; description?: string; category?: string; style?: string; tags?: string[]
  attestation: true; likenessAttestation?: boolean
}): Promise<{ slug: string; id: string }> {
  return apiRequest(`/v1/admin/community/${encodeURIComponent(entityType)}/${encodeURIComponent(id)}/publish`, "Failed to publish", { method: "POST", body })
}

export async function getCommunityReports(): Promise<{ data: Array<Record<string, unknown>> }> {
  return apiRequest(`/v1/admin/community/reports`, "Failed to load reports")
}

export async function takedownCommunityListing(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`/v1/admin/community/listings/${encodeURIComponent(id)}/takedown`, "Failed to take down", { method: "POST", body: {} })
}

// --- Tutorials ---
// After migration 114 the system supports two tutorial flavors sharing one
// taxonomy: video tutorials (table `tutorials`) and flow tutorials
// (workflow_templates with 'tutorial' in listed_in[]). The public endpoint
// returns both grouped by category; admin endpoints manage them separately.

/** Shared taxonomy row used by both tutorial flavors. */
export interface TutorialCategory {
  id: string
  name: string
  slug: string
  description: string | null
  sortOrder: number
  isEnabled: boolean
  createdAt: string
  updatedAt: string
}

/** Embedded category shape returned alongside admin tutorial rows. */
export interface TutorialCategoryEmbed {
  id: string
  name: string
  slug: string
  sortOrder: number
}

/** Full tutorial row as returned by /v1/admin/tutorials (CRUD endpoints). */
export interface AdminTutorial {
  id: string
  type: "video"
  title: string
  description: string | null
  videoUrl: string
  thumbnailUrl: string | null
  categoryId: string
  category: TutorialCategoryEmbed | null
  sortOrder: number
  isEnabled: boolean
  createdAt: string
  updatedAt: string
}

/** Video tutorial inside a grouped category bucket (public GET /v1/tutorials). */
export interface VideoTutorialItem {
  id: string
  type: "video"
  title: string
  description: string | null
  videoUrl: string
  thumbnailUrl: string | null
  categoryId: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/** Flow tutorial inside a grouped category bucket — a workflow_template
 *  flagged 'tutorial'. Mirrors the backend's toFlowResponse mapping. */
export interface FlowTutorialItem {
  id: string
  type: "flow"
  templateId: string
  slug: string | null
  title: string
  description: string | null
  markdownDescription: string | null
  previewMediaUrl: string | null
  previewMediaType: "image" | "video" | null
  complexity: "simple" | "intermediate" | "advanced"
  estimatedCredits: number
  nodeTypesUsed: string[]
  providersUsed: string[]
  nodeCount: number
  categoryId: string
  tutorialSortOrder: number
  workflowId: string
  createdAt: string
}

/** Grouped bucket: one per enabled tutorial_category. */
export interface TutorialCategoryWithItems {
  id: string
  name: string
  slug: string
  sortOrder: number
  videos: VideoTutorialItem[]
  flows: FlowTutorialItem[]
}

/** Slim template row returned by the admin cross-user list endpoint. */
export interface AdminWorkflowTemplateRow {
  id: string
  slug: string | null
  name: string
  description: string | null
  listedIn: string[]
  isListed: boolean
  isTutorial: boolean
  tutorialCategoryId: string | null
  tutorialSortOrder: number
  isActive: boolean
  category: string
  nodeCount: number
  complexity: "simple" | "intermediate" | "advanced"
  previewMediaUrl: string | null
  previewMediaType: "image" | "video" | null
  creatorId: string
  creatorDisplayName: string | null
  cloneCount: number
  favoriteCount: number
  createdAt: string
}

// ---- Public ----

/** GET /v1/tutorials — grouped video + flow tutorials by category. */
export async function fetchTutorialsGrouped(): Promise<{
  categories: TutorialCategoryWithItems[]
}> {
  return apiRequest<{ categories: TutorialCategoryWithItems[] }>(
    "/v1/tutorials",
    "Failed to fetch tutorials",
    { skipAuth: true },
  )
}

// ---- Admin: video tutorials CRUD ----

export async function fetchAdminTutorials(): Promise<AdminTutorial[]> {
  const res = await apiRequest<{ data: AdminTutorial[] }>(
    "/v1/admin/tutorials",
    "Failed to fetch tutorials",
  )
  return res.data
}

export async function createTutorial(data: {
  title: string
  video_url: string
  description?: string
  thumbnail_url?: string
  category_id: string
  sort_order?: number
  is_enabled?: boolean
}): Promise<AdminTutorial> {
  const res = await apiRequest<{ data: AdminTutorial }>(
    "/v1/admin/tutorials",
    "Failed to create tutorial",
    { method: "POST", body: data },
  )
  return res.data
}

export async function updateTutorial(id: string, data: {
  title?: string
  video_url?: string
  description?: string | null
  thumbnail_url?: string | null
  category_id?: string
  sort_order?: number
  is_enabled?: boolean
}): Promise<AdminTutorial> {
  const res = await apiRequest<{ data: AdminTutorial }>(
    `/v1/admin/tutorials/${encodeURIComponent(id)}`,
    "Failed to update tutorial",
    { method: "PATCH", body: data },
  )
  return res.data
}

export async function deleteTutorial(id: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(
    `/v1/admin/tutorials/${encodeURIComponent(id)}`,
    "Failed to delete tutorial",
    { method: "DELETE" },
  )
}

// ---- Admin: tutorial categories CRUD ----

export async function fetchAdminTutorialCategories(): Promise<TutorialCategory[]> {
  const res = await apiRequest<{ data: TutorialCategory[] }>(
    "/v1/admin/tutorial-categories",
    "Failed to fetch tutorial categories",
  )
  return res.data
}

export async function createTutorialCategory(data: {
  name: string
  slug: string
  description?: string
  sort_order?: number
  is_enabled?: boolean
}): Promise<TutorialCategory> {
  const res = await apiRequest<{ data: TutorialCategory }>(
    "/v1/admin/tutorial-categories",
    "Failed to create category",
    { method: "POST", body: data },
  )
  return res.data
}

export async function updateTutorialCategory(
  id: string,
  data: {
    name?: string
    slug?: string
    description?: string | null
    sort_order?: number
    is_enabled?: boolean
  },
): Promise<TutorialCategory> {
  const res = await apiRequest<{ data: TutorialCategory }>(
    `/v1/admin/tutorial-categories/${encodeURIComponent(id)}`,
    "Failed to update category",
    { method: "PATCH", body: data },
  )
  return res.data
}

/** Throws `TutorialCategoryInUseError` (with videoCount + flowCount) on 409. */
export async function deleteTutorialCategory(id: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(
    `/v1/admin/tutorial-categories/${encodeURIComponent(id)}`,
    "Failed to delete category",
    { method: "DELETE" },
  )
}

// ---- Admin: cross-user template list + tutorial flag ----

export async function listAdminWorkflowTemplates(params?: {
  cursor?: string
  limit?: number
  search?: string
  listed?: "marketplace" | "tutorial" | "unlisted"
}): Promise<{ data: AdminWorkflowTemplateRow[]; nextCursor: string | null }> {
  const qs = new URLSearchParams()
  if (params?.cursor) qs.set("cursor", params.cursor)
  if (params?.limit) qs.set("limit", String(params.limit))
  if (params?.search) qs.set("search", params.search)
  if (params?.listed) qs.set("listed", params.listed)
  const query = qs.toString()
  return apiRequest<{ data: AdminWorkflowTemplateRow[]; nextCursor: string | null }>(
    `/v1/admin/workflow-templates${query ? `?${query}` : ""}`,
    "Failed to list templates",
  )
}

export async function toggleTemplateTutorialFlag(
  templateId: string,
  data: {
    isTutorial: boolean
    tutorialCategoryId?: string
    tutorialSortOrder?: number
  },
): Promise<AdminWorkflowTemplateRow> {
  const body: Record<string, unknown> = { is_tutorial: data.isTutorial }
  if (data.tutorialCategoryId !== undefined) body.tutorial_category_id = data.tutorialCategoryId
  if (data.tutorialSortOrder !== undefined) body.tutorial_sort_order = data.tutorialSortOrder
  return apiRequest<AdminWorkflowTemplateRow>(
    `/v1/admin/workflow-templates/${encodeURIComponent(templateId)}/tutorial-flag`,
    "Failed to update tutorial flag",
    { method: "PATCH", body },
  )
}

// --- Execution stats (progress bar estimation) ---

export interface ExecutionEstimate {
  estimatedMs: number
  confidence: "exact" | "partial" | "model" | "default"
  sampleCount: number
}

const DEFAULT_ESTIMATE: ExecutionEstimate = {
  estimatedMs: 30000, confidence: "default", sampleCount: 0
}

export async function getExecutionEstimate(
  model: string,
  aspectRatio?: string,
  quality?: string,
  duration?: number,
): Promise<ExecutionEstimate> {
  const params = new URLSearchParams({ model })
  if (aspectRatio) params.set("aspectRatio", aspectRatio)
  if (quality) params.set("quality", quality)
  if (duration) params.set("duration", String(duration))
  const res = await fetch(`${API_BASE_URL}/v1/execution-stats/estimate?${params}`, {
    headers: await getAuthHeaders(),
  })
  if (!res.ok) {
    return DEFAULT_ESTIMATE
  }
  return res.json()
}

export async function batchExecutionEstimates(
  nodes: { nodeId: string; model: string; aspectRatio?: string; quality?: string; duration?: number }[],
): Promise<Record<string, ExecutionEstimate>> {
  if (nodes.length === 0) return {}
  const res = await fetch(`${API_BASE_URL}/v1/execution-stats/batch-estimate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify({ nodes }),
  })
  if (!res.ok) {
    const defaults: Record<string, ExecutionEstimate> = {}
    for (const n of nodes) {
      defaults[n.nodeId] = DEFAULT_ESTIMATE
    }
    return defaults
  }
  const { estimates } = await res.json()
  return estimates
}

// ──────────────────────────────────────────────────────────────────────────
// Node defaults (admin)
// ──────────────────────────────────────────────────────────────────────────

import type { AdminDefault } from "@/lib/node-defaults"

export async function fetchNodeDefaults(): Promise<AdminDefault[]> {
  const res = await fetch(`${API_BASE_URL}/v1/node-defaults`, {
    headers: { ...(await getAuthHeaders()) },
  })
  if (!res.ok) return []
  const { defaults } = await res.json()
  return defaults ?? []
}

export async function fetchAdminNodeDefaults(): Promise<AdminDefault[]> {
  const res = await fetch(`${API_BASE_URL}/v1/admin/node-defaults`, {
    headers: { ...(await getAuthHeaders()) },
  })
  if (!res.ok) throw new Error(`fetchAdminNodeDefaults failed: ${res.status}`)
  const { defaults } = await res.json()
  return defaults ?? []
}

export async function updateAdminNodeDefault(
  nodeType: string,
  body: { provider: string; qualityLevel?: string | null; aspectRatio?: string | null },
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/v1/admin/node-defaults/${nodeType}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(text || `updateAdminNodeDefault failed: ${res.status}`)
  }
}

export async function deleteAdminNodeDefault(nodeType: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/v1/admin/node-defaults/${nodeType}`, {
    method: "DELETE",
    headers: { ...(await getAuthHeaders()) },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(text || `deleteAdminNodeDefault failed: ${res.status}`)
  }
}
