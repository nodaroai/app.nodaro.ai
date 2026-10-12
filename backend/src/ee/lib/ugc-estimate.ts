import { DEFAULT_TRANSCRIBE_NODE_PROVIDER, estimateCombineVideosCredits } from "@nodaro/shared"
import { UGC_ESTIMATE_PARTS, type UgcEstimatePart, type UgcQuoteLineKey } from "@nodaro/render-rules"
import { getAppSettings } from "../../lib/app-settings.js"
import { getPluginServices } from "../../lib/private-plugins/load.js"
import type { PluginUgcEstimate, PluginUgcEstimateInput } from "../../lib/private-plugins/types.js"
import { getModelCreditCostFromDB } from "../billing/credits.js"
import { applyServiceMarkup } from "../billing/service-margin.js"
import { priceUgcCalls, UgcQuoteError, type UgcPriceCaller } from "./ugc-quote.js"

/**
 * The UGC canvas quote and the free dry-run estimate (Nodaro Cloud only).
 *
 * `quoteUgcTickets` prices the tickets UGC Clips returns: per clip, the video,
 * the speech call when the ticket has one, and the reading, each at the
 * platform's own charge-time price (`priceUgcCalls`), plus the steps the canvas
 * adds after the clips (the join, word timings, the speech check, the cards and
 * the captions), each read from its own price row. A ticket is opaque: only
 * `v`, `durationSec` and its `video` / `speech` call objects are read, and the
 * calls are handed to the pricer as they came.
 *
 * `estimateUgcRun` plans a whole video from a target length with the plugin's
 * `ugc.estimate` and prices it at 0.8x, 1x and 1.2x the target. It reads no
 * job, reserves nothing and spends nothing. A sampled creator is priced as the
 * run will draw it: the primary image alone, or every image candidate when the
 * run renders them all for a person to pick (`rendersEveryCandidate`).
 *
 * Both state each part's expected credits (`parts`): the script, the creator,
 * the clips, the cards' word timings and speech check, the join, the screenshot
 * cards and the captions. The editor prices a run with the parts it executes.
 *
 * An item this cannot price is an error, never a zero.
 */


/**
 * The multiple of a clip's expected price held while it renders, for a plugin
 * that predates `clipHoldFactor` (or answers it with no usable multiple).
 */
export const FALLBACK_CLIP_HOLD_FACTOR = 2

/**
 * The multiple of a clip's expected price a run holds while its clips render:
 * the plugin's own re-render factor (`clipHoldFactor`), read once per answer so
 * its ceiling, holds and worst case share one value. A plugin without the
 * member, one whose answer is not a finite number of at least 1, or one that
 * throws, holds `FALLBACK_CLIP_HOLD_FACTOR`; the quote answers either way.
 */
export function clipHoldFactor(): number {
  try {
    const raw: unknown = getPluginServices().ugc?.clipHoldFactor?.()
    return typeof raw === "number" && Number.isFinite(raw) && raw >= 1 ? raw : FALLBACK_CLIP_HOLD_FACTOR
  } catch {
    return FALLBACK_CLIP_HOLD_FACTOR
  }
}

/** What a clip holds at `factor` times its price, in whole credits: a hold rounds up, never down. */
const heldAt = (factor: number, credits: number): number => Math.ceil(factor * credits)

/** Priced as the speech check's reading of a finished clip. */
const READING = { tool: "image_to_text", args: {} } as const

/**
 * One public line: its English `label` (API and MCP clients read it), its credits, and the stable
 * id the editor names it by in the person's language (`key`); a clip line its number and length.
 */
export interface UgcQuoteLineOut {
  label: string
  credits: number
  key: UgcQuoteLineKey
  n?: number
  seconds?: number
}
/** Expected credits per part of the video, every part present (0 when the quote has none of it). */
export type UgcEstimateParts = Readonly<Record<UgcEstimatePart, number>>
export interface UgcQuoteResult {
  readonly lines: UgcQuoteLineOut[]
  readonly expected: number
  readonly ceiling: number
  /** The expected credits per part; they add up to `expected`. */
  readonly parts: UgcEstimateParts
  /**
   * What each part holds while the clips render: each clip at its ceiling (its price times the
   * plugin's hold factor, `clipHoldFactor`), the steps around the clips at their price. They add up
   * to `ceiling` (the ticket form) or `worstCase` (the estimate, at the longest length it allows).
   */
  readonly holdParts: UgcEstimateParts
  readonly range?: readonly [number, number]
  readonly worstCase?: number
}

/** A line with the part it prices (the public lines carry only label and credits). */
interface PartLine extends UgcQuoteLineOut {
  readonly part: UgcEstimatePart
}

const publicLine = ({ label, credits, key, n, seconds }: PartLine): UgcQuoteLineOut => ({
  label,
  credits,
  key,
  ...(n !== undefined ? { n } : {}),
  ...(seconds !== undefined ? { seconds } : {}),
})

/** Each part's credits: the sum of its lines; with `holdFactor`, what each clip line holds (`heldAt`). */
function partsOf(lines: readonly PartLine[], holdFactor?: number): UgcEstimateParts {
  const creditsOf = (l: PartLine) => (holdFactor !== undefined && l.part === "clip" ? heldAt(holdFactor, l.credits) : l.credits)
  return Object.fromEntries(
    UGC_ESTIMATE_PARTS.map((part) => [part, sum(lines.filter((l) => l.part === part).map(creditsOf))]),
  ) as Record<UgcEstimatePart, number>
}

/** The estimate form cannot be served: this deployment has no UGC plugin. */
export class UgcEstimateUnavailable extends Error {
  constructor() {
    super("UGC estimate is not available on this deployment")
    this.name = "UgcEstimateUnavailable"
  }
}

interface OpaqueCall {
  readonly tool: string
  readonly args: Record<string, unknown>
}
interface OpaqueTicket {
  readonly v: number
  readonly durationSec: number
  readonly video: OpaqueCall
  readonly speech: OpaqueCall | null
}

function asTicket(raw: unknown, i: number): OpaqueTicket {
  const t = raw as Partial<OpaqueTicket> | null
  if (!t || t.v !== 1 || typeof t.durationSec !== "number" || !Number.isFinite(t.durationSec) || !t.video || typeof t.video.tool !== "string") {
    throw new UgcQuoteError(`clip ${i + 1}`)
  }
  return t as OpaqueTicket
}

/** The platform's own row for a flat-priced step; a missing row is a quote error, never 0. */
async function rowCredits(id: string, label: string): Promise<number> {
  try {
    return (await getModelCreditCostFromDB(id)).creditCost
  } catch {
    throw new UgcQuoteError(label)
  }
}

/** The steps the canvas runs after the clips, in order, each with its part. */
async function fixedLines(durations: readonly number[], hasCards: boolean): Promise<PartLine[]> {
  const lines: PartLine[] = []
  if (durations.length > 1) {
    try {
      // The computed amount combine-videos reserves, marked up the way the guard marks it up.
      const base = estimateCombineVideosCredits({ transition: "cut" }, [...durations])
      lines.push({ label: "Join the clips", key: "join", credits: applyServiceMarkup(base, await getAppSettings(), "combine-videos"), part: "join" })
    } catch {
      throw new UgcQuoteError("the join")
    }
  }
  lines.push({ label: "Word timings", key: "alignment", credits: await rowCredits("elevenlabs-forced-alignment", "word timings"), part: "cards" })
  lines.push({ label: "Speech check", key: "speechCheck", credits: await rowCredits(DEFAULT_TRANSCRIBE_NODE_PROVIDER, "the speech check"), part: "cards" })
  if (hasCards) lines.push({ label: "Screenshot cards", key: "cards", credits: await rowCredits("video-overlay", "the screenshot cards"), part: "overlay" })
  lines.push({ label: "Captions", key: "captions", credits: await rowCredits("add-captions:kinetic", "the captions"), part: "captions" })
  return lines
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)

/** A price the pricer returned for a call: a non-negative number, or the quote fails. */
function priced(label: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new UgcQuoteError(label)
  return value
}

export async function quoteUgcTickets(caller: UgcPriceCaller, rawTickets: unknown[], hasCards: boolean): Promise<UgcQuoteResult> {
  return quoteTickets(caller, rawTickets, hasCards, clipHoldFactor())
}

/** The ticket quote, each clip held at `holdFactor` times its price in both the ceiling and its hold. */
async function quoteTickets(caller: UgcPriceCaller, rawTickets: unknown[], hasCards: boolean, holdFactor: number): Promise<UgcQuoteResult> {
  const tickets = rawTickets.map(asTicket)
  const lines: PartLine[] = []
  let expected = 0
  let ceiling = 0
  for (const [i, t] of tickets.entries()) {
    const calls = [t.video, ...(t.speech ? [t.speech] : []), READING]
    const prices = await priceUgcCalls(caller, calls)
    const clip = sum(prices.map((p) => priced(`clip ${i + 1}`, p)))
    lines.push({ label: `Clip ${i + 1} (${t.durationSec} s)`, key: "clip", n: i + 1, seconds: t.durationSec, credits: clip, part: "clip" })
    expected += clip
    ceiling += heldAt(holdFactor, clip)
  }
  const fixed = await fixedLines(tickets.map((t) => t.durationSec), hasCards)
  const fixedSum = sum(fixed.map((l) => l.credits))
  const all = [...lines, ...fixed]
  return {
    lines: all.map(publicLine),
    expected: expected + fixedSum,
    ceiling: ceiling + fixedSum,
    parts: partsOf(all),
    holdParts: partsOf(all, holdFactor),
  }
}

/** How far either side of the target the estimate prices. */
const ESTIMATE_FACTORS = [0.8, 1, 1.2] as const

export interface UgcEstimateOptions {
  /**
   * The run renders every image candidate of a sampled creator, for a person to
   * pick one. Off (the default): the primary alone, what a run with no person to
   * ask renders.
   */
  readonly rendersEveryCandidate?: boolean
}

/**
 * The creator's paid calls, images first, then the checks: the creator's
 * checks run on every image it renders, and once on a photo, which renders
 * none. Every candidate only when the run renders them all and the plugin
 * lists more than one; otherwise the primary. A fallback that fires is in no
 * figure: the worst case is the candidates themselves; the spent lines show a
 * fired fallback after the fact.
 */
function creatorCallsOf(plan: PluginUgcEstimate, opts: UgcEstimateOptions): OpaqueCall[] {
  const checks = plan.creatorChecks ?? []
  const candidates = plan.creatorCandidates ?? []
  const images = opts.rendersEveryCandidate && candidates.length > 1 ? candidates : plan.creatorImage ? [plan.creatorImage] : []
  const checked = Math.max(images.length, 1)
  return [...images, ...Array.from({ length: checked }, () => checks).flat()]
}

export async function estimateUgcRun(
  caller: UgcPriceCaller,
  input: PluginUgcEstimateInput,
  opts: UgcEstimateOptions = {},
): Promise<UgcQuoteResult & { range: readonly [number, number]; worstCase: number }> {
  const svc = getPluginServices().ugc
  if (!svc) throw new UgcEstimateUnavailable()
  // 1-2 screenshots are dropped by the script, so only 3 or more make cards.
  const hasCards = input.screenshotCount >= 3
  // One value for the whole answer: its ceiling (the target length) and its holds and worst case (the longest).
  const holdFactor = clipHoldFactor()
  const runs: { plan: ReturnType<typeof svc.estimate>; quote: UgcQuoteResult }[] = []
  for (const f of ESTIMATE_FACTORS) {
    const plan = svc.estimate({ ...input, targetDurationSec: Math.max(4, Math.round(input.targetDurationSec * f)) })
    runs.push({ plan, quote: await quoteTickets(caller, plan.tickets, hasCards, holdFactor) })
  }
  const [low, mid, high] = runs as [(typeof runs)[number], (typeof runs)[number], (typeof runs)[number]]
  const script = await rowCredits("ugc-script", "the script")
  const creatorCalls = creatorCallsOf(mid.plan, opts)
  const creatorPrices = (await priceUgcCalls(caller, creatorCalls)).map((p) => priced("the creator", p))
  const creatorLines: UgcQuoteLineOut[] = creatorCalls.map((c, i) =>
    c.tool === "image_to_text"
      ? { label: "Creator check", key: "creatorCheck", credits: creatorPrices[i]! }
      : { label: "Creator image", key: "creatorImage", credits: creatorPrices[i]! },
  )
  const before: UgcQuoteLineOut[] = [{ label: "Script", key: "script", credits: script }, ...creatorLines]
  const beforeSum = sum(before.map((l) => l.credits))
  return {
    lines: [...before, ...mid.quote.lines],
    expected: beforeSum + mid.quote.expected,
    ceiling: beforeSum + mid.quote.ceiling,
    // At the target length: the mid run's parts, with the script and the creator it draws.
    parts: { ...mid.quote.parts, script, creator: sum(creatorPrices) },
    // At the longest length (the worst case): the high run's holds, with the same script and creator.
    holdParts: { ...high.quote.holdParts, script, creator: sum(creatorPrices) },
    range: [beforeSum + low.quote.expected, beforeSum + high.quote.expected],
    worstCase: beforeSum + high.quote.ceiling,
  }
}
