/**
 * The price of ONE Gemini Omni Flash 1.2 Extend run (`gemini-omni-flash-1-2-extend`),
 * as ONE id (decided 2026-11-17) — part of the public credit-id contract.
 *
 * Such a run is charged per second of video it sends and adds, on two rows
 * the server reads, the total rounded up once: no single row × units can name
 * it. `geminiOmniExtendQuoteCreditId` names the whole run instead:
 *
 *   `gemini-omni-flash-1-2-extend:<resolution>:sent-<S>s:added-<A>s`
 *
 * - `<resolution>`: the one the run renders at and is priced by (360p / 720p /
 *   1080p / 4k; any other is 720p, as the run reads it);
 * - `<S>`: the seconds of the source sent — its last 10 seconds, or all of a
 *   shorter source, read by the platform's container-overhang rule (8.04 s is
 *   8 s, 8.3 s is 8.3 s); with no known source, the whole 10 s window, the
 *   most a run sends;
 * - `<A>`: the whole seconds added, held in the engine's 3–10 s window (8
 *   when none is asked).
 *
 * `GET /v1/credits/model-cost` and `POST /v1/credits/model-costs` answer it
 * with exactly what such a run is charged; an id the server does not price (a
 * resolution, a length or a source it refuses) lands in `missing`. Numbers are
 * written exactly as JavaScript prints them.
 */
import { MODEL_CATALOG } from "./model-catalog.js"
import { seedanceExtendAddedSec, seedanceExtendSentSec } from "./seedance-extend-rate.js"

const PROVIDER = "gemini-omni-flash-1-2-extend"
const DEFAULT_RESOLUTION = "720p"
const PREFIX = `${PROVIDER}:`
const NUMBER = String.raw`\d{1,7}(?:\.\d{1,20})?`
const QUOTE_ID = new RegExp(`^${PROVIDER}:([0-9a-z]+):sent-(${NUMBER})s:added-(\\d{1,3})s$`)

/** A `gemini-omni-flash-1-2-extend:<res>:sent-<S>s:added-<A>s` id, read back. */
export interface GeminiOmniExtendQuoteCreditIdParts {
  /** The resolution the run renders at. */
  readonly resolution: string
  /** The seconds of the source sent. */
  readonly sentSec: number
  /** The whole seconds added. */
  readonly addedSec: number
}

/**
 * The id of the whole price of one Gemini Omni Flash 1.2 Extend run that adds
 * `duration` seconds at `resolution` to a source whose picture lasts
 * `sourcePictureSec` (undefined, or not a positive number: not known — the
 * whole 10 s window, the most a run of that length costs).
 */
export function geminiOmniExtendQuoteCreditId(args: {
  readonly sourcePictureSec?: number | null
  readonly duration?: number | string
  readonly resolution?: unknown
}): string {
  const resolution = typeof args.resolution === "string" && MODEL_CATALOG[PROVIDER]?.resolutions?.includes(args.resolution)
    ? args.resolution
    : DEFAULT_RESOLUTION
  const sent = seedanceExtendSentSec(args.sourcePictureSec)
  const added = seedanceExtendAddedSec(PROVIDER, args.duration)
  return `${PREFIX}${resolution}:sent-${String(sent)}s:added-${String(added)}s`
}

/**
 * The parts of such an id by its shape alone, or undefined. Which
 * resolutions, lengths and sources the server prices is the server's to say:
 * an id it does not price lands in `missing`.
 */
export function parseGeminiOmniExtendQuoteCreditId(id: string): GeminiOmniExtendQuoteCreditIdParts | undefined {
  if (typeof id !== "string" || !id.startsWith(PREFIX)) return undefined
  const m = QUOTE_ID.exec(id)
  if (!m) return undefined
  const sentSec = Number(m[2])
  const addedSec = Number(m[3])
  if (!Number.isFinite(sentSec) || sentSec <= 0 || !Number.isInteger(addedSec) || addedSec <= 0) return undefined
  return { resolution: m[1]!, sentSec, addedSec }
}
