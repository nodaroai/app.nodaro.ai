import type { CharacterAspectRatio, CharacterAttachColumn, EntityStyle } from "@nodaro/shared"
import type { NodaroClient } from "../client.js"

/**
 * Re-export the shared `EntityStyle` union (realistic | anime | 3d-pixar |
 * illustration) and `CHARACTER_STYLES` runtime tuple so SDK consumers don't
 * have to add `@nodaro/shared` as a second dependency just to typecheck the
 * `style` field. Single source of truth lives in `@nodaro/shared/entity-prompts`.
 */
export type { EntityStyle } from "@nodaro/shared"
export { CHARACTER_STYLES } from "@nodaro/shared"

/**
 * Re-export the 4-value aspect-ratio union accepted by the generate-character*
 * routes. Single source of truth lives in `@nodaro/shared`. See
 * `CHARACTER_ASPECT_DEFAULTS` for the per-asset-type defaults.
 */
export type { CharacterAspectRatio } from "@nodaro/shared"
export { CHARACTER_ASPECT_OPTIONS, CHARACTER_ASPECT_DEFAULTS } from "@nodaro/shared"

/**
 * A character record returned by Nodaro's REST API. Mirrors the camelCase
 * shape produced by `backend/src/routes/characters.ts::toCamel()`.
 *
 * `expressions`, `poses`, `motions`, `angles`, `bodyAngles`,
 * `lightingVariations` are independent buckets keyed by a human-readable
 * variant name (e.g. `"smile"`, `"standing"`, `"3/4 left"`). Each entry's
 * `url` points at an R2-hosted asset.
 *
 * Identity-foundation fields:
 *   - `referencePhotos` — caller-supplied real-life refs (max one per
 *     non-`other` kind; cap 20 total). Drive the i2v / i2i path when a
 *     provider supports multi-image conditioning.
 *   - `realLifeRefsByVariant` — per-variant reference URLs (cap 20 keys,
 *     5 URLs per key). Keys are lowercased+trimmed.
 *   - `referenceVideosByVariant` — per-label user-uploaded reference VIDEO
 *     URLs (cap 20 keys, 5 URLs per key, lowercased+trimmed keys). Mirrors
 *     `realLifeRefsByVariant` for video clips (e.g. emotion takes). Read the
 *     chosen URLs off the row to drive generate-video's `referenceVideoUrls`.
 *   - `seedPrompt` — short prompt fragment that scaffolds portrait gen.
 *   - `canonicalDescription` — ~80–120-word LLM-authored visual caption,
 *     populated by `approvePortrait()` / `recaption()`.
 */
export interface Character {
  id: string
  userId: string
  nodeId: string
  projectId: string | null
  name: string
  description: string | null
  gender: string | null
  style: string | null
  baseOutfit: string | null
  sourceImageUrl: string | null
  expressions: Array<{ name: string; url: string }> | null
  poses: Array<{ name: string; url: string }> | null
  lightingVariations: Array<{ name: string; url: string }> | null
  angles: Array<{ name: string; url: string }> | null
  bodyAngles: Array<{ name: string; url: string }> | null
  motions: Array<{ name: string; url: string }> | null
  /** Per-label user-uploaded reference VIDEO URLs (R2), keyed by a
   *  caller-owned label (lowercased+trimmed server-side). Mirrors
   *  `realLifeRefsByVariant` for video clips; read the chosen URLs off the row
   *  to feed generate-video's `referenceVideoUrls`. Defaults to `{}`. */
  referenceVideosByVariant?: Record<string, string[]> | null
  /** `voiceType` records the selected voice's KIND (premade voices are
   *  addressed by name; library/custom voices by id at text-to-speech time).
   *  Optional — a character may have no voice, or a legacy voice predating the
   *  field. */
  voice: { voiceId: string; voiceName: string; traits: string; voiceType?: "premade" | "library" | "custom" } | null
  personality: {
    mood: string
    speechStyle: string
    movementStyle: string
    behavioralNotes: string
  } | null
  /** ~80–120-word LLM-authored visual caption (approve-portrait / recaption).
   *  Optional on the read surface so existing literal consumers don't break;
   *  the route always returns it (string | null). */
  canonicalDescription?: string | null
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * GET /v1/characters/:id appends three live-progress buckets the studio uses
 * to rehydrate spinners after a reload. Optional in the SDK surface — they
 * don't appear on `list()` rows.
 */
export interface CharacterDetail extends Character {
  pendingJobs?: Array<{
    jobId: string
    assetType: "expressions" | "poses" | "angles" | "bodyAngles" | "lighting" | "motions"
    name: string
  }>
  portraitCandidates?: Array<{
    jobId: string
    url: string | undefined
    progress: number
    status: string
  }>
  previousCandidates?: Array<{
    jobId: string
    url: string
    createdAt: string
  }>
}

export type ReferencePhotoKind =
  | "frontFace"
  | "sideLeft"
  | "sideRight"
  | "threeQuarterLeft"
  | "threeQuarterRight"
  | "frontBody"
  | "other"

export interface ReferencePhoto {
  url: string
  kind: ReferencePhotoKind
}

/**
 * Body for `client.characters.upsert()`. Mirrors `upsertCharacterBody` in
 * `backend/src/routes/characters.ts`. Omitting `id` triggers an INSERT;
 * supplying it triggers an UPDATE that only writes the fields you pass —
 * undefined keys are NOT touched on the row.
 *
 * `name` is optional at the type level. The route requires `name` on INSERT
 * (id absent) and rejects with `validation_error` otherwise; on UPDATE the
 * route just ignores `name` when omitted, which lets partial updates like
 * `update(id, { gender: "female" })` succeed without re-sending the same
 * name the caller already has.
 */
export interface UpsertCharacterInput {
  /** UUID of the character row; omit to create. */
  id?: string
  /** Canvas node id the character belongs to. */
  nodeId: string
  workflowId?: string
  projectId?: string
  name?: string
  description?: string
  gender?: string
  style?: string
  baseOutfit?: string
  sourceImageUrl?: string
  expressions?: Array<{ name: string; url: string }>
  poses?: Array<{ name: string; url: string }>
  lightingVariations?: Array<{ name: string; url: string }>
  angles?: Array<{ name: string; url: string }>
  bodyAngles?: Array<{ name: string; url: string }>
  motions?: Array<{ name: string; url: string }>
  /** See `Character.voice.voiceType` — persisted alongside the voice so TTS can
   *  resolve a library/custom voice by id. Optional. */
  voice?: { voiceId: string; voiceName: string; traits: string; voiceType?: "premade" | "library" | "custom" } | null
  personality?: {
    mood: string
    speechStyle: string
    movementStyle: string
    behavioralNotes: string
  } | null
  seedPrompt?: string
  canonicalDescription?: string
  referencePhotos?: ReferencePhoto[]
  /** Per-variant real-life reference URLs. Keys are lowercased+trimmed server-side. */
  realLifeRefsByVariant?: Record<string, string[]>
  /** Per-label user-uploaded reference VIDEO URLs (e.g. emotion takes). Keys
   *  are lowercased+trimmed server-side; max 20 keys, 5 URLs each. Stored R2
   *  URLs are read back off the row to drive generate-video's
   *  `referenceVideoUrls`. */
  referenceVideosByVariant?: Record<string, string[]>
}

export interface UpsertCharacterResult {
  id: string
  name?: string
}

export interface ListCharactersParams {
  /** Restrict to a single project. */
  projectId?: string
  /** When true, return archived characters instead of active ones. */
  archived?: boolean
  /**
   * Max rows to return. Server defaults to 100, caps at 500. Omit to take the
   * server default — passing it just narrows further.
   */
  limit?: number
}

export interface DuplicateCharacterInput {
  /** Optional canvas node id to bind the new row to. */
  nodeId?: string
  /** Optional project to drop the new row into. */
  projectId?: string
}

export interface CharacterUsage {
  workflowCount: number
  workflows: Array<{ id: string; name: string }>
}

/**
 * Input for `client.characters.generate()` — fires the
 * `POST /v1/generate-character` route. Produces 1–10 portrait candidates;
 * each lands as one `jobs` row in `pending` state and is then enqueued for
 * the worker.
 *
 * Provide at least one of `seedPrompt`, `referencePhotos`, or `description`
 * (the backend's refinement rejects empty input with `validation_error`).
 *
 * When `attachToCharacterId` is set, the worker writes the resulting URL
 * directly to `characters.source_image_url` on completion — caller doesn't
 * need a separate `approvePortrait` call for single-candidate runs.
 */
export interface GenerateCharacterInput {
  name: string
  description?: string
  userPrompt?: string
  gender?: string
  style?: EntityStyle
  baseOutfit?: string
  sourceImageUrl?: string
  provider?: string
  /** Auto-attach the result to this character row. */
  attachToCharacterId?: string
  seedPrompt?: string
  referencePhotos?: ReferencePhoto[]
  /** Number of candidate images to generate (1–10; server-validated). */
  count?: number
  /**
   * Explicit aspect ratio. Highest precedence — overrides both the character
   * node toggle and the per-asset-type default (portraits default to `3:4`).
   * Must be one of the 4-value `CharacterAspectRatio` union.
   */
  aspectRatio?: CharacterAspectRatio
  /**
   * Character node toggle (per-canvas-node `defaultAssetAspectRatio`). Wins
   * against the per-asset-type default, loses to `aspectRatio`.
   */
  characterNodeAspectRatio?: CharacterAspectRatio
}

export interface GenerateCharacterResult {
  /** First job-id; convenience alias for `jobIds[0]`. */
  jobId: string
  /** All job-ids when `count > 1`. */
  jobIds: string[]
}

export interface GenerateAssetInput {
  assetType:
    | "expressions"
    | "poses"
    | "lighting"
    | "angles"
    | "headAngles"
    | "bodyAngles"
    | "custom"
  /** The named variant (e.g. `"smile"`, `"standing"`, `"3/4 left"`). */
  variant: string
  /** Display name of the character; appears in the prompt. */
  name: string
  description?: string
  userPrompt?: string
  gender?: string
  style?: EntityStyle
  baseOutfit?: string
  sourceImageUrl?: string
  /** Real-life reference URLs (cap 5). */
  realLifeRefs?: string[]
  provider?: string
  /** Auto-attach to character row + asset bucket on completion. */
  attachToCharacterId?: string
  /** Shared type — auto-includes new buckets (sheets/detail_closeups/outfit_variations); mirrors objects.ts/locations.ts. */
  attachToColumn?: CharacterAttachColumn
  attachName?: string
  /**
   * Explicit aspect ratio. Highest precedence — overrides both the character
   * node toggle and the per-asset-type default (expressions=1:1, poses=9:16,
   * headAngles=3:4, bodyAngles=9:16, lighting=3:4, angles=3:4, custom=3:4).
   */
  aspectRatio?: CharacterAspectRatio
  /**
   * Character node toggle (per-canvas-node `defaultAssetAspectRatio`). Wins
   * against the per-asset-type default, loses to `aspectRatio`.
   */
  characterNodeAspectRatio?: CharacterAspectRatio
}

export interface GenerateMotionInput {
  motionPrompt: string
  /** Optional when `attachToCharacterId` is set — falls back to the row's portrait. */
  sourceImageUrl?: string
  provider?: string
  name: string
  description?: string
  motionDescription?: string
  gender?: string
  style?: EntityStyle
  baseOutfit?: string
  realLifeRefs?: string[]
  attachToCharacterId?: string
  attachName?: string
  /**
   * Explicit aspect ratio. Highest precedence — overrides both the character
   * node toggle and the motions default (`9:16`).
   */
  aspectRatio?: CharacterAspectRatio
  /**
   * Character node toggle (per-canvas-node `defaultAssetAspectRatio`). Wins
   * against the motions default, loses to `aspectRatio`.
   */
  characterNodeAspectRatio?: CharacterAspectRatio
}

export interface ApprovePortraitResult {
  portraitUrl: string
  /**
   * LLM-authored caption. `null` when the LLM call failed during the approval
   * — the portrait is still set; call `recaption()` to retry.
   */
  canonicalDescription: string | null
}

export interface RecaptionResult {
  canonicalDescription: string
}

export class CharactersResource {
  constructor(private client: NodaroClient) {}

  /**
   * List the caller's characters. By default returns active characters only;
   * pass `archived: true` to fetch soft-deleted rows for an "archive" view.
   * When `projectId` is set, only characters belonging to that project are
   * returned.
   */
  list(params: ListCharactersParams = {}): Promise<{ characters: Character[] }> {
    const query: Record<string, string | undefined> = {}
    if (params.projectId) query.projectId = params.projectId
    if (params.archived) query.archived = "true"
    if (params.limit !== undefined) query.limit = String(params.limit)
    return this.client.request("GET", "/v1/characters", { query })
  }

  /**
   * Fetch a single character including in-flight portrait / asset job state.
   * Soft-deleted (archived) rows are returned by id intentionally so canvas
   * nodes that hold a stale `characterDbId` keep loading.
   */
  get(id: string): Promise<CharacterDetail> {
    return this.client.request("GET", `/v1/characters/${encodeURIComponent(id)}`)
  }

  /**
   * Create or update a character. Omit `id` to create; supply it to update
   * (only the fields you pass get written — undefined keys are untouched).
   *
   * If the caller-supplied `name` collides with an existing active character
   * for this user, the request returns 409 `name_taken`. To auto-number a
   * placeholder, pass the placeholder name from `@nodaro/shared` and the
   * server will derive "Untitled character 2", "Untitled character 3", etc.
   */
  upsert(input: UpsertCharacterInput): Promise<UpsertCharacterResult> {
    return this.client.request("POST", "/v1/characters", { body: input })
  }

  /**
   * Convenience wrapper around `upsert()` for creating new characters.
   * Equivalent to `upsert({ ...input, id: undefined })`. `name` is REQUIRED
   * on create — the route 400s on INSERT-without-name; we narrow the type
   * here so callers fail at compile-time rather than runtime.
   */
  create(
    input: Omit<UpsertCharacterInput, "id"> & { name: string },
  ): Promise<UpsertCharacterResult> {
    return this.upsert(input)
  }

  /**
   * Convenience wrapper around `upsert()` for updating an existing character.
   * Equivalent to `upsert({ ...input, id })`.
   */
  update(
    id: string,
    input: Omit<UpsertCharacterInput, "id">,
  ): Promise<UpsertCharacterResult> {
    return this.upsert({ ...input, id })
  }

  /**
   * Soft-delete (archive) a character. The row is hidden from `list()` by
   * default but still loadable via `get(id)` so canvas nodes pointing at it
   * keep working. Restore with `restore(id)`.
   */
  delete(id: string): Promise<{ success: true; archived: true }> {
    return this.client.request("DELETE", `/v1/characters/${encodeURIComponent(id)}`)
  }

  /**
   * Un-archive a character. If the original name now collides with an
   * active row, the server auto-suffixes "(restored)" and returns the
   * effective name.
   */
  restore(id: string): Promise<{ id: string; name: string }> {
    return this.client.request("POST", `/v1/characters/${encodeURIComponent(id)}/restore`)
  }

  /**
   * Duplicate (fork) a character to a new row with a `"(copy)"` suffix.
   * Asset URLs are shared by reference — the new row can diverge by
   * regenerating any of them.
   */
  duplicate(id: string, input: DuplicateCharacterInput = {}): Promise<{ id: string; name: string }> {
    return this.client.request(
      "POST",
      `/v1/characters/${encodeURIComponent(id)}/duplicate`,
      { body: input },
    )
  }

  /**
   * Count of the caller's workflows that reference this character. Powers the
   * library "Archive" confirmation modal in the editor.
   */
  usage(id: string): Promise<CharacterUsage> {
    return this.client.request("GET", `/v1/characters/${encodeURIComponent(id)}/usage`)
  }

  /**
   * Fire `POST /v1/generate-character` to produce one or more portrait
   * candidates. With `count > 1`, all jobs are reserved up-front before any
   * is enqueued — mid-batch failures roll back atomically.
   *
   * When `attachToCharacterId` is set, the worker writes the result directly
   * to the row's `source_image_url`; otherwise you must call
   * `approvePortrait()` after picking a candidate.
   */
  generate(input: GenerateCharacterInput): Promise<GenerateCharacterResult> {
    return this.client.request("POST", "/v1/generate-character", { body: input })
  }

  /**
   * Fire `POST /v1/generate-character-asset` to produce a single
   * expression / pose / angle / lighting variant. When the studio path is
   * set (`attachToCharacterId` + `attachToColumn` + `attachName`), the
   * worker appends `{ name: attachName, url: <result> }` to the named
   * JSONB array column on completion.
   */
  generateAsset(input: GenerateAssetInput): Promise<{ jobId: string }> {
    return this.client.request("POST", "/v1/generate-character-asset", { body: input })
  }

  /**
   * Fire `POST /v1/generate-character-motion` to animate the character's
   * portrait into a motion clip. The result is appended to the character's
   * `motions[]` bucket when `attachToCharacterId` is set.
   */
  generateMotion(input: GenerateMotionInput): Promise<{ jobId: string }> {
    return this.client.request("POST", "/v1/generate-character-motion", { body: input })
  }

  /**
   * Approve a completed `generate-character` job as the character's portrait.
   * Sets `source_image_url` and fires the LLM caption (Claude Sonnet vision)
   * inline. Returns the new portrait URL plus the caption — `canonicalDescription`
   * is `null` if the LLM call sub-failed (portrait still set; retry via `recaption()`).
   */
  approvePortrait(id: string, candidateJobId: string): Promise<ApprovePortraitResult> {
    return this.client.request(
      "POST",
      `/v1/characters/${encodeURIComponent(id)}/approve-portrait`,
      { body: { candidateJobId } },
    )
  }

  /**
   * Re-fire the LLM caption against the character's current portrait. 502s on
   * LLM failure; returns 400 `no_portrait` if no portrait is set yet.
   */
  recaption(id: string): Promise<RecaptionResult> {
    return this.client.request(
      "POST",
      `/v1/characters/${encodeURIComponent(id)}/llm-caption`,
    )
  }
}
