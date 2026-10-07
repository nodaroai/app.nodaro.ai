import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { DIALOGUE_PROVIDERS, dialogueProviderOf, dialogueStabilityAccepted, getDialogueCapabilities } from "@nodaro/shared"
import { supabase } from "../lib/supabase.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { speechLengthPricingEnabled } from "../lib/config.js"
import { dialogueBaseCredits } from "../lib/speech-credits.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { isVoiceGenderAllowed, premadeVoiceGender } from "../lib/voice-policy.js"

// Probed hard limit (2026-08-30): an 11th unique voice → 400 max_voices_exceeded.
const MAX_UNIQUE_DIALOGUE_VOICES = 10

/** "0, 0.5, or 1" — the message v3 dialogue has always answered with. */
function stepsPhrase(steps: readonly number[]): string {
  return steps.length > 1 ? `${steps.slice(0, -1).join(", ")}, or ${steps[steps.length - 1]}` : String(steps[0])
}

const textToDialogueBody = z.object({
  // Our dialogue model id. Omitted → v3 dialogue (the default, decided 2026-10-04).
  provider: z.enum(DIALOGUE_PROVIDERS).optional(),
  dialogue: z.array(z.object({
    text: z.string().min(1),
    voice: z.string().min(1),
  })).min(1).refine(
    (lines) => new Set(lines.map((l) => l.voice)).size <= MAX_UNIQUE_DIALOGUE_VOICES,
    { message: `A dialogue can use at most ${MAX_UNIQUE_DIALOGUE_VOICES} unique voices — reuse voices across lines or split the script into two nodes` }
  ),
  userPrompt: z.string().max(8000).optional(),
  stability: z.number().min(0).max(1).optional(),
  similarityBoost: z.number().min(0).max(1).optional(),
  languageCode: z.string().max(10).optional(),
  seed: z.number().int().min(0).max(4294967295).optional(),
  applyTextNormalization: z.enum(["auto", "on", "off"]).optional(),
  userId: z.string().uuid().optional(),
}).superRefine((body, ctx) => {
  // Both limits are the CHOSEN model's, read from its capability sheet — the
  // same getters the panel counter and the MCP verb read. Defensive on the
  // lines: a refinement may run on a body whose own fields already failed.
  const sheet = getDialogueCapabilities(body.provider)
  const lines = Array.isArray(body.dialogue) ? body.dialogue : []
  const total = lines.reduce((sum, l) => sum + (typeof l?.text === "string" ? l.text.length : 0), 0)
  if (total > sheet.maxChars) {
    ctx.addIssue({ code: "custom", path: ["dialogue"], message: `Total dialogue text must not exceed ${sheet.maxChars} characters` })
  }
  if (typeof body.stability === "number" && !dialogueStabilityAccepted(body.provider, body.stability)) {
    const steps = sheet.stabilitySteps
    ctx.addIssue({
      code: "custom",
      path: ["stability"],
      message: steps ? `Stability must be ${stepsPhrase(steps)}` : "Stability must be between 0 and 1",
    })
  }
})

export async function textToDialogueRoutes(app: FastifyInstance) {
  app.post("/v1/text-to-dialogue", {
    // Runs before Zod on the raw body: an unknown id prices the default here and
    // is refused by the schema right after — never priced as another lane's row.
    // `denyResolvedModel`: that same resolved id is what the surface deny reads, so a
    // deployment that denies the default is not bypassed by omitting the field.
    preHandler: creditGuard(
      (req) => dialogueProviderOf((req.body as Record<string, unknown> | undefined)?.provider),
      // Length-based pricing (decided 2026-10-06): the sum of the lines' texts,
      // every started 100 characters, on the chosen model's unit row, attached
      // only while the flag is on. The Zod refine below refuses a script over
      // the model's total cap, so a priced script is always one that runs whole.
      speechLengthPricingEnabled()
        ? {
            denyResolvedModel: true,
            computeCredits: (body) => {
              const raw = body as { dialogue?: unknown; provider?: unknown } | undefined
              return dialogueBaseCredits(raw?.dialogue, raw?.provider)
            },
          }
        : { denyResolvedModel: true },
    ),
  }, async (req, reply) => {
    const parsed = textToDialogueBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { dialogue, stability, similarityBoost, languageCode, seed, applyTextNormalization } = parsed.data
    // The model the run renders on, reserves under and is keyed as at egress.
    const provider = dialogueProviderOf(parsed.data.provider)
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // B4c: reject any line whose PREMADE voice gender the deployment disallows
    // (mirrors the TTS route). Custom / library / unknown-gender identifiers
    // pass (UUIDs resolve to `undefined` gender). Unrestricted deployments are
    // byte-identical (isVoiceGenderAllowed returns true when allowedGenders
    // is []). Dialogue enforced this at NEITHER seam before — going direct
    // removes even the KIE proxy's incidental name-clamping, so the policy
    // gate must be explicit now.
    for (const line of dialogue) {
      const g = premadeVoiceGender(line.voice)
      if (g !== undefined && !isVoiceGenderAllowed(g)) {
        return reply.status(400).send({
          error: { code: "voice_not_available", message: "A selected voice is not available on this deployment." },
        })
      }
    }

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        // The row names the model the run renders on (resolved, never the raw
        // body's optional field): the orchestrator path stores the same shape,
        // so job stats and egress read one id for both doors.
        input_data: buildJobInputData({ ...parsed.data, provider }, "text-to-dialogue"),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, provider)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("text-to-dialogue", {
      jobId: job.id,
      provider,
      dialogue,
      stability,
      similarityBoost,
      languageCode,
      seed,
      applyTextNormalization,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
