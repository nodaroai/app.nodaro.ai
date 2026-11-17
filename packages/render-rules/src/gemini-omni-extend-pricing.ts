/**
 * How a Gemini Omni Flash 1.2 Extend run (`gemini-omni-flash-1-2-extend`) is
 * priced (decided 2026-11-17) — the ONE rule the route's hold, a workflow
 * run's hold, the worker's settlement and the price lookups' answer to a
 * whole-run quote id (`geminiOmniExtendQuoteCreditId`, `@nodaro/shared`) all
 * read, so an administrator's change to either row moves every one of them.
 *
 * Two kinds of row, both admin-editable in `model_pricing`:
 * - {@link GEMINI_OMNI_EXTEND_SOURCE_CREDIT_ID}: per second of the source sent;
 * - {@link GEMINI_OMNI_EXTEND_ADDED_CREDIT_IDS}: per second added, one per
 *   resolution the catalog entry offers.
 * A run's base is (sent × the sent row) + (added × its resolution's row),
 * rounded up to the next {@link GEMINI_OMNI_EXTEND_ROUND_TO} once; the
 * deployment's pricing settings apply to that total once, at the resolution's
 * row (the id the route's guard names).
 */
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { CONTAINER_OVERHANG_SEC } from "@nodaro/shared/video"
import { parseGeminiOmniExtendQuoteCreditId, tailExtendResolution, type GeminiOmniExtendQuoteCreditIdParts } from "@nodaro/shared/credits"
import { resolveGraphOrigin, type EstimateGraphEdge, type EstimateGraphNode } from "./apply-edl-estimate"
import { forwardedVideoLengthSec } from "./utility-wire-length"
import { activeTake } from "./measured-wire-length"
import { LENGTH_RECORDING_VIDEO_NODE_TYPES } from "./length-following-video"
import { runWireFrame, type VideoFrame } from "./topaz-video-quote"

/** The Extend Video provider these rows price. */
export const GEMINI_OMNI_EXTEND_PROVIDER = "gemini-omni-flash-1-2-extend" as const

/** Is `provider` Gemini Omni Flash 1.2 Extend? A retired id answers false. */
export function isGeminiOmniExtendProvider(provider: unknown): provider is typeof GEMINI_OMNI_EXTEND_PROVIDER {
  return provider === GEMINI_OMNI_EXTEND_PROVIDER
}

/** The row priced per second of the source sent, at every resolution. */
export const GEMINI_OMNI_EXTEND_SOURCE_CREDIT_ID = `${GEMINI_OMNI_EXTEND_PROVIDER}:source:per-second`

/** The rows priced per second added, by resolution (read from the catalog's resolutions). */
export const GEMINI_OMNI_EXTEND_ADDED_CREDIT_IDS: Readonly<Record<string, string>> = Object.fromEntries(
  (MODEL_CATALOG[GEMINI_OMNI_EXTEND_PROVIDER]?.resolutions ?? []).map((resolution) => [
    resolution,
    `${GEMINI_OMNI_EXTEND_PROVIDER}:${resolution}:per-second`,
  ]),
)

/** The per-second-added row of the resolution a run renders at (720p for one it does not offer): the id its hold is marked up at. */
export function geminiOmniExtendAddedCreditId(resolution: unknown): string {
  return GEMINI_OMNI_EXTEND_ADDED_CREDIT_IDS[tailExtendResolution(GEMINI_OMNI_EXTEND_PROVIDER, resolution)]
    ?? GEMINI_OMNI_EXTEND_ADDED_CREDIT_IDS["720p"]!
}

/** A run's total is rounded up to a multiple of this, once, before the pricing settings apply. */
export const GEMINI_OMNI_EXTEND_ROUND_TO = 10

/**
 * The shortest source (its picture, in seconds) the engine continues: about
 * 4 seconds — the 4 s source the model was measured continuing, less the
 * quarter second the sent-seconds rule allows a picture (`CONTAINER_OVERHANG_SEC`),
 * so a nominal 4 s clip that measures 3.96 s runs (decided 2026-11-17).
 */
export const GEMINI_OMNI_EXTEND_MIN_SOURCE_SEC = 4 - CONTAINER_OVERHANG_SEC

/**
 * The BASE credits of one run: `sentSec` × the sent row plus `addedSec` × the
 * resolution's row, rounded up to the next {@link GEMINI_OMNI_EXTEND_ROUND_TO}
 * once. The sum is read to the millionth first, so a product that floats a
 * hair above a whole multiple (5 × 4.2) is not pushed to the next one.
 */
export function geminiOmniExtendBaseCredits(args: {
  readonly sourcePerSec: number
  readonly addedPerSec: number
  readonly sentSec: number
  readonly addedSec: number
}): number {
  const raw = Math.round((args.sourcePerSec * args.sentSec + args.addedPerSec * args.addedSec) * 1e6) / 1e6
  return Math.ceil(raw / GEMINI_OMNI_EXTEND_ROUND_TO) * GEMINI_OMNI_EXTEND_ROUND_TO
}

/**
 * A whole-run quote id the server prices, read: its parts when the engine can
 * run it (a resolution it renders, a length in its window, at most 10 s and
 * at least its shortest source sent), else undefined (the id lands in
 * `missing`).
 */
export function pricedGeminiOmniExtendQuote(id: string): GeminiOmniExtendQuoteCreditIdParts | undefined {
  const parts = parseGeminiOmniExtendQuoteCreditId(id)
  if (!parts) return undefined
  const entry = MODEL_CATALOG[GEMINI_OMNI_EXTEND_PROVIDER]
  if (!entry?.resolutions?.includes(parts.resolution)) return undefined
  if (!entry.durations?.includes(parts.addedSec)) return undefined
  if (parts.sentSec > 10 || parts.sentSec < GEMINI_OMNI_EXTEND_MIN_SOURCE_SEC) return undefined
  return parts
}

/** The rows a quote's price reads, and its base from them (undefined when a row is priced nowhere). */
export function geminiOmniExtendQuoteBase(
  parts: GeminiOmniExtendQuoteCreditIdParts,
  rowOf: (id: string) => number | undefined,
): number | undefined {
  const sourcePerSec = rowOf(GEMINI_OMNI_EXTEND_SOURCE_CREDIT_ID)
  const addedPerSec = rowOf(geminiOmniExtendAddedCreditId(parts.resolution))
  if (sourcePerSec === undefined || addedPerSec === undefined) return undefined
  return geminiOmniExtendBaseCredits({ sourcePerSec, addedPerSec, sentSec: parts.sentSec, addedSec: parts.addedSec })
}

/** The lines of picture (the short side) each resolution renders. */
export const GEMINI_OMNI_EXTEND_TIER_LINES: Readonly<Record<string, number>> = { "360p": 360, "720p": 720, "1080p": 1080, "4k": 2160 }

/**
 * How far a source's short side may sit above a tier's lines and still count
 * as that tier (decided 2026-11-17): 2% of the tier's lines (the tolerance the
 * 16:9 / 9:16 shape check gives), and never less than 16 lines — the padding
 * an encoder adds to a 720- or 1080-line picture (736, 1088). A source a few
 * lines over a tier is that tier, never the next one up.
 */
export const GEMINI_OMNI_EXTEND_TIER_TOLERANCE = 0.02
export const GEMINI_OMNI_EXTEND_TIER_TOLERANCE_MIN_LINES = 16

/** The most lines of a source's short side that count as the tier of `lines`. */
function tierCeilingLines(lines: number): number {
  return lines + Math.max(lines * GEMINI_OMNI_EXTEND_TIER_TOLERANCE, GEMINI_OMNI_EXTEND_TIER_TOLERANCE_MIN_LINES)
}

/**
 * The resolution a run renders at, and is charged at (decided 2026-11-17).
 * The delivered clip keeps the source's size, so no run renders, or is
 * charged, above the source: the asked resolution (one the engine renders,
 * else 720p) is capped at the SOURCE'S TIER — the smallest of 360p / 720p /
 * 1080p / 4k whose lines (360 / 720 / 1080 / 2160) are at or above the
 * source's short side, a source a few lines over a tier counting as that
 * tier ({@link GEMINI_OMNI_EXTEND_TIER_TOLERANCE}); 4k above that; 360p for a
 * source under 360. A 1280×720 source asked for 4K runs at 720p, a 1296×736
 * one at 720p, a 1920×1088 one at 1080p, an 854×480 one at 720p. A tier
 * below the source's runs as asked (the stitch scales the new seconds up to
 * the source's size). A source whose size is not known: the asked tier.
 */
export function geminiOmniExtendResolution(asked: unknown, source?: { readonly width: number; readonly height: number }): string {
  const resolution = tailExtendResolution(GEMINI_OMNI_EXTEND_PROVIDER, asked)
  if (!source || !(source.width > 0) || !(source.height > 0)) return resolution
  const shortSide = Math.min(source.width, source.height)
  const tiers = Object.entries(GEMINI_OMNI_EXTEND_TIER_LINES).sort((a, b) => a[1] - b[1])
  const cap = tiers.find(([, lines]) => tierCeilingLines(lines) >= shortSide) ?? tiers[tiers.length - 1]!
  return GEMINI_OMNI_EXTEND_TIER_LINES[resolution]! > cap[1] ? cap[0] : resolution
}

/** What an estimate knows of the source an Extend Video node continues. */
export interface GeminiOmniExtendEstimateSource {
  /** The seconds of picture to quote, rounded so the quote is never below the hold; undefined when not known (the whole 10 s window). */
  readonly sourcePictureSec?: number
  /** The source's recorded size, when the graph knows it. */
  readonly frame?: VideoFrame
}

/**
 * The source of a Gemini Omni Flash 1.2 Extend node as an estimate reads it —
 * the editor's quote and the server's run estimate alike (decided 2026-11-17):
 * - its length: an upload's or a Video URL's, as measured (the run measures
 *   the same file); a video generation's recorded length (that does not run
 *   again in the estimated run) rounded UP to the whole second, because such a
 *   record can sit a little under the file the run measures, and the
 *   charge's sent seconds never exceed that whole second (a picture at most a
 *   quarter second past its record reads as the record's whole second or
 *   less); any other source, not known (the whole 10 s window);
 * - its size, when the graph records one (`runWireFrame`).
 * A node with several video wires is not known.
 */
export function geminiOmniExtendEstimateSource(
  node: { readonly id?: string | null },
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
  rerunIds: ReadonlySet<string>,
): GeminiOmniExtendEstimateSource {
  if (!node.id) return {}
  const wires = edges.filter((e) => e.target === node.id && (e.targetHandle === "video" || e.targetHandle === undefined || e.targetHandle === null || e.targetHandle === ""))
  if (wires.length !== 1) return {}
  const wire = wires[0]!
  const frame = runWireFrame(wire.source, nodes, edges, rerunIds)
  const origin = resolveGraphOrigin(nodes.find((n) => n.id === wire.source), nodes, edges)
  const known = (sec: unknown): number | undefined => (typeof sec === "number" && Number.isFinite(sec) && sec > 0 ? sec : undefined)
  let sourcePictureSec: number | undefined
  if (origin) {
    const type = origin.type ?? ""
    if (type === "upload-video" || type === "youtube-video") sourcePictureSec = known(forwardedVideoLengthSec(origin))
    else if (LENGTH_RECORDING_VIDEO_NODE_TYPES.has(type) && !rerunIds.has(origin.id)) {
      const recorded = known(activeTake(origin.data, { anyUrl: true })?.duration)
      sourcePictureSec = recorded === undefined ? undefined : Math.ceil(recorded - 1e-9)
    }
  }
  return { ...(sourcePictureSec !== undefined ? { sourcePictureSec } : {}), ...(frame ? { frame } : {}) }
}
