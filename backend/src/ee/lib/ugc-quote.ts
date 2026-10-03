import {
  applyDefaultVideoSelection,
  buildVideoCreditModelIdentifier,
  captionRoutesToRemotion,
  estimateCombineVideosCredits,
  resolveLlmCreditId,
} from "@nodaro/shared"
import { z } from "zod"
import { getAppSettings } from "../../lib/app-settings.js"
import type { BillingContext } from "../../lib/billing-context.js"
import { imageCollageCreditModelIdentifier } from "../../lib/image-collage-credit-id.js"
import { normalizeVideoInput } from "../../lib/mcp/normalize.js"
import { isUuid } from "../../lib/mcp/tools/_id-guard.js"
import { llmPayloadFields, type LlmMcpArgs } from "../../lib/mcp/tools/_llm-fields.js"
import { MCP_TRANSCRIBE_PROVIDER } from "../../lib/mcp/tools/verbs-audio.js"
import { supabase } from "../../lib/supabase.js"
import { resolveVideoRequestNorm } from "../../lib/video-request-norm.js"
import { getModelCreditCostFromDB, type ModelPricing } from "../billing/credits.js"
import {
  modelAvailabilityNeedsGates,
  modelAvailabilityRefusal,
  type ModelAvailabilityGates,
} from "../billing/model-availability.js"
import { effectiveTierOf, payerProfileId, spendGates } from "../billing/org-entitlements.js"
import { applyServiceMarkup } from "../billing/service-margin.js"

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
}

export class UgcQuoteError extends Error {
  constructor(label: string) {
    super(`could not price ${label}`)
    this.name = "UgcQuoteError"
  }
}

/** How a route decides what it reserves: the pricing row for `id`, or a computed base marked up under `id`. */
export interface UgcPricing {
  readonly id: string
  readonly base?: number
}

export interface QuoteContext {
  /** How many clips the join combines. */
  readonly clipCount: number
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined)

/**
 * The credit decision each quoted tool's route makes for the payload its MCP
 * verb dispatches. `null` = this tool cannot be priced from these args.
 */
const PRICING: Record<string, (args: Readonly<Record<string, unknown>>, ctx: QuoteContext) => UgcPricing | null> = {
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
  // generate_speech → POST /v1/text-to-speech: the provider, with the legacy alias mapped.
  generate_speech: (args) => {
    const model = str(args.model)
    if (!model) return null
    return { id: model === "elevenlabs" ? "elevenlabs-turbo" : model }
  },
  // extract_frame → POST /v1/extract-frame: one flat id.
  extract_frame: () => ({ id: "extract-frame" }),
  // image_collage → POST /v1/image-collage: priced by output resolution.
  image_collage: (args) => ({ id: imageCollageCreditModelIdentifier(args.resolution) }),
  // image_to_text → POST /v1/image-to-text/describe: the LLM tier from the verb's own LLM fields.
  image_to_text: (args) => ({ id: resolveLlmCreditId("image-to-text", llmPayloadFields(args as LlmMcpArgs)) }),
  // combine_videos → POST /v1/combine-videos: a COMPUTED base (the verb sends no upstream durations).
  combine_videos: (args, ctx) => {
    if (ctx.clipCount < 2) return null
    return {
      id: "combine-videos",
      base: estimateCombineVideosCredits(
        { transition: str(args.transition) as never, transitionDuration: num(args.transition_duration) },
        Array.from({ length: ctx.clipCount }, () => undefined),
      ),
    }
  },
  // forced_alignment → POST /v1/forced-alignment: one flat id.
  forced_alignment: () => ({ id: "elevenlabs-forced-alignment" }),
  // silence_detect → POST /v1/silence-detect: one flat id (the route's inline literal).
  silence_detect: () => ({ id: "silence-detect" }),
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
export function pricingFor(tool: string, args: Readonly<Record<string, unknown>>, ctx: QuoteContext): UgcPricing | null {
  const rule = Object.prototype.hasOwnProperty.call(PRICING, tool) ? PRICING[tool] : undefined
  return rule ? rule(args, ctx) : null
}

/** What the reservation charges: the row's marked-up price, or the computed base marked up under the row's id. */
async function creditsFor(pricing: UgcPricing, row: ModelPricing): Promise<number> {
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

async function priceItem(raw: unknown, ctx: QuoteContext, callerGates: CallerGates): Promise<UgcQuoteLine> {
  const item = parseItem(raw)
  const pricing = pricingFor(item.tool, item.args, ctx)
  if (!pricing) throw new UgcQuoteError(item.label)
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
    return { label: item.label, credits: (await creditsFor(pricing, row)) * item.count }
  } catch {
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
  const spent: UgcQuoteLine[] = []
  const skipped: string[] = []
  for (const id of unique) {
    const row = rows.get(id)
    if (!row) { skipped.push(id); continue }
    const type = typeof row.input_data?.type === "string" ? row.input_data.type : row.job_type ?? "job"
    spent.push({ label: `${type} (already spent)`, credits: spentCredits(row) })
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
  for (const item of input.items) lines.push(await priceItem(item, ctx, callerGates))
  const { spent, skipped } = await spentLines(input.spentJobIds.slice(0, 30), input.userId)
  const total = [...spent, ...lines].reduce((sum, l) => sum + l.credits, 0)
  return { spent, lines, total, skipped }
}
