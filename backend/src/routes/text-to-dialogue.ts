import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { getMaxTtsChars } from "@nodaro/shared"
import { supabase } from "../lib/supabase.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { isVoiceGenderAllowed, premadeVoiceGender } from "../lib/voice-policy.js"

// Probed hard limit (2026-08-30): an 11th unique voice → 400 max_voices_exceeded.
const MAX_UNIQUE_DIALOGUE_VOICES = 10

const textToDialogueBody = z.object({
  dialogue: z.array(z.object({
    text: z.string().min(1),
    voice: z.string().min(1),
  })).min(1).refine(
    // Same shared cap the panel counter and the GVP synth read — never a
    // hand-kept literal (three copies of this number drifted before).
    (lines) => lines.reduce((sum, l) => sum + l.text.length, 0) <= getMaxTtsChars("elevenlabs-dialogue"),
    { message: `Total dialogue text must not exceed ${getMaxTtsChars("elevenlabs-dialogue")} characters` }
  ).refine(
    (lines) => new Set(lines.map((l) => l.voice)).size <= MAX_UNIQUE_DIALOGUE_VOICES,
    { message: `A dialogue can use at most ${MAX_UNIQUE_DIALOGUE_VOICES} unique voices — reuse voices across lines or split the script into two nodes` }
  ),
  userPrompt: z.string().max(8000).optional(),
  stability: z.number().refine((v) => v === 0 || v === 0.5 || v === 1, {
    message: "Stability must be 0, 0.5, or 1",
  }).optional(),
  languageCode: z.string().max(10).optional(),
  seed: z.number().int().min(0).max(4294967295).optional(),
  applyTextNormalization: z.enum(["auto", "on", "off"]).optional(),
  userId: z.string().uuid().optional(),
})

export async function textToDialogueRoutes(app: FastifyInstance) {
  app.post("/v1/text-to-dialogue", {
    preHandler: creditGuard(() => "elevenlabs-dialogue"),
  }, async (req, reply) => {
    const parsed = textToDialogueBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { dialogue, stability, languageCode, seed, applyTextNormalization } = parsed.data
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
        input_data: buildJobInputData(parsed.data, "text-to-dialogue"),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, "elevenlabs-dialogue")
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("text-to-dialogue", {
      jobId: job.id,
      dialogue,
      stability,
      languageCode,
      seed,
      applyTextNormalization,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
