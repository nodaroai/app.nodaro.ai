// backend/src/routes/video-sfx.ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { probeVideoSource } from "../providers/video/ffmpeg-utils.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { videoQueue } from "../lib/queue.js"
import { supabase } from "../lib/supabase.js"
import { hasCredits } from "../lib/config.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { formatZodError } from "../lib/zod-error.js"

const SEED_MAX = 2 ** 31 - 1

export const VideoSfxBody = z.object({
  // safeUrlSchema (not z.string().url()): rejects literal private/reserved IPs
  // and non-http(s) at the boundary. The DNS-rebinding case is closed at the
  // ffprobe sink by assertSafeProbeSource in ffmpeg-utils.ts.
  videoUrl: safeUrlSchema,
  prompt: z.string().max(2000).optional(),
  negativePrompt: z.string().max(500).optional().default("music"),
  cfgStrength: z.number().min(1).max(10).optional().default(4.5),
  numSteps: z.number().int().min(10).max(50).optional().default(25),
  seed: z.number().int().optional(),
  versions: z.number().int().min(1).max(4).optional().default(1),
})
export type VideoSfxBody = z.infer<typeof VideoSfxBody>

const BUCKETS: ReadonlyArray<{ upTo: number; base: number; key: string }> = [
  { upTo: 8,   base: 1,  key: "replicate-mmaudio:8s" },
  { upTo: 15,  base: 1,  key: "replicate-mmaudio:15s" },
  { upTo: 30,  base: 2,  key: "replicate-mmaudio:30s" },
  { upTo: 60,  base: 3,  key: "replicate-mmaudio:60s" },
  { upTo: 120, base: 5,  key: "replicate-mmaudio:120s" },
  { upTo: 300, base: 11, key: "replicate-mmaudio:300s" },
]

/** Returns BASE credits (pre-markup). creditGuard applies cost_markup_percent. */
export function bucketBaseCreditsFor(durationSeconds: number): number {
  const b = BUCKETS.find((b) => durationSeconds <= b.upTo)
  return b?.base ?? 11  // ceiling at :300s; route should reject > 300 before reaching here
}

export function bucketKeyFor(durationSeconds: number): string {
  const b = BUCKETS.find((b) => durationSeconds <= b.upTo)
  return b?.key ?? "replicate-mmaudio:300s"
}

/**
 * Fastify preHandler: ffprobes the input video, validates duration (0 < d <= 300),
 * stashes ceil(duration) on req.probedDuration AND mirrors it on req.body.__probedDuration
 * so creditGuard.computeCredits (which only sees the parsed body) can pick a bucket
 * without re-probing. Falls back to 8s on ffprobe failure (logs warning).
 */
export async function probeDurationPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = req.body as VideoSfxBody
  let duration: number
  try {
    const probe = await probeVideoSource(body.videoUrl)
    duration = probe.durationSeconds
  } catch (err) {
    req.log.warn({ err }, "video-sfx: ffprobe failed; falling back to 8s bucket")
    duration = 8
  }
  if (duration <= 0) {
    return void reply.code(400).send({
      error: "invalid_video_duration",
      message: "Video has no detectable duration. The file may be corrupted or an unsupported format.",
    })
  }
  if (duration > 300) {
    return void reply.code(400).send({
      error: "video_duration_exceeds_limit",
      message: `Video is ${Math.ceil(duration)} seconds. Maximum duration is 300 seconds (5 minutes) for SFX generation.`,
    })
  }
  const ceiled = Math.ceil(duration)
  req.probedDuration = ceiled
  ;(req.body as Record<string, unknown>).__probedDuration = ceiled
}

export default async function videoSfxRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/video-sfx", {
    preHandler: [
      probeDurationPreHandler,
      // Multi-version batch: credits scale linearly with `versions` (1-4).
      // Without `× versions` the preHandler would greenlight users who can
      // afford ONE generation when versions=4 — then Phase 2A would partially
      // reserve, fail mid-batch, and roll back. Checking the batch up front
      // is cheaper UX. Mirrors generate-object / generate-character /
      // generate-location. computeCredits returns BASE; markup is applied
      // inside creditGuardImpl so checkCredits + reserveCredits agree on
      // the final number.
      creditGuard(
        () => "replicate-mmaudio",
        {
          computeCredits: async (parsedBody) => {
            const body = parsedBody as Record<string, unknown>
            const probed = body.__probedDuration
            const duration = typeof probed === "number" ? probed : 8
            const versionsRaw = body.versions
            const versions = typeof versionsRaw === "number" && versionsRaw >= 1 ? versionsRaw : 1
            return bucketBaseCreditsFor(duration) * versions
          },
        },
      ),
    ],
  }, async (req, reply) => {
    // Manual Zod parse — preHandler ran first against raw body (it only reads videoUrl).
    // Strip the preHandler-stashed __probedDuration before parsing so it doesn't leak through.
    const rawBody = (req.body ?? {}) as Record<string, unknown>
    const { __probedDuration: _stashed, ...toParse } = rawBody
    const parsed = VideoSfxBody.safeParse(toParse)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }
    const body = parsed.data
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const duration = req.probedDuration ?? 8
    const versions = body.versions
    const bucketKey = bucketKeyFor(duration)

    const mcpClient = extractMcpClient(req.body)
    const workflowId = extractWorkflowId(req.body)
    const forcePrivate = extractForcePrivate(req.body) || undefined

    // ──────────────────────────────────────────────────────────────────────
    // Per-row credit override.
    //
    // creditGuardImpl set `req.creditReservation.creditOverride` to the
    // BATCH total (bucketBase × versions × markup) so the upfront affordance
    // check above is correct. But reserveCreditsForJobImpl reads the SAME
    // `req.creditReservation.creditOverride` for EVERY per-row reservation
    // call — without correction, each of N rows would be deducted the batch
    // total (N² over-charge). Recompute the per-job base (still pre-markup;
    // creditGuardImpl applied markup once into the BATCH number, which we
    // ignore — instead we set the per-job BASE here and let the RPC apply
    // its own per-row markup via the override path).
    //
    // ⚠️ Subtlety: the override is consumed by `reserveCredits` as the
    // final p_credits value (post-markup), NOT as a pre-markup BASE. So
    // mirror what creditGuardImpl computed: apply the SAME markup formula
    // to the per-job base. We re-fetch app settings via the dynamic ee
    // import path keep this file ee-import-free. (hasCredits() guard.)
    //
    // generate-object / generate-character / generate-location currently
    // DO NOT do this correction and over-charge multi-candidate batches
    // (pre-existing issue, separate fix). Filed in code review for
    // follow-up.
    // ──────────────────────────────────────────────────────────────────────
    let perJobCreditOverride: number | undefined
    if (hasCredits() && req.creditReservation) {
      const baseCredits = bucketBaseCreditsFor(duration)
      const { getAppSettings } = await import("../lib/app-settings.js")
      const settings = await getAppSettings()
      perJobCreditOverride =
        settings.cost_markup_percent > 0 && baseCredits > 0
          ? Math.ceil(baseCredits * (1 + settings.cost_markup_percent / 100))
          : baseCredits
    }

    // ──────────────────────────────────────────────────────────────────────
    // Phase 1: Insert N pending jobs.
    //
    // Each row carries its own seed (sequential when user-supplied, -1
    // otherwise) + per-iteration index so the worker can identify which
    // version of the batch it is. On mid-batch insert failure: delete any
    // rows already inserted (no credits reserved yet so no refund needed).
    // ──────────────────────────────────────────────────────────────────────
    const inserted: Array<{ jobId: string; inputData: Record<string, unknown> }> = []
    for (let i = 0; i < versions; i++) {
      const seedForVersion = (body.seed !== undefined && body.seed >= 0)
        ? (body.seed + i) % SEED_MAX
        : -1
      const inputData: Record<string, unknown> = {
        type: "video-sfx",
        videoUrl: body.videoUrl,
        prompt: body.prompt,
        negativePrompt: body.negativePrompt,
        cfgStrength: body.cfgStrength,
        numSteps: body.numSteps,
        seed: seedForVersion,
        duration_seconds: duration,
        bucketKey,
        iterationIndex: i,
        iterationTotal: versions,
      }
      const { data: job, error } = await supabase
        .from("jobs")
        .insert({
          user_id: userId,
          status: "pending",
          input_data: inputData,
          ...(workflowId ? { workflow_id: workflowId } : {}),
          ...(forcePrivate !== undefined ? { force_private: forcePrivate } : {}),
          ...(mcpClient ? { mcp_client: mcpClient } : {}),
        })
        .select("id")
        .single()
      if (error || !job) {
        if (inserted.length > 0) {
          const orphanIds = inserted.map((r) => r.jobId)
          try {
            await supabase.from("jobs").delete().in("id", orphanIds)
          } catch (cleanupErr) {
            req.log.warn(
              { err: cleanupErr, orphanJobIds: orphanIds },
              "[video-sfx] failed to delete orphan jobs after mid-batch insert failure",
            )
          }
        }
        return reply.status(500).send({
          error: { code: "internal_error", message: error?.message ?? "Failed to create job" },
        })
      }
      inserted.push({ jobId: job.id, inputData })
    }

    // ──────────────────────────────────────────────────────────────────────
    // Phase 2A: Reserve credits for every job BEFORE enqueueing any.
    //
    // The preHandler already gated the full batch cost (computeCredits
    // multiplies by `versions`), so mid-batch reservation failure is
    // unlikely — but not impossible. When it happens we roll back:
    //   - refund any reservations that succeeded (jobs 0..K-1)
    //   - delete the orphan `pending` rows that never got a reservation
    //     (jobs K+1..N-1; job K itself was already deleted by
    //     reserveCreditsForJobImpl on its failure path)
    //
    // Per-row creditOverride correction (see comment above the perJob
    // calculation): mutate `req.creditReservation.creditOverride` to the
    // per-job number before each call so reserveCreditsForJobImpl deducts
    // per-job, not per-batch.
    // ──────────────────────────────────────────────────────────────────────
    type ReservationRecord = { jobId: string; usageLogId?: string }
    const reservations: ReservationRecord[] = []
    for (const { jobId } of inserted) {
      if (req.creditReservation && perJobCreditOverride !== undefined) {
        req.creditReservation.creditOverride = perJobCreditOverride
      }
      const reservation = await reserveCreditsForJob(req, reply, jobId, "replicate-mmaudio")
      if (reply.sent) {
        // Refund reservations that succeeded earlier in this batch.
        if (reservations.length > 0 && hasCredits()) {
          try {
            const { CreditsService } = await import("../ee/services/credits.js")
            for (const r of reservations) {
              if (!r.usageLogId) continue
              try {
                await CreditsService.refundCredits(r.usageLogId)
              } catch (refundErr) {
                req.log.warn(
                  { err: refundErr, jobId: r.jobId, usageLogId: r.usageLogId },
                  "[video-sfx] refund failed during batch rollback",
                )
              }
            }
          } catch (importErr) {
            req.log.warn(
              { err: importErr },
              "[video-sfx] failed to load CreditsService for rollback refund",
            )
          }
        }
        // Delete jobs that were inserted but never reserved (orphans).
        // Job K itself was already deleted by reserveCreditsForJobImpl,
        // so exclude any id that appears in `reservations` AND the failing id.
        const reservedIds = new Set(reservations.map((r) => r.jobId))
        const orphanIds = inserted
          .map((r) => r.jobId)
          .filter((id) => !reservedIds.has(id) && id !== jobId)
        if (orphanIds.length > 0) {
          try {
            await supabase.from("jobs").delete().in("id", orphanIds)
          } catch (deleteErr) {
            req.log.warn(
              { err: deleteErr, orphanJobIds: orphanIds },
              "[video-sfx] failed to delete orphan jobs during batch rollback",
            )
          }
        }
        return
      }
      reservations.push({ jobId, usageLogId: reservation?.usageLogId })
    }

    // ──────────────────────────────────────────────────────────────────────
    // Phase 2B: All reservations succeeded — enqueue every job.
    //
    // Worker reads canonical fields (videoUrl, prompt, etc.) from the
    // jobs row's input_data (single source of truth), but we still pass
    // them in the BullMQ payload for parity with the rest of the worker
    // pipeline and to avoid a second DB read on hot path.
    // ──────────────────────────────────────────────────────────────────────
    for (const r of reservations) {
      const entry = inserted.find((e) => e.jobId === r.jobId)
      if (!entry) continue  // unreachable; satisfies TS
      const { inputData } = entry
      await videoQueue.add("video-sfx", {
        jobId: r.jobId,
        userId,
        model: "replicate-mmaudio",
        videoUrl: inputData.videoUrl,
        prompt: inputData.prompt,
        negativePrompt: inputData.negativePrompt,
        cfgStrength: inputData.cfgStrength,
        numSteps: inputData.numSteps,
        seed: inputData.seed,
        duration_seconds: inputData.duration_seconds,
        bucketKey: inputData.bucketKey,
        iterationIndex: inputData.iterationIndex,
        iterationTotal: inputData.iterationTotal,
        usageLogId: r.usageLogId,
      })
    }

    // Backward-compat response shape: versions=1 returns the legacy
    // `{ jobId }`, versions>1 returns `{ jobIds }`. Matches
    // generate-object's response contract.
    return versions === 1
      ? { jobId: reservations[0]?.jobId }
      : { jobIds: reservations.map((r) => r.jobId) }
  })
}
