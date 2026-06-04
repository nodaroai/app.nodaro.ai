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
// Options
// ---------------------------------------------------------------------------

export interface GenerateAvatarVideoOpts {
  engine: AiAvatarEngine
  avatarId: string
  speechMode: "text" | "audio"
  /** Text mode: the verbatim script (≤5000 chars). Distinct from any prompt field. */
  script?: string
  /** Text mode: HeyGen voice ID. */
  voiceId?: string
  /** Text mode: playback speed 0.5–1.5 (default 1.0). */
  voiceSpeed?: number
  /** Audio mode: R2 URL of the driving audio. */
  audioUrl?: string
  resolution: AiAvatarResolution
  aspectRatio: "16:9" | "9:16"
  caption?: boolean
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
    engine,
    avatarId,
    speechMode,
    script,
    voiceId,
    voiceSpeed,
    audioUrl,
    resolution,
    aspectRatio,
    caption,
    pollIntervalMs = 6000,
  } = opts

  // ── Build the /v3/videos request body ────────────────────────────────────
  function buildBody(effectiveEngine: AiAvatarEngine): Record<string, unknown> {
    const base: Record<string, unknown> = {
      type: "avatar",
      avatar_id: avatarId,
      engine: { type: engineApi(effectiveEngine) },
      resolution,
      aspect_ratio: aspectRatio,
      output_format: "mp4",
    }

    if (speechMode === "text") {
      base.script = script
      base.voice_id = voiceId
      base.voice_settings = { speed: voiceSpeed ?? 1.0 }
    } else {
      base.audio_url = audioUrl
    }

    if (caption) {
      base.caption = { file_format: "srt", style: "default" }
    }

    return base
  }

  // ── POST /v3/videos with engine-eligibility fallback ─────────────────────
  let effectiveEngine: AiAvatarEngine = engine
  let videoId: string

  try {
    const resp = await heygenFetch<RawCreateVideoResponse>("/v3/videos", {
      method: "POST",
      body: JSON.stringify(buildBody(engine)),
    })
    videoId = resp.data.video_id
  } catch (err) {
    // Engine-eligibility fallback: Avatar V → IV on "does not support Avatar" error
    if (
      err instanceof HeygenError &&
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
