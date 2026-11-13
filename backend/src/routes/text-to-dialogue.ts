import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { DIALOGUE_PROVIDERS, TTS_OUTPUT_FORMATS, dialogueProblem, dialogueProviderOf, dialogueReplicaOf, dialogueReplicaVoices, dialogueStabilityAccepted, getDialogueCapabilities } from "@nodaro/shared/models"
import { dialogueTextBeforeCap } from "@nodaro/prompts/prompt-fields"
import { replicaConsentProblem } from "@nodaro/shared/model-catalog"
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
import { judgeVoices, voiceNotAvailableBody } from "../lib/voice-gender.js"
import { judgeNamedVoiceModel } from "../lib/voice-lock.js"
import { readReplica, ReplicaRecordingError, withoutReplicaLinks } from "../lib/voice-replica.js"
import { enqueueRouteJob } from "../lib/enqueue-route-job.js"

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
    // Gemini 3.8: how this line is spoken (judged by `dialogueProblem` on a model that takes it, never sent to one that does not).
    styleDirection: z.string().optional(),
  })).min(1),
  // Gemini 3.1 / 2.5: each speaker's style, pace, accent and audio profile, keyed by the voice its lines name.
  speakers: z.array(z.object({
    voice: z.string().min(1),
    styleDirection: z.string().optional(),
    pace: z.string().optional(),
    accent: z.string().optional(),
    audioProfile: z.string().optional(),
    // A one-off clone of this speaker (Gemini 3.8 Flash, decided 2026-11-13): two https links to WAV
    // recordings; the lines that name this `voice` are spoken in the cloned voice. Judged by `dialogueProblem`
    // (the model must clone) and again before any hold (the recordings, `lib/voice-replica.ts`).
    // `consent: true`: the caller confirms the editor checkbox's sentence (REPLICA_CONSENT_ATTESTATION).
    replica: z.object({ sourceAudioUrl: z.string().max(2048), consentAudioUrl: z.string().max(2048), consent: z.boolean().optional() }).optional(),
  })).max(10).optional(),
  // Gemini 3.8, two speakers: filler words between them. Never sent to a model that does not take it.
  fillerWords: z.boolean().optional(),
  // The file (decided 2026-11-13): MP3 (the default) or the WAV as rendered on a Gemini model; the ElevenLabs
  // dialogue models deliver the default MP3 only, so another format there is refused by `dialogueProblem`.
  outputFormat: z.enum(TTS_OUTPUT_FORMATS).optional(),
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
  // Measured as the model takes each line before the cap (on Gemini 3.8 its tags rewritten), so a priced
  // script is always one that runs whole; on any other model, the lines' texts as written.
  const total = dialogueTextBeforeCap(lines, sheet)
  if (total > sheet.maxChars) {
    ctx.addIssue({ code: "custom", path: ["dialogue"], message: `Total dialogue text must not exceed ${sheet.maxChars} characters` })
  }
  // The one check every dialogue door runs: the model's speaker limit (10 on ElevenLabs — probed 2026-08-30,
  // an 11th → 400 max_voices_exceeded; 2 on Gemini), a Gemini model's own voices, the line style and the
  // speakers' direction it takes — refused here, before any hold.
  const problem = dialogueProblem(body.provider, body)
  if (problem) ctx.addIssue({ code: "custom", path: [...problem.path], message: problem.message })
  // A cloned speaker must carry the caller's consent (decided 2026-11-13), refused before anything is read or held.
  ;(Array.isArray(body.speakers) ? body.speakers : []).forEach((sp, i) => {
    const consent = replicaConsentProblem(sp?.replica)
    if (consent && !problem) ctx.addIssue({ code: "custom", path: ["speakers", i, "replica", "consent"], message: consent })
  })
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
      // Length-based pricing (decided 2026-10-06): the lines as they are sent
      // (`dialogueBaseCredits`: on Gemini 3.8 each line's tags rewritten — the
      // texts as written on any other model), every started 100 characters, on
      // the chosen model's rate row (a Gemini model's is its one-speaker row,
      // per 1,000 characters), attached only while the flag is on. The Zod
      // refine below refuses a script over the model's total cap, so a priced
      // script is always one that runs whole.
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

    const { dialogue, stability, similarityBoost, languageCode, seed, applyTextNormalization, speakers, fillerWords, outputFormat } = parsed.data
    // The model the run renders on, reserves under and is keyed as at egress.
    const provider = dialogueProviderOf(parsed.data.provider)
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // A model that speaks only its own named voices (Gemini) under a voice lock: refused whole — no gender is
    // recorded for its voices (decided 2026-11-13, as for one speaker).
    if (!judgeNamedVoiceModel(provider).allowed) {
      return reply.status(400).send(voiceNotAvailableBody())
    }

    // B4c: under a voice lock, every line's voice must be one whose gender the
    // platform can vouch for as allowed (mirrors the TTS route): judged by the
    // voice's id alone — a premade voice (by name or id), the caller's own
    // clone, a library voice this deployment listed (lib/voice-gender.ts). A
    // voice of unknown gender is refused too. No lock: no lookup at all.
    // A cloned speaker's label is no stored voice: nothing to look up (the model was refused above under a lock).
    const clones = dialogueReplicaVoices(provider, speakers)
    const voiceVerdict = await judgeVoices(dialogue.map((line) => line.voice).filter((v) => !clones.has(v)), { userId })
    if (!voiceVerdict.allowed) {
      return reply.status(400).send(voiceNotAvailableBody("A selected voice is not available on this deployment."))
    }

    // A cloned speaker's recordings are judged before anything is held (https, allowed here, a WAV within
    // 10 MB, the reference 10–30 s); nothing is stored, and their links are never written on the job row.
    for (const voice of clones) {
      try {
        const replica = dialogueReplicaOf(provider, speakers, voice)
        if (!replica) continue
        await readReplica(replica)
      } catch (err) {
        if (err instanceof ReplicaRecordingError) return reply.status(400).send({ error: { code: err.code, message: err.message } })
        throw err
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
        input_data: { ...buildJobInputData(withoutReplicaLinks({ ...parsed.data, provider }), "text-to-dialogue"), resolvedModel: provider },
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, provider)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await enqueueRouteJob(req, reply, job.id, () => videoQueue.add("text-to-dialogue", {
      jobId: job.id,
      provider,
      dialogue,
      stability,
      similarityBoost,
      languageCode,
      seed,
      applyTextNormalization,
      // A Gemini model's own fields (the worker sends each only where the model takes it).
      ...(speakers ? { speakers } : {}),
      ...(fillerWords !== undefined ? { fillerWords } : {}),
      ...(outputFormat ? { outputFormat } : {}),
      usageLogId,
    }))
    if (reply.sent) return

    return { jobId: job.id }
  })
}
