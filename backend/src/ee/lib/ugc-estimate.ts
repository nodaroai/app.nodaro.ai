import { DEFAULT_TRANSCRIBE_NODE_PROVIDER } from "@nodaro/shared/models"
import { LLM_FEATURE_DEFAULTS } from "@nodaro/shared/llm-models"
import { UGC_ESTIMATE_PARTS, type UgcEstimatePart, type UgcQuoteLineKey } from "@nodaro/render-rules"
import { getAppSettings } from "../../lib/app-settings.js"
import { getPluginServices } from "../../lib/private-plugins/services-registry.js"
import { videoUtilityChargeBaseCredits, videoUtilityEstimateBody } from "../../lib/video-utility-credits.js"
import type { PluginUgcEstimate, PluginUgcEstimateInput } from "../../lib/private-plugins/types.js"
import type { LlmRequest } from "../../lib/llm/types.js"
import { llmHoldForCalls } from "../billing/llm-hold-for-calls.js"
import { getModelCreditCostFromDB } from "../billing/credits.js"
import { applyServiceMarkup } from "../billing/service-margin.js"
import { priceUgcCallLines, started, UGC_ROUTE_CALL_PRICED_AT, UgcQuoteError, ugcClipReadingMode, ugcClipReadingPricedAt, type UgcPriceCaller } from "./ugc-quote.js"

/**
 * The UGC canvas quote and the free dry-run estimate (Nodaro Cloud only).
 *
 * `quoteUgcTickets` prices the tickets UGC Clips returns: per clip, the video,
 * the speech call when the ticket has one, and the reading, each at the
 * platform's own charge-time price (`priceUgcCalls`), plus the steps the canvas
 * adds after the clips (UGC Finish's job on a video cut from one recorded
 * speech, the join, word timings, the speech check, the cards and the
 * captions), each read from its own price row. A ticket is opaque: only
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

/** R58's one switch lives beside the pricer (`ugc-quote.ts`); re-exported for callers of the estimate. */
export { ugcClipReadingMode }

/** The model a metered reading runs (the plugin's pin), else the host's image-to-text default. */
function clipReadingModel(): string {
  try {
    const raw: unknown = getPluginServices().ugc?.clipReadingModel?.()
    if (typeof raw === "string" && raw.length > 0) return raw
  } catch {
    // the default below
  }
  return LLM_FEATURE_DEFAULTS["image-to-text"]
}

/**
 * A metered reading as it runs (R56): `requireLane: "direct"` — priced at its `:direct` key
 * (Advanced mode is the direct pin), on the model the plugin runs.
 */
function meteredReadingCall(model: string): OpaqueCall {
  return { tool: "image_to_text", args: { llmModel: model, advanced_mode: true } }
}

/**
 * The side hold one metered reading takes — sized as `tk.llmBilling.side.holdFor` sizes it: one
 * attempt of a one-frame vision call on its direct lane, at its output cap, marked up at its charge id.
 */
async function meteredReadingHold(model: string): Promise<number> {
  const request: LlmRequest = {
    modelId: model,
    system: "",
    messages: [{ role: "user", content: [{ type: "image", url: "https://price.invalid/frame.jpg" }] }],
    requireLane: "direct",
  }
  try {
    return (await llmHoldForCalls("image-to-text", [{ modelId: model, request }])).holdCredits
  } catch {
    throw new UgcQuoteError("the frame check")
  }
}

/** How a metered reading counts toward a ceiling: one side hold at a time (`hold`), or every re-render's (`worst`). */
type ReadingHeld = "hold" | "worst"

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
  /** A clip line the run hands back from an earlier render (`reusedClips`): priced at nothing. */
  reused?: true
  /** The line holds a metered LLM call's ESTIMATE (charged its actual usage after the run): shown `~`. */
  estimate?: true
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
  /**
   * The parts whose expected credits hold a metered LLM call's ESTIMATE (a line
   * marked `estimate`): charged their actual usage, so a figure that counts one
   * of them is shown `~`. Absent when no part does (a quote with none is
   * byte-identical to before). The one rule the server's run estimate and the
   * editor read (R58: a clip's reading only when the plugin meters it).
   */
  readonly estimateParts?: readonly UgcEstimatePart[]
}

/** A line with the part it prices (the public lines carry only label and credits). */
interface PartLine extends UgcQuoteLineOut {
  readonly part: UgcEstimatePart
  /** What the line holds when it is not its price × the clip hold factor (a metered reading's side hold). */
  readonly held?: number
}

const publicLine = ({ label, credits, key, n, seconds, reused, estimate }: PartLine): UgcQuoteLineOut => ({
  label,
  credits,
  key,
  ...(n !== undefined ? { n } : {}),
  ...(seconds !== undefined ? { seconds } : {}),
  ...(reused ? { reused } : {}),
  ...(estimate ? { estimate } : {}),
})

/** The parts any of `lines` marks an estimate, in part order; absent when none (`UgcQuoteResult.estimateParts`). */
function estimatePartsOf(lines: ReadonlyArray<{ readonly part: UgcEstimatePart; readonly estimate?: true }>): { estimateParts?: UgcEstimatePart[] } {
  const parts = UGC_ESTIMATE_PARTS.filter((part) => lines.some((l) => l.part === part && l.estimate === true))
  return parts.length > 0 ? { estimateParts: parts } : {}
}

/** Several answers' estimate parts, merged (absent when none). */
function mergedEstimateParts(...answers: ReadonlyArray<{ readonly estimateParts?: readonly UgcEstimatePart[] } | readonly UgcEstimatePart[]>): { estimateParts?: UgcEstimatePart[] } {
  const all = new Set(answers.flatMap((a) => (Array.isArray(a) ? a : ((a as { estimateParts?: readonly UgcEstimatePart[] }).estimateParts ?? []))))
  const parts = UGC_ESTIMATE_PARTS.filter((part) => all.has(part))
  return parts.length > 0 ? { estimateParts: parts } : {}
}

/** Each part's credits: the sum of its lines; with `holdFactor`, what each clip line holds (`heldAt`). */
function partsOf(lines: readonly PartLine[], holdFactor?: number): UgcEstimateParts {
  const creditsOf = (l: PartLine) =>
    holdFactor === undefined ? l.credits : l.held !== undefined ? l.held : l.part === "clip" ? heldAt(holdFactor, l.credits) : l.credits
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

/**
 * The UGC video's join: the settings of the UGC template's own join node (`ugc-website-video.test.ts` pins the
 * template to these, both ways). The quote prices the join a run of that node commits.
 */
export const UGC_JOIN_NODE = {
  type: "combine-videos",
  data: { transition: "cut", audioMode: "keep", smartCutEnabled: false, trimStartFrames: 1, trimEndFrames: 2 },
} as const

/**
 * What the join commits for clips of `ticketSecs` seconds: the run's own reservation (`node-executor.ts`
 * `computeVideoUtilityCreditOverride`: `videoUtilityChargeBaseCredits` over the request, marked up under
 * `combine-videos`), over the request the join node sends (`videoUtilityEstimateBody`: its settings
 * with the run's defaults). The clips reach the join as one list over a Bundle edge, and a run hands
 * it each finished clip at its own real length (`runForwardedVideoLengthSec`, decided 2026-10-13), so
 * the quote prices each clip at its ticket's length: the most a finished clip runs — the finish cuts
 * a clip to its speech and pads, a passed-through clip is its ticket's render.
 */
async function joinCredits(ticketSecs: readonly number[]): Promise<number> {
  const body = { ...videoUtilityEstimateBody(UGC_JOIN_NODE)!, videoUrls: ticketSecs.map(() => ""), upstreamDurations: [...ticketSecs] }
  const base = await videoUtilityChargeBaseCredits(UGC_JOIN_NODE.type, body)
  if (base === undefined) throw new Error("combine-videos has no computed price")
  return applyServiceMarkup(base, await getAppSettings(), UGC_JOIN_NODE.type)
}

/** The steps the canvas runs after the clips, in order, each with its part. Their rows are read at once (`started`). */
async function fixedLines(durations: readonly number[], hasCards: boolean): Promise<PartLine[]> {
  const join = durations.length > 1
    ? started(joinCredits(durations).catch(() => { throw new UgcQuoteError("the join") }))
    : null
  const alignment = started(rowCredits("elevenlabs-forced-alignment", "word timings"))
  const speechCheck = started(rowCredits(DEFAULT_TRANSCRIBE_NODE_PROVIDER, "the speech check"))
  const cards = hasCards ? started(rowCredits("video-overlay", "the screenshot cards")) : null
  const captions = started(rowCredits("add-captions:kinetic", "the captions"))
  const lines: PartLine[] = []
  if (join) lines.push({ label: "Join the clips", key: "join", credits: await join, part: "join" })
  lines.push({ label: "Word timings", key: "alignment", credits: await alignment, part: "cards" })
  lines.push({ label: "Speech check", key: "speechCheck", credits: await speechCheck, part: "cards" })
  if (cards) lines.push({ label: "Screenshot cards", key: "cards", credits: await cards, part: "overlay" })
  lines.push({ label: "Captions", key: "captions", credits: await captions, part: "captions" })
  return lines
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)

/** A price the pricer returned for a call: a non-negative number, or the quote fails. */
function priced(label: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new UgcQuoteError(label)
  return value
}

/**
 * The canvas UGC Clips quote. `finishes`: the run's clips go through UGC Finish's job (a video cut from one
 * recorded speech — the answer's plan carries a finish call, `ugcClipsOutputs`), priced once after the clips,
 * from the row that job reserves (`ugc_finish_clips` → `ugc-finish`), never held at the clip hold factor.
 * `reusedClips`: the clips (by place, from 1) the run hands back from an earlier render — each line at 0
 * credits, marked `reused`, in neither the expected figure nor the ceiling; every other line as it was
 * (the join still takes every clip). None given: every clip renders.
 */
export async function quoteUgcTickets(
  caller: UgcPriceCaller,
  rawTickets: unknown[],
  hasCards: boolean,
  finishes = false,
  reusedClips: ReadonlySet<number> = new Set(),
): Promise<UgcQuoteResult> {
  return quoteTickets(caller, rawTickets, hasCards, clipHoldFactor(), finishes, reusedClips, "hold")
}

/** UGC Finish's call, as the quote prices it: the job is a flat fee, its segments never change the price. */
const UGC_FINISH_CALL: OpaqueCall = { tool: "ugc_finish_clips", args: {} }

/** The ticket quote, each clip held at `holdFactor` times its price in both the ceiling and its hold. */
async function quoteTickets(
  caller: UgcPriceCaller,
  rawTickets: unknown[],
  hasCards: boolean,
  holdFactor: number,
  finishes = false,
  reusedClips: ReadonlySet<number> = new Set(),
  readingHeld: ReadingHeld = "hold",
): Promise<UgcQuoteResult> {
  const tickets = rawTickets.map(asTicket)
  const reused = (i: number) => reusedClips.has(i + 1)
  // The reading as the plugin charges it (`clipReadingMode`): metered — its own line, its own side
  // hold, never in the clip's reservation (held at the clip factor it would be held twice).
  const metered = ugcClipReadingMode() === "metered"
  const readingModel = metered ? clipReadingModel() : undefined
  const reading = metered && tickets.some((_, i) => !reused(i))
    ? started(Promise.all([
        priceUgcCallLines(caller, [meteredReadingCall(readingModel!)], "estimate").then(([l]) => ({ credits: priced("the frame check", l!.credits), estimate: l!.estimate })),
        meteredReadingHold(readingModel!),
      ]))
    : undefined
  // Every clip's calls priced in one pass: the caller's gates are read once per quote, not once per clip.
  // A clip handed back makes no call, so it prices none.
  const callsOf = tickets.map((t, i) => (reused(i) ? [] : [t.video, ...(t.speech ? [t.speech] : []), ...(metered ? [] : [READING])]))
  // The clips, the finish and the steps after them are priced at once, and read back in run order.
  // R58: a fixed-mode reading inside the clip at the tier row the plugin charges (no `~`); in metered mode
  // the clip holds no reading (its own line, below), so this answer prices no LLM call.
  const pricing = started(priceUgcCallLines(caller, callsOf.flat(), ugcClipReadingPricedAt()))
  const finishing = started(finishes ? laneStepLines(caller, [UGC_FINISH_CALL]) : Promise.resolve([]))
  const fixing = started(fixedLines(tickets.map((t) => t.durationSec), hasCards))
  const flat = await pricing
  const lines: PartLine[] = []
  let expected = 0
  let ceiling = 0
  let at = 0
  for (const [i, t] of tickets.entries()) {
    const prices = flat.slice(at, at + callsOf[i]!.length)
    at += callsOf[i]!.length
    const clip = sum(prices.map((p) => priced(`clip ${i + 1}`, p.credits)))
    lines.push({
      label: `Clip ${i + 1} (${t.durationSec} s)${reused(i) ? ", reused" : ""}`,
      key: "clip",
      n: i + 1,
      seconds: t.durationSec,
      credits: clip,
      part: "clip",
      ...(reused(i) ? { reused: true as const } : {}),
      ...(prices.some((p) => p.estimate) ? { estimate: true as const } : {}),
    })
    expected += clip
    ceiling += heldAt(holdFactor, clip)
    if (reading && !reused(i)) {
      const [quoted, hold] = await reading
      // Expected: one reading. Held: one side hold at a time — every re-render's in the worst case.
      const held = readingHeld === "worst" ? heldAt(holdFactor, hold) : hold
      lines.push({
        label: `Clip ${i + 1} frame check`, key: "clipReading", n: i + 1, credits: quoted.credits, part: "clip", held,
        ...(quoted.estimate ? { estimate: true as const } : {}),
      })
      expected += quoted.credits
      ceiling += held
    }
  }
  // Run order: the clips, the finish (once: a clip's re-render happens inside its own job), the join and the cards' tail.
  const finish = await finishing
  const finishSum = sum(finish.map((l) => l.credits))
  const fixed = await fixing
  const fixedSum = sum(fixed.map((l) => l.credits))
  const all = [...lines, ...fixed]
  return {
    lines: [...lines, ...finish, ...fixed].map(publicLine),
    expected: expected + finishSum + fixedSum,
    ceiling: ceiling + finishSum + fixedSum,
    // The finish is a step of the clip part, as the estimate counts it, never held at the clip hold factor.
    parts: withSteps(partsOf(all), finishSum),
    holdParts: withSteps(partsOf(all, holdFactor), finishSum),
    ...estimatePartsOf([...all, ...finish]),
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

/** The creator's lines, in call order: an image, or a check (an Image to Text call, `estimate` when metered). */
function creatorLinesOf(
  calls: readonly OpaqueCall[],
  quoted: ReadonlyArray<{ readonly estimate?: true }>,
  prices: readonly number[],
): UgcQuoteLineOut[] {
  return calls.map((c, i) => {
    const line: UgcQuoteLineOut = c.tool === "image_to_text"
      ? { label: "Creator check", key: "creatorCheck", credits: prices[i]! }
      : { label: "Creator image", key: "creatorImage", credits: prices[i]! }
    return quoted[i]?.estimate ? { ...line, estimate: true } : line
  })
}

export async function estimateUgcRun(
  caller: UgcPriceCaller,
  input: PluginUgcEstimateInput,
  opts: UgcEstimateOptions = {},
): Promise<UgcQuoteResult & { range: readonly [number, number]; worstCase: number }> {
  const svc = getPluginServices().ugc
  if (!svc) throw new UgcEstimateUnavailable()
  // A video whose clips are cut from one recorded speech: the plugin's own three lists, priced as they come.
  if (input.language !== undefined && input.language !== "en") {
    const plan = svc.estimate(input)
    if (plan.lane) return estimateLaneRun(caller, plan, input, opts)
  }
  // 1-2 screenshots are dropped by the script, so only 3 or more make cards.
  const hasCards = input.screenshotCount >= 3
  // One value for the whole answer: its ceiling (the target length) and its holds and worst case (the longest).
  const holdFactor = clipHoldFactor()
  // The three lengths, the script and the creator are priced at once (a cold estimate is many price-row
  // reads) and read back in this order, so the answer and any error are those of pricing them in turn.
  const plans = ESTIMATE_FACTORS.map((f) => svc.estimate({ ...input, targetDurationSec: Math.max(4, Math.round(input.targetDurationSec * f)) }))
  // The longest length is the worst case: every re-render's reading held there.
  const quoting = plans.map((plan, i) => started(quoteTickets(caller, plan.tickets, hasCards, holdFactor, false, new Set(), i === 2 ? "worst" : "hold")))
  const scripting = started(rowCredits("ugc-script", "the script"))
  const creatorCalls = creatorCallsOf(plans[1]!, opts)
  // The creator check is a host-route Image to Text call (metered whenever metered pricing is on), not the plugin's clip reading: it does not follow ugcClipReadingMode (R58).
  const creatorPricing = started(priceUgcCallLines(caller, creatorCalls, UGC_ROUTE_CALL_PRICED_AT))
  const runs: { plan: ReturnType<typeof svc.estimate>; quote: UgcQuoteResult }[] = []
  for (const [i, plan] of plans.entries()) runs.push({ plan, quote: await quoting[i]! })
  const [low, mid, high] = runs as [(typeof runs)[number], (typeof runs)[number], (typeof runs)[number]]
  const script = await scripting
  const creatorQuoted = await creatorPricing
  const creatorPrices = creatorQuoted.map((p) => priced("the creator", p.credits))
  const creatorLines = creatorLinesOf(creatorCalls, creatorQuoted, creatorPrices)
  const before: UgcQuoteLineOut[] = [{ label: "Script", key: "script", credits: script }, ...creatorLines]
  const beforeSum = sum(before.map((l) => l.credits))
  return {
    // The mid run's lines are the ones listed; the creator's and every length's parts count as the figures do.
    ...mergedEstimateParts(mid.quote, high.quote, creatorLines.some((l) => l.estimate) ? ["creator"] : []),
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

// ── A video whose clips are cut from one recorded speech ─────────────────────

/** The server's English words for a step of a speech-first video (an API client reads them; the editor names a line by its id). */
const LANE_STEP_LINES: Readonly<Record<string, { readonly key: UgcQuoteLineKey; readonly label: string }>> = {
  generate_speech: { key: "speech", label: "Speech" },
  forced_alignment: { key: "alignment", label: "Word timings" },
  ugc_split_speech: { key: "split", label: "Split the speech" },
  ugc_finish_clips: { key: "finish", label: "Finish the clips" },
}

/** Each of these calls priced once, as a line of the clip part: the prelude (speech, word timings, split) and the finish. */
async function laneStepLines(caller: UgcPriceCaller, calls: ReadonlyArray<OpaqueCall>): Promise<PartLine[]> {
  const prices = await priceUgcCallLines(caller, calls, UGC_ROUTE_CALL_PRICED_AT)
  return calls.map((c, i) => {
    const step = LANE_STEP_LINES[c.tool]
    if (!step) throw new UgcQuoteError(c.tool)
    return {
      label: step.label, key: step.key, credits: priced(step.label, prices[i]!.credits), part: "clip" as const,
      ...(prices[i]!.estimate ? { estimate: true as const } : {}),
    }
  })
}

/** Each part's credits with the steps around the clips added to the clip part. */
function withSteps(parts: UgcEstimateParts, steps: number): UgcEstimateParts {
  return { ...parts, clip: parts.clip + steps }
}

/**
 * The estimate of a video whose clips are cut from one recorded speech, priced as the canvas runs it: the
 * prelude (the speech, its word timings, its split) and the finish, each once; the clips as canvas tickets —
 * the render and its reading, held at the clip hold factor while they render — with the join and the cards'
 * tail, exactly as English's tickets are priced; and the script and the creator. The clip count is decided by
 * the recorded speech, so there is no 0.8x / 1.2x run: `expected` and `ceiling` are the clips the speech is
 * expected to need (as rendered, and as held); the range runs to the most clips the rules plan for. The worst
 * case is the dearest split a take can legally get (`worstTicketSets`, every clip held), so it covers whatever the
 * recorded speech turns out to need; a plugin that predates them holds the range's clips instead.
 */
async function estimateLaneRun(
  caller: UgcPriceCaller,
  plan: PluginUgcEstimate,
  input: PluginUgcEstimateInput,
  opts: UgcEstimateOptions,
): Promise<UgcQuoteResult & { range: readonly [number, number]; worstCase: number }> {
  const lane = plan.lane!
  const hasCards = input.screenshotCount >= 3
  const holdFactor = clipHoldFactor()
  const prelude = await laneStepLines(caller, lane.prelude)
  const [finish] = await laneStepLines(caller, [lane.finish])
  const expectedClips = await quoteTickets(caller, plan.tickets, hasCards, holdFactor)
  const mostClips = await quoteTickets(caller, lane.ceilingTickets, hasCards, holdFactor)
  // The worst case: the dearest of every split the plugin says a take can legally get (each priced as it would
  // run), never below the two above — each with every re-render's reading held (`worst`).
  const worstOf = (tickets: unknown[]) => quoteTickets(caller, tickets, hasCards, holdFactor, false, new Set(), "worst")
  const [expectedWorst, mostWorst] = [await worstOf(plan.tickets), await worstOf(lane.ceilingTickets)]
  let worst = expectedWorst.ceiling > mostWorst.ceiling ? expectedWorst : mostWorst
  for (const set of worstTicketSetsOf(lane)) {
    const q = await worstOf(set)
    if (q.ceiling > worst.ceiling) worst = q
  }
  const script = await rowCredits("ugc-script", "the script")
  const creatorCalls = creatorCallsOf(plan, opts)
  // The creator check is a host-route Image to Text call (metered whenever metered pricing is on), not the plugin's clip reading: it does not follow ugcClipReadingMode (R58).
  const creatorQuoted = await priceUgcCallLines(caller, creatorCalls, UGC_ROUTE_CALL_PRICED_AT)
  const creatorPrices = creatorQuoted.map((p) => priced("the creator", p.credits))
  const creatorLines = creatorLinesOf(creatorCalls, creatorQuoted, creatorPrices)
  const before: UgcQuoteLineOut[] = [{ label: "Script", key: "script", credits: script }, ...creatorLines]
  const creator = sum(creatorPrices)
  const steps = sum([...prelude, finish!].map((l) => l.credits))
  const fixed = script + creator + steps
  // Run order: the prelude, the clips, the finish, then the join and the cards' tail.
  const clipLines = expectedClips.lines.filter((l) => l.key === "clip" || l.key === "clipReading")
  const tailLines = expectedClips.lines.filter((l) => l.key !== "clip" && l.key !== "clipReading")
  return {
    ...mergedEstimateParts(
      expectedClips,
      worst,
      estimatePartsOf([...prelude, finish!]).estimateParts ?? [],
      creatorLines.some((l) => l.estimate) ? ["creator"] : [],
    ),
    lines: [...before, ...prelude.map(publicLine), ...clipLines, publicLine(finish!), ...tailLines],
    expected: fixed + expectedClips.expected,
    ceiling: fixed + expectedClips.ceiling,
    parts: { ...withSteps(expectedClips.parts, steps), script, creator },
    holdParts: { ...withSteps(worst.holdParts, steps), script, creator },
    range: [fixed + expectedClips.expected, fixed + mostClips.expected],
    worstCase: fixed + worst.ceiling,
  }
}

/**
 * The most a video's estimate holds for its clips and the steps after them (the finish, the join and the
 * cards' tail), each clip at its hold — the clip-onward part of the hold the run's balance was checked
 * against before it started, without the script, the creator and the prelude, which have run by the time
 * this is asked. Priced with the clips' own `hasCards` and `finishes`, exactly as `quoteUgcTickets` prices
 * the clips a run is about to render, so the two figures compare like with like: a video cut from one
 * recorded speech takes the dearest of its expected clips, its most clips and every legal split
 * (`worstTicketSets`), as `estimateLaneRun`'s worst case does; any other video its clips at 1.2x the
 * target, as the estimate's worst case does.
 */
export async function ugcRenderHold(caller: UgcPriceCaller, input: PluginUgcEstimateInput, hasCards: boolean, finishes: boolean): Promise<number> {
  const svc = getPluginServices().ugc
  if (!svc) throw new UgcEstimateUnavailable()
  const holdFactor = clipHoldFactor()
  const plan = svc.estimate(input)
  const sets = plan.lane
    ? [plan.tickets, plan.lane.ceilingTickets, ...worstTicketSetsOf(plan.lane)]
    : [svc.estimate({ ...input, targetDurationSec: Math.max(4, Math.round(input.targetDurationSec * ESTIMATE_FACTORS[2])) }).tickets]
  let most = 0
  for (const set of sets) most = Math.max(most, (await quoteTickets(caller, set, hasCards, holdFactor, finishes, new Set(), "worst")).ceiling)
  return most
}

/** The plugin's worst splits, each a non-empty ticket list; none from a plugin that predates them. Anything else is a quote error. */
function worstTicketSetsOf(lane: NonNullable<PluginUgcEstimate["lane"]>): unknown[][] {
  const sets: unknown = lane.worstTicketSets
  if (sets === undefined) return []
  if (!Array.isArray(sets) || !sets.every((s) => Array.isArray(s) && s.length > 0)) throw new UgcQuoteError("the worst case")
  return sets as unknown[][]
}
