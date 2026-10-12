import { rateLimiter } from "../middleware/rate-limit.js"

/**
 * The per-user limit on STARTING a clip measurement (decided 2026-10-12, R3):
 * 20 a minute, failing closed. ONE counter (`rl:clip-measure:<user>`) for every
 * door that starts one — `POST /v1/media/clip-length` and `POST
 * /v1/speaker-view` with a `videoUrl` — so the two cannot add up to twice the
 * allowance. A poll, or an address already measured, never counts.
 */
export const clipMeasureStartLimiter = () => rateLimiter({ windowMs: 60_000, max: 20, keyPrefix: "clip-measure", failClosed: true })
