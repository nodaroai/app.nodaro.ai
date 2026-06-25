// Beeble SwitchX pricing. Metered per-step (no per-job meter returned), so we
// reserve a frame-tier bucket and commit it verbatim. Values are 0%-base credits
// (global markup applies at reserve). PROVISIONAL worst-case until anchored
// (see plan final task / spec §9.2): deliberately HIGH so any pre-anchor Cloud
// usage over-reserves and never under-bills. 1 credit = $0.02.
export const SWITCHX_FRAME_TIERS = [48, 96, 144, 192, 240] as const

export function pickSwitchXFrameTier(frames?: number): number {
  if (frames === undefined || !Number.isFinite(frames) || frames <= 0) return 240
  for (const t of SWITCHX_FRAME_TIERS) if (frames <= t) return t
  return 240
}

// PROVISIONAL $/frame ceilings (replace after anchoring). 1080p ≈ $0.015/frame,
// 720p ≈ $0.009/frame. base credits = ceil(usd / 0.02).
const SWITCHX_USD_PER_FRAME: Record<720 | 1080, number> = { 720: 0.009, 1080: 0.015 }

export function switchXHoldCredits(frames: number | undefined, res: 720 | 1080): number {
  const tier = pickSwitchXFrameTier(frames)
  return Math.ceil((SWITCHX_USD_PER_FRAME[res] * tier) / 0.02)
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
