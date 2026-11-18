/**
 * POST /v1/podcast-pack — several podcast tools on one recording, one price
 * (decided 2026-11-18): every started 15 seconds of the original recording,
 * every tool chosen included (lib/use-case/pack-price.ts). Each tool runs as
 * its own ordinary run, followed by its own job; the pack paid for it, so it
 * owes no fee and its steps hold nothing (lib/covered-step.ts). A tool that
 * fails re-runs free from where it failed (its own continue route) until it
 * succeeds. A later pack, or a tool run on its own, is charged anew.
 *
 * In order: the body, every tool's own refusals (each tool's estimate, before
 * anything is charged), the recording's length, the pack's job and its
 * charge, then each tool's start. The pack's job completes once its tools
 * have started and keeps its charge; only a pack none of whose tools started
 * fails and is refunded.
 *
 * POST /v1/podcast-pack/estimate — the same refusals and the price, nothing
 * written or charged.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { hasCredits } from "../lib/config.js"
import { insertSyncJob, insertSyncJobIdempotent } from "../lib/insert-job.js"
import { KEYED_JOB_COLUMNS, keyedJobOf } from "../lib/dedup-fingerprint.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { markJobFailed } from "../lib/job-failure.js"
import { commitReservedCreditsForJob, refundReservedCreditsForJob } from "../lib/credits-job-lifecycle.js"
import { sendInternalError } from "../lib/http-errors.js"
import { unitRateBaseCredits } from "../lib/credit-base-cost.js"
import { loadChargedPrices } from "../lib/pricing/charged-prices.js"
import { IDEMPOTENCY_KEY_REUSED, adoptForwardedPayer, idempotencyKeyOf } from "../lib/use-case/lanes.js"
import { PODCAST_PACK_JOB_TYPE } from "../lib/use-case/pack-cover.js"
import { PODCAST_PACK_RATE_ID, PODCAST_PACK_TOOLS, type PodcastPackTool } from "../lib/use-case/pack-price.js"
import { packToolsChosen, packToolsReviewing, type PodcastPackBody } from "../lib/use-case/pack-body.js"
import { askTool, notePackRun, packBodyOf, packMeasureOf, packRequestOf, packReviewerPresent, startPackTool, type PackRefusal } from "../lib/use-case/pack-start.js"
import { packStanding, type PackStanding } from "../lib/use-case/pack-cover.js"
import { formatZodError } from "../lib/zod-error.js"
import { z } from "zod"
import { PREVIEW_REVIEW_REQUIRED } from "@nodaro/shared/nodes"
import { previewRefusalMessage } from "../lib/preview-refusal-copy.js"

const startToolBody = z.object({ tool: z.enum(PODCAST_PACK_TOOLS as unknown as [string, ...string[]]) })

const send = (reply: FastifyReply, refusal: PackRefusal) => reply.status(refusal.status).send({ error: refusal.error })

/** The pack's BASE price for its credit guard (marked up once there): its units of the rate; none when unmeasured (the handler refuses). */
async function packBaseCredits(_body: unknown, req: FastifyRequest): Promise<number | undefined> {
  const measured = await packMeasureOf(req)
  return measured.ok ? unitRateBaseCredits(PODCAST_PACK_RATE_ID, measured.units) : undefined
}

/** Every chosen tool's own refusals, through its estimate route: the first one refuses the pack. */
async function firstToolRefusal(app: FastifyInstance, req: FastifyRequest, body: PodcastPackBody): Promise<PackRefusal | null> {
  // A tool that stops for a review, in a run nobody can review it in: refused as its own run route
  // refuses it — here, before the pack is charged, never after.
  const reviewing = packReviewerPresent(req, body) ? undefined : packToolsReviewing(body)[0]
  if (reviewing) return { status: 409, error: { code: PREVIEW_REVIEW_REQUIRED, message: previewRefusalMessage("headless", "review"), tool: reviewing } }
  for (const type of packToolsChosen(body)) {
    const answer = await askTool(app, req, type, "estimate", body)
    if (!answer.ok) return answer
  }
  return null
}

/** Stop the tool runs a pack started (its own cancel: each run's hidden run stopped too). */
async function stopPackRuns(jobIds: readonly string[], userId: string, req: FastifyRequest): Promise<void> {
  const { cancelOwnedJob } = await import("../lib/cancel-job.js")
  for (const jobId of jobIds) {
    try {
      await cancelOwnedJob(jobId, userId)
    } catch (err) {
      req.log.error({ err, jobId }, "[podcast-pack] a tool run of a held pack could not be stopped")
    }
  }
}

export async function podcastPackRoutes(app: FastifyInstance) {
  app.post("/v1/podcast-pack/estimate", async (req, reply) => {
    const parsed = packBodyOf(req)
    if (!parsed.ok) return send(reply, parsed)
    if (!req.userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    const refusal = await firstToolRefusal(app, req, parsed.body)
    if (refusal) return send(reply, refusal)
    const measured = await packMeasureOf(req)
    if (!measured.ok) return send(reply, measured)
    const credits = hasCredits() ? ((await loadChargedPrices()).credits(PODCAST_PACK_RATE_ID, measured.units) ?? null) : 0
    return { data: { tools: packToolsChosen(parsed.body), durationSec: measured.durationSec, units: measured.units, credits } }
  })

  app.post(
    "/v1/podcast-pack",
    { preHandler: [adoptForwardedPayer, creditGuard(() => PODCAST_PACK_RATE_ID, { computeCredits: packBaseCredits })] },
    async (req, reply) => {
      const parsed = packBodyOf(req)
      if (!parsed.ok) return send(reply, parsed)
      const body = parsed.body
      const userId = req.userId
      if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
      const tools = packToolsChosen(body)

      const refusal = await firstToolRefusal(app, req, body)
      if (refusal) return send(reply, refusal)
      const measured = await packMeasureOf(req)
      if (!measured.ok) return send(reply, measured)

      const packRow = {
        user_id: userId,
        provider: PODCAST_PACK_JOB_TYPE,
        job_type: PODCAST_PACK_JOB_TYPE,
        status: "processing",
        started_at: new Date().toISOString(),
        input_data: {
          type: PODCAST_PACK_JOB_TYPE,
          tools,
          settings: body.tools,
          mediaUrls: body.mediaUrls,
          ...(body.masterAudioUrl !== undefined ? { masterAudioUrl: body.masterAudioUrl } : {}),
          // What starting a tool later reads (POST /v1/podcast-pack/:id/start): the whole recording.
          ...(body.cameras !== undefined ? { cameras: body.cameras } : {}),
          ...(body.speakerNames !== undefined ? { speakerNames: body.speakerNames } : {}),
          durationSec: measured.durationSec,
          units: measured.units,
        },
        ...(body.workflowId ? { workflow_id: body.workflowId } : {}),
        ...(body.nodeId ? { node_id: body.nodeId } : {}),
      }
      const headerKey = idempotencyKeyOf(req)
      let packId: string
      try {
        if (headerKey) {
          const dedup = await insertSyncJobIdempotent<{ id: string } & Record<string, unknown>>(req, packRow, headerKey, KEYED_JOB_COLUMNS)
          if (!dedup.created) {
            // The key is taken: only a pack answers it (the pack it started).
            if (keyedJobOf(dedup.row).provider !== PODCAST_PACK_JOB_TYPE) return reply.status(409).send({ error: IDEMPOTENCY_KEY_REUSED })
            reply.header("X-Dedup-Hit", "1")
            return reply.status(202).send({ jobId: dedup.row.id, deduped: true })
          }
          packId = dedup.row.id
        } else {
          const inserted = await insertSyncJob(req, packRow)
          if (inserted.error) return sendInternalError(reply, req, inserted.error, "Failed to start the pack")
          packId = inserted.data.id
        }
      } catch (err) {
        return sendInternalError(reply, req, err, "Failed to start the pack")
      }

      // The pack's charge, held on its job before any tool starts.
      try {
        await reserveCreditsForJob(req, reply, packId, PODCAST_PACK_RATE_ID)
      } catch (err) {
        // The pack fails, any hold the throw left behind is returned (only a reserved hold moves).
        await markJobFailed(packId, { error_message: "The pack's price could not be held", from: ["processing"], extra: { idempotency_key: null } })
        await refundReservedCreditsForJob(packId)
        return sendInternalError(reply, req, err, "Failed to start the pack")
      }
      if (reply.sent) {
        await markJobFailed(packId, { error_message: "The pack's price could not be held", from: ["processing"], extra: { idempotency_key: null } })
        return
      }

      const runs: Array<{ tool: PodcastPackTool; jobId: string; executionId: string | null }> = []
      const notStarted: Array<{ tool: PodcastPackTool; error: PackRefusal["error"] }> = []
      for (const tool of tools) {
        try {
          const answer = await startPackTool(app, req, packId, tool, body)
          const jobId = answer.ok ? answer.json.jobId : undefined
          if (answer.ok && typeof jobId === "string") {
            const executionId = answer.json.executionId
            runs.push({ tool, jobId, executionId: typeof executionId === "string" ? executionId : null })
            // The first tool started: the pack's charge is final from here (no refund once a tool runs),
            // so nothing that happens to the pack's own job later can return it while its tools run.
            if (runs.length === 1) await commitReservedCreditsForJob(packId)
          } else {
            notStarted.push({ tool, error: answer.ok ? { code: "tool_refused", message: `${tool}: no run started`, tool } : answer.error })
          }
        } catch (err) {
          req.log.error({ err, packId, tool }, "[podcast-pack] a tool failed to start")
          notStarted.push({ tool, error: { code: "internal_error", message: `${tool}: failed to start`, tool } })
        }
      }

      const { markJobCompletedDetailed } = await import("../workers/shared.js")
      if (runs.length === 0) {
        // Nothing runs: the pack fails and its charge is returned.
        if (await markJobFailed(packId, { error_message: "No tool of the pack could start", from: ["processing"], extra: { idempotency_key: null } })) {
          await refundReservedCreditsForJob(packId)
        }
        const first = notStarted[0]!
        return reply.status(first.error.code === "internal_error" ? 500 : 409).send({ error: first.error, jobId: packId })
      }
      // The tools run on their own from here: the pack keeps its charge, committed when the first one
      // started (a failed tool re-runs free). A pack left `processing` is closed by its sweep.
      const output = { tools: runs, ...(notStarted.length > 0 ? { notStarted } : {}), durationSec: measured.durationSec, units: measured.units }
      const outcome = await markJobCompletedDetailed(packId, { output_data: output, completed_at: new Date().toISOString() })
      if (outcome === "held" || outcome === "blocked") {
        // Held for review or blocked (suspected abuse): everything under the pack stops, now.
        await stopPackRuns(runs.map((r) => r.jobId), userId, req)
        return reply.status(409).send({ error: { code: "pack_under_review", message: "This pack is under review, so its tools were stopped." }, jobId: packId })
      }
      return reply.status(202).send({ jobId: packId, ...output })
    },
  )

  /**
   * POST /v1/podcast-pack/:id/start — start, free, a tool the pack paid for that did not start
   * (decided 2026-11-18): once per tool (it is refused once the tool has a run in the pack; a run
   * that failed re-runs through its own continue). Only a pack done starting its tools, never one
   * held for review.
   */
  app.post<{ Params: { id: string } }>("/v1/podcast-pack/:id/start", async (req, reply) => {
    const userId = req.userId
    if (!userId) return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    const parsedTool = startToolBody.safeParse(req.body)
    if (!parsedTool.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsedTool.error) } })
    const tool = parsedTool.data.tool as PodcastPackTool
    const packId = req.params.id
    let pack: PackStanding
    try {
      pack = await packStanding(packId, userId, tool)
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to read the pack")
    }
    if (pack.kind === "held") return reply.status(409).send({ error: { code: "pack_under_review", message: "This pack is under review, so nothing can run under it for now." } })
    if (pack.kind === "none") return reply.status(404).send({ error: { code: "not_found", message: "No pack of yours names this tool." } })
    if (pack.status !== "completed") return reply.status(409).send({ error: { code: "pack_starting", message: "The pack is still starting its tools; try again in a moment." } })
    const stored = await packRequestOf(packId, userId)
    if (!stored) return reply.status(404).send({ error: { code: "not_found", message: "No pack of yours names this tool." } })
    const answer = await startPackTool(app, req, packId, tool, stored)
    if (!answer.ok) return send(reply, answer)
    const jobId = answer.json.jobId
    const executionId = typeof answer.json.executionId === "string" ? answer.json.executionId : null
    if (typeof jobId === "string") await notePackRun(packId, userId, { tool, jobId, executionId })
    return reply.status(202).send({ jobId, executionId, tool })
  })
}
