/**
 * How a Video to Video run on HappyHorse Edit or Wan 2.7 VideoEdit is priced
 * (decided 2026-11-18): from the length of the clip it edits, as the server
 * reads it from the file before anything is held. Every other Video to Video
 * model keeps its flat row and is never read.
 *
 * - HappyHorse Edit is charged per started half-second of the clip, at its
 *   size's row (the price of four clip seconds): row × half-seconds ÷ 8,
 *   rounded up once, marked up once. The size priced is the size sent
 *   ({@link videoToVideoSentResolution}): 1080p only when the request says
 *   so, else 720p. A clip shorter than 3 s or longer than 60 s is refused.
 * - Wan 2.7 VideoEdit is charged per second of the clip it delivers (the
 *   clip's length, or the shorter `videoEditDuration` it is asked for),
 *   rounded up to a whole second after the house grace — at its row (the price
 *   of four seconds) × seconds ÷ 4, rounded up once — but never below its flat
 *   row (`wan-videoedit`): a run is charged the LARGER of the two. A clip
 *   shorter than 2 s or longer than 10 s (past `CLIP_PRICE_GRACE_SEC`) is
 *   refused; a clip within the grace is priced at 10 s.
 *
 * The route, the workflow run, the MCP verb (which calls the route), `POST
 * /v1/quote` and both estimates read this one module.
 */
import { CLIP_PRICE_GRACE_SEC, gracedMeasuredSec } from "./priced-clip-seconds.js"
import { MODEL_CATALOG } from "./model-catalog.js"

/** Float noise: a length that is arithmetic can land a hair past an edge, and must not be refused or rounded up for it. */
const FLOAT_NOISE_SEC = 1e-9

/** The Video to Video models priced by the length of their clip. */
export const CLIP_PRICED_V2V_PROVIDERS = ["happyhorse-edit", "wan-videoedit"] as const
export type ClipPricedV2vProvider = (typeof CLIP_PRICED_V2V_PROVIDERS)[number]

/** Whether a Video to Video run on `provider` is priced by its clip's length (and so reads the clip before it holds anything). */
export function isClipPricedV2vProvider(provider: unknown): provider is ClipPricedV2vProvider {
  return typeof provider === "string" && (CLIP_PRICED_V2V_PROVIDERS as readonly string[]).includes(provider)
}

/** The shortest and longest clip HappyHorse Edit takes, in seconds. */
export const HAPPYHORSE_EDIT_MIN_SEC = 3
export const HAPPYHORSE_EDIT_MAX_SEC = 60
/** The shortest and longest clip Wan 2.7 VideoEdit takes, in seconds. */
export const WAN_VIDEOEDIT_MIN_SEC = 2
export const WAN_VIDEOEDIT_MAX_SEC = 10

/** Wan 2.7 VideoEdit's flat row: what a run cost before it was priced by length, and the least it costs now. */
export const WAN_VIDEOEDIT_FLOOR_CREDIT_ID = "wan-videoedit"

/** A rate: the row that prices `rateSeconds` seconds of clip. */
export interface V2vClipRate {
  readonly rateId: string
  readonly rateSeconds: number
}

const WAN_VIDEOEDIT_1080P_RATE: V2vClipRate = { rateId: "wan-videoedit:1080p:per-4s", rateSeconds: 4 }

/**
 * The rates, keyed `<provider>:<size priced>`. A row prices four seconds so
 * its value stays a whole credit, and dividing by 4 (or 8 half-seconds) is
 * exact in floating point. Wan 2.7 VideoEdit at 720p is charged at its 1080p
 * rate for now: giving it its own is this one entry (plus its row).
 */
export const V2V_CLIP_RATES: Readonly<Record<string, V2vClipRate>> = {
  "happyhorse-edit:720p": { rateId: "happyhorse-edit:720p:per-4s", rateSeconds: 4 },
  "happyhorse-edit:1080p": { rateId: "happyhorse-edit:1080p:per-4s", rateSeconds: 4 },
  "wan-videoedit:1080p": WAN_VIDEOEDIT_1080P_RATE,
  "wan-videoedit:720p": WAN_VIDEOEDIT_1080P_RATE,
}

/** Every rate row, once. */
export const V2V_CLIP_RATE_IDS: readonly string[] = [...new Set(Object.values(V2V_CLIP_RATES).map((r) => r.rateId))]

/**
 * The seeded credits of one of these models' rows, from their catalog entries'
 * pricing (held to `STATIC_CREDIT_COSTS` by the catalog parity test): the rows
 * an estimate with no live price table of its own compares.
 */
export function v2vSeededRowCredits(id: string): number | undefined {
  for (const provider of CLIP_PRICED_V2V_PROVIDERS) {
    const row = MODEL_CATALOG[provider]?.pricing.find((p) => p.identifier === id)
    if (row) return row.credits
  }
  return undefined
}

/** The shortest clip `provider` takes. */
export function videoToVideoClipMinSec(provider: ClipPricedV2vProvider): number {
  return provider === "happyhorse-edit" ? HAPPYHORSE_EDIT_MIN_SEC : WAN_VIDEOEDIT_MIN_SEC
}

/** The longest clip `provider` takes. */
export function videoToVideoClipMaxSec(provider: ClipPricedV2vProvider): number {
  return provider === "happyhorse-edit" ? HAPPYHORSE_EDIT_MAX_SEC : WAN_VIDEOEDIT_MAX_SEC
}

/**
 * The resolution a Video to Video run SENDS. HappyHorse Edit: "1080p" only
 * when the request names it, else "720p" — what it is priced at too, so a
 * size left on the node by another model never reaches the model unpriced.
 * Every other model: the value as given (absent stays absent).
 */
export function videoToVideoSentResolution(provider: unknown, resolution: unknown): string | undefined {
  if (provider === "happyhorse-edit") return resolution === "1080p" ? "1080p" : "720p"
  return typeof resolution === "string" && resolution !== "" ? resolution : undefined
}

/** The size a clip-priced run is CHARGED at: HappyHorse Edit's sent size; Wan 2.7 VideoEdit 720p only when named (it renders 1080p otherwise). */
function chargedSize(provider: ClipPricedV2vProvider, resolution: unknown): "720p" | "1080p" {
  if (provider === "happyhorse-edit") return videoToVideoSentResolution(provider, resolution) as "720p" | "1080p"
  return resolution === "720p" ? "720p" : "1080p"
}

/** The rate a run of `provider` at `resolution` is charged at, or undefined for a model not priced by its clip. */
export function videoToVideoClipRateOf(provider: unknown, resolution: unknown): V2vClipRate | undefined {
  if (!isClipPricedV2vProvider(provider)) return undefined
  return V2V_CLIP_RATES[`${provider}:${chargedSize(provider, resolution)}`]
}

/** The output length Wan 2.7 VideoEdit is asked for: `videoEditDuration` "5" / "10", else 0 (as long as the clip). */
function wanAskedSeconds(videoEditDuration: unknown): number {
  const n = typeof videoEditDuration === "number" ? videoEditDuration : typeof videoEditDuration === "string" ? Number(videoEditDuration) : 0
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * The seconds a clip of `clipSec` is billed for. HappyHorse Edit: every
 * started half-second of the clip (float noise forgiven, nothing more): 3.00 s
 * is 3, 10.04 s is 10.5. Wan 2.7 VideoEdit: the clip it delivers — the clip's
 * length, or `videoEditDuration` when that is shorter — rounded up to a whole
 * second after `CLIP_PRICE_GRACE_SEC`, at least 1 and at most its limit. THE
 * one rounding every lane reads.
 */
export function videoToVideoBilledSeconds(provider: ClipPricedV2vProvider, clipSec: number, videoEditDuration?: unknown): number {
  if (provider === "happyhorse-edit") return Math.max(1, Math.ceil(2 * clipSec - FLOAT_NOISE_SEC)) / 2
  const asked = wanAskedSeconds(videoEditDuration)
  const output = asked > 0 ? Math.min(asked, clipSec) : clipSec
  return Math.min(WAN_VIDEOEDIT_MAX_SEC, Math.max(1, Math.ceil(gracedMeasuredSec(output))))
}

/** What the length check answers for a clip. */
export type V2vClipLengthCheck =
  | { readonly ok: true; readonly billedSeconds: number }
  | { readonly ok: false; readonly code: "video_too_short" | "video_too_long"; readonly message: string }

const LABEL: Readonly<Record<ClipPricedV2vProvider, string>> = {
  "happyhorse-edit": "HappyHorse Edit",
  "wan-videoedit": "Wan 2.7 VideoEdit",
}

/**
 * Whether a clip of `clipSec` can run on `provider`, and the seconds it is
 * billed for. Shorter than the model's minimum is refused; longer than its
 * maximum is refused — past float noise on HappyHorse Edit, past
 * `CLIP_PRICE_GRACE_SEC` on Wan 2.7 VideoEdit (a clip within it is billed at
 * the limit).
 */
export function checkVideoToVideoClipLength(provider: ClipPricedV2vProvider, clipSec: number, videoEditDuration?: unknown): V2vClipLengthCheck {
  const min = videoToVideoClipMinSec(provider)
  const max = videoToVideoClipMaxSec(provider)
  if (clipSec < min - FLOAT_NOISE_SEC) {
    return {
      ok: false,
      code: "video_too_short",
      message: `The video is ${clipSec.toFixed(1)} seconds. ${LABEL[provider]} needs a video of at least ${min} seconds.`,
    }
  }
  const grace = provider === "wan-videoedit" ? CLIP_PRICE_GRACE_SEC : 0
  if (clipSec > max + grace + FLOAT_NOISE_SEC) {
    return {
      ok: false,
      code: "video_too_long",
      message: `The video is ${clipSec.toFixed(1)} seconds. ${LABEL[provider]} takes at most ${max} seconds. Trim the video first.`,
    }
  }
  return { ok: true, billedSeconds: videoToVideoBilledSeconds(provider, Math.min(clipSec, max), videoEditDuration) }
}

/** A clip-priced run's price: the row it reserves and, for a rate, the units of that row. */
export interface V2vClipPrice {
  /** The row the run reserves: a rate row, or Wan 2.7 VideoEdit's flat row while it is the larger. */
  readonly creditId: string
  /** Units of the row the run is charged (billed seconds ÷ the rate's seconds); undefined for a row charged once. */
  readonly units?: number
}

/**
 * The price of a run of `provider` at `resolution` billed for `billedSeconds`.
 *
 * Wan 2.7 VideoEdit is charged the LARGER of its flat row and its rate for the
 * billed seconds (its rate row × seconds ÷ 4, rounded up), so a run never
 * costs less than the flat row and costs more once its length passes what
 * that row covers; a tie keeps the flat row. `rowOf` gives a row's credits —
 * the caller's own table (the server's live rows, an estimate's price table),
 * the same kind for both rows; a row it does not know never wins.
 */
export function videoToVideoClipPrice(
  provider: ClipPricedV2vProvider,
  resolution: unknown,
  billedSeconds: number,
  rowOf: (id: string) => number | undefined,
): V2vClipPrice {
  const rate = videoToVideoClipRateOf(provider, resolution)!
  const units = billedSeconds / rate.rateSeconds
  if (provider === "happyhorse-edit") return { creditId: rate.rateId, units }
  const rateRow = rowOf(rate.rateId)
  const floorRow = rowOf(WAN_VIDEOEDIT_FLOOR_CREDIT_ID)
  const rateWins = rateRow !== undefined && (floorRow === undefined || Math.ceil(rateRow * units) > floorRow)
  return rateWins ? { creditId: rate.rateId, units } : { creditId: WAN_VIDEOEDIT_FLOOR_CREDIT_ID }
}

/**
 * The fewest billed seconds at which Wan 2.7 VideoEdit at `resolution` is
 * charged by its rate rather than its flat row, given `rowOf`; undefined when
 * the rate never passes the flat row inside the model's limit.
 */
export function wanVideoEditRateFromSeconds(resolution: unknown, rowOf: (id: string) => number | undefined): number | undefined {
  for (let s = 1; s <= WAN_VIDEOEDIT_MAX_SEC; s++) {
    if (videoToVideoClipPrice("wan-videoedit", resolution, s, rowOf).units !== undefined) return s
  }
  return undefined
}

/**
 * The billed seconds an ESTIMATE quotes before the clip is read: the length
 * the graph gives, held to the model's limits, billed as a run bills it; a
 * length it does not know quotes the longest clip the model takes — the most
 * the run can be charged — marked as an estimate by the caller.
 */
export function videoToVideoEstimateSeconds(provider: ClipPricedV2vProvider, videoEditDuration: unknown, knownSec?: number | null): number {
  const min = videoToVideoClipMinSec(provider)
  const max = videoToVideoClipMaxSec(provider)
  const sec = knownSec == null || !Number.isFinite(knownSec) || knownSec <= 0 ? max : Math.min(max, Math.max(min, knownSec))
  return videoToVideoBilledSeconds(provider, sec, videoEditDuration)
}

/** The price an estimate quotes ({@link videoToVideoEstimateSeconds}), and whether it stood in for an unknown length. */
export function videoToVideoEstimatePrice(
  provider: ClipPricedV2vProvider,
  resolution: unknown,
  videoEditDuration: unknown,
  knownSec: number | null | undefined,
  rowOf: (id: string) => number | undefined,
): V2vClipPrice & { readonly lengthKnown: boolean } {
  const lengthKnown = knownSec != null && Number.isFinite(knownSec) && knownSec > 0
  return {
    ...videoToVideoClipPrice(provider, resolution, videoToVideoEstimateSeconds(provider, videoEditDuration, knownSec), rowOf),
    lengthKnown,
  }
}
