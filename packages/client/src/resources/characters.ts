import { buildPersonHints, PEOPLE, PERSON_DIMENSION_ORDER, PERSON_DIMENSION_LABELS, type PersonValue } from "@nodaro/prompts/person"
import type { CharacterAspectRatio, CharacterAttachColumn, EntityStyle } from "@nodaro/shared/entities"
import type { TtsProvider } from "@nodaro/shared/models"
export type { EntityStyle, CharacterAspectRatio } from "@nodaro/shared/entities"
export { CHARACTER_STYLES, CHARACTER_ASPECT_OPTIONS, CHARACTER_ASPECT_DEFAULTS } from "@nodaro/shared/entities"
import type { NodaroClientCore } from "../core.js"
import type { GenerationSessionParams } from "./nodes.js"

/**
 * Re-export the shared `EntityStyle` union (realistic | anime | 3d-pixar |
 * illustration) and `CHARACTER_STYLES` runtime tuple so SDK consumers don't
 * have to add `@nodaro/shared` as a second dependency just to typecheck the
 * `style` field. Single source of truth lives in `@nodaro/shared/entity-prompts`.
 */

/**
 * Re-export the 4-value aspect-ratio union accepted by the generate-character*
 * routes. Single source of truth lives in `@nodaro/shared`. See
 * `CHARACTER_ASPECT_DEFAULTS` for the per-asset-type defaults.
 */

/**
 * Structured Person composer, re-exported from `@nodaro/shared` so SDK
 * consumers can build a detailed person description — Identity, Body, and the
 * Face facial-geometry layer (cheekbones, canthal tilt, eyelid type, lip
 * fullness/shape, nose tip, etc.) — and feed it as `seedPrompt` / `description`
 * to `generate()` / `upsert()` without adding `@nodaro/shared` as a second dep.
 *
 * `buildPersonSeedPrompt` collapses a `PersonValue` into the same comma-joined
 * fragment the editor's Person picker produces (e.g. "almond-shaped eyes,
 * sharply sculpted high cheekbones, full plump lips"). Returns "" when empty.
 */


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
  /** Canvas node linkage. `null` only on legacy clone rows that predate the
   *  clone-side node_id fix (new clones mint one; creates always had one). */
  nodeId: string | null
  projectId: string | null
  name: string
  description: string | null
  gender: string | null
  style: string | null
  baseOutfit: string | null
  sourceImageUrl: string | null
  /** MODEL_CATALOG image-model id the main image was generated with (or `null`).
   *  Set on create (the provider you generated with) + editable via `upsert`. */
  imageProvider: string | null
  expressions: Array<{ name: string; url: string }> | null
  poses: Array<{ name: string; url: string }> | null
  lightingVariations: Array<{ name: string; url: string }> | null
  angles: Array<{ name: string; url: string }> | null
  bodyAngles: Array<{ name: string; url: string }> | null
  motions: Array<{ name: string; url: string }> | null
  /** Named Character Boards — dense reference sheets, one per persona/look
   *  (the `generate-image/character-board` factory preset rendered from the
   *  character's images). A first-class bucket: community publish snapshots it
   *  and clone hands the consumer their own copy to extend. Defaults to `[]`.
   *  `type` marks an image-collage `"identity"` sheet vs a plain `"looks"`
   *  board; `sourceImages` are the R2 URLs it was collaged from. Both optional
   *  + backward-compatible (legacy boards have neither). */
  boards?: Array<{ name: string; url: string; type?: "looks" | "identity"; sourceImages?: string[] }> | null
  /** Per-label user-uploaded reference VIDEO URLs (R2), keyed by a
   *  caller-owned label (lowercased+trimmed server-side). Mirrors
   *  `realLifeRefsByVariant` for video clips; read the chosen URLs off the row
   *  to feed generate-video's `referenceVideoUrls`. Defaults to `{}`. */
  referenceVideosByVariant?: Record<string, string[]> | null
  /** The user's chosen DEFAULT asset take per variant (Studio version history).
   *  OPAQUE map: key `"<bucket>:<variant>"` (e.g. `"bodyAngles:front"`,
   *  `"expressions:smile"`) → the chosen asset URL (one already present in that
   *  bucket). Stored verbatim — keys are NOT normalized; soft-capped server-side
   *  at 200 keys / 2048-char values (overflow dropped silently). Defaults to `{}`. */
  selectedAssetByVariant?: Record<string, string> | null
  /** `voiceType` records the selected voice's KIND (premade voices are
   *  addressed by name; library/custom voices by id at text-to-speech time).
   *  `previewUrl` is a playable audio sample (the voice's `preview_url` / clone
   *  sample) the studio plays in an `<audio>` element — persisted so Voice Library
   *  voices (which have no by-id lookup) stay previewable after reload. Client-
   *  played only; the server never fetches it. `ttsProvider` is the library
   *  voice's verified TTS provider (see `SharedVoice.recommendedProvider`) —
   *  send it as the text-to-speech `provider` so the voice renders on a model
   *  it's verified for. All optional — a character may have no voice, or a
   *  legacy voice predating these fields. */
  voice: { voiceId: string; voiceName: string; traits: string; voiceType?: "premade" | "library" | "custom"; previewUrl?: string; ttsProvider?: TtsProvider } | null
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
  /** Identity-lock strength for Character Studio asset generation. */
  identityLock?: "off" | "soft" | "strict"
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
  /** Recently completed portrait takes (7 days, newest first): at most 5
   *  alternates, never the current portrait — plus, with
   *  `get(id, { candidates: "all" })`, the current portrait's own take. */
  previousCandidates?: Array<{
    jobId: string
    url: string
    createdAt: string
    /** The image model the take was requested with. */
    provider?: string
    /** The aspect ratio the request sent explicitly; absent when the take
     *  used the default ratio. */
    aspectRatio?: string
    /** `true` only on the current portrait's own take (returned with
     *  `candidates: "all"`); `false` on the alternates. */
    isPortrait?: boolean
  }>
}

/** Options for `client.characters.get()`. */
export interface GetCharacterOptions {
  /**
   * `"all"`: `previousCandidates` also carries the current portrait's own
   * take, flagged `isPortrait: true`, when its job is within the 7-day window
   * (the alternates stay at most 5). Default `"alternates"`: the current
   * portrait is left out.
   */
  candidates?: "alternates" | "all"
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
  /** Canvas node id the character belongs to. REQUIRED on create (the route
   *  400s without it, like `name`); optional on update — the update branch
   *  never touches node_id, so partial updates needn't round-trip it. */
  nodeId?: string
  workflowId?: string
  projectId?: string
  name?: string
  description?: string
  gender?: string
  style?: string
  baseOutfit?: string
  sourceImageUrl?: string
  /** Persistent image-model id (a MODEL_CATALOG image model). Validated
   *  server-side — unknown / non-image / "" is stored as `null`. */
  imageProvider?: string | null
  expressions?: Array<{ name: string; url: string }>
  poses?: Array<{ name: string; url: string }>
  lightingVariations?: Array<{ name: string; url: string }>
  angles?: Array<{ name: string; url: string }>
  bodyAngles?: Array<{ name: string; url: string }>
  motions?: Array<{ name: string; url: string }>
  /** Named Character Boards (see `Character.boards`) — whole-array replace,
   *  like the asset buckets. Server caps: 24 boards, 200-char names, 30
   *  sourceImages per board. */
  boards?: Array<{ name: string; url: string; type?: "looks" | "identity"; sourceImages?: string[] }>
  /** See `Character.voice` — persisted alongside the voice so TTS can resolve a
   *  library/custom voice by id, `previewUrl` keeps the sample playable after
   *  reload, and `ttsProvider` keeps generation on a model the voice is
   *  verified for. All optional. */
  voice?: { voiceId: string; voiceName: string; traits: string; voiceType?: "premade" | "library" | "custom"; previewUrl?: string; ttsProvider?: TtsProvider } | null
  personality?: {
    mood: string
    speechStyle: string
    movementStyle: string
    behavioralNotes: string
  } | null
  seedPrompt?: string
  canonicalDescription?: string
  /** Identity-lock strength for Character Studio asset generation (off/soft/strict). */
  identityLock?: "off" | "soft" | "strict"
  referencePhotos?: ReferencePhoto[]
  /** Per-variant real-life reference URLs. Keys are lowercased+trimmed server-side. */
  realLifeRefsByVariant?: Record<string, string[]>
  /** Per-label user-uploaded reference VIDEO URLs (e.g. emotion takes). Keys
   *  are lowercased+trimmed server-side; max 20 keys, 5 URLs each. Stored R2
   *  URLs are read back off the row to drive generate-video's
   *  `referenceVideoUrls`. */
  referenceVideosByVariant?: Record<string, string[]>
  /** The user's chosen DEFAULT asset take per variant. OPAQUE
   *  `"<bucket>:<variant>"` → chosen-URL map; a write REPLACES the whole map
   *  (the studio sends the full map each save). Omit to leave the row untouched.
   *  Keys stored verbatim; soft-capped server-side at 200 keys / 2048-char values. */
  selectedAssetByVariant?: Record<string, string>
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
   * Search words: only the characters whose name or description contains
   * every word (split on spaces, the first 5), in any order, ignoring case —
   * `"red car"` finds "Car, red". Each word is matched as written (`%`, `_`
   * and `*` are not wildcards; punctuation is kept); blank means no search; up
   * to 200 characters. Combines with the other filters and with `cursor`
   * paging.
   */
  q?: string
  /**
   * Max rows to return. Server defaults to 100, caps at 500. Omit to take the
   * server default — passing it just narrows further.
   */
  limit?: number
  /** Opaque cursor from a prior page's `nextCursor` (fetches the next page). */
  cursor?: string
}

export interface ListCharactersResult {
  characters: Character[]
  /** Pass back as `cursor` for the next page; `null` when there are no more. */
  nextCursor: string | null
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
 * need a separate `approvePortrait` call for single-candidate runs. Pass
 * `attachPortrait: false` to keep every take a candidate instead.
 */
export interface GenerateCharacterInput extends GenerationSessionParams {
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
  /** `false`: the take stays a candidate; only the approve route
   *  (`approvePortrait()`) sets the portrait. Omitted/`true`: the finished
   *  take is written to the row's portrait. */
  attachPortrait?: boolean
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
  /**
   * Credit-affecting quality tier (e.g. `"high"` for gpt-image). Priced like
   * generate-image (composite ids such as `gpt-image:high`); values the chosen
   * model doesn't support are ignored server-side, never rejected.
   */
  quality?: string
  /**
   * Credit-affecting output resolution (e.g. `"2K"` / `"4K"` / `"2 MP"`).
   * Priced like generate-image (composite ids such as `nano-banana-pro:4K`);
   * values the chosen model doesn't support are ignored server-side, never
   * rejected.
   */
  resolution?: string
}

export interface GenerateCharacterResult {
  /** First job-id; convenience alias for `jobIds[0]`. */
  jobId: string
  /** All job-ids when `count > 1`. */
  jobIds: string[]
}

export interface GenerateAssetInput extends GenerationSessionParams {
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
  /**
   * Credit-affecting quality tier (e.g. `"high"` for gpt-image). Values the
   * chosen model doesn't support are ignored server-side, never rejected.
   */
  quality?: string
  /**
   * Credit-affecting output resolution (e.g. `"2K"` / `"4K"` / `"2 MP"`).
   * Values the chosen model doesn't support are ignored server-side, never
   * rejected.
   */
  resolution?: string
}

export interface GenerateMotionInput extends GenerationSessionParams {
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

/**
 * Where a character's high-fidelity training stands. `untrained`: nothing was
 * ever trained, the trained model was removed (`deleteLora`), or a training
 * could not be started (`training_dispatch_failed` — refunded; this resets the
 * status even for a character trained before). `queued` / `training`: in
 * flight. `succeeded` / `failed` / `cancelled`: the last training's outcome.
 *
 * Generation uses the trained model only while the status is `succeeded`.
 */
export type CharacterTrainingState = "untrained" | "queued" | "training" | "succeeded" | "failed" | "cancelled"

/** `GET /v1/characters/:id/training` — the character's training record. */
export interface CharacterTrainingStatus {
  status: CharacterTrainingState
  /** The provider's id for the latest training; `null` before the first one. */
  trainingId: string | null
  /** Why the last training failed, as the user may read it; `null` otherwise. */
  error: string | null
  /**
   * When the last successful training finished (ISO 8601). It stays set through
   * a re-train, a failed or cancelled one, or one that could not be started —
   * but the model is used only while `status` is `succeeded`.
   */
  trainedAt: string | null
  /** The last successful training's model version; set or not, used only while `status` is `succeeded`. */
  version: string | null
  /** The token added to prompts for this character (`TOK_<slug>_<6hex>`); generation adds it for you. */
  triggerWord: string | null
  /** How many images the latest training used. */
  imageCount: number | null
}

/** Body for `characters.train()`. */
export interface TrainCharacterInput {
  /**
   * Train on these of the character's images only (max 200 URLs; at most 20
   * are used). Omitted or empty: every eligible image — the portrait,
   * reference photos, expressions, poses, head and body angles and lighting
   * variations. At least 4 distinct images must remain either way.
   */
  selectedImageUrls?: string[]
}

/** `POST /v1/characters/:id/train` — answered 202 while the training runs. */
export interface TrainCharacterResult {
  /** The training's job; it ends `completed`, `failed` or `cancelled` with the training. */
  jobId: string
  /** The provider's id for this training (also on `trainingStatus().trainingId`). */
  trainingId: string
  /** The token added to prompts for this character once trained. */
  triggerWord: string
}

/**
 * The `code` of a `NodaroError` `train()` can throw beyond the typed classes
 * (`ForbiddenError` — an app token without `assets:write`, `missingScope`
 * says so; `InsufficientCreditsError`; `RateLimitedError`; `JobBlockedError`;
 * `UnauthorizedError`; …):
 *
 * - `insufficient_training_images` (400) — fewer than 4 distinct images; the
 *   message says how many there are.
 * - `validation_error` (400) — a malformed id or `selectedImageUrls`.
 * - `already_training_or_not_found` (409) — a training is already in flight,
 *   or the character is not yours / archived.
 * - `claim_failed` (500) — the training slot could not be claimed; nothing
 *   started. Retry.
 * - `training_dispatch_failed` (502) — the training could not be started;
 *   nothing is charged.
 * - `public_url_not_configured` (503) — the deployment cannot receive the
 *   provider's completion call.
 * - `price_not_configured` (503) — the deployment has no price for training.
 * - `dedup_race_winner_unresolvable` (503) — a duplicate of this request was
 *   in flight and its outcome could not be read; this one reserved nothing.
 *   Read {@link CharactersResource.trainingStatus} before retrying.
 */
export type TrainCharacterRefusalCode =
  | "insufficient_training_images"
  | "validation_error"
  | "already_training_or_not_found"
  | "claim_failed"
  | "training_dispatch_failed"
  | "public_url_not_configured"
  | "price_not_configured"
  | "dedup_race_winner_unresolvable"

export class CharactersResource {
  constructor(private client: NodaroClientCore) {}

  /**
   * List the caller's characters. By default returns active characters only;
   * pass `archived: true` to fetch soft-deleted rows for an "archive" view.
   * When `projectId` is set, only characters belonging to that project are
   * returned; `q` keeps the ones whose name or description contains it.
   *
   * Cursor-paginated: a response carrying a non-null `nextCursor` means more
   * rows exist. Pass it back as `cursor` to fetch the next page, and keep going
   * until `nextCursor` is `null` — a single call returns at most `limit` rows
   * (default 100), so treating one call as "all characters" silently truncates
   * the list for anyone past that count.
   *
   * ```ts
   * const all: Character[] = []
   * let cursor: string | undefined
   * do {
   *   const page = await client.characters.list({ cursor })
   *   all.push(...page.characters)
   *   cursor = page.nextCursor ?? undefined
   * } while (cursor)
   * ```
   */
  list(params: ListCharactersParams = {}): Promise<ListCharactersResult> {
    const query: Record<string, string | undefined> = {}
    if (params.projectId) query.projectId = params.projectId
    if (params.archived) query.archived = "true"
    if (params.q) query.q = params.q
    if (params.limit !== undefined) query.limit = String(params.limit)
    if (params.cursor) query.cursor = params.cursor
    return this.client.request("GET", "/v1/characters", { query })
  }

  /**
   * Fetch a single character including in-flight portrait / asset job state.
   * Soft-deleted (archived) rows are returned by id intentionally so canvas
   * nodes that hold a stale `characterDbId` keep loading. Pass
   * `{ candidates: "all" }` to also get the current portrait's own take in
   * `previousCandidates` (flagged `isPortrait: true`).
   */
  get(id: string, options: GetCharacterOptions = {}): Promise<CharacterDetail> {
    const query: Record<string, string | undefined> = {}
    if (options.candidates) query.candidates = options.candidates
    return this.client.request("GET", `/v1/characters/${encodeURIComponent(id)}`, { query })
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
   * to the row's `source_image_url` (unless `attachPortrait: false`);
   * otherwise you must call `approvePortrait()` after picking a candidate.
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

  /**
   * Start training a high-fidelity model of the character on its own images
   * (Nodaro Cloud only — other editions answer `NotFoundError`). Reserves the
   * training price up front and refunds it if the training fails or is
   * cancelled. Resolves at once (202); a training takes about 15 minutes —
   * follow it with {@link trainingStatus}. Once it succeeds, a workflow's
   * Generate Image node whose prompt @-mentions this one character runs on the
   * trained model.
   *
   * An OAuth app token needs the `assets:write` scope (`ForbiddenError`
   * otherwise, before anything is reserved); a session or personal API key
   * needs none. Refusals are `NodaroError`s whose `code` is a
   * {@link TrainCharacterRefusalCode}; rate-limited to 3 calls a minute.
   */
  train(id: string, input: TrainCharacterInput = {}): Promise<TrainCharacterResult> {
    return this.client.request("POST", `/v1/characters/${encodeURIComponent(id)}/train`, { body: input })
  }

  /**
   * The character's training record (Nodaro Cloud only). Poll it while
   * `status` is `queued` or `training` — every 10 s or so is plenty.
   */
  trainingStatus(id: string): Promise<CharacterTrainingStatus> {
    return this.client.request("GET", `/v1/characters/${encodeURIComponent(id)}/training`)
  }

  /**
   * Remove the character's trained model (Nodaro Cloud only): cancels a
   * training in flight and refunds its reservation, deletes the model, and
   * clears the training record (`trainingStatus` then reads `untrained`).
   * Generations go back to reference images. Cannot be undone — a new model
   * means a new, paid training. An OAuth app token needs the `assets:write`
   * scope (`ForbiddenError` otherwise), like deleting the character.
   */
  async deleteLora(id: string): Promise<void> {
    await this.client.request("DELETE", `/v1/characters/${encodeURIComponent(id)}/lora`)
  }
}

/** Person catalog + hint helpers, re-exported from @nodaro/prompts (FSL-licensed). */
export { buildPersonHints, PEOPLE, PERSON_DIMENSION_ORDER, PERSON_DIMENSION_LABELS }
export type { PersonValue }

/**
 * Collapse a PersonValue into the comma-joined seed-prompt fragment used by
 * `characters.generate({ seedPrompt })` — same composition the Nodaro editor
 * performs. Powered by @nodaro/prompts.
 */
export function buildPersonSeedPrompt(value: PersonValue): string {
  return buildPersonHints(value as Record<string, unknown> & PersonValue).join(", ")
}
