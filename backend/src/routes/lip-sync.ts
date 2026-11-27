import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { fourKSpellingPreHandler } from "../lib/four-k-spelling.js"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { applyPromptPolicies } from "../lib/prompt-policy.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob, type RoutePricing } from "../middleware/credit-guard.js"
import { noteWarning } from "../lib/price-notes.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { withResolvedModel } from "../lib/job-resolved-model.js"
import { LIP_SYNC_DEFAULT_PROVIDER } from "../workers/handlers/default-models.js"
import { LIP_SYNC_PROVIDERS, lipSyncLeverClearPatch, lipSyncResolutionRefusal, retiredLipSyncProviderMessage } from "@nodaro/shared/models"
import { drivingAudioCreditId, drivingAudioLipSyncResolution, drivingAudioOf, isDrivingAudioLipSyncProvider, isLipSyncChargedAtRunCost, lipSyncAudioRateOf, referenceAudioLipSyncCreditId } from "@nodaro/shared/credits"
import { drivingAudioFaceRefusal, drivingAudioFreeVideoRequest, drivingAudioRefusalStatus, measureDrivingAudio, type DrivingAudioMeasure } from "../lib/driving-audio-measure.js"
import { checkLipSyncInputs, lipSyncAudioPricingOf, lipSyncHeldCreditId, lipSyncModelLabel, lipSyncRateBaseCredits } from "../lib/lip-sync-inputs.js"
import { lipSyncFloorRefusal } from "../lib/lip-sync-floor-check.js"
import { formatZodError } from "../lib/zod-error.js"
import { probeAndCheckRefAudio, sentReferenceAudioUrls } from "../lib/ref-audio-probe.js"
import { sendInternalError } from "../lib/http-errors.js"
import { jobRunModel } from "../lib/run-model.js"
import { enqueueRouteJob } from "../lib/enqueue-route-job.js"
import { dropClientMeasureFields, requestMeasure, setRequestMeasure } from "../lib/request-measure.js"

export const lipSyncBody = z.object({
  imageUrl: safeUrlSchema.optional(),     // Portrait/face image (required for the KIE avatars)
  videoUrl: safeUrlSchema.optional(),     // Video input (required for LatentSync and the dubbing models)
  audioUrl: safeUrlSchema,                // Audio to sync
  prompt: z.string().max(500).optional(),
  userPrompt: z.string().max(8000).optional(),
  provider: z.enum(LIP_SYNC_PROVIDERS).optional(),
  // 1080p / 4k only valid for the seedance-2 family; infinitalk caps at 720p.
  // 1440p: LTX 2.5 Fast's top tier (its audio-to-video run, decided 2026-11-23); another model renders its own.
  resolution: z.enum(["480p", "720p", "1080p", "1440p", "4k"]).optional(),
  // Accepted for older clients and never read (decided 2026-11-13): every
  // model priced by its audio's length is priced on the length the server
  // measures (`lipSyncInputPreHandler`), and the job records that length.
  audioDurationSec: z.number().min(0.1).max(600).optional(),
  // LatentSync params
  guidanceScale: z.number().min(1).max(3).optional(),
  inferenceSteps: z.number().int().min(20).max(50).optional(),
  seed: z.number().int().optional(),
  fastMode: z.boolean().optional(),        // OmniHuman 1.5 — pe_fast_mode (trade quality for speed)
  // Wav2Lip and SadTalker params: those models are retired (refused before
  // this schema), and the fields stay accepted and passed on so every other
  // model's job is what it was.
  pads: z.string().max(50).optional(),
  smooth: z.boolean().optional(),
  fps: z.number().min(1).max(60).optional(),
  resizeFactor: z.number().int().min(1).max(4).optional(),
  enhancer: z.enum(["gfpgan", "RestoreFormer"]).optional(),
  preprocess: z.enum(["crop", "resize", "full"]).optional(),
  still: z.boolean().optional(),
  poseStyle: z.number().int().min(0).max(45).optional(),
  expressionScale: z.number().min(0).max(3).optional(),
  // HeyGen Lipsync Precision params
  enableDynamicDuration: z.boolean().optional(),
  disableMusicTrack: z.boolean().optional(),
  enableSpeechEnhancement: z.boolean().optional(),
  // Sync Lipsync 2 Pro params
  syncMode: z.enum(["loop", "bounce", "cut_off", "silence", "remap"]).optional(),
  temperature: z.number().min(0).max(1).optional(),
  activeSpeaker: z.boolean().optional(),
  // Volcengine video-to-video lip sync (AI dubbing) params
  mode: z.enum(["lite", "basic"]).optional(),
  separateVocal: z.boolean().optional(),
  openScenedet: z.boolean().optional(),
  alignAudio: z.boolean().optional(),
  alignAudioReverse: z.boolean().optional(),
  templStartSeconds: z.number().min(0).max(86400).optional(),
  userId: z.string().uuid().optional(),
})

/** A measured audio-to-video run (`measureDrivingAudio`'s answer when it prices the run). */
type DrivingAudioRunMeasure = Extract<DrivingAudioMeasure, { ok: true }>

/**
 * Single source of truth for the lip-sync credit identifier — used by BOTH the
 * creditGuard preHandler and the in-handler reservation so the reserved price
 * can never drift from the charged price. Mirrors extend-video.ts's
 * resolveExtendVideoIdentifier().
 */
export function resolveLipSyncIdentifier(body: Record<string, unknown> | undefined, measured?: LipSyncMeasure, drivingAudio?: DrivingAudioRunMeasure): string {
  const provider = (body?.provider as string) ?? LIP_SYNC_DEFAULT_PROVIDER
  // An audio-to-video model (LTX 2.5 Fast, decided 2026-11-23): the row of the voice the measuring step
  // read — Generate Video's audio-to-video row, never a length the request sent. Never priced on a guess.
  if (isDrivingAudioLipSyncProvider(provider)) {
    if (!drivingAudio) throw new Error("lip-sync: an audio-to-video run reached its pricing without its measured voice")
    return drivingAudio.creditId
  }
  // A model charged per second of its audio at a rate (OmniHuman 2.0): its
  // one-second row, which `computeCredits` multiplies by the seconds the
  // guard's measuring step measured. Before the bucket branch below, which would bucket it.
  const rate = lipSyncAudioRateOf(provider)
  if (rate) return rate.rateId
  if (provider === "infinitalk") {
    return `infinitalk:${(body?.resolution as string) ?? "720p"}`
  }
  // MiniMax Hailuo 3 — same audio-as-reference mechanism. The lip-sync
  // surface's resolution enum (480p-4k) never names H3's own 768P tier, so
  // every request reserves the 2K-rate 8s composite (the top tier — KIE
  // renders 2K when the param is omitted, and the worker decides actual
  // duration). If H3 lip-sync ever exposes the 768P lever, route the id
  // through normalizeMinimaxH3Resolution like the video routes do.
  // The Seedance 2 family (an 8-second clip from a portrait and the voice as
  // reference AUDIO, no reference video: the plain row at the resolution the
  // run sends) and MiniMax Hailuo 3 (`minimax-h3:8s`) — decided 2026-11-16, the
  // one rule the workflow run, the pipeline and both estimates share.
  const referenceAudioId = referenceAudioLipSyncCreditId(provider, body?.resolution)
  if (referenceAudioId) return referenceAudioId
  // Models priced by a length BUCKET (Kling AI Avatar, OmniHuman 1.5, HeyGen
  // Lipsync Precision, Sync Lipsync 2 Pro / v3, Volcengine): the bucket of the
  // length the measuring step measured (decided 2026-11-13) — never a length the
  // request sent. The charge is this hold, committed as it is, so a run whose
  // audio was not measured is never priced on a guess: it is refused.
  const pricing = lipSyncAudioPricingOf(provider)
  if (pricing?.kind === "bucket") {
    const held = measured?.billedSeconds
    if (held === undefined) throw new Error("lip-sync: a run priced by its audio's length reached its pricing without its measured audio")
    return lipSyncHeldCreditId(pricing, held)
  }
  return provider
}

/**
 * A retired Lip Sync model (`RETIRED_LIP_SYNC_PROVIDERS`, retired 2026-11-12)
 * is answered BEFORE the credit guard, with its own sentence: its price row is
 * kept for history, so the guard would otherwise check credits for a model
 * that no longer runs, and the schema's enum would answer with a generic
 * error. The workflow build refuses it with the same sentence
 * (`payload-builder.ts`), and the MCP `lip_sync` tool reaches this route.
 */
async function retiredLipSyncProviderPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const message = retiredLipSyncProviderMessage((req.body as Record<string, unknown> | null)?.provider)
  if (message) {
    return reply.status(400).send({ error: { code: "validation_error", message } })
  }
}

/**
 * `1440p` is LTX 2.5 Fast's alone on Lip Sync (decided 2026-11-23): the route
 * took no `1440p` before, so for any other model it is refused before the
 * credit guard (`lipSyncResolutionRefusal`, the workflow run's rule too) —
 * never moved to a tier above it. Every other value is read as before.
 */
async function lipSyncResolutionPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>
  const message = lipSyncResolutionRefusal(String(body.provider ?? LIP_SYNC_DEFAULT_PROVIDER), body.resolution)
  if (message) {
    return reply.status(400).send({ error: { code: "validation_error", message } })
  }
}

/**
 * A model that takes the voice line as reference audio and documents which
 * audio it accepts (`VIDEO_REF_AUDIO_RULES`: Seedance 2.5 Flash, WAV or MP3,
 * 2-30 s) is held to that rule with the same check the video routes and the
 * workflow run use, so a clip the provider would refuse never costs a run.
 * Runs inside the credit guard (`lipSyncPricingStep`, after its model and node
 * doors and before anything is priced or held), in every edition, and only on
 * a body the handler's own schema accepts (an invalid one is left to the
 * handler's 400). Every other model passes through unprobed.
 */
async function lipSyncReferenceAudioPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const parsed = lipSyncBody.safeParse(req.body)
  if (!parsed.success) return
  const provider = parsed.data.provider ?? LIP_SYNC_DEFAULT_PROVIDER
  const check = await probeAndCheckRefAudio({
    provider,
    referenceAudioUrls: sentReferenceAudioUrls({ provider, audioUrl: parsed.data.audioUrl, lipSync: true }),
  })
  if (!check.ok) {
    return reply.status(400).send({ error: { code: check.code, message: check.message } })
  }
}

/** Body fields named like the measure (the names the route once stashed it under): dropped from every request, never read. */
const MEASURED_AUDIO_SEC = "__lipSyncAudioSec"
const BILLED_SECONDS = "__lipSyncBilledSeconds"
/** The request measure the measuring step (`lipSyncInputPreHandler`) keeps, server-side only, for the guard's pricing and the handler. */
const MEASURE = "lipSyncAudio"
/** What the measuring step measured: the audio's decoded length and the seconds the run is held for. */
export interface LipSyncMeasure {
  readonly audioSec: number
  readonly billedSeconds: number
}

/** What the measuring step measured for this request (the server-side request's, never the body's). */
export function lipSyncMeasureOf(req: FastifyRequest): LipSyncMeasure | undefined {
  return requestMeasure<LipSyncMeasure>(req, MEASURE)
}

/**
 * The face input a request is refused without, or undefined: an image or a
 * video, and a video for Volcengine (video-to-video dubbing, no image
 * fallback). The handler asks it, and — for a model priced by a length bucket
 * — the measuring step asks it first, so such a request costs no download.
 */
function faceInputRefusal(provider: string, imageUrl: unknown, videoUrl: unknown): string | undefined {
  if (!imageUrl && !videoUrl) return "Either imageUrl or videoUrl is required"
  if (provider === "volcengine-lipsync" && !videoUrl) return "Volcengine lip sync requires a video input (videoUrl)"
  return undefined
}

/** The status a measuring refusal answers with: busy is a 429 (try again in a moment), a stopped measurement a 503 (ours), the rest the request's (400). */
function measureRefusalStatus(code: string): number {
  if (code === "lip_sync_audio_busy") return 429
  if (code === "lip_sync_audio_measure_stopped") return 503
  return 400
}


/**
 * The credit guard's `beforePricing` step (decided 2026-11-13: it runs after
 * the guard's model and node doors, the app-token scope gate and the
 * Idempotency-Key dedup, so a model the deployment withholds answers 403
 * without its audio ever being downloaded): for a model priced by the length
 * of its audio — at a per-second rate (OmniHuman 2.0) or by a length bucket
 * (Kling AI Avatar, OmniHuman 1.5, the dubbing models; `lipSyncAudioPricingOf`)
 * — validate the body (the handler's own schema — a request that would 400
 * there never costs a download), measure the audio (and a rate model's image:
 * `checkLipSyncInputs`, the rule the workflow run shares), refuse what the
 * model cannot take with a 400 before anything is held, and keep the measured
 * length and the held seconds on the server-side request (never the body) for
 * the guard's pricing and the handler. A length the request sent
 * (`audioDurationSec`) is never trusted, and the measure's old body names are
 * dropped from EVERY request first, whatever its model. Every other model passes straight through, unprobed. A request
 * waits at most `LIP_SYNC_MEASURE_SLOT_WAIT_MS` for a measuring slot, then is
 * refused with a 429 to retry.
 */
export async function lipSyncInputPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  dropClientMeasureFields(req.body, [MEASURED_AUDIO_SEC, BILLED_SECONDS])
  const body = (req.body ?? {}) as Record<string, unknown>
  const model = (body.provider ?? LIP_SYNC_DEFAULT_PROVIDER) as string
  if (isDrivingAudioLipSyncProvider(model)) return drivingAudioLipSyncStep(req, reply, model, body)
  const pricing = lipSyncAudioPricingOf(model)
  if (!pricing) return
  const parsed = lipSyncBody.safeParse(body)
  if (!parsed.success) {
    return void reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
  }
  // The cheap checks first, so a request they refuse costs no download: its face
  // input (a bucketed model; OmniHuman 2.0's own check asks for its image before
  // fetching anything), then whether the payer can afford even the cheapest run.
  if (pricing.kind === "bucket") {
    const face = faceInputRefusal(model, parsed.data.imageUrl, parsed.data.videoUrl)
    if (face) return void reply.status(400).send({ error: { code: "validation_error", message: face } })
  }
  const floor = await lipSyncFloorRefusal(req, pricing)
  if (floor) return void reply.status(floor.statusCode).send(floor.body)
  const checked = await checkLipSyncInputs({
    provider: body.provider ?? LIP_SYNC_DEFAULT_PROVIDER,
    audioUrl: body.audioUrl,
    imageUrl: body.imageUrl,
    userId: req.userId,
  })
  if (!checked) return
  if (!checked.ok) {
    return void reply.status(measureRefusalStatus(checked.code)).send({ error: { code: checked.code, message: checked.message } })
  }
  setRequestMeasure(req, MEASURE, { audioSec: checked.audioSec, billedSeconds: checked.billedSeconds } satisfies LipSyncMeasure)
  // The length the request named is gone from here on: nothing the guard runs
  // can read it, and the handler records the measured one.
  delete body.audioDurationSec
  // A model charged what its run used holds its bucket row as the most it is
  // charged: a quote says so (a no-op on a run).
  if (isLipSyncChargedAtRunCost(model)) noteWarning(req, LIP_SYNC_RUN_COST_WARNING)
}

/**
 * The measuring step of an audio-to-video model (LTX 2.5 Fast, decided
 * 2026-11-23) — Generate Video's audio-to-video measurement, the same rule
 * (`measureDrivingAudio`): the body is the handler's own schema; the portrait
 * is required (a video face input is refused: the endpoint takes an image)
 * before anything is downloaded; the payer must afford the shortest clip; the
 * voice is read (decoded length, the endpoint's formats, no video file) and a
 * voice the endpoint would not take is refused before the hold. The reading is
 * kept on the server-side request (`req.drivingAudio`) for the pricing, the
 * free-credit check (built only from it) and the queued job. The resolution is
 * the Lip Sync rule's (`drivingAudioLipSyncResolution`); the node's frame-rate
 * field belongs to other models and is not read (the run is sent at 24 fps).
 */
async function drivingAudioLipSyncStep(req: FastifyRequest, reply: FastifyReply, model: string, body: Record<string, unknown>): Promise<void> {
  const parsed = lipSyncBody.safeParse(body)
  if (!parsed.success) {
    return void reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
  }
  if (!parsed.data.imageUrl || parsed.data.videoUrl) {
    return void reply.status(400).send({
      error: { code: "lip_sync_image_required", message: `${lipSyncModelLabel(model)} makes a talking clip from a portrait image (imageUrl) and a voice line; it takes no video. Nothing was charged.` },
    })
  }
  const resolution = drivingAudioLipSyncResolution(model, parsed.data.resolution)
  const floor = await lipSyncFloorRefusal(req, { floorCreditId: drivingAudioCreditId(model, resolution, drivingAudioOf(model)?.minSec ?? 2) })
  if (floor) return void reply.status(floor.statusCode).send(floor.body)
  // The portrait must be a picture the run can use (decided 2026-11-24), read by content — after the cheap checks,
  // before the voice is read and anything is held. A quote prices nothing from the face, so it never fetches it.
  if (req.quoteOnly !== true) {
    const face = await drivingAudioFaceRefusal(model, parsed.data.imageUrl)
    if (face) return void reply.status(400).send({ error: { code: face.code, message: face.message } })
  }
  const measured = await measureDrivingAudio({ provider: model, audioUrl: parsed.data.audioUrl, resolution, userId: req.userId })
  if (!measured.ok) {
    return void reply.status(drivingAudioRefusalStatus(measured.code)).send({ error: { code: measured.code, message: measured.message } })
  }
  req.drivingAudio = measured
  req.freeVideoRequest = drivingAudioFreeVideoRequest(model, measured)
  delete body.audioDurationSec
}


/** What a quote of a model charged what its run used says about its `reserve`. */
const LIP_SYNC_RUN_COST_WARNING = {
  code: "settles_to_actual",
  message: "This is the most the run can cost: it is charged what its run used, and the difference is refunded when it finishes.",
} as const

/**
 * The credit guard's `beforePricing` step: the audio measured
 * (`lipSyncInputPreHandler`), then a voice line sent as reference audio held
 * to its model's rule (`lipSyncReferenceAudioPreHandler`) — each refusal
 * before anything is priced or held.
 */
async function lipSyncPricingStep(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  await lipSyncInputPreHandler(req, reply)
  if (reply.sent) return
  await lipSyncReferenceAudioPreHandler(req, reply)
}

/**
 * BASE credits for a per-second-rate run: the rate's row × the seconds the
 * measuring step measured (`lipSyncRateBaseCredits`, rounded up once); undefined
 * for every other model, which the guard prices from its row as before. A rate
 * model whose audio was not measured is never priced at a guess.
 */
export async function lipSyncComputeCredits(body: unknown, req: FastifyRequest): Promise<number | undefined> {
  const b = body as Record<string, unknown> | undefined
  const rate = lipSyncAudioRateOf(b?.provider ?? LIP_SYNC_DEFAULT_PROVIDER)
  if (!rate) return undefined
  const billed = lipSyncMeasureOf(req)?.billedSeconds
  if (billed === undefined) throw new Error("lip-sync: a per-second-rate run reached the credit guard without its measured audio")
  return lipSyncRateBaseCredits(rate, billed)
}

/**
 * At most this many requests a minute per caller for a model priced by its
 * audio's length (decided 2026-11-12 for OmniHuman 2.0, extended 2026-11-13 to
 * every model that measures its audio).
 */
export const LIP_SYNC_RATE_MODEL_REQUESTS_PER_MINUTE = 30

/**
 * Whether the route's rate limit lets a request through uncounted: every
 * request but one for a model that downloads and decodes its audio before
 * anything is held (`lipSyncAudioPricingOf`: OmniHuman 2.0, Kling Avatar,
 * OmniHuman 1.5, the dubbing models). A model priced by no length is never
 * limited here.
 */
export function lipSyncRateLimitSkips(req: Pick<FastifyRequest, "body">): boolean {
  const body = req.body as Record<string, unknown> | undefined
  const model = body?.provider ?? LIP_SYNC_DEFAULT_PROVIDER
  // An audio-to-video model downloads and reads its voice before the hold too: counted.
  return lipSyncAudioPricingOf(model) === undefined && !isDrivingAudioLipSyncProvider(model)
}

/**
 * The route's pricing chain, registered as its preHandlers and run by
 * `POST /v1/quote` (`ee/routes/node-quote.ts`) with the same functions: a
 * retired model's refusal, then the credit guard, whose `beforePricing` step
 * measures the audio and checks a reference voice line.
 */
export const lipSyncPricing: RoutePricing = {
  // A 4K spelling (`2160p`, `UHD`) on Seedance 2.5 is read as `4k` first (decided 2026-11-27).
  prechecks: [fourKSpellingPreHandler((b) => (typeof b.provider === "string" ? b.provider : undefined)), retiredLipSyncProviderPreHandler, lipSyncResolutionPreHandler],
  modelResolver: (req) => resolveLipSyncIdentifier(req.body as Record<string, unknown> | undefined, lipSyncMeasureOf(req), req.drivingAudio),
  opts: {
    runModel: jobRunModel("lip-sync"),
    computeCredits: lipSyncComputeCredits,
    beforePricing: lipSyncPricingStep,
  },
}

export async function lipSyncRoutes(app: FastifyInstance) {
  app.post("/v1/lip-sync", {
    // Per user / credential (`rateLimitKeyGenerator`), for the models that
    // measure their audio only (`lipSyncRateLimitSkips`). Checked at preValidation: the body
    // is parsed by then (the model is in it), and it runs before every
    // preHandler — before the audio is downloaded (in the guard).
    config: {
      rateLimit: {
        max: LIP_SYNC_RATE_MODEL_REQUESTS_PER_MINUTE,
        timeWindow: "1 minute",
        hook: "preValidation",
        allowList: (req) => lipSyncRateLimitSkips(req),
      },
    },
    preHandler: [
      ...lipSyncPricing.prechecks,
      // The audio is measured inside the guard (`beforePricing`), after its model and node doors.
      creditGuard(lipSyncPricing.modelResolver, lipSyncPricing.opts),
    ],
  }, async (req, reply) => {
    const parsed = lipSyncBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const {
      imageUrl, videoUrl, audioUrl, prompt, provider,
      guidanceScale, inferenceSteps,
      pads, smooth, fps, resizeFactor,
      enhancer, preprocess, still, poseStyle, expressionScale,
      enableDynamicDuration, disableMusicTrack, enableSpeechEnhancement,
      syncMode, temperature, activeSpeaker,
      mode, separateVocal, openScenedet, alignAudio, alignAudioReverse, templStartSeconds,
    } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // A face input is required — an image or a video, and a video for Volcengine
    // (video-to-video dubbing, routed through the KIE lipSyncVideo path).
    const face = faceInputRefusal(provider ?? LIP_SYNC_DEFAULT_PROVIDER, imageUrl, videoUrl)
    if (face) {
      return reply.status(400).send({ error: { code: "validation_error", message: face } })
    }

    // B4b: deployment prompt policy at this route's assembly point — only when
    // a prompt exists (most lip-sync providers run promptless). Mirrored into
    // parsed.data so input_data persists the policed text. No policy
    // registered = identity.
    const finalPrompt = prompt
      ? applyPromptPolicies({ prompt, negativePrompt: "", kind: "video" }).prompt
      : prompt
    parsed.data.prompt = finalPrompt

    // A model priced by its audio's length: the job records the length the
    // measuring step measured, never one the request sent, and the seconds it
    // held (the worker holds the audio it sends to them). A per-second-rate
    // model (OmniHuman 2.0) also takes none of the levers it does not take (a
    // resolution, fast mode or seed left from another model).
    // The held seconds are read off the server-side request only for such a
    // model (the measuring step sets them only for these, never on the body).
    // Every other model's job is what it was: its price reads no length.
    const resolvedModel = provider ?? LIP_SYNC_DEFAULT_PROVIDER
    const isMeasuredModel = lipSyncAudioPricingOf(resolvedModel) !== undefined
    const measure = isMeasuredModel ? lipSyncMeasureOf(req) : undefined
    const billedSeconds = measure?.billedSeconds
    if (isMeasuredModel) parsed.data.audioDurationSec = measure?.audioSec
    if (lipSyncAudioRateOf(resolvedModel) !== undefined) {
      Object.assign(parsed.data, lipSyncLeverClearPatch(provider, parsed.data))
    }
    // An audio-to-video model: the run the measuring step priced — its resolution, the voice's length, the
    // seconds held, the length sent — on the row and the queued job (`audioToVideo`, its voice as the
    // first reference audio: the runner, the worker's and the reconcile's lay-on all read that shape).
    const drivingAudio = isDrivingAudioLipSyncProvider(resolvedModel) ? req.drivingAudio : undefined
    if (drivingAudio) {
      Object.assign(parsed.data, { resolution: drivingAudio.resolution, audioDurationSec: drivingAudio.audioSec })
    }
    const drivingAudioFields = drivingAudio
      ? { audioToVideo: true, referenceAudioUrls: [audioUrl], duration: drivingAudio.sentSec, drivingAudioSec: drivingAudio.audioSec, drivingAudioBilledSec: drivingAudio.billedSec }
      : {}
    const { resolution: sentResolution, seed: sentSeed, fastMode: sentFastMode, audioDurationSec: sentAudioDurationSec } = parsed.data

    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        // The held seconds ride the row as well as the queue payload (as a
        // workflow run's do), so a job rebuilt from its row still carries them.
        input_data: withResolvedModel({
          ...buildJobInputData(parsed.data, "lip-sync"),
          ...(billedSeconds !== undefined ? { lipSyncBilledSeconds: billedSeconds } : {}),
          ...drivingAudioFields,
        }, "lip-sync"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const baseProvider = provider ?? LIP_SYNC_DEFAULT_PROVIDER
    const modelIdentifier = resolveLipSyncIdentifier(req.body as Record<string, unknown> | undefined, lipSyncMeasureOf(req), req.drivingAudio)
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await enqueueRouteJob(req, reply, job.id, () => videoQueue.add("lip-sync", {
      jobId: job.id,
      imageUrl,
      videoUrl,
      audioUrl,
      prompt: finalPrompt,
      provider: baseProvider,
      resolution: sentResolution,
      audioDurationSec: sentAudioDurationSec,
      ...(billedSeconds !== undefined ? { lipSyncBilledSeconds: billedSeconds } : {}),
      ...drivingAudioFields,
      guidanceScale, inferenceSteps, seed: sentSeed, fastMode: sentFastMode,
      pads, smooth, fps, resizeFactor,
      enhancer, preprocess, still, poseStyle, expressionScale,
      enableDynamicDuration, disableMusicTrack, enableSpeechEnhancement,
      syncMode, temperature, activeSpeaker,
      mode, separateVocal, openScenedet, alignAudio, alignAudioReverse, templStartSeconds,
      usageLogId,
    }))
    if (reply.sent) return

    return { jobId: job.id }
  })
}
