/**
 * "Which route will this request take?" — the ONE decision for a routable
 * video model (docs/design/alternate-routes.md, "Routing per model"). Made
 * once, at admission (before credits are held), stored on the job as
 * `input_data.__videoRoute`, and obeyed by the run: never decided again, so
 * an admin change affects only new jobs.
 *
 * `decideVideoRoute` is pure: the admin's policy, what this process's route
 * service can do (`RouteView`), and the request. No I/O here; the stored
 * decision is signed with a key derived from the deployment's internal secret.
 */
import { createHash, createHmac } from "node:crypto"
import { config } from "./config.js"
import { getRuntimeEnv } from "./runtime-env.js"
import { constantTimeEqualStr } from "./constant-time.js"
import type { PluginAlternateRouteRequest, PluginAlternateRoutesService } from "./private-plugins/types.js"
import { isRoutableVideoModel, videoRouteChoiceFor, type VideoRoutePolicy } from "./video-route-policy.js"

/** What a process's route service can do, as the decision reads it. */
export interface RouteView {
  /** The service speaks the second version of the contract (`prices` is a function). */
  readonly v2: boolean
  /** Whether the route knows `model` at all. Never throws. */
  capable(model: string): boolean
  /** The plugin's `accepts`, made safe: a throw reads as "not mine". */
  accepts(req: PluginAlternateRouteRequest): { routeId: string } | null
}

export type VideoRouteDefaultReason =
  /** The policy keeps this model (or service) on the default route — the shipped state. */
  | "setting"
  /** Not a model a route can be chosen for. */
  | "not-routable"
  /** This process has no route service. */
  | "no-route"
  /** The route service predates per-model routing. */
  | "route-v1"
  /** The route does not know the model. */
  | "not-capable"
  /** The route's `accepts` declined this request. */
  | "not-accepted"

export type VideoRouteDecision =
  | { readonly route: "default"; readonly why: VideoRouteDefaultReason }
  | { readonly route: "alternate"; readonly routeId: string; readonly service: string }

export interface VideoRouteAsk {
  readonly model: string
  readonly service: string
  /** The request as it is known at admission; `service` and `kind` set. */
  readonly request: PluginAlternateRouteRequest
}

/**
 * The decision. The policy is read first, so with the model on "default" the
 * route service is never consulted (an older plugin's `accepts` is never
 * reached from a lane it did not know).
 */
export function decideVideoRoute(
  policy: VideoRoutePolicy | null | undefined,
  view: RouteView | null,
  ask: VideoRouteAsk,
): VideoRouteDecision {
  if (!isRoutableVideoModel(ask.model)) return { route: "default", why: "not-routable" }
  if (videoRouteChoiceFor(policy, ask.model, ask.service) !== "alternate") return { route: "default", why: "setting" }
  if (!view) return { route: "default", why: "no-route" }
  if (!view.v2) return { route: "default", why: "route-v1" }
  if (!view.capable(ask.model)) return { route: "default", why: "not-capable" }
  const accepted = view.accepts({ ...ask.request, service: ask.service, kind: ask.request.kind ?? "generate" })
  const routeId = accepted?.routeId
  if (typeof routeId !== "string" || routeId.length === 0) return { route: "default", why: "not-accepted" }
  return { route: "alternate", routeId, service: ask.service }
}

/** Whether a price id names `model` (the bare id, or a composite of it). */
function priceIdNamesModel(id: string, model: string): boolean {
  return id === model || id.startsWith(`${model}:`)
}

/**
 * The view of a plugin's route service. V2 is the presence of `prices`.
 * `capable` falls back to "a model `prices()` names" when the plugin has no
 * `capable`. Every call into the plugin is guarded: a throw is a "no".
 */
export function routeViewOf(
  service: PluginAlternateRoutesService | undefined,
  prices: Readonly<Record<string, number>> | null,
  /** The model a price id prices (an extend's or a finalize's id names its model differently); default: the id's model prefix. */
  modelOf?: (priceId: string) => string | undefined,
): RouteView | null {
  if (!service) return null
  const v2 = typeof service.prices === "function"
  return {
    v2,
    capable: (model) => {
      try {
        if (typeof service.capable === "function") return service.capable(model) === true
        return prices !== null && Object.keys(prices).some((id) => (modelOf ? modelOf(id) === model : priceIdNamesModel(id, model)))
      } catch {
        return false
      }
    },
    accepts: (req) => {
      try {
        return service.accepts(req) ?? null
      } catch (err) {
        console.warn(`[video-route] accepts threw; the request stays on the default route: ${err instanceof Error ? err.message : String(err)}`)
        return null
      }
    },
  }
}

/**
 * The service a job belongs to, as the policy names it: the parent job's
 * type for a plugin's child job (cast-swap, generate-video-pro, ugc, …), else
 * the job's own type (the platform lane).
 */
export function videoRouteServiceOf(job: { jobType: string; parentJobType?: string | null }): string {
  return job.parentJobType && job.parentJobType.length > 0 ? job.parentJobType : job.jobType
}

// ── The stored decision ──

/**
 * The job's stored decision on `input_data`. A `__` key: server-only — dropped
 * from every job a read returns (`redactPrivateJobData`, lib/public-job-data.ts,
 * which every job route, MCP tool, webhook and SSE serializer goes through) and
 * stripped from every caller's body before a route reads it
 * (middleware/server-only-body-keys.ts).
 *
 * It is SIGNED for its job and for the request it priced: an HMAC (a key
 * derived from the deployment's internal secret) over the job id, the price
 * id, a key of the priced request's inputs ({@link videoRouteRequestKey}) and
 * every field. A stamp is honoured only when its signature verifies for the
 * job it sits on, so a value that reached `input_data` any other way — a
 * workflow node's data, an import, a copy onto another job by a retry — is no
 * decision at all: that job is admitted afresh (decided, priced, held).
 */
export const VIDEO_ROUTE_STAMP_KEY = "__videoRoute"

export interface VideoRouteStamp {
  readonly route: "alternate"
  readonly routeId: string
  readonly service: string
  readonly model: string
  readonly decidedAt: string
  /** The environment that admitted the job (`getRuntimeEnv()`): staging and production share one database, and each counts only its own. */
  readonly env: string
  /** The platform price id the job was held under. */
  readonly priceId: string
  /** The key of the priced request's inputs ({@link videoRouteRequestKey}): the run checks its inputs still match. */
  readonly requestKey: string
  /** The route's quote at admission (USD before any factor, and its billed seconds): what settlement compares with. */
  readonly quotedUsd: number
  readonly quotedSec: number
  /** The correction factor the hold was multiplied by. */
  readonly factor: number
  /** The factor's key (video-route-policy.ts `priceFactorKey`). */
  readonly factorKey: string
  /** The measured lengths of the request's reference clips the quote was made on. */
  readonly referenceVideoDurationsSec?: readonly number[]
  /** The output length the quote was made on. */
  readonly outputSec?: number
  /** A draft finalize: the route's own task reference of the draft (without `alt:`). */
  readonly draftRouteTaskRef?: string
}

/** The stamp as stored: its fields and their signature. */
export type SignedVideoRouteStamp = VideoRouteStamp & { readonly sig: string }

/** The job inputs a routed price depends on: what the request key covers. */
const PRICED_INPUT_KEYS = [
  "provider", "duration", "resolution", "aspectRatio", "referenceTaskType", "draft", "generateAudio", "sound", "outputFormat",
  "imageUrl", "sourceImageUrl", "endFrameUrl", "videoUrl", "audioUrl",
  "referenceImageUrls", "referenceVideoUrls", "referenceVideoUrl", "referenceAudioUrls", "refVideoDurationsSec",
  "taskId", "kieTaskId", "sourceJobId", "draftOutputSec", "draftRefVideoDurationsSec",
] as const

/**
 * A key of the job inputs a routed price depends on (a SHA-256 over them, in
 * a fixed order). Admission stores it with the decision; the run recomputes
 * it from the job's inputs and refuses a decision whose inputs changed since
 * (an edited job would otherwise run against a hold priced for other inputs).
 */
export function videoRouteRequestKey(input: Readonly<Record<string, unknown>> | null | undefined): string {
  const values = PRICED_INPUT_KEYS.map((k) => (input?.[k] === undefined ? null : input[k]))
  return createHash("sha256").update(JSON.stringify(values)).digest("base64url")
}

function stampKey(): Buffer {
  return createHmac("sha256", config.INTERNAL_ORCHESTRATOR_SECRET).update("video-route-stamp/v1").digest()
}

function signatureOf(jobId: string, s: VideoRouteStamp): string {
  const payload = JSON.stringify([
    jobId, s.route, s.routeId, s.service, s.model, s.decidedAt, s.env, s.priceId, s.requestKey, s.quotedUsd, s.quotedSec, s.factor, s.factorKey,
    s.referenceVideoDurationsSec ?? null, s.outputSec ?? null, s.draftRouteTaskRef ?? null,
  ])
  return createHmac("sha256", stampKey()).update(payload).digest("base64url")
}

/** The signed stamp to store on job `jobId` for an "alternate" decision. */
export function videoRouteStamp(
  jobId: string,
  decision: Extract<VideoRouteDecision, { route: "alternate" }>,
  args: {
    model: string
    priceId: string
    requestKey: string
    quotedUsd: number
    quotedSec: number
    factor: number
    factorKey: string
    referenceVideoDurationsSec?: readonly number[]
    outputSec?: number
    draftRouteTaskRef?: string
    now?: Date
  },
): SignedVideoRouteStamp {
  const stamp: VideoRouteStamp = {
    route: "alternate",
    routeId: decision.routeId,
    service: decision.service,
    model: args.model,
    decidedAt: (args.now ?? new Date()).toISOString(),
    env: getRuntimeEnv(),
    priceId: args.priceId,
    requestKey: args.requestKey,
    quotedUsd: args.quotedUsd,
    quotedSec: args.quotedSec,
    factor: args.factor,
    factorKey: args.factorKey,
    ...(args.referenceVideoDurationsSec && args.referenceVideoDurationsSec.length > 0 ? { referenceVideoDurationsSec: [...args.referenceVideoDurationsSec] } : {}),
    ...(args.outputSec !== undefined ? { outputSec: args.outputSec } : {}),
    ...(args.draftRouteTaskRef ? { draftRouteTaskRef: args.draftRouteTaskRef } : {}),
  }
  return { ...stamp, sig: signatureOf(jobId, stamp) }
}

const finiteNonNeg = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0

/**
 * Job `jobId`'s stored "alternate" decision, or undefined: no stamp, a
 * malformed one, or one whose signature does not verify for THIS job (never
 * written by the admission for it). Undefined = the job runs as the platform
 * always ran it.
 */
export function videoRouteStampOf(inputData: unknown, jobId: string): VideoRouteStamp | undefined {
  const raw = (inputData as Record<string, unknown> | null | undefined)?.[VIDEO_ROUTE_STAMP_KEY]
  if (typeof raw !== "object" || raw === null) return undefined
  const r = raw as Record<string, unknown>
  if (r.route !== "alternate" || typeof r.sig !== "string") return undefined
  if (typeof r.routeId !== "string" || !r.routeId || typeof r.service !== "string" || typeof r.model !== "string" || typeof r.decidedAt !== "string") return undefined
  if (typeof r.priceId !== "string" || typeof r.requestKey !== "string" || typeof r.env !== "string") return undefined
  if (!finiteNonNeg(r.quotedUsd) || !finiteNonNeg(r.quotedSec) || !finiteNonNeg(r.factor) || typeof r.factorKey !== "string") return undefined
  const stamp: VideoRouteStamp = {
    route: "alternate",
    routeId: r.routeId,
    service: r.service,
    model: r.model,
    decidedAt: r.decidedAt,
    env: r.env,
    priceId: r.priceId,
    requestKey: r.requestKey,
    quotedUsd: r.quotedUsd,
    quotedSec: r.quotedSec,
    factor: r.factor,
    factorKey: r.factorKey,
    ...(Array.isArray(r.referenceVideoDurationsSec) && r.referenceVideoDurationsSec.every(finiteNonNeg) ? { referenceVideoDurationsSec: r.referenceVideoDurationsSec as number[] } : {}),
    ...(finiteNonNeg(r.outputSec) ? { outputSec: r.outputSec } : {}),
    ...(typeof r.draftRouteTaskRef === "string" && r.draftRouteTaskRef ? { draftRouteTaskRef: r.draftRouteTaskRef } : {}),
  }
  if (!constantTimeEqualStr(r.sig, signatureOf(jobId, stamp))) {
    console.error(`[ALERT] job ${jobId}: input_data carries a video route decision the server did not sign; ignored.`)
    return undefined
  }
  return stamp
}
