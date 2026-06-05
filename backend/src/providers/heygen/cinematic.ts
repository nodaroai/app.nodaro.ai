/**
 * HeyGen Cinematic Avatar generation — POST /v3/videos (type:"cinematic_avatar")
 * + poll /v1/video_status.get.
 *
 * ─── How this differs from generateAvatarVideo ──────────────────────────────
 * The `cinematic_avatar` discriminant is a generative clip (Seedance-style
 * pipeline) driven entirely by a PROMPT + 1–3 avatar look ids — there is NO
 * script / voice / audio / engine. The request shape is:
 *   {
 *     type: "cinematic_avatar",
 *     prompt: string (1–10000),
 *     avatar_id: string[] (1–3 look ids),
 *     duration?: int (4–15, default 10),
 *     auto_duration?: bool (default false),
 *     aspect_ratio?: "16:9" | "9:16" | "1:1" (default 16:9),
 *     resolution?: "720p" | "1080p" (default 720p),
 *     enhance_prompt?: bool (default false),
 *     references?: AssetUrl[]  (optional images/videos/audio guiding generation)
 *   }
 *
 * ─── references ─────────────────────────────────────────────────────────────
 * HeyGen's `references` array is a discriminated union keyed by `type` on the
 * SOURCE FORMAT — `"url" | "asset_id" | "base64"` — NOT on the media kind.
 * HeyGen infers video/image/audio from the URL itself; there is NO media-kind
 * field on the item (confirmed against create-video.md: `AssetUrl` is exactly
 * `{ type: "url", url: string }` with additionalProperties:false). We always
 * resolve references to a public R2 url, so every item maps to the AssetUrl
 * shape `{ type: "url", url }`. Our caller-facing `references` carries an
 * internal media-kind `type` (video/image/audio) used ONLY for the route's
 * caps validation — it is mapped away here before hitting the API.
 * Combined HeyGen limits: at most 3 videos and 9 images across avatar looks +
 * references (enforced at the route).
 *
 * ─── Result URLs ────────────────────────────────────────────────────────────
 * HeyGen result URLs are signed and EXPIRING — the caller MUST re-host to R2
 * immediately after generation. Never store a raw HeyGen URL.
 *
 * ─── Duration ───────────────────────────────────────────────────────────────
 * `data.duration` is fractional seconds. cinematicUsdCost() calls Math.ceil()
 * internally so partial seconds are billed as full seconds.
 */

import { heygenFetch, HeygenError } from "./client.js"
import { cinematicUsdCost } from "@nodaro/shared"
import type { CinematicResolution } from "@nodaro/shared"
import type { RawCreateVideoResponse, RawVideoStatusResponse } from "./types.js"

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface GenerateCinematicAvatarOpts {
  /** Generative prompt (1–10000 chars). Unlike ai-avatar's script, this IS a prompt. */
  prompt: string
  /** 1–3 catalog avatar look ids (the same /v3/avatars/looks the ai-avatar picker uses). */
  avatarLooks: string[]
  /** Target clip length in seconds (4–15, default 10). Ignored when autoDuration. */
  duration?: number
  /** Let HeyGen auto-pick the clip length (default false). */
  autoDuration?: boolean
  /** Output aspect ratio (default "16:9"). */
  aspectRatio?: "16:9" | "9:16" | "1:1"
  /** Output resolution (default "720p"). */
  resolution?: CinematicResolution
  /** Ask HeyGen to enhance the prompt before generation (default false). */
  enhancePrompt?: boolean
  /**
   * Optional reference assets (images/videos/audio) guiding the generation.
   * `type` is the internal MEDIA KIND (used by the route for caps validation);
   * each item is mapped to HeyGen's AssetUrl shape `{ type: "url", url }` here.
   * Combined HeyGen limits (enforced at the route): ≤3 videos, ≤9 images across
   * avatar looks + references.
   */
  references?: Array<{ type: "video" | "image" | "audio"; url: string }>
  /**
   * Poll interval in milliseconds (default 6000).
   * Pass 0 in tests to skip sleep delays.
   */
  pollIntervalMs?: number
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface CinematicAvatarResult {
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
 * Generates a cinematic-avatar video via HeyGen, polls to completion, and
 * returns the result URL + duration + USD cost.
 *
 * The caller is responsible for re-hosting the returned `videoUrl` to R2
 * before it expires.
 */
export async function generateCinematicAvatar(
  opts: GenerateCinematicAvatarOpts,
): Promise<CinematicAvatarResult> {
  const {
    prompt,
    avatarLooks,
    duration,
    autoDuration,
    aspectRatio = "16:9",
    resolution = "720p",
    enhancePrompt,
    references,
    pollIntervalMs = 6000,
  } = opts

  // ── Build the /v3/videos request body ────────────────────────────────────
  const body: Record<string, unknown> = {
    type: "cinematic_avatar",
    prompt,
    avatar_id: avatarLooks,
    aspect_ratio: aspectRatio,
    resolution,
  }

  if (autoDuration) {
    // When auto_duration is on, HeyGen picks the length — do NOT send duration.
    body.auto_duration = true
  } else if (duration !== undefined) {
    body.duration = duration
  }

  if (enhancePrompt !== undefined) {
    body.enhance_prompt = enhancePrompt
  }

  // ── references → HeyGen AssetUrl[] ───────────────────────────────────────
  // Map our internal {type:"video"|"image"|"audio", url} to HeyGen's
  // source-format discriminated union AssetUrl shape {type:"url", url}. The
  // media kind is inferred by HeyGen from the URL — it is NOT a field on the
  // item (sending it would be rejected: AssetUrl is additionalProperties:false
  // with `type` const "url"). Empty arrays are omitted so we never send
  // `references: []`.
  if (references && references.length > 0) {
    body.references = references.map((ref) => ({ type: "url", url: ref.url }))
  }

  // ── POST /v3/videos ──────────────────────────────────────────────────────
  const resp = await heygenFetch<RawCreateVideoResponse>("/v3/videos", {
    method: "POST",
    body: JSON.stringify(body),
  })
  const videoId = resp.data.video_id

  // ── Poll /v1/video_status.get until completed or failed ──────────────────
  const deadline = Date.now() + MAX_POLL_DURATION_MS

  while (true) {
    await sleep(pollIntervalMs)

    const statusResp = await heygenFetch<RawVideoStatusResponse>(
      `/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
    )

    const { status, video_url, duration: resultDuration, error } = statusResp.data

    if (status === "completed") {
      if (!video_url) {
        throw new HeygenError("HeyGen returned completed status but no video_url")
      }

      // Guard: a missing or zero duration would compute cost=0, effectively
      // giving a free video and refunding the entire reservation. Throw instead
      // so the job fails and credits are refunded cleanly rather than silently
      // undercharging.
      if (!resultDuration || resultDuration <= 0) {
        throw new HeygenError("HeyGen returned completed without a duration")
      }

      const cost = cinematicUsdCost(resolution, resultDuration)

      return {
        videoUrl: video_url,
        durationSec: resultDuration,
        cost,
        meteredCost: true,
      }
    }

    if (status === "failed") {
      throw new HeygenError(error ?? "HeyGen cinematic-avatar generation failed", {
        code: "generation_failed",
      })
    }

    if (Date.now() >= deadline) {
      throw new HeygenError(
        `HeyGen cinematic-avatar generation timed out after ${MAX_POLL_DURATION_MS / 1000}s`,
        { code: "timeout" },
      )
    }
  }
}
