// Beeble SwitchX — Relight & Switch video node. Non-monetary tier bucketing
// and credit-identifier helpers. Beeble bills per 30-frame block with no
// per-job meter returned, so we reserve a block tier (the smallest tier that
// covers the clip's frame count) and commit it verbatim — tiers are 30-frame
// multiples, so a clip snaps to the exact number of blocks Beeble bills
// (ceil(frames/30)); there is no tier over-charge.
//
// The $-per-block provider rate and the credits-per-block formula derived
// from it live in `backend/src/lib/pricing/switchx-cost.ts` (core, not ee/).
// They were moved out of this package (published Apache-2.0 on npm — an
// irrevocable grant) per the 2026-07-06 public-flip IP audit, S5.
export const SWITCHX_FRAME_TIERS = [30, 60, 90, 120, 150, 180, 210, 240] as const

/** Beeble's metering granularity: frames per billed block. */
export const SWITCHX_BLOCK_FRAMES = 30

export function pickSwitchXFrameTier(frames?: number): number {
  if (frames === undefined || !Number.isFinite(frames) || frames <= 0) return 240
  for (const t of SWITCHX_FRAME_TIERS) if (frames <= t) return t
  return 240
}

function readMaxResolution(body: Record<string, unknown>): 720 | 1080 {
  const r = Number(body.maxResolution ?? body.max_resolution)
  return r === 720 ? 720 : 1080 // default 1080
}

// Frames are stashed on the raw body by the route's ffprobe preHandler.
export function resolveSwitchXCreditId(body: Record<string, unknown>): string {
  const frames = Number(body.__probedFrameCount)
  const tier = pickSwitchXFrameTier(Number.isFinite(frames) ? frames : undefined)
  return `beeble-switchx:${tier}f:${readMaxResolution(body)}p`
}
