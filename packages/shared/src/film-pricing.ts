/**
 * Film cost ESTIMATION for the studio preview.
 *
 * This is display guidance only — it produces an approximate "this film will
 * cost ≈ N credits" number so the user can see cost before committing to a
 * length + model. The ACTUAL charge is still computed at generation time from
 * `STATIC_CREDIT_COSTS` / the `model_pricing` table per job; this module never
 * bills.
 *
 * Numbers are grounded in the KIE-calibrated per-clip credit costs in
 * `backend/src/ee/billing/credits.ts` (each entry there is annotated with its
 * KIE-credit + USD source). A backend test cross-checks `VIDEO_CLIP_CREDITS`
 * against that source so the estimate can't silently drift from reality.
 *
 * Cost structure of a Story→Video film:
 *   total = BASE  (duration-independent planning + assembly)
 *         + perShot × shotCount   (the variable, model-driven bulk)
 * where a shot = one keyframe image + one video clip + one video-critic pass,
 * and shotCount ≈ ceil(duration / clipSeconds) for the chosen model.
 */

/**
 * Duration-independent overhead, in credits:
 *   script/showrunner LLM chain ~30 · music timeline 4 · editor LLM 3 ·
 *   final merge 3 · storyboard-cohesion critic 5  ≈ 45.
 * Mirrors the fixed line items in `estimateUpfrontCredits`
 * (backend/src/ee/pipelines/credits.ts).
 */
export const FILM_BASE_CREDITS = 45

/** Per-shot keyframe image (nano-banana class) — see STATIC_CREDIT_COSTS. */
export const KEYFRAME_CREDITS_PER_SHOT = 2
/** Per-shot Video Critic pass (first_last frame mode) — see credits.ts. */
export const VIDEO_CRITIC_CREDITS_PER_SHOT = 2

export interface VideoClipCost {
  /** Representative per-clip credit cost at the studio's default config
   *  (720p; for the Seedance 2 family this is the ref-image variant the
   *  studio uses for identity). Sourced from STATIC_CREDIT_COSTS. */
  readonly credits: number
  /** Representative clip length in seconds for shot-count estimation. */
  readonly clipSeconds: number
}

/**
 * Representative per-clip credit cost for each user-pinnable video model.
 * Values are the KIE-calibrated credits from STATIC_CREDIT_COSTS at the
 * studio's typical settings (720p; Seedance 2 = 8s 720p +ref). Keep in sync
 * with that table — the backend cross-check test guards drift.
 */
export const VIDEO_CLIP_CREDITS: Record<string, VideoClipCost> = {
  "kling-turbo": { credits: 11, clipSeconds: 5 }, // kling-turbo:5s
  "kling": { credits: 14, clipSeconds: 5 }, // kling:5s
  ***REDACTED-OSS-SCRUB***
  "seedance": { credits: 7, clipSeconds: 8 }, // seedance:8s
  "seedance-2": { credits: 50, clipSeconds: 8 }, // seedance-2:8s:720p-ref
  "seedance-2-fast": { credits: 40, clipSeconds: 8 }, // seedance-2-fast:8s:720p-ref
  "veo3": { credits: 79, clipSeconds: 8 }, // flat per generation (VEO 3.1 Quality)
  "veo3.1": { credits: 19, clipSeconds: 6 }, // veo3.1 @ 720p
  "veo3_lite": { credits: 10, clipSeconds: 6 }, // veo3_lite @ 720p
  "minimax": { credits: 18, clipSeconds: 6 }, // fixed ~6s
  "hailuo-standard": { credits: 8, clipSeconds: 6 }, // hailuo-standard:6s
  "wan-turbo": { credits: 13, clipSeconds: 5 }, // 5s 480p
  "bytedance-lite": { credits: 6, clipSeconds: 5 },
  "bytedance-pro": { credits: 18, clipSeconds: 5 },
}

/**
 * Fallback when no model is pinned (Auto — the Scene Director picks per scene)
 * or the model isn't in the table. kling-turbo is the cheap, common default
 * the engine gravitates to, so it's a reasonable "≈" anchor.
 */
export const DEFAULT_VIDEO_CLIP_COST: VideoClipCost = VIDEO_CLIP_CREDITS["kling-turbo"]!

export interface FilmCreditEstimate {
  /** Total estimated credits for the whole film. */
  readonly totalCredits: number
  /** Fixed base portion (planning + assembly). */
  readonly baseCredits: number
  /** Variable portion (shots × per-shot). */
  readonly variableCredits: number
  /** Estimated number of shots (clips) generated. */
  readonly shotCount: number
  /** Average credits per second of film (totalCredits / duration). */
  readonly creditsPerSecond: number
  /** Whether a known model drove the estimate (false = Auto/fallback). */
  readonly modelKnown: boolean
}

/**
 * Estimate the credit cost of a Story→Video film of `durationSeconds` rendered
 * with `videoModel`. Approximate, for the studio's cost preview only.
 */
export function estimateFilmCredits(
  durationSeconds: number,
  videoModel?: string,
): FilmCreditEstimate {
  const seconds = Math.max(1, Math.round(durationSeconds))
  const known = !!videoModel && videoModel in VIDEO_CLIP_CREDITS
  const clip = known ? VIDEO_CLIP_CREDITS[videoModel!]! : DEFAULT_VIDEO_CLIP_COST

  const shotCount = Math.max(1, Math.ceil(seconds / clip.clipSeconds))
  const perShot =
    clip.credits + KEYFRAME_CREDITS_PER_SHOT + VIDEO_CRITIC_CREDITS_PER_SHOT
  const variableCredits = shotCount * perShot
  const totalCredits = FILM_BASE_CREDITS + variableCredits

  return {
    totalCredits,
    baseCredits: FILM_BASE_CREDITS,
    variableCredits,
    shotCount,
    creditsPerSecond: Math.round((totalCredits / seconds) * 10) / 10,
    modelKnown: known,
  }
}
