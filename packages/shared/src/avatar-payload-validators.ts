/**
 * Shared structural validators for the ai-avatar and cinematic-avatar payloads.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────
 * The route Zod schemas (`aiAvatarBody` / `cinematicAvatarBody`) only protect the
 * single-node Run path. Workflow runs, published-app runs, MCP run_workflow, and
 * imported/crafted workflow JSON all assemble a payload in
 * `payload-builder.ts` and forward it straight to the worker → provider →
 * HeyGen with NO Zod parse in between. That structural gap is the root cause of
 * the avatar edge-case findings: missing/over-count avatarLooks, reference caps,
 * source/speech-conditional requireds, and voice-param ranges all reach HeyGen
 * unvalidated on those paths.
 *
 * These validators reproduce the route Zod's invariants (minus the userId /
 * workflow wrapper and minus the URL-host allowlist — orchestrated URLs come
 * from trusted upstream R2 outputs). They run inside the `ai-avatar` /
 * `cinematic-avatar` cases of `payload-builder.ts` on the ASSEMBLED payload,
 * throwing `AvatarPayloadError` BEFORE credit reservation + enqueue. The
 * node-executor catches the throw and deletes the orphaned pending job, so both
 * entry points are correct-by-construction rather than relying on the route as
 * the only gate.
 *
 * Keep these in sync with `backend/src/routes/ai-avatar.ts` and
 * `backend/src/routes/cinematic-avatar.ts`.
 */

/** Thrown by the avatar payload validators on a structurally-invalid payload. */
export class AvatarPayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AvatarPayloadError"
  }
}

const AI_AVATAR_SOURCES = new Set(["avatar", "image"])
const AI_AVATAR_ENGINES = new Set(["avatar-v", "avatar-iv"])
const AI_AVATAR_SPEECH_MODES = new Set(["text", "audio"])
const AI_AVATAR_RESOLUTIONS = new Set(["720p", "1080p", "4k"])
const AI_AVATAR_ASPECT_RATIOS = new Set(["16:9", "9:16"])

const AI_AVATAR_SCRIPT_MAX = 5000
const AI_AVATAR_VOICE_SPEED_MIN = 0.5
const AI_AVATAR_VOICE_SPEED_MAX = 1.5
const AI_AVATAR_PITCH_MIN = -50
const AI_AVATAR_PITCH_MAX = 50
const AI_AVATAR_VOLUME_MIN = 0
const AI_AVATAR_VOLUME_MAX = 1

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0
}

/**
 * Validate an assembled ai-avatar payload (post-default-application).
 * Mirrors `aiAvatarBody` (`backend/src/routes/ai-avatar.ts`): enum bounds,
 * source/speech-conditional requireds, script length, and voice-param ranges.
 *
 * @throws AvatarPayloadError on any violation.
 */
export function validateAiAvatarPayload(payload: Record<string, unknown>): void {
  const avatarSource = (payload.avatarSource as string | undefined) ?? "avatar"
  const speechMode = (payload.speechMode as string | undefined) ?? "text"
  const engine = (payload.engine as string | undefined) ?? "avatar-iv"
  const resolution = (payload.resolution as string | undefined) ?? "720p"
  const aspectRatio = (payload.aspectRatio as string | undefined) ?? "16:9"

  if (!AI_AVATAR_SOURCES.has(avatarSource)) {
    throw new AvatarPayloadError(`ai-avatar: invalid avatarSource "${avatarSource}" (expected avatar | image)`)
  }
  if (!AI_AVATAR_ENGINES.has(engine)) {
    throw new AvatarPayloadError(`ai-avatar: invalid engine "${engine}" (expected avatar-v | avatar-iv)`)
  }
  if (!AI_AVATAR_SPEECH_MODES.has(speechMode)) {
    throw new AvatarPayloadError(`ai-avatar: invalid speechMode "${speechMode}" (expected text | audio)`)
  }
  if (!AI_AVATAR_RESOLUTIONS.has(resolution)) {
    throw new AvatarPayloadError(`ai-avatar: invalid resolution "${resolution}" (expected 720p | 1080p | 4k)`)
  }
  if (!AI_AVATAR_ASPECT_RATIOS.has(aspectRatio)) {
    throw new AvatarPayloadError(`ai-avatar: invalid aspectRatio "${aspectRatio}" (expected 16:9 | 9:16)`)
  }

  // Source-conditional requireds: avatar mode needs avatarId; image mode needs imageUrl.
  if (avatarSource === "image") {
    if (!isNonEmptyString(payload.imageUrl)) {
      throw new AvatarPayloadError("ai-avatar: imageUrl is required when avatarSource is image")
    }
  } else {
    if (!isNonEmptyString(payload.avatarId)) {
      throw new AvatarPayloadError("ai-avatar: avatarId is required when avatarSource is avatar")
    }
  }

  // Speech-conditional requireds.
  if (speechMode === "text") {
    if (!isNonEmptyString(payload.script)) {
      throw new AvatarPayloadError("ai-avatar: script is required when speechMode is text")
    }
    if ((payload.script as string).length > AI_AVATAR_SCRIPT_MAX) {
      throw new AvatarPayloadError(`ai-avatar: script exceeds ${AI_AVATAR_SCRIPT_MAX} characters`)
    }
    if (!isNonEmptyString(payload.voiceId)) {
      throw new AvatarPayloadError("ai-avatar: voiceId is required when speechMode is text")
    }
  } else {
    if (!isNonEmptyString(payload.audioUrl)) {
      throw new AvatarPayloadError("ai-avatar: audioUrl is required when speechMode is audio")
    }
  }

  // Voice-param ranges (optional fields — only checked when present).
  assertNumberInRange(payload.voiceSpeed, AI_AVATAR_VOICE_SPEED_MIN, AI_AVATAR_VOICE_SPEED_MAX, "ai-avatar: voiceSpeed")
  assertNumberInRange(payload.pitch, AI_AVATAR_PITCH_MIN, AI_AVATAR_PITCH_MAX, "ai-avatar: pitch")
  assertNumberInRange(payload.volume, AI_AVATAR_VOLUME_MIN, AI_AVATAR_VOLUME_MAX, "ai-avatar: volume")
}

function assertNumberInRange(v: unknown, min: number, max: number, label: string): void {
  if (v === undefined || v === null) return
  const n = Number(v)
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new AvatarPayloadError(`${label} must be between ${min} and ${max} (got ${String(v)})`)
  }
}

// ---------------------------------------------------------------------------
// cinematic-avatar
// ---------------------------------------------------------------------------

const CINEMATIC_RESOLUTIONS = new Set(["720p", "1080p"])
const CINEMATIC_ASPECT_RATIOS = new Set(["16:9", "9:16", "1:1"])
const CINEMATIC_PROMPT_MAX = 10000

/** HeyGen combined reference caps: ≤3 videos and ≤9 images across avatar looks + references. */
export const CINEMATIC_MAX_REFERENCE_VIDEOS = 3
export const CINEMATIC_MAX_REFERENCE_IMAGES = 9
export const CINEMATIC_MIN_LOOKS = 1
export const CINEMATIC_MAX_LOOKS = 3

/**
 * Validate an assembled cinematic-avatar payload.
 * Mirrors `cinematicAvatarBody` (`backend/src/routes/cinematic-avatar.ts`):
 * prompt presence/length, avatarLooks count (1–3), enum bounds, and the
 * combined reference caps (≤3 videos; avatarLooks + image refs ≤ 9).
 *
 * @throws AvatarPayloadError on any violation.
 */
export function validateCinematicAvatarPayload(payload: Record<string, unknown>): void {
  const prompt = payload.prompt
  if (!isNonEmptyString(prompt)) {
    throw new AvatarPayloadError("cinematic-avatar: prompt is required")
  }
  if ((prompt as string).length > CINEMATIC_PROMPT_MAX) {
    throw new AvatarPayloadError(`cinematic-avatar: prompt exceeds ${CINEMATIC_PROMPT_MAX} characters`)
  }

  const avatarLooks = payload.avatarLooks
  if (!Array.isArray(avatarLooks)) {
    throw new AvatarPayloadError("cinematic-avatar: avatarLooks must be an array of 1–3 look ids")
  }
  if (avatarLooks.length < CINEMATIC_MIN_LOOKS || avatarLooks.length > CINEMATIC_MAX_LOOKS) {
    throw new AvatarPayloadError(
      `cinematic-avatar: avatarLooks must contain ${CINEMATIC_MIN_LOOKS}–${CINEMATIC_MAX_LOOKS} look ids (got ${avatarLooks.length})`,
    )
  }
  if (!avatarLooks.every((l) => isNonEmptyString(l))) {
    throw new AvatarPayloadError("cinematic-avatar: every avatarLooks entry must be a non-empty string")
  }

  const resolution = (payload.resolution as string | undefined) ?? "720p"
  const aspectRatio = (payload.aspectRatio as string | undefined) ?? "16:9"
  if (!CINEMATIC_RESOLUTIONS.has(resolution)) {
    throw new AvatarPayloadError(`cinematic-avatar: invalid resolution "${resolution}" (expected 720p | 1080p)`)
  }
  if (!CINEMATIC_ASPECT_RATIOS.has(aspectRatio)) {
    throw new AvatarPayloadError(`cinematic-avatar: invalid aspectRatio "${aspectRatio}" (expected 16:9 | 9:16 | 1:1)`)
  }

  // Combined reference caps. avatar looks are image looks → count toward the
  // 9-image budget (matches the route superRefine).
  const references = payload.references
  if (references !== undefined) {
    if (!Array.isArray(references)) {
      throw new AvatarPayloadError("cinematic-avatar: references must be an array")
    }
    let videoCount = 0
    let imageRefCount = 0
    for (const r of references) {
      if (!r || typeof r !== "object") {
        throw new AvatarPayloadError("cinematic-avatar: each reference must be an object { type, url }")
      }
      const type = (r as { type?: unknown }).type
      const url = (r as { url?: unknown }).url
      if (type !== "video" && type !== "image" && type !== "audio") {
        throw new AvatarPayloadError(`cinematic-avatar: invalid reference type "${String(type)}" (expected video | image | audio)`)
      }
      if (!isNonEmptyString(url)) {
        throw new AvatarPayloadError("cinematic-avatar: each reference must carry a non-empty url")
      }
      if (type === "video") videoCount++
      else if (type === "image") imageRefCount++
    }
    if (videoCount > CINEMATIC_MAX_REFERENCE_VIDEOS) {
      throw new AvatarPayloadError(
        `cinematic-avatar: at most ${CINEMATIC_MAX_REFERENCE_VIDEOS} video references are allowed (got ${videoCount})`,
      )
    }
    const totalImages = avatarLooks.length + imageRefCount
    if (totalImages > CINEMATIC_MAX_REFERENCE_IMAGES) {
      throw new AvatarPayloadError(
        `cinematic-avatar: at most ${CINEMATIC_MAX_REFERENCE_IMAGES} images are allowed across avatar looks + image references (got ${totalImages})`,
      )
    }
  }
}
