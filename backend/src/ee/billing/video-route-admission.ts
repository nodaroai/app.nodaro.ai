import { routedWorkflowVideoAddonBase } from "../../lib/loop-trim-addon.js"
import { applyServiceMarkup } from "./service-margin.js"
/**
 * ADMISSION of a routable video job (docs/design/alternate-routes.md,
 * "Routing per model"): the one place a job's route is decided, priced and
 * stored, right before its credits are held.
 *
 * Every job-creating lane holds its credits through `reserveCreditsForJob`
 * (routes and the plugin toolkit) or the orchestrator's node reservation, and
 * both ask {@link admitRoutedVideo} first. It answers null — "hold as
 * always" — unless the admin routed the job's model for its service and this
 * process's route takes the request; then it stores the decision on the job
 * (`input_data.__videoRoute`) and returns the hold: the route's quote × the
 * key's correction factor, marked up at the platform price id.
 *
 * With nothing routed it returns before any read.
 */
import { modelOfPriceId } from "./video-route-listing.js"
import { supabase } from "../../lib/supabase.js"
import { getRuntimeEnv } from "../../lib/runtime-env.js"
import { probeRefVideoDurations } from "../../lib/ref-video-probe.js"
import { admissionRouteRequest, seatedLikeTheProvider, str, strList, num } from "./video-route-request.js"
export { admissionRouteRequest, VOICE_TRACK_STAND_IN } from "./video-route-request.js"
import { seedanceExtendSentSec } from "@nodaro/shared/credits"
import { isSeedanceExtendProvider, SEEDANCE_EDIT_REF_VIDEO_SEC, VIDEO_REF_VIDEO_DURATION_LIMITS } from "@nodaro/shared/models"
import { tailCutSec } from "../../lib/extend-recipe.js"
import { seedance2RefVideoQuoteBasis } from "./seedance2-ref-video-quote.js"
import { refVideoWorstCaseSecFor } from "../../lib/ref-video-worst-case.js"
import { pricePlannedVideo } from "./video-route-planned.js"
import { getVideoRouteSettings } from "./video-route-settings.js"
import type { getAppSettings } from "../../lib/app-settings.js"
import { getPluginServices, pluginServicesLoaded } from "../../lib/private-plugins/services-registry.js"
import { currentRouteView } from "../../lib/alternate-route-prices.js"
import { ALTERNATE_ROUTE_JOB_TYPES, alternateRouteRecordOf, alternateRouteTaskRefOf, type AlternateRouteJobType } from "../../lib/alternate-route-request.js"
import type { PluginAlternateRouteRequest } from "../../lib/private-plugins/types.js"
import { anyModelRouted, isRoutableVideoModel, priceFactorKey, videoRouteChoiceFor } from "../../lib/video-route-policy.js"
import {
  foreignVideoRouteStamp, VIDEO_ROUTE_STAMP_KEY,
  decideVideoRoute,
  videoRouteServiceOf,
  videoRouteRequestKey,
  videoRouteStamp,
  type RouteView,
  type VideoRouteDecision,
  type VideoRouteStamp,
} from "../../lib/video-route-decision.js"
import { routedPriceIdOf, routedQuote, type RoutedPriceId, type RoutedQuote } from "./video-route-pricing.js"
import { config } from "../../lib/config.js"
import { loopbackFetch } from "../../services/workflow-engine/loopback-fetch.js"
import { PriceNotConfiguredError } from "./price-not-configured.js"
import { registerRoutedNodeEstimators, type RoutedNodeEstimators } from "./routed-node-estimators.js"

/** Why the route a setting names cannot run a model at all, in an operator's words (by refusal reason). */
const ROUTE_UNAVAILABLE_WORDS: Readonly<Record<string, string>> = {
  "no-route": "no alternate route is loaded in this environment",
  "route-v1": "the alternate route loaded here predates per-model routing",
  "not-capable": "the alternate route loaded here does not take this model",
}

export interface RoutedAdmission {
  readonly stamp: VideoRouteStamp
  /** The post-markup credits to hold (the reservation's override). */
  readonly holdCredits: number
}

interface AdmissionJobRow {
  job_type: string | null
  parent_job_id: string | null
  input_data: Record<string, unknown> | null
}

/**
 * What admission decided for a job whose model the admin routed, kept on the
 * job (server-only) so Admin → Video route can count, per model and service,
 * how many requests the route took and why selected requests were refused. Display only: nothing runs or prices from it.
 */
export const VIDEO_ROUTE_OUTCOME_KEY = "__videoRouteOutcome"

export interface VideoRouteOutcome {
  readonly route: "alternate" | "default" | "refused"
  /** Why admission refused a selected request (`decideVideoRoute`'s reason). */
  readonly why?: string
  readonly model: string
  readonly service: string
  /** The environment that admitted the job: each counts only its own. */
  readonly env: string
  readonly at: string
}

async function recordOutcome(jobId: string, input: Record<string, unknown>, outcome: VideoRouteOutcome): Promise<void> {
  // Best effort: a count is never worth failing an admission for.
  const { error } = await supabase.from("jobs").update({ input_data: { ...input, [VIDEO_ROUTE_OUTCOME_KEY]: outcome } }).eq("id", jobId)
  if (error) console.warn(`[video-route] job ${jobId}: the routing outcome was not recorded: ${error.message}`)
}

function extendSentSeconds(provider: unknown, seconds: number): number {
  return typeof provider === "string" && isSeedanceExtendProvider(provider) ? tailCutSec(provider, seconds) : seedanceExtendSentSec(seconds)
}

function unsupportedSetting(jobType: AlternateRouteJobType, input: Record<string, unknown>): string | undefined {
  const plainVideo = jobType === "image-to-video" || jobType === "text-to-video"
  if (plainVideo && (input.webSearch === true || input.nsfwChecker === true)) return "unsupported-setting"
  if ((plainVideo || jobType === "voiced-video") && typeof input.seed === "number") return "seed-set"
  return undefined
}

const JOB_TYPES: ReadonlySet<string> = new Set(ALTERNATE_ROUTE_JOB_TYPES)

/** What a routed consult decided for a request, and its quote when it routes. No write. */
export interface RoutedConsult {
  readonly decision: VideoRouteDecision
  readonly request: PluginAlternateRouteRequest
  readonly factorKey?: string
  readonly quote?: RoutedQuote
}

/**
 * The decision and quote for one request, as admission and `/v1/quote` both
 * ask it: the request shaped as the default provider would send it, its
 * reference clips measured, then `decideVideoRoute`, then the route's quote
 * (which throws `PriceNotConfiguredError` when there is none). Reads and
 * probes; writes nothing.
 */
export async function consultRoute(args: {
  jobId: string
  jobType: AlternateRouteJobType
  parent: { jobId: string; jobType: string } | null
  service: string
  input: Record<string, unknown>
  priceId: string
  parsed: RoutedPriceId
  settings: Awaited<ReturnType<typeof getAppSettings>>
  view: RouteView | null
}): Promise<RoutedConsult> {
  const { parsed } = args
  let request = seatedLikeTheProvider(admissionRouteRequest({ jobId: args.jobId, jobType: args.jobType, model: parsed.model, parent: args.parent, service: args.service, input: args.input, ...(parsed.seconds !== undefined ? { pricedSec: parsed.seconds } : {}) }))
  // A request with reference clips is asked with the clips' lengths: probed here
  // when the route did not keep its own probe on the job (an unreadable clip
  // is left unmeasured, and the route then gives no quote: 503, never a guess).
  // Always measured HERE, never read from the job's input (a value there could
  // have come from a request body or a node's data).
  if (request.referenceVideoUrls.length > 0) {
    const { referenceVideoDurationsSec: _fromInput, ...withoutInputLengths } = request
    request = withoutInputLengths
    const probed = await probeRefVideoDurations({ provider: parsed.model, referenceVideoUrls: request.referenceVideoUrls })
    if (probed.length === request.referenceVideoUrls.length && probed.every((d) => Number.isFinite(d) && d > 0)) {
      request = { ...request, referenceVideoDurationsSec: probed }
    }
  }
  // An extend sends the source's last seconds only (at most its window), measured as the run counts them.
  if (args.jobType === "extend-video" && request.referenceVideoDurationsSec) {
    request = { ...request, referenceVideoDurationsSec: request.referenceVideoDurationsSec.map((d) => extendSentSeconds(args.input.provider, d)) }
  }
  // An edit's output is its source's measured length.
  if (request.referenceTaskType === "edit" && request.outputSec === undefined && request.referenceVideoDurationsSec?.[0] !== undefined) {
    request = { ...request, outputSec: request.referenceVideoDurationsSec[0] }
  }
  const unsupported = unsupportedSetting(args.jobType, args.input)
  if (unsupported) return { decision: { route: "refused", why: "not-accepted", detail: unsupported }, request }
  const decision = decideVideoRoute(args.settings.video_route_policy, args.view, { model: parsed.model, service: args.service, request })
  if (decision.route !== "alternate") return { decision, request }
  const factorKey = priceFactorKey({ model: parsed.model, resolution: request.resolution ?? parsed.resolution, hasRefVideo: request.referenceVideoUrls.length > 0, kind: parsed.kind })
  const quote = routedQuote({
    service: getPluginServices().alternateRoutes,
    request: { ...request, service: args.service, kind: "generate" },
    priceId: args.priceId,
    factorKey,
    factors: args.settings.video_route_price_factors,
    settings: args.settings,
  })
  return { decision, request, factorKey, quote }
}

/**
 * The routed hold for job `jobId`, priced on `priceId`, or null for "hold as
 * always". Throws `PriceNotConfiguredError` when the decision is "alternate"
 * and the route gives no quote: the caller refuses the job (503), never
 * holding the default price for a routed run. `view` is this process's route
 * (tests pass their own).
 */
export async function admitRoutedVideo(args: {
  jobId: string
  priceId: string
  view?: RouteView | null
}): Promise<RoutedAdmission | null> {
  const parsed = routedPriceIdOf(args.priceId)
  if (!parsed) return null
  const settings = await getVideoRouteSettings(args.priceId)
  const policy = settings.video_route_policy
  // Draft finalizes follow the draft's own route, never the policy. A process
  // with no route that routes per model makes and finalizes no route draft
  // (its gate refuses one, lib/seedance-draft-finalize.ts): nothing read.
  if (parsed.kind === "draft-finalize") {
    return admitRoutedFinalize(args.jobId, args.priceId, parsed, settings)
  }
  // The shipped state: nothing routed, nothing read.
  if (!anyModelRouted(policy)) return null

  // trash-read: a job being admitted right now.
  const { data, error } = await supabase.from("jobs").select("job_type, parent_job_id, input_data").eq("id", args.jobId).maybeSingle()
  if (error || !data) throw new Error(`video route admission: job ${args.jobId} could not be read`)
  const row = data as AdmissionJobRow
  if (foreignVideoRouteStamp(row.input_data)) throw new Error("Video run belongs to another environment")
  const jobType = row.job_type ?? str(row.input_data?.type) ?? ""
  if (!JOB_TYPES.has(jobType)) return null
  const parent = row.parent_job_id ? await readParent(row.parent_job_id) : null
  const service = videoRouteServiceOf({ jobType, parentJobType: parent?.jobType })
  if (videoRouteChoiceFor(policy, parsed.model, service) !== "alternate") return null

  // Never a decision already on the row: whatever is there (a replay's, or a
  // value that reached the input some other way) is replaced by this one,
  // decided and priced here, now. A replayed reservation keeps its first hold
  // in the reservation itself (`oncePerJob`).
  const input = row.input_data ?? {}
  const view = args.view === undefined ? currentRouteView(modelOfPriceId) : args.view
  const { decision, request, quote, factorKey } = await consultRoute({
    jobId: args.jobId, jobType: jobType as AlternateRouteJobType, parent, service, input, priceId: args.priceId, parsed, settings, view,
  })
  if (decision.route !== "alternate" || !quote || !factorKey) {
    const why = decision.route === "refused" ? (decision.detail ? `${decision.why}:${decision.detail}` : decision.why) : "no-quote"
    console.warn(`[video-route] job ${args.jobId}: ${parsed.model} is routed for ${service}, but the request cannot be admitted (${why})`)
    await recordOutcome(args.jobId, input, { route: "refused", why, model: parsed.model, service, env: getRuntimeEnv(), at: new Date().toISOString() })
    // The route the setting names is gone or cannot take the model at all (not one request it
    // declined): every such job is refused until an admin acts, so say so, and why, once per cause.
    const refusedWhy = decision.route === "refused" ? decision.why : undefined
    const missing = refusedWhy ? ROUTE_UNAVAILABLE_WORDS[refusedWhy] : undefined
    if (missing && refusedWhy) {
      const message = `${parsed.model} is set to the alternate route for ${service}, but ${missing}. Its requests are refused (never sent to the default provider) until the route is back or the setting is changed.`
      console.error(`[ALERT] video route: ${message}`)
      try {
        const { recordVideoRouteAlert } = await import("./video-route-alerts.js")
        await recordVideoRouteAlert({ key: `route-unavailable:${parsed.model}:${refusedWhy}`, kind: "route-unavailable", model: parsed.model, message })
      } catch (err) {
        console.error(`[video-route] recording the unavailable-route alert failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    throw new PriceNotConfiguredError(args.priceId)
  }
  const stamp = videoRouteStamp(args.jobId, decision, {
    priceId: args.priceId,
    requestKey: videoRouteRequestKey(input),
    model: parsed.model,
    quotedUsd: quote.usd,
    quotedSec: quote.billedSeconds,
    factor: quote.factor,
    factorKey,
    ...(request.referenceVideoDurationsSec ? { referenceVideoDurationsSec: request.referenceVideoDurationsSec } : {}),
    ...(request.outputSec !== undefined ? { outputSec: request.outputSec } : {}),
  })
  const { error: writeError } = await supabase
    .from("jobs")
    .update({ input_data: { ...input, [VIDEO_ROUTE_STAMP_KEY]: stamp, [VIDEO_ROUTE_OUTCOME_KEY]: { route: "alternate", model: parsed.model, service, env: stamp.env, at: stamp.decidedAt } } })
    .eq("id", args.jobId)
  if (writeError) throw new Error(`video route admission: job ${args.jobId}: the decision could not be stored: ${writeError.message}`)
  console.warn(`[video-route] job ${args.jobId}: ${parsed.model} for ${service} on route ${decision.routeId}, held at ${quote.chargedCredits} credits (factor ${quote.factor})`)
  return { stamp, holdCredits: quote.chargedCredits }
}

/**
 * A draft finalize is bound to the route that made its draft: a draft the alternate route made (`alt:<ref>`) is finalized on
 * that route — whatever the policy says now — held at the route's quote for
 * the draft's measured length; a default draft finalizes as always (null).
 * A route draft this process cannot finalize is refused (503), never sent to
 * the default upstream.
 */
/** What a routed draft finalize is priced on: the draft's route, reference and measured lengths. */
interface RoutedFinalizeAsk {
  readonly jobId: string
  readonly priceId: string
  readonly parsed: RoutedPriceId
  readonly draftTaskId: string | undefined
  readonly sourceJobId: string | undefined
  readonly outputSec: number | undefined
  readonly refSec: readonly unknown[]
  readonly parent: { jobId: string; jobType: string } | null
  readonly jobType: string
}

/**
 * The route's quote for finalizing a draft it made — the ONE pricing of a
 * routed finalize, shared by its admission and its estimates (`/v1/quote`,
 * `/v1/seedance-hd-estimate`): null for a draft the default provider made;
 * throws `PriceNotConfiguredError` for a route draft this process cannot price.
 */
export async function routedFinalizeQuote(ask: RoutedFinalizeAsk, settings: Awaited<ReturnType<typeof getAppSettings>>): Promise<{
  request: PluginAlternateRouteRequest
  routeId: string
  service: string
  draftRef: string
  factorKey: string
  quote: RoutedQuote
} | null> {
  const draftRef = alternateRouteTaskRefOf(ask.draftTaskId)
  if (!draftRef) return null
  const service = getPluginServices().alternateRoutes
  // trash-read: the draft names its route whatever became of it since.
  const source = ask.sourceJobId ? (await supabase.from("jobs").select("input_data").eq("id", ask.sourceJobId).maybeSingle()).data as { input_data?: unknown } | null : null
  if (foreignVideoRouteStamp(source?.input_data)) throw new PriceNotConfiguredError(ask.priceId)
  const sourceRouteId = alternateRouteRecordOf(source?.input_data)?.routeId
  const outputSec = ask.outputSec
  if (typeof service?.prices !== "function" || !sourceRouteId || outputSec === undefined || outputSec <= 0) {
    console.error(`[video-route] job ${ask.jobId}: a draft the alternate route made cannot be finalized here (route ${service ? "v1" : "absent"}, route id ${sourceRouteId ?? "unknown"}, length ${outputSec ?? "unknown"})`)
    throw new PriceNotConfiguredError(ask.priceId)
  }
  const refSec = ask.refSec.filter((d): d is number => typeof d === "number" && Number.isFinite(d) && d > 0)
  // The draft's own reference clips, beside their lengths (index-aligned, or none).
  const refUrls = strList(((source?.input_data ?? {}) as Record<string, unknown>).referenceVideoUrls)
  const draftRefs = refUrls.length > 0 && refUrls.length === refSec.length ? { referenceVideoUrls: refUrls, referenceVideoDurationsSec: refSec } : undefined
  const svc = videoRouteServiceOf({ jobType: ask.jobType, parentJobType: ask.parent?.jobType })
  const request: PluginAlternateRouteRequest = {
    jobId: ask.jobId,
    jobType: "video-upscale",
    model: ask.parsed.model,
    parent: ask.parent,
    service: svc,
    kind: "draft-finalize",
    draftRouteTaskRef: draftRef,
    prompt: "",
    draft: false,
    resolution: "1080p",
    referenceImageUrls: [],
    referenceVideoUrls: draftRefs?.referenceVideoUrls ?? [],
    referenceAudioUrls: [],
    outputSec,
    ...(draftRefs ? { referenceVideoDurationsSec: draftRefs.referenceVideoDurationsSec } : {}),
  }
  const factorKey = priceFactorKey({ model: ask.parsed.model, resolution: "1080p", hasRefVideo: ask.parsed.hasRefVideo, kind: "draft-finalize" })
  const quote = routedQuote({ service, request, priceId: ask.priceId, factorKey, factors: settings.video_route_price_factors, settings })
  // The supplier that made the draft quotes and starts its own finalize operation.
  const routeId = service.accepts(request)?.routeId
  if (!routeId) throw new PriceNotConfiguredError(ask.priceId)
  return { request, routeId, service: svc, draftRef, factorKey, quote }
}

/**
 * The charged credits of finalizing a resolved draft (`resolveSeedanceDraftFinalize`'s
 * plan) when the route made it; null for a draft the default provider made.
 * What `/v1/quote` and `/v1/seedance-hd-estimate` show, equal to the hold.
 */
export async function routedFinalizeCredits(plan: { draftTaskId: string; sourceJobId: string; outputSec: number; refVideoDurationsSec: readonly unknown[]; creditId: string }): Promise<number | null> {
  if (!alternateRouteTaskRefOf(plan.draftTaskId)) return null
  const parsed = routedPriceIdOf(plan.creditId)
  if (!parsed) return null
  const settings = await getVideoRouteSettings(plan.creditId)
  const priced = await routedFinalizeQuote({
    jobId: "quote", priceId: plan.creditId, parsed, draftTaskId: plan.draftTaskId, sourceJobId: plan.sourceJobId,
    outputSec: plan.outputSec, refSec: plan.refVideoDurationsSec, parent: null, jobType: "video-upscale",
  }, settings)
  return priced ? priced.quote.chargedCredits : null
}

async function admitRoutedFinalize(
  jobId: string,
  priceId: string,
  parsed: RoutedPriceId,
  settings: Awaited<ReturnType<typeof getAppSettings>>,
): Promise<RoutedAdmission | null> {
  // trash-read: a job being admitted right now.
  const { data, error } = await supabase.from("jobs").select("job_type, parent_job_id, input_data").eq("id", jobId).maybeSingle()
  if (error || !data) throw new Error(`video route admission: job ${jobId} could not be read`)
  const row = data as AdmissionJobRow
  if (foreignVideoRouteStamp(row.input_data)) throw new Error("Video run belongs to another environment")
  const input = row.input_data ?? {}
  const parent = row.parent_job_id ? await readParent(row.parent_job_id) : null
  const priced = await routedFinalizeQuote({
    jobId, priceId, parsed,
    draftTaskId: str(input.taskId) ?? str(input.kieTaskId),
    sourceJobId: str(input.sourceJobId),
    outputSec: num(input.draftOutputSec),
    refSec: Array.isArray(input.draftRefVideoDurationsSec) ? (input.draftRefVideoDurationsSec as unknown[]) : [],
    parent,
    jobType: row.job_type ?? "video-upscale",
  }, settings)
  if (!priced) return null
  const { quote, routeId, service: svc, draftRef, factorKey, request } = priced
  const stamp = videoRouteStamp(jobId, { route: "alternate", routeId, service: svc }, {
    priceId,
    requestKey: videoRouteRequestKey(input),
    model: parsed.model,
    quotedUsd: quote.usd,
    quotedSec: quote.billedSeconds,
    factor: quote.factor,
    factorKey,
    outputSec: request.outputSec!,
    draftRouteTaskRef: draftRef,
    ...(request.referenceVideoDurationsSec ? { referenceVideoDurationsSec: request.referenceVideoDurationsSec } : {}),
  })
  const { error: writeError } = await supabase
    .from("jobs")
    .update({ input_data: { ...input, [VIDEO_ROUTE_STAMP_KEY]: stamp, [VIDEO_ROUTE_OUTCOME_KEY]: { route: "alternate", model: parsed.model, service: svc, env: stamp.env, at: stamp.decidedAt } } })
    .eq("id", jobId)
  if (writeError) throw new Error(`video route admission: job ${jobId}: the decision could not be stored: ${writeError.message}`)
  return { stamp, holdCredits: quote.chargedCredits }
}

/**
 * The routed price of a request that has no job yet (`/v1/quote`): the
 * charged credits the admission would hold for it, or null when it would run
 * on the default route. Throws `PriceNotConfiguredError` like the admission.
 */
export async function quoteRoutedVideo(args: {
  priceId: string
  parentJobId?: string
  jobType: AlternateRouteJobType
  input: Record<string, unknown>
}): Promise<number | null> {
  const parsed = routedPriceIdOf(args.priceId)
  if (!parsed || parsed.kind === "draft-finalize") return null
  const settings = await getVideoRouteSettings(args.priceId)
  if (!anyModelRouted(settings.video_route_policy)) return null
  // The service exactly as admission names it for this request: a request on its own has no parent
  // job, and its job type is the one its run route stores (`ROUTED_QUOTE_JOB_TYPES`, node-quote.ts).
  const parent = args.parentJobId ? await readParent(args.parentJobId) : null
  const service = videoRouteServiceOf({ jobType: args.jobType, parentJobType: parent?.jobType })
  if (videoRouteChoiceFor(settings.video_route_policy, parsed.model, service) !== "alternate") return null
  const { quote } = await consultRoute({
    jobId: "quote", jobType: args.jobType, parent, service, input: args.input, priceId: args.priceId, parsed, settings, view: currentRouteView(modelOfPriceId),
  })
  if (!quote) throw new PriceNotConfiguredError(args.priceId)
  return quote.chargedCredits
}

async function readParent(parentId: string): Promise<{ jobId: string; jobType: string } | null> {
  // trash-read: the parent's type names the service, whatever its state.
  const { data, error } = await supabase.from("jobs").select("job_type").eq("id", parentId).maybeSingle()
  if (error || !data) throw new Error("Could not verify the parent video service")
  const jobType = (data as { job_type?: unknown } | null)?.job_type
  return { jobId: parentId, jobType: typeof jobType === "string" ? jobType : "" }
}

const LOOPBACK_TIMEOUT_MS = 10_000

/**
 * {@link admitRoutedVideo} from any process. A process that loaded the
 * plugins (the API, the workers) admits here; the standalone orchestrator,
 * which loads none, asks this container's API to admit the job — and when the
 * API cannot answer while the model is routed, the node fails: it is never
 * held at the default price for a run the admin routed.
 */
export async function admitRoutedVideoAnywhere(args: {
  jobId: string
  priceId: string
  /** The node's built payload: a draft finalize names its draft's task there (`kieTaskId`). */
  payload?: Readonly<Record<string, unknown>>
}): Promise<RoutedAdmission | null> {
  if (pluginServicesLoaded()) return admitRoutedVideo({ jobId: args.jobId, priceId: args.priceId })
  const parsed = routedPriceIdOf(args.priceId)
  if (!parsed) return null
  if (parsed.kind === "draft-finalize") {
    // Only a draft the route made is the route's to finalize.
    if (!alternateRouteTaskRefOf(str(args.payload?.kieTaskId) ?? str(args.payload?.taskId))) return null
  } else if (!anyModelRouted((await getVideoRouteSettings(args.priceId)).video_route_policy)) return null
  const port = process.env.BACKEND_PORT || process.env.PORT || "8000"
  const res = await loopbackFetch(
    `http://localhost:${port}/v1/video-route/internal/admit`,
    {
      method: "POST",
      headers: { "X-Internal-Orchestrator-Secret": config.INTERNAL_ORCHESTRATOR_SECRET, "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: args.jobId, priceId: args.priceId }),
      signal: AbortSignal.timeout(LOOPBACK_TIMEOUT_MS),
    },
    { label: "video route admission", delaysMs: [500, 1500] },
  )
  const body = (await res.json().catch(() => null)) as { admitted?: RoutedAdmission | null; error?: { code?: string } } | null
  if (res.status === 503 && body?.error?.code === "price_not_configured") throw new PriceNotConfiguredError(args.priceId)
  if (!res.ok || !body || body.admitted === undefined) throw new Error(`video route admission answered ${res.status}`)
  return body.admitted
}

/** The service a workflow node's run holds under (its run route's job type). */
export const NODE_ROUTE_JOB_TYPES: Readonly<Record<string, AlternateRouteJobType>> = {
  "generate-video": "image-to-video",
  "text-to-video": "text-to-video",
  "video-to-video": "text-to-video",
  "image-to-video": "image-to-video",
  "voiced-video": "voiced-video",
  "lip-sync": "lip-sync",
  "extend-video": "extend-video",
}

function estimatedJobType(nodeType: string, data: Record<string, unknown>): AlternateRouteJobType | undefined {
  if (nodeType !== "generate-video") return NODE_ROUTE_JOB_TYPES[nodeType]
  const frame = data.hasStartFrame || data.hasEndFrame || data.startFrameUrl || data.imageUrl || data.endFrameUrl
  return frame ? "image-to-video" : "text-to-video"
}

/**
 * A workflow node's routed price for a run estimate — what its admission
 * would hold, computed with no I/O from the node's settings and the clip
 * lengths the estimate already measured:
 *   - `{ kind: "route", credits }` when the route takes it and quotes it;
 *   - `{ kind: "default" }` when admission would keep it on the default route
 *     (the policy chooses default): price it as the default;
 *   - `{ kind: "listed" }` when the request is not concrete yet (a reference
 *     clip of unknown length): the listed price, the safe figure;
 *   - throws `PriceNotConfiguredError` when the route takes it but gives no quote.
 * Null for a node that is not a routable video run.
 */
export function estimateRoutedNode(args: {
  nodeType: string
  data: Record<string, unknown>
  priceId: string
  /** The measured lengths of its reference clips, in order; undefined = not all known. */
  referenceVideoDurationsSec?: readonly number[]
  settings: Awaited<ReturnType<typeof getAppSettings>>
  view: RouteView | null
}): { kind: "route"; credits: number } | { kind: "default" } | { kind: "listed" } | null {
  const jobType = estimatedJobType(args.nodeType, args.data)
  if (!jobType) return null
  const quote = quoteRoutedRequest({ ...args, jobType, service: jobType })
  if (quote?.kind !== "route") return quote
  const addon = routedWorkflowVideoAddonBase(jobType, args.data)
  return addon > 0 ? { kind: "route", credits: quote.credits + applyServiceMarkup(addon, args.settings, args.priceId) } : quote
}

/**
 * `estimateRoutedNode` where no route is loaded to quote (the standalone
 * orchestrator): the admin's choice for the node's own service decides —
 * "default" where admission keeps it on the default route, "listed" (the
 * published listing, the safe figure) where it routes.
 */
export function listedRoutedNode(args: {
  data?: Record<string, unknown>
  nodeType: string
  priceId: string
  settings: Awaited<ReturnType<typeof getAppSettings>>
}): { kind: "default" } | { kind: "listed" } | null {
  const jobType = estimatedJobType(args.nodeType, args.data ?? {})
  const parsed = routedPriceIdOf(args.priceId)
  if (!jobType || !parsed || parsed.kind === "draft-finalize") return null
  return videoRouteChoiceFor(args.settings.video_route_policy, parsed.model, jobType) === "alternate" ? { kind: "listed" } : { kind: "default" }
}

/**
 * The routed price of one request with no I/O (`estimateRoutedNode`'s core):
 * for a job of `jobType` under `service` (a plugin child's service is its
 * parent's type, e.g. cast-swap).
 */
export function quoteRoutedRequest(args: {
  jobType: AlternateRouteJobType
  service: string
  data: Record<string, unknown>
  priceId: string
  referenceVideoDurationsSec?: readonly number[]
  settings: Awaited<ReturnType<typeof getAppSettings>>
  view: RouteView | null
}): { kind: "route"; credits: number } | { kind: "default" } | { kind: "listed" } | null {
  const { jobType, service } = args
  const parsed = routedPriceIdOf(args.priceId)
  if (!parsed || parsed.kind === "draft-finalize") return null
  const policy = args.settings.video_route_policy
  if (videoRouteChoiceFor(policy, parsed.model, service) !== "alternate") return { kind: "default" }
  if (unsupportedSetting(jobType, args.data)) throw new PriceNotConfiguredError(args.priceId)
  const request = admissionRouteRequest({ jobId: "estimate", jobType, model: parsed.model, parent: null, service, input: args.data, pricedSec: parsed.seconds })
  const measured = args.referenceVideoDurationsSec ?? []
  const unknown = Math.max(Number(args.data.unknownReferenceVideos) || 0, request.referenceVideoUrls.length - measured.length, 0)
  if ((measured.length || unknown) && (jobType === "text-to-video" || jobType === "image-to-video" || jobType === "voiced-video")) {
    return { kind: "route", credits: plannedReferenceRange({
      provider: parsed.model, resolution: request.resolution,
      duration: typeof args.data.duration === "string" || typeof args.data.duration === "number" ? args.data.duration : request.durationSec,
      draft: request.draft, generateAudio: request.generateAudio, referenceTaskType: args.data.referenceTaskType,
      durationsSec: measured, unknownClips: unknown,
    }, service, args.settings).credits }
  }
  if (unknown || measured.some(d => !(d > 0))) return { kind: "listed" }
  const refs = jobType === "extend-video" ? measured.map(d => extendSentSeconds(args.data.provider, d)) : measured
  const task = request.referenceTaskType
  const outputSec = task === "edit" && refs.length ? Math.max(...refs) : request.outputSec ?? parsed.seconds
  if (!outputSec) return { kind: "listed" }
  const planned = pricePlannedVideo({
    model: parsed.model, service, resolution: request.resolution ?? parsed.resolution ?? "720p", outputSec,
    referenceVideoDurationsSec: refs, generateAudio: request.generateAudio, draft: request.draft,
    ...(task === "edit" || task === "extend" || task === "reference" ? { referenceTaskType: task } : {}),
  }, args.priceId, args.settings)
  return { kind: "route", credits: planned.credits }
}

/**
 * `tk.http.quoteSeedanceRefVideo` for a model the admin routed: the route's
 * quote of the clip's request (its measured lengths), so a plugin's parent
 * total (Video Remake) shows what each child's admission holds. Null when the
 * model is not routed for the service. A missing quote on a selected route refuses the request.
 */
export async function routedRefVideoHoldQuote(args: {
  provider: string
  resolution?: string
  duration?: number | string
  draft?: boolean
  referenceTaskType?: unknown
  durationsSec: ReadonlyArray<number | null>
  routeService?: string
}): Promise<{ hold: number; expected: number | null } | null> {
  if (!isRoutableVideoModel(args.provider)) return null
  const settings = await getVideoRouteSettings(args.provider)
  if (!anyModelRouted(settings.video_route_policy)) return null
  const service = args.routeService ?? (await ambientJobType())
  if (!service) return null
  if (videoRouteChoiceFor(settings.video_route_policy, args.provider, service) !== "alternate") return null
  const secs = args.durationsSec.map((d) => (typeof d === "number" && Number.isFinite(d) && d > 0 ? d : Number.NaN))
  if (secs.some(Number.isNaN)) throw new PriceNotConfiguredError(args.provider)
  const hold = plannedReferencePrice(args, secs, service, settings)
  return { hold, expected: hold }
}

/**
 * The editor's reference-video estimate (`/v1/credits/seedance-ref-estimate`)
 * of a Generate Video node whose model the admin routed for it: the route's
 * quote of the request as its admission will hold it (every clip measured), or
 * a range over accepted lengths while a clip is not produced yet.
 * Null when the node's model is not routed for it: the default estimate stands.
 */
type ReferencePriceRequest = {
  provider: string
  resolution?: string
  duration?: number | string
  draft?: boolean
  generateAudio?: boolean
  referenceTaskType?: unknown
  durationsSec: ReadonlyArray<number>
  unknownClips: number
  seed?: number
  unsupportedSettings?: boolean
  routeService?: string
}

function plannedReferencePrice(args: Omit<ReferencePriceRequest, "durationsSec" | "unknownClips">, secs: readonly number[], service: string, settings: Awaited<ReturnType<typeof getAppSettings>>): number {
  const { priceArgs, identifier } = seedance2RefVideoQuoteBasis({ ...args, referenceTaskType: args.referenceTaskType }, secs)
  const task = priceArgs.referenceTaskType
  const outputSec = task === "edit" ? Math.max(...secs) : priceArgs.outputDurationSec
  return pricePlannedVideo({
    model: args.provider, service, resolution: priceArgs.resolution, outputSec, referenceVideoDurationsSec: secs,
    draft: args.draft, generateAudio: args.generateAudio,
    ...(task === "edit" || task === "extend" || task === "reference" ? { referenceTaskType: task } : {}),
  }, identifier, settings).credits
}

export async function routedRefVideoEstimate(args: ReferencePriceRequest): Promise<{ credits: number; min: number; exact: boolean } | null> {
  if (!isRoutableVideoModel(args.provider)) return null
  const settings = await getVideoRouteSettings(args.provider)
  const service = args.routeService ?? "image-to-video"
  if (videoRouteChoiceFor(settings.video_route_policy, args.provider, service) !== "alternate") return null
  if (args.seed !== undefined || args.unsupportedSettings) throw new PriceNotConfiguredError(args.provider)
  return plannedReferenceRange(args, service, settings)
}

function plannedReferenceRange(args: ReferencePriceRequest, service: string, settings: Awaited<ReturnType<typeof getAppSettings>>) {
  const known = args.durationsSec.filter(d => Number.isFinite(d) && d > 0)
  const unknown = args.unknownClips + args.durationsSec.length - known.length
  const limits = VIDEO_REF_VIDEO_DURATION_LIMITS[args.provider]
  const shortest = limits?.minSec ?? 1
  const longest = refVideoWorstCaseSecFor(args.provider)
  const available = (limits?.maxTotalSec ?? Infinity) - known.reduce((sum, d) => sum + d, 0)
  if (unknown * shortest > available) throw new PriceNotConfiguredError(args.provider)
  // The range is over feasible runs. Compare the shortest clips, the boundary
  // where an edit can be declared, and the largest permitted total. At that
  // total keep one clip as long as possible since it can also size the output.
  const candidates = [shortest, ...(args.referenceTaskType === "edit" ? [SEEDANCE_EDIT_REF_VIDEO_SEC.min] : []), longest]
  const prices: number[] = []
  for (const size of new Set(unknown ? candidates : [0])) {
    let remaining = available
    const clips = [...known]
    for (let i = 0; i < unknown; i++) {
      const sec = Math.min(size, remaining - (unknown - i - 1) * shortest)
      clips.push(sec)
      remaining -= sec
    }
    prices.push(plannedReferencePrice(args, clips, service, settings))
  }
  return { credits: Math.max(...prices), min: Math.min(...prices), exact: unknown === 0 }
}

/** The type of the job this call runs inside (a plugin's parent), or undefined outside one. */
async function ambientJobType(): Promise<string | undefined> {
  const { getJobId } = await import("../../lib/job-cancellation.js")
  const id = getJobId()
  if (!id) return undefined
  // trash-read: the running job's own type.
  const { data } = await supabase.from("jobs").select("job_type").eq("id", id).maybeSingle()
  const type = (data as { job_type?: unknown } | null)?.job_type
  return typeof type === "string" ? type : undefined
}

export { routedRunPricing, routedEditVideoProPricing, routedContinuationPricing, editVideoProSegmentReferences } from "./video-route-planned.js"

// The price table prices a routed node through these (injected: credits.ts never imports this module).
registerRoutedNodeEstimators({ estimateRoutedNode, listedRoutedNode } as unknown as RoutedNodeEstimators)
