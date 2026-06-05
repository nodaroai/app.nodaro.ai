/**
 * HeyGen video generation — POST /v3/videos + poll /v1/video_status.get.
 *
 * ─── Engine eligibility ─────────────────────────────────────────────────────
 * The HeyGen API uses underscore form for engine.type ("avatar_v", "avatar_iv")
 * while Nodaro's AiAvatarEngine type uses hyphens ("avatar-v", "avatar-iv").
 * Conversion via engineApi() happens here.
 *
 * Not all photo-avatars support Avatar V. When the API returns an error
 * matching /does not support Avatar/i and engine was "avatar-v", we retry
 * ONCE with "avatar-iv" and recalculate the cost using avatar-iv rates.
 *
 * ─── Result URLs ────────────────────────────────────────────────────────────
 * HeyGen result URLs are signed and EXPIRING — the caller MUST re-host to R2
 * immediately after generation. Never store a raw HeyGen URL.
 *
 * ─── Duration ───────────────────────────────────────────────────────────────
 * `data.duration` is fractional seconds (e.g. 3.05633). aiAvatarUsdCost()
 * calls Math.ceil() internally so partial seconds are billed as full seconds.
 */

import { heygenFetch, HeygenError } from "./client.js"
import { aiAvatarUsdCost } from "@nodaro/shared"
import type { AiAvatarEngine, AiAvatarResolution } from "@nodaro/shared"
import type { RawCreateVideoResponse, RawVideoStatusResponse } from "./types.js"

// ---------------------------------------------------------------------------
// Engine mapping (hyphen ↔ underscore)
// ---------------------------------------------------------------------------

/**
 * Maps Nodaro's AiAvatarEngine (hyphen form) to HeyGen's API engine.type
 * (underscore form).
 *
 * "avatar-v"  → "avatar_v"
 * "avatar-iv" → "avatar_iv"
 */
function engineApi(engine: AiAvatarEngine): "avatar_v" | "avatar_iv" {
  return engine === "avatar-v" ? "avatar_v" : "avatar_iv"
}

// ---------------------------------------------------------------------------
// TTS engine_settings discriminated union
// ---------------------------------------------------------------------------

export interface ElevenLabsEngineSettings {
  engine_type: "elevenlabs"
  model?: "eleven_multilingual_v2" | "eleven_turbo_v2_5" | "eleven_flash_v2_5" | "eleven_v3" | null
  similarity_boost?: number
  stability?: number
  style?: number
  use_speaker_boost?: boolean
}

export interface FishEngineSettings {
  engine_type: "fish"
  model?: "s1" | "s2-pro" | null
  stability?: number
  similarity?: number
}

export interface StarfishEngineSettings {
  engine_type: "starfish"
}

export type TtsEngineSettings = ElevenLabsEngineSettings | FishEngineSettings | StarfishEngineSettings

/**
 * Normalize a TTS engine_settings object to HeyGen's snake_case body shape,
 * accepting BOTH the route path's already-snake_case shape AND the workflow-DAG
 * path's camelCase shape.
 *
 * The two callers historically diverged: single-node Run maps camelCase →
 * snake_case in `frontend/src/lib/api.ts::runAiAvatar` before the route, but the
 * orchestrator's `payload-builder.ts` forwards the raw node data
 * (`AiAvatarData.ttsEngine`, which uses camelCase `similarityBoost` /
 * `useSpeakerBoost`) straight to the worker, bypassing the route Zod. Without
 * this normalizer those two ElevenLabs levers reached HeyGen as unknown
 * camelCase keys and were silently dropped during workflow execution.
 *
 * Doing the mapping HERE (the single point that builds the HeyGen body) makes
 * both paths correct by construction. Snake_case input passes through unchanged.
 */
export function normalizeTtsEngine(raw: unknown): TtsEngineSettings | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const e = raw as Record<string, unknown>
  const engineType = e.engine_type

  if (engineType === "elevenlabs") {
    const out: ElevenLabsEngineSettings = { engine_type: "elevenlabs" }
    if (e.model !== undefined) out.model = e.model as ElevenLabsEngineSettings["model"]
    if (e.stability !== undefined) out.stability = e.stability as number
    // Accept either snake_case (route path) or camelCase (DAG/node-data path).
    const similarityBoost = e.similarity_boost ?? e.similarityBoost
    if (similarityBoost !== undefined) out.similarity_boost = similarityBoost as number
    if (e.style !== undefined) out.style = e.style as number
    const useSpeakerBoost = e.use_speaker_boost ?? e.useSpeakerBoost
    if (useSpeakerBoost !== undefined) out.use_speaker_boost = useSpeakerBoost as boolean
    return out
  }

  if (engineType === "fish") {
    const out: FishEngineSettings = { engine_type: "fish" }
    if (e.model !== undefined) out.model = e.model as FishEngineSettings["model"]
    if (e.stability !== undefined) out.stability = e.stability as number
    if (e.similarity !== undefined) out.similarity = e.similarity as number
    return out
  }

  if (engineType === "starfish") {
    return { engine_type: "starfish" }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Background shape
// ---------------------------------------------------------------------------

export interface AvatarBackground {
  type: "color" | "image"
  /** Hex colour when type="color". */
  value?: string
  /** Image URL when type="image". */
  url?: string
  /** HeyGen asset ID when type="image". */
  assetId?: string
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface GenerateAvatarVideoOpts {
  /**
   * Visual source. "avatar" (default) animates a catalog avatar look via the
   * IV/V engine; "image" animates a raw image (HeyGen's `type:"image"` mode,
   * which uses its OWN engine — no avatar_id, no `engine` field). Image-mode
   * needs no created/trained avatar, so it works on the current HeyGen tier.
   */
  avatarSource?: "avatar" | "image"
  engine: AiAvatarEngine
  /** Catalog avatar look id — required (and only used) when avatarSource="avatar". */
  avatarId: string
  /** Source image URL — required (and only used) when avatarSource="image". */
  imageUrl?: string
  speechMode: "text" | "audio"
  /** Text mode: the verbatim script (≤5000 chars). Distinct from any prompt field. */
  script?: string
  /** Text mode: HeyGen voice ID. */
  voiceId?: string
  /** Text mode: playback speed 0.5–1.5 (default 1.0). */
  voiceSpeed?: number
  /** Text mode: voice pitch adjustment -50..50. */
  pitch?: number
  /** Text mode: voice volume 0..1. */
  volume?: number
  /** Text mode: locale string for locale-aware voices. */
  locale?: string
  /** Text mode: TTS engine settings (elevenlabs / fish / starfish). */
  ttsEngine?: TtsEngineSettings
  /** Audio mode: R2 URL of the driving audio. */
  audioUrl?: string
  resolution: AiAvatarResolution
  aspectRatio: "16:9" | "9:16"
  /** How video is fitted into the frame: "cover" (default) or "contain". */
  fit?: "cover" | "contain"
  /** Output container format (default "mp4"). */
  outputFormat?: "mp4" | "webm"
  caption?: boolean
  /**
   * Caption style for burn-in captions. When provided with caption=true,
   * sends `caption.style`; when omitted the API uses its default.
   */
  captionStyle?: "default"
  /** Background fill — colour swatch or hosted image. */
  background?: AvatarBackground
  /** Remove the avatar's background before compositing. */
  removeBackground?: boolean
  /**
   * Motion prompt string. Only valid for Avatar IV and photo avatars; must be
   * omitted when engine is "avatar-v" to avoid a HeyGen API rejection.
   */
  motionPrompt?: string
  /**
   * Expressiveness level — photo avatars only (default "low").
   * Ignored for Avatar V engine.
   */
  expressiveness?: "high" | "medium" | "low"
  /**
   * Poll interval in milliseconds (default 6000).
   * Pass 0 in tests to skip sleep delays.
   */
  pollIntervalMs?: number
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface AvatarVideoResult {
  videoUrl: string
  durationSec: number
  cost: number
  meteredCost: true
}

// ---------------------------------------------------------------------------
// Sleep helper (testable — callers can pass pollIntervalMs: 0)
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// Poll timeout
// ---------------------------------------------------------------------------

/** Maximum total wait time: 10 minutes. */
const MAX_POLL_DURATION_MS = 10 * 60 * 1000

// ---------------------------------------------------------------------------
// Core generation function
// ---------------------------------------------------------------------------

/**
 * Generates an AI avatar video via HeyGen, polls to completion, and returns
 * the result URL + duration + USD cost.
 *
 * The caller is responsible for re-hosting the returned `videoUrl` to R2
 * before it expires.
 */
export async function generateAvatarVideo(
  opts: GenerateAvatarVideoOpts,
): Promise<AvatarVideoResult> {
  const {
    avatarSource = "avatar",
    engine,
    avatarId,
    imageUrl,
    speechMode,
    script,
    voiceId,
    voiceSpeed,
    pitch,
    volume,
    locale,
    ttsEngine,
    audioUrl,
    resolution,
    aspectRatio,
    fit,
    outputFormat,
    caption,
    captionStyle,
    background,
    removeBackground,
    motionPrompt,
    expressiveness,
    pollIntervalMs = 6000,
  } = opts

  // ── Build the /v3/videos request body ────────────────────────────────────
  function buildBody(effectiveEngine: AiAvatarEngine): Record<string, unknown> {
    // Image-source mode: HeyGen's `type:"image"` discriminant animates a raw
    // image with its OWN engine — there is no avatar_id and NO `engine` field.
    // Catalog-avatar mode keeps avatar_id + engine. Both share the framing
    // fields (resolution / aspect_ratio / output_format).
    const base: Record<string, unknown> = {
      resolution,
      aspect_ratio: aspectRatio,
      output_format: outputFormat ?? "mp4",
      ...(avatarSource === "image"
        ? { type: "image", image: { type: "url", url: imageUrl } }
        : { type: "avatar", avatar_id: avatarId, engine: { type: engineApi(effectiveEngine) } }),
    }

    if (fit !== undefined) {
      base.fit = fit
    }

    if (speechMode === "text") {
      base.script = script
      base.voice_id = voiceId

      // Build voice_settings — always include speed; append optional levers
      const voiceSettings: Record<string, unknown> = { speed: voiceSpeed ?? 1.0 }
      if (pitch !== undefined) voiceSettings.pitch = pitch
      if (volume !== undefined) voiceSettings.volume = volume
      if (locale !== undefined) voiceSettings.locale = locale
      // Normalize so BOTH the route path (snake_case) and the workflow-DAG path
      // (camelCase node data) emit HeyGen's expected snake_case engine_settings.
      const normalizedTts = normalizeTtsEngine(ttsEngine)
      if (normalizedTts !== undefined) voiceSettings.engine_settings = normalizedTts
      base.voice_settings = voiceSettings
    } else {
      base.audio_url = audioUrl
    }

    if (caption) {
      base.caption = { file_format: "srt", style: captionStyle ?? "default" }
    }

    if (background !== undefined) {
      const bgPayload: Record<string, unknown> = { type: background.type }
      if (background.value !== undefined) bgPayload.value = background.value
      if (background.url !== undefined) bgPayload.url = background.url
      if (background.assetId !== undefined) bgPayload.asset_id = background.assetId
      base.background = bgPayload
    }

    if (removeBackground !== undefined) {
      base.remove_background = removeBackground
    }

    // motion_prompt is ONLY valid for avatar_iv + photo avatars; rejected for
    // avatar_v. Image-source mode is IV-class (its own engine), so it's allowed.
    if (
      motionPrompt !== undefined &&
      (avatarSource === "image" || effectiveEngine !== "avatar-v")
    ) {
      base.motion_prompt = motionPrompt
    }

    // expressiveness is photo-avatars-only / IV-class — same class as
    // motion_prompt. Gate it identically: avatar_v ignores/rejects it, so only
    // send it for image-source mode (IV-class) or non-avatar_v engines. Without
    // this gate a stale value set under avatar-iv would reach HeyGen after the
    // user switches to avatar-v (the config panel hides the control but doesn't
    // clear the stored value).
    if (
      expressiveness !== undefined &&
      (avatarSource === "image" || effectiveEngine !== "avatar-v")
    ) {
      base.expressiveness = expressiveness
    }

    return base
  }

  // ── POST /v3/videos with engine-eligibility fallback ─────────────────────
  // Image-source mode is IV-class: it sends no `engine` field, so the V→IV
  // eligibility fallback below never applies. Pin the billing engine to
  // avatar-iv so the cost matches the IV rate (mirrors resolveAiAvatarCreditId).
  let effectiveEngine: AiAvatarEngine = avatarSource === "image" ? "avatar-iv" : engine
  let videoId: string

  try {
    const resp = await heygenFetch<RawCreateVideoResponse>("/v3/videos", {
      method: "POST",
      body: JSON.stringify(buildBody(engine)),
    })
    videoId = resp.data.video_id
  } catch (err) {
    // Engine-eligibility fallback: Avatar V → IV on "does not support Avatar" error.
    // Only relevant for avatar-source mode (image mode has no engine field).
    if (
      err instanceof HeygenError &&
      avatarSource !== "image" &&
      engine === "avatar-v" &&
      /does not support Avatar/i.test(err.message)
    ) {
      effectiveEngine = "avatar-iv"
      const retryResp = await heygenFetch<RawCreateVideoResponse>("/v3/videos", {
        method: "POST",
        body: JSON.stringify(buildBody("avatar-iv")),
      })
      videoId = retryResp.data.video_id
    } else {
      throw err
    }
  }

  // ── Poll /v1/video_status.get until completed or failed ──────────────────
  const deadline = Date.now() + MAX_POLL_DURATION_MS

  while (true) {
    await sleep(pollIntervalMs)

    const statusResp = await heygenFetch<RawVideoStatusResponse>(
      `/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
    )

    const { status, video_url, duration, error } = statusResp.data

    if (status === "completed") {
      if (!video_url) {
        throw new HeygenError("HeyGen returned completed status but no video_url")
      }

      // Guard: a missing or zero duration would compute cost=0, effectively
      // giving a free video and refunding the entire reservation. Throw instead
      // so the job fails and credits are refunded cleanly rather than silently
      // undercharging.
      if (!duration || duration <= 0) {
        throw new HeygenError("HeyGen returned completed without a duration")
      }

      const cost = aiAvatarUsdCost(effectiveEngine, resolution, duration)

      return {
        videoUrl: video_url,
        durationSec: duration,
        cost,
        meteredCost: true,
      }
    }

    if (status === "failed") {
      throw new HeygenError(error ?? "HeyGen video generation failed", {
        code: "generation_failed",
      })
    }

    if (Date.now() >= deadline) {
      throw new HeygenError(
        `HeyGen video generation timed out after ${MAX_POLL_DURATION_MS / 1000}s`,
        { code: "timeout" },
      )
    }
  }
}
