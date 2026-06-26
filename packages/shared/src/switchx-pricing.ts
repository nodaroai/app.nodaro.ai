// Beeble SwitchX pricing. Anchored to Beeble's published rate 2026-06-26
***REDACTED-OSS-SCRUB***
***REDACTED-OSS-SCRUB***
// and commit it verbatim. Tiers ARE 30-frame multiples, so a clip snaps to the
// exact number of blocks Beeble bills (ceil(frames/30)); there is no tier
***REDACTED-OSS-SCRUB***
//
***REDACTED-OSS-SCRUB***
// [comment removed]
// cost_markup_percent (applied at reserve) rather than baking it in here.
export const SWITCHX_FRAME_TIERS = [30, 60, 90, 120, 150, 180, 210, 240] as const

const SWITCHX_BLOCK_FRAMES = 30

export function pickSwitchXFrameTier(frames?: number): number {
  if (frames === undefined || !Number.isFinite(frames) || frames <= 0) return 240
  for (const t of SWITCHX_FRAME_TIERS) if (frames <= t) return t
  return 240
}

***REDACTED-OSS-SCRUB***
const SWITCHX_BLOCK_CREDITS: Record<720 | 1080, number> = { 720: 5, 1080: 15 }

export function switchXHoldCredits(frames: number | undefined, res: 720 | 1080): number {
  // tier is always a 30-frame multiple, so (tier / 30) is the integer block count.
  const blocks = pickSwitchXFrameTier(frames) / SWITCHX_BLOCK_FRAMES
  return blocks * SWITCHX_BLOCK_CREDITS[res]
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
