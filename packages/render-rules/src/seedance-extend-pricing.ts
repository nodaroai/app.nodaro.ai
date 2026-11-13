/**
 * How a Seedance 2.5 Extend Video run is priced (decided 2026-11-12).
 *
 * The run sends the model the source's last {@link SEEDANCE_EXTEND_CONTEXT_MAX_SEC}
 * seconds of picture (the whole source when it is shorter) as `@video_1`, and
 * the provider bills that clip's seconds beside the seconds it adds. So the
 * run is charged per second of (seconds sent + seconds added), at the same
 * per-second rate the earlier per-length rows were built from, the total
 * rounded up to a whole credit ONCE, then marked up once by the deployment's
 * pricing settings. A source of 2 s costs exactly what a run cost when the
 * extend sent a 2-second tail.
 *
 * `model_pricing.credit_cost` holds whole credits, and the per-second rates
 * (42.5 / 95 / 237.5 base credits at 480p / 720p / 1080p) are not whole. Each
 * resolution's row is therefore the price of TWO seconds (85 / 190 / 475), and
 * a run is `unitRateBaseCredits(row, billedSec / 2)`: the row × half a unit per
 * second, one rounding at the end. Dividing by 2 is exact in binary floating
 * point, and the rows are admin-editable like any other: a retune moves the
 * hold, every quote and the charge together.
 *
 * The seconds sent are read off the source's PICTURE, by the platform's
 * container-overhang rule (decided 2026-11-13, `CONTAINER_OVERHANG_SEC`): a
 * picture that reads at most a quarter second past a whole second counts as
 * that whole second (8.04 s is 8 s), any other counts exactly as measured
 * (8.3 s is 8.3 s, 4.37 s is 4.37 s); then at most 10. A quote that does not
 * know the source yet (an upstream generation not made yet) counts the whole
 * 10 s window, so a quote is never below the charge; a known source counts its own.
 *
 * Seedance 2.0 Extend is not priced here: it keeps its per-length rows.
 */
import {
  SEEDANCE_EXTEND_SENT_PRICED_PROVIDER,
  seedanceExtendAddedSec,
  seedanceExtendRateCreditId,
  seedanceExtendSentSec,
  seedanceExtendUnits,
} from "@nodaro/shared/credits"
import { resolveGraphOrigin, type EstimateGraphEdge, type EstimateGraphNode } from "./apply-edl-estimate"
import { forwardedVideoLengthSec } from "./utility-wire-length"
import { activeTake } from "./measured-wire-length"
import { LENGTH_RECORDING_VIDEO_NODE_TYPES } from "./length-following-video"

// The provider, the window, the rate rows and each resolution's row are the
// public credit-id contract, so they live in `@nodaro/shared/credits`, beside
// the builder (`tailExtendCreditId`) every client prices an extend with. So
// does the seconds rule (decided 2026-11-13): what is sent, what is added and
// the units they make — the rule a client's `seedanceExtendSourceCreditId`
// names a run on a known source by. One rule, re-exported here unchanged.
export {
  SEEDANCE_EXTEND_CONTEXT_MAX_SEC,
  SEEDANCE_EXTEND_RATE_CREDIT_IDS,
  SEEDANCE_EXTEND_RATE_SECONDS,
  SEEDANCE_EXTEND_SENT_PRICED_PROVIDER,
  isSeedanceExtendPricedBySecondsSent,
  isSeedanceExtendRateCreditId,
  seedanceExtendRateCreditId,
  seedanceExtendAddedSec,
  seedanceExtendSourceSec,
  seedanceExtendSentSec,
  seedanceExtendUnits,
  type SentPricedSeedanceExtendProvider,
} from "@nodaro/shared/credits"

/** A length the graph records, when it is one: finite and above 0. */
function knownSec(sec: number | null | undefined): number | undefined {
  return typeof sec === "number" && Number.isFinite(sec) && sec > 0 ? sec : undefined
}

/** The recordings an estimate reads a length off: an upload, a Video URL — at the length a run forwards from it. */
const RECORDING_VIDEO_SOURCE_TYPES: ReadonlySet<string> = new Set(["upload-video", "youtube-video"])

/**
 * The length, in seconds, of the source an Extend Video node continues, when
 * a RUN estimate knows it — the ONE reading the editor's quote and the
 * server's run estimate share (decided 2026-11-12):
 * - a recording: an upload's measured length, a Video URL's;
 * - a video generation that has made its video and does not run again in the
 *   estimated run: the length its result recorded (`output_data.durationSec`).
 * Any other source — a generation not made yet or run again, a step's output
 * — is not known: `undefined`, and the quote counts the whole 10 s window, the
 * most a run sends, so a quote is never below the charge. Read through
 * teleports. A node with several video wires is known only when every one is
 * (the longest of them).
 *
 * A recorded length is capped at its run's bound and can sit a few hundredths
 * of a second under the file the run measures: a quote read off one can be
 * that much under the charge.
 */
export function extendSourceEstimateSec(
  node: { readonly id?: string | null },
  nodes: readonly EstimateGraphNode[],
  edges: readonly EstimateGraphEdge[],
  rerunIds: ReadonlySet<string>,
): number | undefined {
  if (!node.id) return undefined
  const wires = edges.filter((e) => e.target === node.id && (e.targetHandle === "video" || e.targetHandle === undefined || e.targetHandle === null || e.targetHandle === ""))
  if (wires.length === 0) return undefined
  const lengths = wires.map((e) => {
    const origin = resolveGraphOrigin(nodes.find((n) => n.id === e.source), nodes, edges)
    if (!origin) return undefined
    const type = origin.type ?? ""
    if (RECORDING_VIDEO_SOURCE_TYPES.has(type)) return knownSec(forwardedVideoLengthSec(origin))
    if (LENGTH_RECORDING_VIDEO_NODE_TYPES.has(type) && !rerunIds.has(origin.id)) {
      return knownSec(activeTake(origin.data, { anyUrl: true })?.duration as number | undefined)
    }
    return undefined
  })
  if (lengths.some((sec) => sec === undefined)) return undefined
  return Math.max(...(lengths as number[]))
}

/** What one Seedance 2.5 Extend run is priced at: the rate row, and how many of it. */
export interface SeedanceExtendPrice {
  /** The rate row (`<provider>:<resolution>:per-2s`). */
  readonly rateId: string
  /** The rate row's units: (seconds sent + seconds added) ÷ 2. */
  readonly units: number
  /** The seconds of the source sent. */
  readonly sentSec: number
  /** The seconds added. */
  readonly addedSec: number
}

/**
 * The price of one Seedance 2.5 Extend run — the ONE rule the route's hold,
 * the workflow run's hold, the worker's settlement, the server's run estimate
 * and the editor's quote all read. `sourcePictureSec` is the length of the
 * source's picture when it is known (measured, or what the graph records),
 * else undefined: the whole window is counted.
 */
export function seedanceExtendPrice(args: {
  readonly duration: unknown
  readonly resolution: unknown
  readonly sourcePictureSec: number | null | undefined
}): SeedanceExtendPrice {
  const sentSec = seedanceExtendSentSec(args.sourcePictureSec)
  const addedSec = seedanceExtendAddedSec(SEEDANCE_EXTEND_SENT_PRICED_PROVIDER, args.duration)
  return {
    rateId: seedanceExtendRateCreditId(args.resolution),
    units: seedanceExtendUnits(sentSec, addedSec),
    sentSec,
    addedSec,
  }
}
