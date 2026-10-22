import {
  applyDefaultVideoSelection,
} from "@nodaro/shared/models"
import {
  buildVideoCreditModelIdentifier,
} from "@nodaro/shared/credits"
import {
  captionRoutesToRemotion,
} from "@nodaro/shared/captions"
import {
  LLM_FEATURE_DEFAULTS,
  llmPriceKey,
  resolveLlmCreditId,
} from "@nodaro/shared/llm-models"
import {
  ugcCallToRouteBody,
} from "@nodaro/shared/ugc"
import type { FastifyRequest } from "fastify"
import { z } from "zod"
import { getAppSettings } from "../../lib/app-settings.js"
import type { BillingContext } from "../../lib/billing-context.js"
import { llmMeteredPricing, speechLengthPricingEnabled } from "../../lib/config.js"
import { speechBaseCredits } from "../../lib/speech-credits.js"
import { unitRateBaseCredits } from "../../lib/credit-base-cost.js"
import { combineVideosUnits } from "../../lib/video-utility-credits.js"
import { imageCollageCreditModelIdentifier } from "../../lib/image-collage-credit-id.js"
import { normalizeVideoInput } from "../../lib/mcp/normalize.js"
import { sideHoldChargesFor, withSideCharge } from "../../lib/job-step-charge.js"
import { isUuid } from "../../lib/mcp/tools/_id-guard.js"
import { llmPayloadFields, type LlmMcpArgs } from "../../lib/mcp/tools/_llm-payload.js"
import { UGC_SPENT_JOB_IDS_MAX } from "../../lib/mcp/tools/_ugc-limits.js"
import { MCP_TRANSCRIBE_PROVIDER } from "../../lib/mcp/tools/_transcribe-provider.js"
import { supabase } from "../../lib/supabase.js"
import { resolveVideoRequestNorm } from "../../lib/video-request-norm.js"
import { resolveImageCreditIdentifier } from "../../routes/generate-image-credit-id.js"
import { resolveImageToImageCreditIdentifier } from "../../routes/image-to-image-credit-id.js"
import { getChargedPriceTable, getModelCreditCostFromDB, meteredLlmQuote, type ModelPricing } from "../billing/credits.js"
import { LlmUnpricedModelError } from "../billing/llm-metered.js"
import { llmModelUnpricedMessage } from "../billing/llm-unpriced-reply.js"
import {
  modelAvailabilityNeedsGates,
  modelAvailabilityRefusal,
  TIER_ORDER,
  type ModelAvailabilityGates,
} from "../billing/model-availability.js"
import { effectiveTierOf, payerProfileId, spendGates } from "../billing/org-entitlements.js"
import { applyServiceMarkup } from "../billing/service-margin.js"
import { getPluginServices } from "../../lib/private-plugins/services-registry.js"
import { sideHoldsAvailable } from "../../lib/llm-side-hold-availability.js"

/**
 * The credit quote `build_ugc_clips` returns (Nodaro Cloud only).
 *
 * The builder lists every paid call the rest of a UGC video will make, as the
 * public MCP tool and the arguments it will be called with. This prices each
 * one at what its reservation will charge: the credit id comes from the payload
 * the MCP verb dispatches (after the verb's own injected defaults), through the
 * same function the route uses to pick its reservation id, and the price is the
 * charge-time price (`getModelCreditCostFromDB`: the admin pricing row or the
 * static table, with the configured markup). A route that reserves a COMPUTED
 * amount instead of its row (combine-videos) is priced from the same estimate,
 * marked up the way the credit guard marks it up.
 *
 * `ugc-quote-parity.test.ts` runs every verb and every route for real and
 * fails when an id or an amount here stops matching the reservation.
 *
 * A model the credit guard would refuse — disabled by an admin, restricted to
 * a tier above the payer's grade, or on the free-tier blocklist for free-tier
 * work — is refused here too, by the guard's own decision
 * (`modelAvailabilityRefusal`) under the gates the guard computes for an MCP
 * call (`spendGates`): the payer the session's calls are billed to (the
 * caller passes `requestBillingContext`'s answer), that payer's profile
 * (`payerProfileId`), never web-free (an injected request has no browser
 * origin). The balance and daily-cap checks are not the quote's job.
 *
 * An item this cannot price is an error, never a zero.
 */

export interface UgcQuoteItem {
  readonly label: string
  readonly tool: string
  readonly args: Readonly<Record<string, unknown>>
  readonly count: number
}
export interface UgcQuoteLine {
  readonly label: string
  readonly credits: number
  /** A metered LLM call's ESTIMATE (R26): charged its actual usage, so shown `~`. Absent for a fixed price. */
  readonly estimate?: true
}
export interface UgcQuote {
  /** Jobs this video already ran (creator images, screenshot readings, the photo check). */
  readonly spent: UgcQuoteLine[]
  /** Every call still to come, the re-render reserve included. */
  readonly lines: UgcQuoteLine[]
  /** The whole video: spent plus still to come. */
  readonly total: number
  /** `spent_job_ids` entries that are not this user's jobs (or not job ids at all). */
  readonly skipped: string[]
  /** Some line still to come is a metered LLM estimate, so the total is one (`~`). Absent otherwise. */
  readonly totalIsEstimate?: true
}

export class UgcQuoteError extends Error {
  constructor(label: string) {
    super(`could not price ${label}`)
    this.name = "UgcQuoteError"
  }
}

/**
 * A quoted call on a metered LLM model with no price on its lane (R49, fail
 * closed): the call's own route refuses it (`llm_model_unpriced`), so the
 * quote does — with that code and sentence, never a figure.
 */
export class UgcQuoteUnpricedError extends UgcQuoteError {
  readonly code = "llm_model_unpriced"
  readonly modelId: string
  constructor(label: string, err: LlmUnpricedModelError) {
    super(label)
    this.name = "UgcQuoteUnpricedError"
    this.modelId = err.modelId
    this.message = `could not price ${label} (llm_model_unpriced): ${llmModelUnpricedMessage(err)}`
  }
}

/**
 * How the UGC plugin charges a clip's per-take reading (the frame check) — R58: the ONE source for
 * how that reading is quoted, held and flagged (`~`), declared by the plugin (`ugc.clipReadingMode`)
 * and read by its admission too:
 *  - `"metered"` (the plugin says so AND metered side holds are available now): the reading is its
 *    own metered side hold — quoted as a separate `clipReading` line at its `:direct` estimate,
 *    never inside the clip (`ugc-estimate.ts`), and an estimate (`~`);
 *  - `"fixed"` (every plugin that predates it, anything else, the rollback): the reading inside the
 *    clip at its TIER row — exactly what the plugin charges (`priceUgcCalls`' default) — no `~`.
 */
export function ugcClipReadingMode(): "metered" | "fixed" {
  try {
    const raw: unknown = getPluginServices().ugc?.clipReadingMode?.()
    return raw === "metered" && sideHoldsAvailable() ? "metered" : "fixed"
  } catch {
    return "fixed"
  }
}

/** How a CLIP reading is priced where it is quoted (R58): its estimate when metered, else the tier row the plugin charges. */
export function ugcClipReadingPricedAt(): "estimate" | "tier" {
  return ugcClipReadingMode() === "metered" ? "estimate" : "tier"
}

/**
 * How a call the UGC nodes make through the HOST's own routes is priced (the creator check: an Image
 * to Text call through `/v1/image-to-text/describe`, which bills it metered whenever metered pricing is
 * on): as that route bills it — its estimate while metered, else its tier row (a call with no metered
 * key is its tier row either way). Not the plugin's clip reading: that one follows `ugcClipReadingMode`.
 */
export const UGC_ROUTE_CALL_PRICED_AT = "estimate" as const

/**
 * How a route decides what it reserves: the pricing row for `id`, or a computed base marked up under `id`.
 * A metered LLM call (`meteredKey`, while metered pricing is on — R26) keeps the guard's `id` (whose row
 * carries the switches the guard checks) and is quoted at its price key's ESTIMATE: what it is charged
 * is its actual usage, and the route holds more (its 1-attempt hold) — the estimate is never above it.
 */
export interface UgcPricing {
  readonly id: string
  readonly base?: number
  readonly meteredKey?: string
}

export interface QuoteContext {
  /** How many clips the join combines. */
  readonly clipCount: number
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)

/**
 * The credit decision each quoted tool's route makes for the payload its MCP
 * verb dispatches. `null` = this tool cannot be priced from these args. A rule
 * may be async when the route's guard computes its base from a priced row
 * (speech by length reads the model's unit row).
 */
const PRICING: Record<string, (args: Readonly<Record<string, unknown>>, ctx: QuoteContext) => UgcPricing | null | Promise<UgcPricing | null>> = {
  // generate_video → POST /v1/text-to-video (creditGuard in routes/text-to-video.ts).
  generate_video: (args) => {
    const model = str(args.model)
    const duration = num(args.duration)
    const resolution = str(args.resolution)
    const refVideos = args.reference_video_urls
    // Every price lever must be explicit: an unset one would come from the user's saved preferences.
    if (!model || duration === undefined || !resolution) return null
    // A reference-video run reserves from probed clip lengths, which a quote cannot know.
    if (Array.isArray(refVideos) ? refVideos.length > 0 : refVideos !== undefined) return null
    const v = normalizeVideoInput({ model, aspect_ratio: str(args.aspect_ratio), resolution, duration }, {}, model)
    const sel = applyDefaultVideoSelection({ provider: v.model, duration: v.duration })
    const norm = resolveVideoRequestNorm({ provider: sel.provider, aspectRatio: v.aspectRatio, resolution: v.resolution, duration: sel.duration })
    const sound = typeof args.sound === "boolean" ? args.sound : undefined
    return { id: buildVideoCreditModelIdentifier(sel.provider, norm.duration ?? sel.duration, sound, "text-to-video", undefined, norm.resolution, false) }
  },
  // generate_speech → POST /v1/text-to-speech: the provider as the route bills it
  // (the legacy alias mapped) and — while length pricing is on (decided
  // 2026-10-06) — the guard's own BASE for the text sent: the one counter and
  // reader (lib/speech-credits.ts), so the quote and the reservation agree to
  // the credit. The quote prices `text` as the item carries it; a preset's
  // pre/post text the verb folds in at call time is not resolvable here.
  generate_speech: async (args) => {
    const model = str(args.model)
    if (!model) return null
    const id = model === "elevenlabs" ? "elevenlabs-turbo" : model
    return speechLengthPricingEnabled() ? { id, base: await speechBaseCredits(id, args.text) } : { id }
  },
  // extract_frame → POST /v1/extract-frame: one flat id.
  extract_frame: () => ({ id: "extract-frame" }),
  // image_collage → POST /v1/image-collage: priced by output resolution.
  image_collage: (args) => ({ id: imageCollageCreditModelIdentifier(args.resolution) }),
  // image_to_text → POST /v1/image-to-text/describe: the guard's id from the verb's own LLM fields
  // (the LLM tier) — and, while metered pricing is on, the call's price key: the route's model (its
  // default when the verb sends none), effort and Advanced flag (R26).
  image_to_text: (args) => {
    const fields = llmPayloadFields(args as LlmMcpArgs)
    const id = resolveLlmCreditId("image-to-text", fields)
    if (!llmMeteredPricing()) return { id }
    const model = str(fields.llmModel) ?? LLM_FEATURE_DEFAULTS["image-to-text"]
    return { id, meteredKey: llmPriceKey("image-to-text", model, str(fields.reasoningEffort), fields.advancedMode === true) }
  },
  // generate_image → POST /v1/generate-image: the route's own id function over the body the mapper builds.
  generate_image: (args) => {
    const mapped = ugcCallToRouteBody({ tool: "generate_image", args })
    return mapped && "body" in mapped ? { id: resolveImageCreditIdentifier({ body: mapped.body } as FastifyRequest) } : null
  },
  // image_to_image → POST /v1/image-to-image (a realism pass); the image does not change the price.
  image_to_image: (args) => {
    const mapped = ugcCallToRouteBody({ tool: "image_to_image", args, imageArg: "image_url" }, { image: "https://price.invalid/x.png" })
    return mapped && "body" in mapped ? { id: resolveImageToImageCreditIdentifier({ body: mapped.body } as FastifyRequest) } : null
  },
  // combine_videos → POST /v1/combine-videos: a COMPUTED base (the verb sends no upstream durations) —
  // the route's own unit count, each unit at the combine-videos row (`unitRateBaseCredits`), as it reserves.
  combine_videos: async (args, ctx) => {
    if (ctx.clipCount < 2) return null
    const units = combineVideosUnits({
      transition: str(args.transition),
      transitionDuration: num(args.transition_duration),
      videoUrls: Array.from({ length: ctx.clipCount }, () => ""),
    })
    return { id: "combine-videos", base: await unitRateBaseCredits("combine-videos", units) }
  },
  // forced_alignment → POST /v1/forced-alignment: one flat id.
  forced_alignment: () => ({ id: "elevenlabs-forced-alignment" }),
  // silence_detect → POST /v1/silence-detect: one flat id (the route's inline literal).
  silence_detect: () => ({ id: "silence-detect" }),
  // ugc_split_speech / ugc_finish_clips → the private plugin's job routes: one flat id each. The price
  // row is the plugin's (`staticCreditCosts`, or an admin pricing row); with none registered the quote
  // fails as "could not price", never as a zero.
  ugc_split_speech: () => ({ id: "ugc-segments" }),
  ugc_finish_clips: () => ({ id: "ugc-finish" }),
  // transcribe → POST /v1/transcribe: the engine the verb always sends.
  transcribe: () => ({ id: MCP_TRANSCRIBE_PROVIDER }),
  // overlay_images → POST /v1/video-overlay: one flat id.
  overlay_images: () => ({ id: "video-overlay" }),
  // add_captions → POST /v1/add-captions: the price follows the renderer.
  add_captions: (args) => ({
    id: captionRoutesToRemotion({
      style: str(args.style),
      text: str(args.text),
      segments: Array.isArray(args.segments) ? args.segments : undefined,
      captions: Array.isArray(args.captions) ? args.captions : undefined,
      look: args.look,
      fontFamily: args.font_family,
      fontWeight: args.font_weight,
      strokeColor: args.stroke_color,
      strokeWidth: args.stroke_width,
      uppercase: args.uppercase,
      positionY: args.position_y,
      maxWordsPerLine: args.max_words_per_line,
    })
      ? "add-captions:kinetic"
      : "add-captions",
  }),
}

/** The credit decision for one quote item, or null when it cannot be priced. Exported for the parity test. */
export async function pricingFor(tool: string, args: Readonly<Record<string, unknown>>, ctx: QuoteContext): Promise<UgcPricing | null> {
  const rule = Object.prototype.hasOwnProperty.call(PRICING, tool) ? PRICING[tool] : undefined
  return rule ? rule(args, ctx) : null
}

/**
 * What the call is charged: the row's marked-up price, or the computed base marked up under the
 * row's id — or, for a metered LLM call, its price key's estimate as the charged price table quotes
 * it (already marked up at its charge id). A model with no price on its lane throws: never 0.
 */
async function creditsFor(pricing: UgcPricing, row: ModelPricing): Promise<number> {
  if (pricing.meteredKey !== undefined) {
    const quote = meteredLlmQuote(await getChargedPriceTable(), pricing.meteredKey)
    if (quote?.kind === "unpriced") throw quote.error
    if (quote?.kind !== "estimate") throw new Error(`unpriced ${pricing.meteredKey}`)
    return quote.credits
  }
  if (pricing.base !== undefined) return applyServiceMarkup(pricing.base, await getAppSettings(), pricing.id)
  return row.creditCost
}

/** Stand-in gates for a row whose answer no gates can change (`modelAvailabilityNeedsGates` false). */
const NO_GATES: ModelAvailabilityGates = { tierForGates: "", freeSemantics: false }

/** The gates the credit guard will decide this caller's calls under; read once per quote, and only when a row asks. */
type CallerGates = () => Promise<ModelAvailabilityGates>

function callerGatesOf(userId: string, billingContext: BillingContext | undefined): CallerGates {
  let gates: Promise<ModelAvailabilityGates> | undefined
  return () => (gates ??= readCallerGates(userId, billingContext))
}

/**
 * The gates the credit guard's preflight computes for an MCP call, through the
 * helpers it computes them with: the profile it reads (`payerProfileId` — the
 * deployment payer's row under a deployment payer), that profile's effective
 * tier, and `spendGates` under the call's billing context. Never web-free: an
 * injected MCP request carries no browser origin and no web-free stamp.
 */
async function readCallerGates(userId: string, billingContext: BillingContext | undefined): Promise<ModelAvailabilityGates> {
  const { data, error } = await supabase
    .from("profiles")
    .select("tier, subscription_tier, lifetime_topup_credits")
    .eq("id", payerProfileId(userId, billingContext))
    .single()
  // Never a guess at the grade: an unread profile could only over- or under-refuse
  // (and the guard itself answers an unread profile with a 500).
  if (error || !data) throw new UgcQuoteError("the rest of the video")
  const profile = data as { tier: string | null; subscription_tier: string | null; lifetime_topup_credits: number }
  return spendGates(effectiveTierOf(profile), { webFreeMode: false, billingContext })
}

/** One quote item as the builder sends it; the count is a whole number of calls, at least one. */
const quoteItemSchema = z.object({
  label: z.string().min(1),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()).optional().default({}),
  count: z.number().int().min(1),
})

/** A builder item checked at run time: a malformed one is a quote error (with its label when it has one), never a crash. */
function parseItem(raw: unknown): UgcQuoteItem {
  const parsed = quoteItemSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  const label = raw && typeof raw === "object" ? (raw as { label?: unknown }).label : undefined
  throw new UgcQuoteError(typeof label === "string" && label.length > 0 ? label : "a quote item")
}

async function priceItem(
  raw: unknown,
  ctx: QuoteContext,
  callerGates: CallerGates,
  /** Quote a metered LLM call at its estimate (the MCP quote), or at its tier row (the figure handed to the plugin). */
  llmAt: "estimate" | "tier",
): Promise<UgcQuoteLine> {
  const item = parseItem(raw)
  const quoted = await pricingFor(item.tool, item.args, ctx)
  if (!quoted) throw new UgcQuoteError(item.label)
  // At its tier row: the guard's id, priced as before metered pricing.
  const pricing: UgcPricing = llmAt === "tier" && quoted.meteredKey !== undefined ? { id: quoted.id } : quoted
  // The row the guard checks, even for a computed amount: an admin disabling a model still wins.
  let row: ModelPricing
  try {
    row = await getModelCreditCostFromDB(pricing.id)
  } catch {
    // PriceNotConfiguredError and any read failure: never a silent zero.
    throw new UgcQuoteError(item.label)
  }
  // The guard's own decision, under the gates it will use. A row the gates cannot change
  // (unrestricted, not blocklisted, or disabled for everyone) needs no profile read.
  const gates = modelAvailabilityNeedsGates(pricing.id, row) ? await callerGates() : NO_GATES
  if (modelAvailabilityRefusal(pricing.id, row, gates)) throw new UgcQuoteError(item.label)
  try {
    const credits = (await creditsFor(pricing, row)) * item.count
    return pricing.meteredKey !== undefined ? { label: item.label, credits, estimate: true } : { label: item.label, credits }
  } catch (err) {
    if (err instanceof LlmUnpricedModelError) throw new UgcQuoteUnpricedError(item.label, err)
    throw new UgcQuoteError(item.label)
  }
}

interface SpentJobRow {
  id: string
  status: string | null
  job_type: string | null
  input_data: { type?: unknown } | null
  credits: number | null
  credits_actual: number | null
}

/**
 * What a job this video already ran cost: its settled charge once committed
 * (its reservation until the charge settles), its reservation while it runs,
 * and, when it failed or was cancelled, whatever charge was settled on it —
 * a partial charge counts, a full refund shows 0, no settled charge is 0.
 */
function spentCredits(row: SpentJobRow): number {
  if (row.status === "failed" || row.status === "cancelled") return row.credits_actual ?? 0
  if (row.status === "completed") return row.credits_actual ?? row.credits ?? 0
  return row.credits ?? 0
}

async function spentLines(ids: readonly string[], userId: string): Promise<{ spent: UgcQuoteLine[]; skipped: string[] }> {
  // Postgres answers a uuid in lower case, so a user's own id sent in upper case is matched (and deduped) that way.
  const unique = [...new Set(ids.map((id) => (isUuid(id) ? id.toLowerCase() : id)))]
  // A non-uuid can never be one of this user's jobs — and would make the query throw.
  const lookups = unique.filter(isUuid)
  const rows = new Map<string, SpentJobRow>()
  if (lookups.length > 0) {
    const { data, error } = await supabase
      .from("jobs")
      .select("id, status, job_type, input_data, credits, credits_actual")
      .in("id", lookups)
      .eq("user_id", userId)
    if (error) throw new UgcQuoteError("the calls already made")
    for (const row of (data ?? []) as SpentJobRow[]) rows.set(row.id, row)
  }
  // R53: what a job spent includes its settled metered side holds (a clip's readings, 554).
  const side = await sideHoldChargesFor([...rows.keys()])
  const spent: UgcQuoteLine[] = []
  const skipped: string[] = []
  for (const id of unique) {
    const row = rows.get(id)
    if (!row) { skipped.push(id); continue }
    const type = typeof row.input_data?.type === "string" ? row.input_data.type : row.job_type ?? "job"
    spent.push({ label: `${type} (already spent)`, credits: withSideCharge(spentCredits(row), row.id, side) })
  }
  return { spent, skipped }
}

export async function buildUgcQuote(input: {
  /** The builder's `quoteItems`, checked here item by item (see `parseItem`). */
  items: readonly unknown[]
  clipCount: number
  spentJobIds: readonly string[]
  userId: string
  /**
   * Who a call from this MCP session is billed to — `requestBillingContext`,
   * the credit guard's own per-request decision. Absent = the personal payer.
   */
  billingContext?: BillingContext
}): Promise<UgcQuote> {
  const ctx: QuoteContext = { clipCount: input.clipCount }
  const callerGates = callerGatesOf(input.userId, input.billingContext)
  const lines: UgcQuoteLine[] = []
  // The items the AGENT runs through public tools (`build_ugc_clips`' quoteItems — its frame check
  // included): each is a call through a host route, an Image to Text one read by
  // /v1/image-to-text/describe, which bills it metered whenever metered pricing is on. So it is priced
  // as that route reserves it (its estimate, `~`) in every plugin mode — never by `ugcClipReadingMode`,
  // which governs only the reading inside the plugin's own clip job (`quoteTickets`, the `~` flag).
  for (const item of input.items) lines.push(await priceItem(item, ctx, callerGates, UGC_ROUTE_CALL_PRICED_AT))
  const { spent, skipped } = await spentLines(input.spentJobIds.slice(0, UGC_SPENT_JOB_IDS_MAX), input.userId)
  const total = [...spent, ...lines].reduce((sum, l) => sum + l.credits, 0)
  // Present only when a line is an estimate: a quote with none is byte-identical to before.
  return { spent, lines, total, skipped, ...(lines.some((l) => l.estimate) ? { totalIsEstimate: true as const } : {}) }
}

/** No payer: a planning figure (publish, editor, API-token and template estimates), never a reservation. */
export const ESTIMATE_CALLER = Object.freeze({ kind: "estimate" as const })
export type UgcPriceCaller = { userId: string; billingContext?: BillingContext } | typeof ESTIMATE_CALLER

/** Identity, not shape: only the frozen constant is an estimate, so a payer object can never opt out of its gates. */
const isEstimate = (caller: UgcPriceCaller): caller is typeof ESTIMATE_CALLER => caller === ESTIMATE_CALLER

/** The top tier, never free semantics: an estimate is the price of a runnable model, not a refusal. */
const ESTIMATE_GATES: ModelAvailabilityGates = { tierForGates: TIER_ORDER[TIER_ORDER.length - 1]!, freeSemantics: false }

/**
 * The charge-time price of each builder call, in order — the pricer behind the
 * plugin's `tk.http.priceUgcCalls` (the UGC Clip ceiling) and the canvas quote.
 * Same rows, same gates as `buildUgcQuote`; an unpriceable call throws
 * `UgcQuoteError`, never 0. A user caller is priced under the gates the credit
 * guard will use for that payer; `ESTIMATE_CALLER` reads no profile and is
 * priced under the top tier's gates (a disabled model still throws).
 */
export async function priceUgcCalls(
  caller: UgcPriceCaller,
  calls: ReadonlyArray<{ tool: string; args: Readonly<Record<string, unknown>> }>,
  /**
   * How a metered LLM call (a reading) is priced. The default is what the plugin is HANDED: its tier
   * row (a fixed-mode plugin charges it; a metered one holds and settles the call itself). A quote
   * passes `ugcClipReadingPricedAt()` for a clip reading (R58), `UGC_ROUTE_CALL_PRICED_AT` for a call
   * through the host's own metered route.
   */
  llmAt: "estimate" | "tier" = "tier",
): Promise<number[]> {
  return (await priceUgcCallLines(caller, calls, llmAt)).map((line) => line.credits)
}

/**
 * {@link priceUgcCalls} with each call's line: its credits, and `estimate`
 * when it is a metered LLM call priced at its estimate (charged its actual
 * usage, `~`). The canvas quote reads these flags; the plugin's
 * `tk.http.priceUgcCalls` keeps its plain `number[]`.
 */
export async function priceUgcCallLines(
  caller: UgcPriceCaller,
  calls: ReadonlyArray<{ tool: string; args: Readonly<Record<string, unknown>> }>,
  llmAt: "estimate" | "tier" = "tier",
): Promise<UgcQuoteLine[]> {
  const callerGates: CallerGates = isEstimate(caller) ? async () => ESTIMATE_GATES : callerGatesOf(caller.userId, caller.billingContext)
  // Every call asked at once (each a price-row read when the cache is cold), read back in order.
  const lines = calls.map((c, i) => started(priceItem({ label: `${c.tool} #${i + 1}`, tool: c.tool, args: c.args, count: 1 }, { clipCount: 1 }, callerGates, llmAt)))
  const out: UgcQuoteLine[] = []
  for (const line of lines) out.push(await line)
  return out
}

/**
 * `work`, already under way, with its failure marked as handled until it is awaited. Several reads
 * are started at once this way and then awaited one by one in the order they were asked, so the
 * answer, and the error thrown when one fails, are those of asking them one after another; only the
 * waiting overlaps. A read an earlier failure leaves unawaited never surfaces as an unhandled rejection.
 */
export function started<T>(work: Promise<T>): Promise<T> {
  work.catch(() => undefined)
  return work
}
