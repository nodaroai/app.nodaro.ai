import { DEFAULT_TRANSCRIBE_NODE_PROVIDER, estimateCombineVideosCredits } from "@nodaro/shared"
import { getAppSettings } from "../../lib/app-settings.js"
import { getPluginServices } from "../../lib/private-plugins/load.js"
import type { PluginUgcEstimateInput } from "../../lib/private-plugins/types.js"
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
 * job, reserves nothing and spends nothing.
 *
 * An item this cannot price is an error, never a zero.
 */

/**
 * The most a clip can hold: the ceiling the quote states is this multiple of the
 * clip's expected price. The plugin's own re-render factor is authoritative for
 * what a run reserves; this is the quote's copy of it.
 */
export const CLIP_HOLD_FACTOR = 2

/** Priced as the speech check's reading of a finished clip. */
const READING = { tool: "image_to_text", args: {} } as const

export interface UgcQuoteLineOut {
  label: string
  credits: number
}
export interface UgcQuoteResult {
  readonly lines: UgcQuoteLineOut[]
  readonly expected: number
  readonly ceiling: number
  readonly range?: readonly [number, number]
  readonly worstCase?: number
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

/** The steps the canvas runs after the clips, in order. */
async function fixedLines(durations: readonly number[], hasCards: boolean): Promise<UgcQuoteLineOut[]> {
  const lines: UgcQuoteLineOut[] = []
  if (durations.length > 1) {
    try {
      // The computed amount combine-videos reserves, marked up the way the guard marks it up.
      const base = estimateCombineVideosCredits({ transition: "cut" }, [...durations])
      lines.push({ label: "Join the clips", credits: applyServiceMarkup(base, await getAppSettings(), "combine-videos") })
    } catch {
      throw new UgcQuoteError("the join")
    }
  }
  lines.push({ label: "Word timings", credits: await rowCredits("elevenlabs-forced-alignment", "word timings") })
  lines.push({ label: "Speech check", credits: await rowCredits(DEFAULT_TRANSCRIBE_NODE_PROVIDER, "the speech check") })
  if (hasCards) lines.push({ label: "Screenshot cards", credits: await rowCredits("video-overlay", "the screenshot cards") })
  lines.push({ label: "Captions", credits: await rowCredits("add-captions:kinetic", "the captions") })
  return lines
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)

/** A price the pricer returned for a call: a non-negative number, or the quote fails. */
function priced(label: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new UgcQuoteError(label)
  return value
}

export async function quoteUgcTickets(caller: UgcPriceCaller, rawTickets: unknown[], hasCards: boolean): Promise<UgcQuoteResult> {
  const tickets = rawTickets.map(asTicket)
  const lines: UgcQuoteLineOut[] = []
  let expected = 0
  let ceiling = 0
  for (const [i, t] of tickets.entries()) {
    const calls = [t.video, ...(t.speech ? [t.speech] : []), READING]
    const prices = await priceUgcCalls(caller, calls)
    const clip = sum(prices.map((p) => priced(`clip ${i + 1}`, p)))
    lines.push({ label: `Clip ${i + 1} (${t.durationSec} s)`, credits: clip })
    expected += clip
    ceiling += CLIP_HOLD_FACTOR * clip
  }
  const fixed = await fixedLines(tickets.map((t) => t.durationSec), hasCards)
  const fixedSum = sum(fixed.map((l) => l.credits))
  return { lines: [...lines, ...fixed], expected: expected + fixedSum, ceiling: ceiling + fixedSum }
}

type GraphNode = { id?: string; type: string; data?: Record<string, unknown> }
type GraphEdge = { source?: string; target?: string; targetHandle?: string | null }

/**
 * The estimate's inputs read off a UGC graph, with a run's overrides applied
 * (the app runner) or none (every other estimate).
 */
export function ugcEstimateInputOf(
  nodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge> | undefined,
  overrides?: Record<string, Record<string, unknown>>,
): PluginUgcEstimateInput {
  const script = nodes.find((n) => n.type === "ugc-script")
  const creator = nodes.find((n) => n.type === "ugc-creator")
  const val = (n: GraphNode | undefined, k: string): unknown =>
    n ? (n.id ? overrides?.[n.id]?.[k] : undefined) ?? n.data?.[k] : undefined
  const target = val(script, "targetDurationSec")
  const shots = (edges ?? []).filter(
    (e) => script?.id !== undefined && e.target === script.id && /^screenshot\d*$/.test(String(e.targetHandle ?? "")),
  )
  const filled = shots.filter((e) => {
    const url = val(nodes.find((n) => n.id === e.source), "url")
    return typeof url === "string" && url.length > 0
  })
  return {
    targetDurationSec: typeof target === "number" ? target : 15,
    // No overrides (publish, API, templates): count the wired slots, the "from" figure for the graph as built.
    // A run: count the slots that hold an image.
    screenshotCount: overrides ? filled.length : shots.length,
    source: val(creator, "source") === "photo" ? "photo" : "sampled",
  }
}

/** How far either side of the target the estimate prices. */
const ESTIMATE_FACTORS = [0.8, 1, 1.2] as const

export async function estimateUgcRun(
  caller: UgcPriceCaller,
  input: PluginUgcEstimateInput,
): Promise<UgcQuoteResult & { range: readonly [number, number]; worstCase: number }> {
  const svc = getPluginServices().ugc
  if (!svc) throw new UgcEstimateUnavailable()
  // 1-2 screenshots are dropped by the script, so only 3 or more make cards.
  const hasCards = input.screenshotCount >= 3
  const runs: { plan: ReturnType<typeof svc.estimate>; quote: UgcQuoteResult }[] = []
  for (const f of ESTIMATE_FACTORS) {
    const plan = svc.estimate({ ...input, targetDurationSec: Math.max(4, Math.round(input.targetDurationSec * f)) })
    runs.push({ plan, quote: await quoteUgcTickets(caller, plan.tickets, hasCards) })
  }
  const [low, mid, high] = runs as [(typeof runs)[number], (typeof runs)[number], (typeof runs)[number]]
  const script = await rowCredits("ugc-script", "the script")
  const creatorCalls = [...(mid.plan.creatorImage ? [mid.plan.creatorImage] : []), ...(mid.plan.creatorChecks ?? [])]
  const creatorPrices = (await priceUgcCalls(caller, creatorCalls)).map((p) => priced("the creator", p))
  const creatorLines: UgcQuoteLineOut[] = creatorCalls.map((c, i) => ({
    label: c.tool === "image_to_text" ? "Creator check" : "Creator image",
    credits: creatorPrices[i]!,
  }))
  const before = [{ label: "Script", credits: script }, ...creatorLines]
  const beforeSum = sum(before.map((l) => l.credits))
  return {
    lines: [...before, ...mid.quote.lines],
    expected: beforeSum + mid.quote.expected,
    ceiling: beforeSum + mid.quote.ceiling,
    range: [beforeSum + low.quote.expected, beforeSum + high.quote.expected],
    worstCase: beforeSum + high.quote.ceiling,
  }
}
