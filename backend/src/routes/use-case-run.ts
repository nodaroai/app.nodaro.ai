/**
 * The use-case runs (podcast use-case nodes, decided 2026-10-13): one call
 * per registered type that runs the shipped chain of nodes its descriptor
 * builds, as a hidden execution — Tighten Episode first. Core (every edition);
 * a self-host relays the cloud steps when connected. Each type gets its own
 * run route and estimate (its descriptor's `route`); no route names a type.
 *
 * Every refusal happens before any row or credit hold. The wrapper job is the
 * unit a client retries (idempotency-key) and the thing it polls; its fee
 * (its `use-case-fee:<type>` row, at the charged price) is held here and committed or refunded by
 * finalizeUseCaseWrapper when the inner run ends.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import {
  USE_CASE_NODE_TYPES,
  initialRunNodeIds,
  toStoredInlineGraph,
  usecaseDescriptor,
  usecaseDistinctMaster,
  usecaseFeeCreditId,
  usecaseFramingForViewer,
  usecaseFramingIsAuto,
  type UseCaseMediaSource,
  type UseCaseNodeType,
} from "@nodaro/render-rules"
import { PREVIEW_REVIEW_REQUIRED } from "@nodaro/shared/nodes"
import { previewRefusalMessage } from "../lib/preview-refusal-copy.js"
import { hasCredits } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { insertJob, insertJobIdempotent } from "../lib/insert-job.js"
import { KEYED_JOB_COLUMNS, keyedJobOf } from "../lib/dedup-fingerprint.js"
import { creditGuard, reserveCreditsForJob, resolveWebSurfaceFlag } from "../middleware/credit-guard.js"
import { isNodeDeniedForUser } from "../lib/availability-viewer.js"
import { deniedNodeRejectionMessage } from "../lib/surface-deny.js"
import { ensureInlineGraphColumns } from "../lib/execution-inline-graph.js"
import { markJobFailed } from "../lib/job-failure.js"
import { refundReservedCreditsForJob } from "../lib/credits-job-lifecycle.js"
import { sendInternalError } from "../lib/http-errors.js"
import { formatZodError } from "../lib/zod-error.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { usecasePreflight } from "../lib/use-case/preflight.js"
import { USE_CASE_BODIES, type UseCaseBody } from "../lib/use-case/bodies.js"
import {
  IDEMPOTENCY_KEY_REUSED,
  USE_CASE_MAX_DEPTH,
  adoptForwardedPayer,
  idempotencyKeyOf,
  isInternalLane as isInternal,
  usecaseKeyedRetry,
  usecaseKeyedRunIsOwn,
  usecaseUnavailable,
} from "../lib/use-case/lanes.js"
import { prepareUseCase, usecaseReviewerPresent, usecaseWholeClipUrl, type PreparedUseCase, type PrepareUseCaseOptions } from "../lib/use-case/request.js"
import { measureClip, peekClip } from "../lib/clip-measure.js"
import { clipMeasureStartLimiter } from "../lib/clip-measure-limit.js"
import { usecaseClockSec, usecaseSourcesOf, usecaseWrapperRecordings } from "../lib/use-case/sources.js"
import { usecaseFramesAvailable, usecaseInnerDenial, usecaseMulticamDenial } from "../lib/use-case/inner-availability.js"
import { executeInlineGraph, InlineGraphUnavailableError } from "../services/use-case-execution.js"
import { replyIfLlmUnpriced } from "../lib/llm-unpriced-refusal.js"

/**
 * The per-user limit on starting a measurement of a recording (decided
 * 2026-10-20): the SAME counter `POST /v1/media/clip-length` and `POST
 * /v1/speaker-view` draw on, so the doors share one allowance.
 */
const measureStartLimit = clipMeasureStartLimiter()

/** An estimate reads the cache only: it never downloads a recording. */
const ESTIMATE_MEASURE: PrepareUseCaseOptions = { measureWholeClip: (url) => peekClip(url).catch(() => null) }
/** A run measures as its dispatch does (`measureClip(url)`, no options): the same cache key, so the dispatch reuses it. */
const RUN_MEASURE: PrepareUseCaseOptions = { measureWholeClip: (url) => measureClip(url) }

type Ready = { readonly userId: string; readonly body: UseCaseBody; readonly prep: Extract<PreparedUseCase, { ok: true }> }

/**
 * The refusals both of a type's routes share, in order: body, identity, deny,
 * nesting depth, the snapshot columns, (the run route) a review-on run nobody
 * can review, the connection, (the run route) the measurement start limit,
 * then the recording itself. Sends the answer and
 * returns null; nothing is written either way.
 */
async function prepared(type: UseCaseNodeType, req: FastifyRequest, reply: FastifyReply, opts: { readonly run: boolean }): Promise<Ready | null> {
  const d = usecaseDescriptor(type)
  const parsed = USE_CASE_BODIES[type].safeParse(req.body)
  if (!parsed.success) {
    reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    return null
  }
  const userId = req.userId
  if (!userId) {
    reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    return null
  }
  if (await isNodeDeniedForUser(type, userId)) {
    reply.status(403).send({ error: { code: "node_not_available", message: deniedNodeRejectionMessage([type]) } })
    return null
  }
  // An `auto` framing source — sent, or absent on a type whose absent default is `auto` — follows
  // faces only for a caller who may use Speaker Frames; for anyone else it is the even split,
  // silently (decided 2026-10-20). An explicit `tracking` is kept: the inner-step check below
  // refuses it for such a caller. Availability is read only for a body that chooses `auto`.
  const sent = parsed.data as UseCaseBody
  const body = usecaseFramingIsAuto(sent, d) ? usecaseFramingForViewer(sent, await usecaseFramesAvailable(userId), d) : sent
  // Several recordings or a Master audio asked for by a caller who may not use Speaker Map: refused before anything is probed.
  const multicamDenied = await usecaseMulticamDenial(type, body, userId)
  if (multicamDenied) {
    reply.status(multicamDenied.status).send({ error: { code: multicamDenied.code, message: multicamDenied.message } })
    return null
  }
  const internal = isInternal(req)
  if (internal && (body.componentDepth ?? 0) >= USE_CASE_MAX_DEPTH) {
    reply.status(400).send({ error: { code: "nesting_too_deep", message: `Nodes inside components can nest ${USE_CASE_MAX_DEPTH} levels deep.` } })
    return null
  }
  if (!(await ensureInlineGraphColumns())) {
    reply.status(503).send({ error: usecaseUnavailable(type) })
    return null
  }
  // A review-on run inside another run with nobody to review would hold a
  // preview no one sees — refused as the preview stop rule refuses it.
  if (opts.run && internal && body.reviewBeforeRender === true && body.reviewerPresent !== true) {
    reply.status(409).send({ error: { code: PREVIEW_REVIEW_REQUIRED, message: previewRefusalMessage("headless", "review") } })
    return null
  }
  // Connection and keyless refusal BEFORE the recording is probed, so an
  // install that will refuse never fetches the user's media. Without the probe
  // the recording's kind is unknown, so this asks the graph of a VIDEO
  // recording — the superset: an audio episode's graph has no step it lacks,
  // but a framed request's Speaker View is asked even when the recording turns
  // out to be audio (where the run would drop it), so an unconnected self-host
  // may refuse such a request that would have run. Its sources are built as
  // the run builds them (usecaseSourcesOf), from the unprobed inputs.
  const masterAudioUrl = usecaseDistinctMaster(body.masterAudioUrl, body.mediaUrls)
  const { sources: unprobed, shape } = usecaseSourcesOf({
    recordings: body.mediaUrls.map((url) => ({ url, kind: "video" as const })) as [UseCaseMediaSource, ...UseCaseMediaSource[]],
    ...(masterAudioUrl ? { masterAudio: { url: masterAudioUrl, kind: "audio" as const } } : {}),
    ...(body.musicUrl ? { musicUrl: body.musicUrl } : {}),
    ...(body.introCardUrl ? { introCard: { url: body.introCardUrl } } : {}),
  })
  const implied = d.build(d.resolveSettings(body, "video", shape), unprobed)
  const refusal = await usecasePreflight(implied)
  if (refusal) {
    reply.status(refusal.status).send({ error: { code: refusal.code, message: refusal.message } })
    return null
  }
  // A run that will measure its one recording (a whole-clip render): a start costs a download, so it is
  // limited per user — 429 before any probe, row or hold. An address already measured costs nothing.
  // An estimate never measures (it reads the cache only), so it is never limited.
  const wholeClipUrl = opts.run ? usecaseWholeClipUrl(type, body) : null
  if (wholeClipUrl !== null && !(await peekClip(wholeClipUrl).catch(() => null))) {
    await measureStartLimit(req, reply)
    if (reply.sent) return null
  }
  const prep = await prepareUseCase(type, body, opts.run ? RUN_MEASURE : ESTIMATE_MEASURE)
  if (!prep.ok) {
    reply.status(prep.status).send({ error: { code: prep.code, message: prep.message } })
    return null
  }
  // A step of the chain this caller may not run (Speaker Map, on several cameras) refuses the run and its estimate alike.
  const denial = await usecaseInnerDenial(type, prep.graph.nodes, userId)
  if (denial) {
    reply.status(denial.status).send({ error: { code: denial.code, message: denial.message } })
    return null
  }
  return { userId, body, prep }
}

function registerUseCase(app: FastifyInstance, type: UseCaseNodeType): void {
  const d = usecaseDescriptor(type)
  const FEE_ID = usecaseFeeCreditId(type)

  app.post(`${d.route}/estimate`, async (req, reply) => {
    const p = await prepared(type, req, reply, { run: false })
    if (!p) return
    const durationSec = usecaseClockSec(p.prep.sources) ?? null
    if (!hasCredits()) return { data: { totalCredits: 0, stepsCredits: 0, feeCredits: 0, durationSec } }
    const { estimateUseCaseCredits } = await import("../ee/billing/use-case-estimate.js")
    try {
      return { data: { ...(await estimateUseCaseCredits(p.prep.graph)), durationSec } }
    } catch (err) {
      // A metered LLM step whose model has no price (R49): refused, as its run would be.
      if (await replyIfLlmUnpriced(reply, err)) return reply
      throw err
    }
  })

  app.post(d.route, { preHandler: [adoptForwardedPayer, usecaseKeyedRetry(type), creditGuard(() => FEE_ID)] }, async (req, reply) => {
    const p = await prepared(type, req, reply, { run: true })
    if (!p) return
    const { userId, body, prep } = p
    const internal = isInternal(req)
    const billingContext = req.billingContext

    // The run's spend surface: the balance check, the fee hold and every step
    // of the hidden run reserve under it (false off-credits).
    const webFreeMode = req.webFreeMode === true || (await resolveWebSurfaceFlag(req))
    // The balance must cover the whole run, not just the fee. The quote and
    // the hold are one function: the fee held is the fee quoted.
    let feeCredits = 0
    if (hasCredits()) {
      const { estimateUseCaseCredits } = await import("../ee/billing/use-case-estimate.js")
      const { CreditsService, DEPLOYMENT_OUT_OF_CREDITS } = await import("../ee/billing/credits.js")
      let estimate: Awaited<ReturnType<typeof estimateUseCaseCredits>>
      try {
        estimate = await estimateUseCaseCredits(prep.graph)
      } catch (err) {
        if (await replyIfLlmUnpriced(reply, err)) return reply
        throw err
      }
      feeCredits = estimate.feeCredits
      const cover = await CreditsService.checkBalanceCovers(userId, estimate.totalCredits, billingContext, webFreeMode)
      if (!cover.ok) {
        // A deployment's pool is the operator's: its balance is not the
        // requester's to see, and only the operator can top it up. Every
        // use-case node works on an episode, so one sentence serves them all.
        const message = billingContext?.payer === "deployment"
          ? DEPLOYMENT_OUT_OF_CREDITS
          : `This episode is estimated at about ${estimate.totalCredits} credits; your balance is ${cover.balance}.`
        return reply.status(402).send({ error: { code: "insufficient_credits", message } })
      }
      req.creditReservation = { usageLogId: "", creditsReserved: 0, watermark: false, ...req.creditReservation, creditOverride: feeCredits }
    }

    const mcpClient = extractMcpClient(req.body)
    const inputData = {
      type,
      mode: "run",
      settings: prep.settings,
      mediaUrl: prep.sources.media.url,
      ...(prep.sources.music ? { musicUrl: prep.sources.music.url } : {}),
      ...(prep.sources.introCard ? { introCardUrl: prep.sources.introCard.url } : {}),
      // Several recordings or a Master audio: every recording, the master and the run's kind (a continuation's resume match reads them).
      ...usecaseWrapperRecordings(prep.sources),
      durationSec: usecaseClockSec(prep.sources) ?? null,
      _feeCredits: feeCredits,
    }
    // Never `workflow_execution_id`: the wrapper reaches its run only through
    // `input_data._executionId` (and the run's own pointer back), so job
    // listings never fold it in with the inner jobs or an outer run's.
    const wrapperRow = {
      user_id: userId,
      provider: "use-case",
      job_type: type,
      status: "processing",
      started_at: new Date().toISOString(),
      input_data: inputData,
      ...(body.workflowId ? { workflow_id: body.workflowId } : {}),
      ...(body.nodeId ? { node_id: body.nodeId } : {}),
    }
    const headerKey = idempotencyKeyOf(req)
    let wrapperId: string
    try {
      if (headerKey) {
        const dedup = await insertJobIdempotent<{ id: string } & Record<string, unknown>>(req, wrapperRow, headerKey, KEYED_JOB_COLUMNS)
        if (!dedup.created) {
          // The key is taken (another request won the race to it): only a run
          // of this type answers; any other job under it refuses the request.
          if (!usecaseKeyedRunIsOwn(keyedJobOf(dedup.row), type)) {
            return reply.status(409).send({ error: IDEMPOTENCY_KEY_REUSED })
          }
          reply.header("X-Dedup-Hit", "1")
          return reply.status(202).send({ jobId: dedup.row.id, deduped: true })
        }
        wrapperId = dedup.row.id
      } else {
        const inserted = await insertJob(req, wrapperRow)
        if (inserted.error) return sendInternalError(reply, req, inserted.error, `Failed to start ${d.label}`)
        wrapperId = inserted.data.id
      }
    } catch (err) {
      return sendInternalError(reply, req, err, `Failed to start ${d.label}`)
    }

    await reserveCreditsForJob(req, reply, wrapperId, FEE_ID)
    if (reply.sent) {
      // The hold was refused (its own reply says why). A refused hold has
      // already removed the row; this only covers one that kept it.
      await markJobFailed(wrapperId, { error_message: "The run's fee could not be held", from: ["processing"] })
      return
    }

    // Review on: only the chain up to the proxy render runs now; what follows
    // it runs once, in Render final.
    const firstRun = initialRunNodeIds(prep.graph)
    let executionId: string
    try {
      const started = await executeInlineGraph({
        userId,
        graph: toStoredInlineGraph(prep.graph, prep.settings),
        wrapperJobId: wrapperId,
        billingContext,
        componentDepth: internal ? (body.componentDepth ?? 0) : 0,
        executingComponentIds: internal ? (body.executingComponentIds ?? []) : [],
        reviewerPresent: usecaseReviewerPresent(prep.settings, { internal, forwarded: body.reviewerPresent }),
        ...(internal && body.previewStopRule !== undefined ? { previewStopRule: body.previewStopRule } : {}),
        ...(firstRun ? { nodeIds: firstRun } : {}),
        idempotencyKey: `uc-exec-${wrapperId}`,
        mcpClient,
        // The run's steps reserve under the rules its balance check and fee hold used.
        webFreeMode,
        appRun: req.isAppRun === true,
      })
      executionId = started.executionId
    } catch (err) {
      // Only a run that never started unwinds the wrapper and its fee.
      if (await markJobFailed(wrapperId, { error_message: "The run could not start", from: ["processing"] })) {
        await refundReservedCreditsForJob(wrapperId)
      }
      if (err instanceof InlineGraphUnavailableError) return reply.status(503).send({ error: usecaseUnavailable(type) })
      return sendInternalError(reply, req, err, `Failed to start ${d.label}`)
    }

    // The run is live from here: a stamp that fails (or throws) never fails
    // the wrapper or refunds its fee — the sweep finds an unstamped wrapper's
    // run by the run's own pointer.
    try {
      const { error } = await supabase
        .from("jobs")
        .update({ input_data: { ...inputData, _executionId: executionId } })
        .eq("id", wrapperId)
        .eq("user_id", userId)
      if (error) console.warn(`[use-case-run] wrapper ${wrapperId} not stamped with run ${executionId}: ${error.message}`)
    } catch (err) {
      console.warn(`[use-case-run] wrapper ${wrapperId} not stamped with run ${executionId}: ${(err as Error).message}`)
    }
    return reply.status(202).send({ jobId: wrapperId, executionId })
  })
}

/** One run route and one estimate per registered use-case type. */
export async function usecaseRunRoutes(app: FastifyInstance) {
  for (const type of USE_CASE_NODE_TYPES) registerUseCase(app, type)
}
