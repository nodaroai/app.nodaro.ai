/**
 * Video Remake's quotes as callers read them: the size delivered, never how it is made (decided 2026-11-26; the
 * request read the earlier way is removed, stage 5).
 *
 * The engine answers its own quote routes (`POST /v1/video-remake/estimate`, a draft's
 * `POST /v1/video-remake/:jobId/full-quality/estimate`, either prefix). An engine from before stage 5 may still answer
 * the earlier fields for a request that sent `upscale`, or a separate breakdown line for the step. On its way out the
 * answer is shaped here, so the order the engine and the platform are deployed in changes nothing a caller reads:
 *
 *   outputResolution   becomes `resolution` (the size delivered), then dropped
 *   upscale, upscaleOffered   dropped
 *   breakdown.upscale  folded into the engine's own line (`foldStep`): every total unchanged, no line names the step
 *
 * An answer without them is sent exactly as it is. Only a 200, bare or under `data`. The quote an engine STORES with
 * its job (read by the admin's price check) is the engine's own and never passes here.
 */
import type { FastifyInstance, FastifyRequest } from "fastify"
import { castSwapSpelling } from "../../lib/video-remake-paths.js"
import { VIDEO_REMAKE_DELIVERED_SIZES } from "../../lib/video-remake-delivered-resolution.js"

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

/** The quote routes this shapes, in their `/v1/cast-swap` spelling. */
const ESTIMATE_ROUTE = "/v1/cast-swap/estimate"
const FULL_QUALITY_ESTIMATE_RE = /^\/v1\/cast-swap\/[^/]+\/full-quality\/estimate$/

/** The earlier answer fields that say how a size is made. */
const EARLIER_FIELDS = ["outputResolution", "upscale", "upscaleOffered"] as const

/** Whether the request is a Video Remake quote (a run's, or a draft's Full Quality), either prefix. */
export function isVideoRemakeQuoteRequest(req: FastifyRequest): boolean {
  if (req.method !== "POST") return false
  const route = castSwapSpelling(req.routeOptions?.url ?? (req.url.split("?")[0] ?? ""))
  return route === ESTIMATE_ROUTE || FULL_QUALITY_ESTIMATE_RE.test(route)
}

/**
 * The engine's own line(s) a step's credits are folded into: the 1080p render (a Full Quality same take) and its
 * earlier name, else the video and its earlier names, else the job's own steps; with the expected video charge beside
 * the video, as the engine folds it.
 */
const FOLD_GROUPS: ReadonlyArray<readonly string[]> = [
  ["motionHd", "seedanceHd"],
  ["motion", "motionExpected", "seedance", "seedanceExpected", "kling"],
  ["base", "castSwap"],
]

/** A breakdown with its `upscale` line in the engine's own; as it is without one (or with no line to fold into). A new object. */
export function foldStep(breakdown: Rec): Rec {
  const step = breakdown.upscale
  if (!finite(step)) return breakdown
  const group = FOLD_GROUPS.find((keys) => keys.some((k) => finite(breakdown[k])))
  if (!group) return breakdown
  const { upscale: _step, ...rest } = breakdown
  for (const key of group) if (finite(rest[key])) rest[key] = (rest[key] as number) + step
  return rest
}

/** A quote with none of the earlier fields: the size delivered as `resolution`, the step in the engine's line. A new object, or the quote itself when it has none. */
export function quoteWithoutEarlierFields(quote: Rec): Rec {
  const hasEarlier = EARLIER_FIELDS.some((k) => Object.hasOwn(quote, k))
  const hasStepLine = isRec(quote.breakdown) && Object.hasOwn(quote.breakdown, "upscale")
  if (!hasEarlier && !hasStepLine) return quote
  const out: Rec = { ...quote }
  const delivered = quote.outputResolution
  if (typeof delivered === "string" && (VIDEO_REMAKE_DELIVERED_SIZES as readonly string[]).includes(delivered)) out.resolution = delivered
  for (const key of EARLIER_FIELDS) delete out[key]
  if (isRec(out.breakdown)) out.breakdown = foldStep(out.breakdown)
  return out
}

/** The answer, bare or under `data`, shaped (`quoteWithoutEarlierFields`). */
export function videoRemakeQuoteAnswer(payload: unknown): unknown {
  if (!isRec(payload)) return payload
  if (isRec(payload.data) && typeof payload.data.totalCredits === "number") {
    const data = quoteWithoutEarlierFields(payload.data)
    return data === payload.data ? payload : { ...payload, data }
  }
  return typeof payload.totalCredits === "number" ? quoteWithoutEarlierFields(payload) : payload
}

/** Shapes every Video Remake quote on its way out (Cloud, beside the First Remake estimate hook). */
export function registerVideoRemakeQuoteAnswerHook(app: FastifyInstance): void {
  app.addHook("preSerialization", async (req, reply, payload) => {
    if (reply.statusCode !== 200 || !isVideoRemakeQuoteRequest(req)) return payload
    return videoRemakeQuoteAnswer(payload)
  })
}
