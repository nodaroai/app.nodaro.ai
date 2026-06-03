import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractProvider } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { buildPortraitPrompt } from "../lib/character-prompts.js"
import { formatZodError } from "../lib/zod-error.js"
import { hasCredits } from "../lib/config.js"
import {
  CHARACTER_ASPECT_OPTIONS,
  resolveCharacterAspectRatio,
} from "@nodaro/shared"

const generateCharacterBody = z
  .object({
    // Legacy fields preserved
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    userPrompt: z.string().max(8000).optional(),
    gender: z.string().max(50).optional(),
    style: z.enum(["realistic", "anime", "3d-pixar", "illustration"]).optional(),
    baseOutfit: z.string().max(1000).optional(),
    sourceImageUrl: safeUrlSchema.optional(),
    provider: z.string().optional().default("nano-banana"),
    userId: z.string().uuid().optional(),
    // Character Studio auto-attach: when set, the worker writes the resulting
    // image URL to `characters.source_image_url` on this row after generation
    // succeeds. Lets the studio survive page closes mid-generation.
    attachToCharacterId: z.string().uuid().optional(),

    // Character Studio Identity Foundation (v2):
    seedPrompt: z.string().max(2000).optional(),
    referencePhotos: z
      .array(
        z.object({
          url: safeUrlSchema,
          // Migration 118 renamed the two ambiguous kinds:
          //   front    → frontFace  (face-level shot)
          //   fullBody → frontBody  (full-body natural standing shot)
          kind: z.enum([
            "frontFace",
            "sideLeft",
            "sideRight",
            "threeQuarterLeft",
            "threeQuarterRight",
            "frontBody",
            "other",
          ]),
        }),
      )
      .max(20)
      .optional(),
    count: z.number().int().min(1).max(10).optional().default(1),
    // Per-asset-type aspect-ratio defaults (smart-defaults feature). Portrait
    // generation defaults to 3:4 (vertical headshot). Callers can override
    // explicitly via `aspectRatio`, or via `characterNodeAspectRatio` (the
    // character node's 4-pill toggle) which loses to `aspectRatio` but wins
    // against the default. See `packages/shared/src/character-aspect-defaults.ts`.
    aspectRatio: z.enum(CHARACTER_ASPECT_OPTIONS).optional(),
    characterNodeAspectRatio: z.enum(CHARACTER_ASPECT_OPTIONS).optional(),
  })
  .refine(
    (data) =>
      (data.seedPrompt !== undefined && data.seedPrompt.trim().length > 0) ||
      (data.referencePhotos !== undefined && data.referencePhotos.length > 0) ||
      (data.description !== undefined && data.description.trim().length > 0),
    { message: "Provide seedPrompt, referencePhotos, or description" },
  )

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

export async function generateCharacterRoutes(app: FastifyInstance) {
  app.post(
    "/v1/generate-character",
    {
      // Multi-candidate batch: credits scale linearly with `count` (1–10).
      // Without this, the preHandler greenlights users who can afford ONE job
      // even when count=10 — Phase 2 then either rejects mid-batch (orphan rows
      // + partial enqueue) or charges Nx silently. computeCredits returns BASE
      // (pre-markup) credits; markup is applied inside creditGuardImpl so the
      // same final number is both checked AND reserved.
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
      const parsed = generateCharacterBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const data = parsed.data
      const userId = req.userId

      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      const modelIdentifier = data.provider

      // Build portrait prompt — v2 path prefers seedPrompt with studio scaffolding;
      // legacy path falls back to userPrompt → description → name.
      const promptText = data.seedPrompt
        ? buildPortraitPrompt({ seedPrompt: data.seedPrompt })
        : (data.userPrompt ?? data.description ?? data.name)

      const mcpClient = extractMcpClient(req.body)
      const inputData = buildJobInputData(parsed.data, "generate-character")
      const workflowId = extractWorkflowId(req.body)

      // Resolve the final aspect ratio: explicit > node override > portrait default.
      // The character node's `defaultAssetAspectRatio` flows in as
      // `characterNodeAspectRatio`; the portrait default is 3:4 (vertical
      // headshot — characters are vertical subjects).
      const aspectRatio = resolveCharacterAspectRatio({
        explicit: data.aspectRatio,
        nodeOverride: data.characterNodeAspectRatio,
        assetType: "portrait",
      })

      // ──────────────────────────────────────────────────────────────────────
      // Phase 1: Insert N pending jobs (always at least 1).
      // `force_private: true` is unconditional per the Character Studio
      // privacy-by-default rule — generated character assets must never leak
      // to the public gallery, regardless of what the user requests.
      //
      // On mid-batch insert failure: roll back any earlier inserts so we
      // don't leave orphan `pending` rows that will never be queued.
      // ──────────────────────────────────────────────────────────────────────
      const insertedJobIds: string[] = []
      for (let i = 0; i < data.count; i++) {
        const { data: job, error } = await supabase
          .from("jobs")
          .insert({
            workflow_id: workflowId,
            force_private: true,
            user_id: userId,
            status: "pending",
            input_data: { ...inputData, prompt: promptText },
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
                "[generate-character] failed to delete orphan jobs after mid-batch insert failure",
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
      //
      // The preHandler already gated the full batch cost (computeCredits
      // multiplies by `count`), so mid-batch reservation failure is unlikely
      // — but not impossible (race conditions with concurrent spend, RPC
      // errors, etc.). When it happens we must roll back:
      //   - refund any reservations that succeeded (jobs 0..K-1)
      //   - delete the orphan `pending` rows that never got a reservation
      //     (jobs K..N-1; note `reserveCreditsForJobImpl` already deletes
      //     the row for job K itself on failure)
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
                    "[generate-character] refund failed during batch rollback",
                  )
                }
              }
            } catch (importErr) {
              req.log.warn(
                { err: importErr },
                "[generate-character] failed to load CreditsService for rollback refund",
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
                "[generate-character] failed to delete orphan jobs during batch rollback",
              )
            }
          }
          return
        }
        reservations.push({ jobId, usageLogId: reservation?.usageLogId })
      }

      // ──────────────────────────────────────────────────────────────────────
      // Phase 2B: All reservations succeeded — enqueue every job.
      // ──────────────────────────────────────────────────────────────────────
      for (const r of reservations) {
        await videoQueue.add("generate-character", {
          jobId: r.jobId,
          prompt: promptText,
          sourceImageUrl: data.sourceImageUrl,
          provider: data.provider,
          attachToCharacterId: data.attachToCharacterId,
          aspectRatio,
          usageLogId: r.usageLogId,
        })
      }

      return { jobId: insertedJobIds[0], jobIds: insertedJobIds }
    },
  )
}
