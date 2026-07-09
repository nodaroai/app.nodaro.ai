import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { resolveEntityImageCreditIdentifier } from "../lib/entity-credit-identifier.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { buildLocationPrompt, buildLocationRefinePrompt } from "@nodaro/prompts"
import { formatZodError } from "../lib/zod-error.js"
import { hasCredits } from "../lib/config.js"
import { sendInternalError } from "../lib/http-errors.js"

const generateLocationBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  userPrompt: z.string().max(8000).optional(),
  category: z.enum(["indoor", "outdoor", "urban", "nature", "fantasy", "sci-fi", "historical", "futuristic", "other"]).optional(),
  // Free-text style (matches the entity save route + DB; a narrow enum would 400 inherited styles like "cinematic").
  style: z.string().max(50).optional(),
  sourceImageUrl: safeUrlSchema.optional(),
  provider: z.string().optional().default("nano-banana"),
  // Credit-affecting output levers (mirrors generate-image). The enums are
  // PERMISSIVE on purpose — a value the chosen model doesn't support is
  // ignored by the per-provider param routing / worker fail-safe, never 400d.
  resolution: z.enum(["1K", "2K", "4K", "0.5 MP", "1 MP", "2 MP", "4 MP"]).optional(),
  quality: z.enum(["medium", "high", "basic"]).optional(),
  userId: z.string().uuid().optional(),
  // Multi-candidate generation. `1` keeps the legacy single-job behavior and
  // response shape `{ jobId }`. `2`–`10` insert N jobs in parallel and return
  // `{ jobIds: string[] }`. Tasks 11+ wire the studio UI to render candidate
  // grids and prompt the user to pick a winner via
  // `POST /v1/locations/:id/approve-main-image`.
  count: z.number().int().min(1).max(10).optional().default(1),
  // Location Studio auto-attach: when set, the worker writes the resulting
  // image URL to `locations.main_image_url` on this row after generation
  // succeeds. Lets the studio survive page closes mid-generation.
  //
  // ⚠️ Only propagated to the job payload when `count === 1`. Multi-candidate
  // batches MUST go through explicit approval (`approve-main-image`) so the
  // user picks the winner — auto-attaching one of N candidates would leak a
  // random pick into the studio.
  attachToLocationId: z.string().uuid().optional(),
})

/**
 * Extract `count` from a raw request body for the credit pre-check.
 * The Zod schema isn't parsed yet at preHandler time, so we defensively
 * coerce and clamp to the allowed [1, 10] range. Invalid values fall back
 * to 1 so the pre-check never under-charges; the route's Zod validation
 * still 400s on bad input downstream.
 */
function extractCount(body: unknown): number {
  const raw = (body as { count?: unknown })?.count
  if (typeof raw !== "number" || !Number.isInteger(raw)) return 1
  if (raw < 1) return 1
  if (raw > 10) return 10
  return raw
}

export async function generateLocationRoutes(app: FastifyInstance) {
  app.post(
    "/v1/generate-location",
    {
      // Multi-candidate batch: credits scale linearly with `count` (1–10).
      // Mirrors the generate-character pattern — without this, the preHandler
      // greenlights users who can afford ONE job even when count=10. computeCredits
      // returns BASE (pre-markup) credits; markup is applied inside creditGuardImpl
      // so the same final number is both checked AND reserved.
      // The identifier is quality/resolution-aware (composite ids like
      // "gpt-image:high") via the shared resolver — the SAME function the
      // handler's DEBIT uses, so the advisory CHECK can never price a
      // different tier than the reservation.
      preHandler: creditGuard((req: FastifyRequest) => resolveEntityImageCreditIdentifier(req.body), {
        computeCredits: async (body) => {
          const count = extractCount(body)
          const identifier = resolveEntityImageCreditIdentifier(body)
          // Dynamic import: getModelCreditBaseCost lives in ee/ and we keep
          // core free of static ee/ imports. Only reached in cloud edition
          // (creditGuard short-circuits to a no-op otherwise).
          const { getModelCreditBaseCost } = await import("../ee/billing/credits.js")
          const pricing = await getModelCreditBaseCost(identifier)
          return pricing.creditCost * count
        },
      }),
    },
    async (req, reply) => {
      const parsed = generateLocationBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { name, description, category, style, sourceImageUrl, userPrompt } = parsed.data
      const userId = req.userId

      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      // Composite identifier (provider[:quality|:resolution|…]) — derived by
      // the SAME resolver the preHandler ran on the raw body, so CHECK===DEBIT.
      const modelIdentifier = resolveEntityImageCreditIdentifier(parsed.data)

      // Prompt building has two modes:
      //  - Refine/edit: when the caller supplies a non-empty `userPrompt` (the
      //    studio's "describe changes" / sparkle Edit flow), it is honored as a
      //    TRANSIENT edit instruction via buildLocationRefinePrompt. Paired with
      //    `sourceImageUrl` the worker runs i2i so the source establishing shot
      //    is edited toward the instruction. Crucially the instruction is NOT
      //    written back to the row (this route only image-only auto-attaches),
      //    so the stored name / description / canonicalDescription are untouched
      //    - that is the whole point of "transient". Previously `userPrompt` was
      //    accepted by the schema but silently dropped, which pushed callers to
      //    smuggle edits through `description` and risk polluting the stored copy.
      //  - From-scratch: no `userPrompt` -> build from the persisted scene
      //    fields exactly as before.
      const refineInstruction = userPrompt?.trim()
      const prompt = refineInstruction
        ? buildLocationRefinePrompt({ editPrompt: refineInstruction, style })
        : buildLocationPrompt({ name, description, category, style })

      const mcpClient = extractMcpClient(req.body)
      const workflowId = extractWorkflowId(req.body)
      const forcePrivate = extractForcePrivate(req.body) || undefined
      // The full body — minus attachToLocationId — is the base for every job's
      // input_data. Stripping attachToLocationId here means count=2/4 batches
      // never carry the attach id; we re-add it ONLY for the single-job
      // (count=1) backward-compat path below.
      const { attachToLocationId: _attachToLocationId, ...bodyWithoutAttach } = parsed.data
      const baseInputData = buildJobInputData(bodyWithoutAttach, "generate-location")

      // ──────────────────────────────────────────────────────────────────────
      // Phase 1: Insert N pending jobs (always at least 1).
      // Multi-candidate (count=2/4) strips `attachToLocationId` from input_data
      // so the worker doesn't auto-attach — the user must approve a winner
      // through `POST /v1/locations/:id/approve-main-image`. Single-candidate
      // (count=1) propagates it for backward compat with the existing
      // "instant attach" Studio flow.
      //
      // On mid-batch insert failure: roll back any earlier inserts so we
      // don't leave orphan `pending` rows that will never be queued.
      // ──────────────────────────────────────────────────────────────────────
      // `attachToLocationId` (the auto-attach trigger) is propagated to
      // input_data ONLY for the single-candidate (count=1) "instant attach"
      // flow: the worker reads it from the QUEUE payload to write
      // source_image_url, and the count=1 main job also surfaces in the
      // location's pendingJobs via this field. Multi-candidate batches omit it
      // so no candidate auto-attaches; the user picks a winner via
      // approve-main-image.
      //
      // `candidateForLocationId` is the SEPARATE candidate-tracking key. It is
      // written for EVERY generation tied to a location (count=1 AND count>1)
      // and is NEVER read by any worker/reconcile auto-attach path - it exists
      // purely so GET /v1/locations/:id can surface completed candidates as
      // `previousCandidates` (the "pick from N / keep the original" strip). This
      // is why count>1 candidates are now findable WITHOUT re-introducing the
      // auto-attach risk that keeping `attachToLocationId` on them would carry.
      const attachId = parsed.data.attachToLocationId
      const includeAttach = parsed.data.count === 1 && attachId !== undefined
      const inputDataForInsert = {
        ...baseInputData,
        prompt,
        ...(attachId !== undefined ? { candidateForLocationId: attachId } : {}),
        ...(includeAttach ? { attachToLocationId: attachId } : {}),
      }

      const insertedJobIds: string[] = []
      for (let i = 0; i < parsed.data.count; i++) {
        const { data: job, error } = await supabase
          .from("jobs")
          .insert({
            workflow_id: workflowId,
            force_private: forcePrivate,
            user_id: userId,
            status: "pending",
            input_data: inputDataForInsert,
            ...(mcpClient ? { mcp_client: mcpClient } : {}),
          })
          .select("id")
          .single()

        if (error || !job) {
          if (insertedJobIds.length > 0) {
            try {
              await supabase.from("jobs").delete().in("id", insertedJobIds)
            } catch (cleanupErr) {
              req.log.warn(
                { err: cleanupErr, orphanJobIds: insertedJobIds },
                "[generate-location] failed to delete orphan jobs after mid-batch insert failure",
              )
            }
          }
          return sendInternalError(reply, req, error, "Failed to create job")
        }
        insertedJobIds.push(job.id)
      }

      // ──────────────────────────────────────────────────────────────────────
      // Per-job creditOverride correction: the preHandler reserved the BATCH
      // total (cost×count×markup) once; without resetting the override per job,
      // the N-call reservation loop below would debit batchTotal×N (an N²
      // over-charge). Mirror video-sfx: set the override to the per-JOB
      // marked-up cost before each reserveCreditsForJob call.
      //
      // The per-job BASE is `getModelCreditBaseCost(modelIdentifier).creditCost`
      // — identical to what computeCredits uses (it multiplies that same base
      // by `count`), so per-job = computeCredits's base ÷ count. We then apply
      // the SAME markup formula creditGuardImpl uses so the final per-job
      // number matches what was checked.
      //
      // TODO(nodaro): extract a shared per-job-override helper — this block is
      // duplicated 4 ways (video-sfx + generate-character/location/object).
      // ──────────────────────────────────────────────────────────────────────
      let perJobCreditOverride: number | undefined
      if (hasCredits() && req.creditReservation) {
        const { getModelCreditBaseCost } = await import("../ee/billing/credits.js")
        const pricing = await getModelCreditBaseCost(modelIdentifier)
        const { getAppSettings } = await import("../lib/app-settings.js")
        const settings = await getAppSettings()
        perJobCreditOverride =
          settings.cost_markup_percent > 0 && pricing.creditCost > 0
            ? Math.ceil(pricing.creditCost * (1 + settings.cost_markup_percent / 100))
            : pricing.creditCost
      }

      // ──────────────────────────────────────────────────────────────────────
      // Phase 2A: Reserve credits for every job BEFORE enqueueing any.
      // The preHandler already gated the full batch cost (computeCredits
      // multiplies by `count`), so mid-batch reservation failure is unlikely
      // — but not impossible. When it happens we roll back:
      //   - refund any reservations that succeeded (jobs 0..K-1)
      //   - delete the orphan `pending` rows that never got a reservation
      //     (jobs K+1..N-1; job K itself was already deleted by
      //     reserveCreditsForJobImpl on its failure path)
      // We DO NOT call videoQueue.add yet — that happens only in Phase 2B
      // after all reservations have succeeded.
      //
      // Per-job creditOverride correction (see comment above): reset
      // `req.creditReservation.creditOverride` to the per-job number before
      // each call so reserveCreditsForJobImpl debits per-job, not per-batch.
      // ──────────────────────────────────────────────────────────────────────
      type ReservationRecord = { jobId: string; usageLogId?: string }
      const reservations: ReservationRecord[] = []
      for (const jobId of insertedJobIds) {
        if (req.creditReservation && perJobCreditOverride !== undefined) {
          req.creditReservation.creditOverride = perJobCreditOverride
        }
        const reservation = await reserveCreditsForJob(req, reply, jobId, modelIdentifier)
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
                    "[generate-location] refund failed during batch rollback",
                  )
                }
              }
            } catch (importErr) {
              req.log.warn(
                { err: importErr },
                "[generate-location] failed to load CreditsService for rollback refund",
              )
            }
          }
          // Delete jobs that were inserted but never reserved (orphans).
          // Job K itself was already deleted by reserveCreditsForJobImpl,
          // so exclude any id that appears in `reservations`.
          const reservedIds = new Set(reservations.map((r) => r.jobId))
          const orphanIds = insertedJobIds.filter((id) => !reservedIds.has(id) && id !== jobId)
          if (orphanIds.length > 0) {
            try {
              await supabase.from("jobs").delete().in("id", orphanIds)
            } catch (deleteErr) {
              req.log.warn(
                { err: deleteErr, orphanJobIds: orphanIds },
                "[generate-location] failed to delete orphan jobs during batch rollback",
              )
            }
          }
          return
        }
        reservations.push({ jobId, usageLogId: reservation?.usageLogId })
      }

      // ──────────────────────────────────────────────────────────────────────
      // Phase 2B: All reservations succeeded — enqueue every job.
      // `attachToLocationId` flows through the queue payload too, but ONLY
      // when count=1 (matches what's in input_data — single source of truth).
      // ──────────────────────────────────────────────────────────────────────
      for (const r of reservations) {
        await videoQueue.add("generate-location", {
          jobId: r.jobId,
          prompt,
          sourceImageUrl,
          provider: parsed.data.provider,
          resolution: parsed.data.resolution,
          quality: parsed.data.quality,
          usageLogId: r.usageLogId,
          ...(includeAttach ? { attachToLocationId: parsed.data.attachToLocationId } : {}),
        })
      }

      // `jobIds` is ALWAYS present now (the harmonized contract — matches
      // characters). `jobId` is kept ONLY for count===1 as a deprecated
      // back-compat alias for callers that haven't migrated to jobIds yet; drop
      // it on the next major. (Response shape only — billing is untouched.)
      return parsed.data.count === 1
        ? { jobId: insertedJobIds[0], jobIds: insertedJobIds }
        : { jobIds: insertedJobIds }
    },
  )
}
