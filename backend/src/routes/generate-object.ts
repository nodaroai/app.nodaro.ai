import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate, extractProvider } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { buildObjectPrompt } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"
import { hasCredits } from "../lib/config.js"

const generateObjectBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  userPrompt: z.string().max(8000).optional(),
  category: z.enum(["furniture", "vehicle", "weapon", "food", "clothing", "electronics", "nature", "tool", "animal", "other"]).optional(),
  style: z.enum(["realistic", "anime", "3d-pixar", "illustration"]).optional(),
  sourceImageUrl: safeUrlSchema.optional(),
  provider: z.string().optional().default("nano-banana"),
  userId: z.string().uuid().optional(),
  // Multi-candidate generation. `1` keeps the legacy single-job behavior and
  // response shape `{ jobId }`. `2` / `4` insert N jobs in parallel and return
  // `{ jobIds: string[] }`. Object Studio renders 1/4 grids and prompts the
  // user to pick a winner via `POST /v1/objects/:id/approve-main-image`.
  count: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional().default(1),
  // Object Studio auto-attach: when set, the worker writes the resulting
  // image URL to `objects.source_image_url` on this row after generation
  // succeeds. Lets the studio survive page closes mid-generation.
  //
  // ⚠️ Only propagated to the job payload when `count === 1`. Multi-candidate
  // batches MUST go through explicit approval (`approve-main-image`) so the
  // user picks the winner — auto-attaching one of N candidates would leak a
  // random pick into the studio.
  attachToObjectId: z.string().uuid().optional(),
  // Phase E picker-hint pass-through: when the user picks an object from the
  // catalog (parameter-picker), the seed prompt fragment flows through to
  // the worker so it can be appended to the prompt context.
  seedPromptHint: z.string().max(2000).optional(),
  // Optional name to set on the attached row at the same time as the
  // source image URL (worker auto-attach helper writes both atomically).
  attachName: z.string().max(100).optional(),
  // Optimistic-concurrency guard for the single-candidate auto-attach path:
  // if set, worker bails on attach when `objects.updated_at` has drifted.
  expectedUpdatedAt: z.string().datetime().optional(),
})

/**
 * Extract `count` from a raw request body for the credit pre-check.
 * The Zod schema isn't parsed yet at preHandler time, so we defensively
 * coerce and clamp to the allowed {1, 2, 3, 4} set. Invalid values fall back
 * to 1 so the pre-check never under-charges; the route's Zod validation
 * still 400s on bad input downstream.
 */
function extractCount(body: unknown): 1 | 2 | 3 | 4 {
  const raw = (body as { count?: unknown })?.count
  if (raw === 2) return 2
  if (raw === 3) return 3
  if (raw === 4) return 4
  return 1
}

export async function generateObjectRoutes(app: FastifyInstance) {
  app.post(
    "/v1/generate-object",
    {
      // Multi-candidate batch: credits scale linearly with `count` (1, 2, or 4).
      // Mirrors the generate-location / generate-character pattern — without
      // this, the preHandler greenlights users who can afford ONE job even
      // when count=4. computeCredits returns BASE (pre-markup) credits;
      // markup is applied inside creditGuardImpl so the same final number
      // is both checked AND reserved.
      preHandler: creditGuard((req: FastifyRequest) => extractProvider(req.body, "nano-banana"), {
        computeCredits: async (body) => {
          const count = extractCount(body)
          const provider = extractProvider(body, "nano-banana")
          // Dynamic import: getModelCreditBaseCost lives in ee/ and we keep
          // core free of static ee/ imports. Only reached in cloud edition
          // (creditGuard short-circuits to a no-op otherwise).
          const { getModelCreditBaseCost } = await import("../ee/billing/credits.js")
          const pricing = await getModelCreditBaseCost(provider)
          return pricing.creditCost * count
        },
      }),
    },
    async (req, reply) => {
      const parsed = generateObjectBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const { name, description, category, style, sourceImageUrl } = parsed.data
      const userId = req.userId

      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      // ─────────────────────────────────────────────────────────────────────
      // Ownership pre-check on the attach target (spec Pass 3 F-30: MUST
      // happen BEFORE reserveCreditsForJob so a forged `attachToObjectId`
      // can't burn credits before the check). Service-role bypasses RLS,
      // so without this re-check a forged id would let the worker write
      // to another user's row. Also rejects soft-deleted rows.
      //
      // Per spec Pass 10 F-90b: object uses a uniform `"not_found"` error
      // code for missing/cross-user/soft-deleted rows (object is
      // DELIBERATELY stricter than location's per-path codes to prevent
      // callees from enumerating object IDs by error-code differences).
      // ─────────────────────────────────────────────────────────────────────
      if (parsed.data.attachToObjectId) {
        const { data: own } = await supabase
          .from("objects")
          .select("id")
          .eq("id", parsed.data.attachToObjectId)
          .eq("user_id", userId)
          .is("deleted_at", null)
          .maybeSingle()
        if (!own) {
          return reply.status(404).send({
            error: { code: "not_found", message: "Object not found" },
          })
        }
      }

      const modelIdentifier = parsed.data.provider

      const prompt = buildObjectPrompt({ name, description, category, style })

      const mcpClient = extractMcpClient(req.body)
      const workflowId = extractWorkflowId(req.body)
      const forcePrivate = extractForcePrivate(req.body) || undefined

      // The full body — minus attachToObjectId / attachName / expectedUpdatedAt —
      // is the base for every job's input_data. Stripping these here means
      // count=2/4 batches never carry the attach metadata; we re-add it ONLY
      // for the single-job (count=1) backward-compat path below.
      const {
        attachToObjectId: _attachToObjectId,
        attachName: _attachName,
        expectedUpdatedAt: _expectedUpdatedAt,
        ...bodyWithoutAttach
      } = parsed.data
      const baseInputData = buildJobInputData(bodyWithoutAttach, "generate-object")

      // ──────────────────────────────────────────────────────────────────────
      // Phase 1: Insert N pending jobs (always at least 1).
      // Multi-candidate (count=2/4) strips `attachToObjectId` from input_data
      // so the worker doesn't auto-attach — the user must approve a winner
      // through `POST /v1/objects/:id/approve-main-image`. Single-candidate
      // (count=1) propagates it for backward compat with the existing
      // "instant attach" Studio flow.
      //
      // On mid-batch insert failure: roll back any earlier inserts so we
      // don't leave orphan `pending` rows that will never be queued.
      // ──────────────────────────────────────────────────────────────────────
      const includeAttach = parsed.data.count === 1 && parsed.data.attachToObjectId !== undefined
      const inputDataForInsert = includeAttach
        ? {
            ...baseInputData,
            attachToObjectId: parsed.data.attachToObjectId,
            attachName: parsed.data.attachName,
            expectedUpdatedAt: parsed.data.expectedUpdatedAt,
            prompt,
          }
        : { ...baseInputData, prompt }

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
                "[generate-object] failed to delete orphan jobs after mid-batch insert failure",
              )
            }
          }
          return reply.status(500).send({
            error: { code: "internal_error", message: error?.message ?? "Failed to create job" },
          })
        }
        insertedJobIds.push(job.id)
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
      // ──────────────────────────────────────────────────────────────────────
      type ReservationRecord = { jobId: string; usageLogId?: string }
      const reservations: ReservationRecord[] = []
      for (const jobId of insertedJobIds) {
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
                    "[generate-object] refund failed during batch rollback",
                  )
                }
              }
            } catch (importErr) {
              req.log.warn(
                { err: importErr },
                "[generate-object] failed to load CreditsService for rollback refund",
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
                "[generate-object] failed to delete orphan jobs during batch rollback",
              )
            }
          }
          return
        }
        reservations.push({ jobId, usageLogId: reservation?.usageLogId })
      }

      // ──────────────────────────────────────────────────────────────────────
      // Phase 2B: All reservations succeeded — enqueue every job.
      // `attachToObjectId` + auto-attach metadata flows through the queue
      // payload too, but ONLY when count=1 (matches what's in input_data —
      // single source of truth).
      // ──────────────────────────────────────────────────────────────────────
      for (const r of reservations) {
        await videoQueue.add("generate-object", {
          jobId: r.jobId,
          prompt,
          sourceImageUrl,
          provider: parsed.data.provider,
          usageLogId: r.usageLogId,
          seedPromptHint: parsed.data.seedPromptHint,
          ...(includeAttach
            ? {
                attachToObjectId: parsed.data.attachToObjectId,
                attachName: parsed.data.attachName,
                expectedUpdatedAt: parsed.data.expectedUpdatedAt,
              }
            : {}),
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
