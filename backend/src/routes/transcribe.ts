import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { isAllowedSocialVideoUrl, safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { isImportRefusal, requireImportAllowed } from "../lib/import-gate.js"
import { unusableLinkError } from "../lib/unusable-link.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { importJobFields, importViaOf } from "../lib/import-via.js"
import { linkImportRefusal } from "../lib/link-imports.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { withResolvedModel } from "../lib/job-resolved-model.js"
import {
  TRANSCRIBE_PROVIDERS,
  TRANSCRIBE_PROVIDER_CAPABILITIES,
  TRANSCRIBE_TARGET_LANGUAGES,
  DEFAULT_TRANSCRIBE_PROVIDER,
} from "@nodaro/shared/models"
import { NEMOTRON_TRANSCRIBE_ID } from "@nodaro/shared/credits"
import { transcribeTranslationRefusal } from "@nodaro/shared/nodes"
import { measureNemotronTranscribeInput } from "../lib/nemotron-transcribe-input.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { jobRunModel } from "../lib/run-model.js"
import { enqueueRouteJob } from "../lib/enqueue-route-job.js"

// The providers this route ACCEPTS that can also honour word timestamps —
// derived from the capability table, intersected with the route's own enum so
// the rejection message never names a provider this same route would reject.
// (Today the enum is every lane, so the intersection is the whole capable set;
// it stays an intersection because the two sets have diverged before.)
const WORD_TIMESTAMP_PROVIDERS = TRANSCRIBE_PROVIDERS.filter(
  (p) => TRANSCRIBE_PROVIDER_CAPABILITIES[p].wordTimestamps,
)

export const transcribeBody = z.object({
  audioUrl: safeUrlSchema,
  provider: z.enum(TRANSCRIBE_PROVIDERS).optional(),
  language: z.string().max(10).optional(),
  diarize: z.boolean().optional(),
  tagAudioEvents: z.boolean().optional(),
  wordTimestamps: z.boolean().optional(),
  // Translate the speech into this language instead of transcribing it
  // (Nemotron 3.5 Transcribe only: to or from English, and never with word
  // timings — both refused below, before anything is held).
  targetLanguage: z.enum(TRANSCRIBE_TARGET_LANGUAGES).optional(),
  userId: z.string().uuid().optional(),
  // The content rights confirmation (`POST /v1/content-rights/confirm`) a
  // SOCIAL link's sound is imported under: checked here, spent by the worker
  // right before the fetch. Optional until `content_rights_required` is on; a
  // direct file needs none.
  confirmationId: z.string().uuid().optional(),
}).superRefine((v, ctx) => {
  // A translation is one engine's ability, never with word timings: refused at
  // ingress, with the one message every run surface gives.
  const translationRefusal = transcribeTranslationRefusal(v.provider ?? DEFAULT_TRANSCRIBE_PROVIDER, v.targetLanguage, v.wordTimestamps)
  if (translationRefusal) {
    ctx.addIssue({ code: "custom", path: ["targetLanguage"], message: translationRefusal })
    return
  }
  // Word timings are a per-provider capability, and the incapable lane fails
  // SILENTLY: `openai/whisper` has no `word_timestamps` input in any published
  // version, so Replicate drops the key and the job "succeeds" with an empty
  // word list after credits are spent. That is the ONE incapable lane in the
  // enum — `incredibly-fast-whisper` (`timestamp: "word"`) and `elevenlabs-stt`
  // (word-level by design) both pass. Reject at ingress — before the job insert
  // and the credit reservation — rather than auto-swapping the provider: the
  // credit guard reserves on the provider id, so a swap would silently change
  // what bills. The capability is always asked of the table, never of a
  // provider-name check.
  if (!v.wordTimestamps) return
  const resolved = v.provider ?? DEFAULT_TRANSCRIBE_PROVIDER
  if (TRANSCRIBE_PROVIDER_CAPABILITIES[resolved].wordTimestamps) return
  ctx.addIssue({
    code: "custom",
    path: ["wordTimestamps"],
    message:
      `provider "${resolved}"${v.provider ? "" : " (the default)"} does not return word timestamps — ` +
      `set provider to ${WORD_TIMESTAMP_PROVIDERS.join(" or ")}`,
  })
})

/** The request key the Nemotron preHandler stashes its measurement under, for the guard and the handler. */
const PROBED_KEY = "__nemotronMeasured"

/** What the preHandler measured: the id the run holds, and the length when it could be read. */
interface NemotronMeasured {
  readonly creditId: string
  readonly durationSec?: number
}

function withoutStash(body: unknown): Record<string, unknown> {
  const { [PROBED_KEY]: _stashed, ...rest } = (body ?? {}) as Record<string, unknown>
  return rest
}

function measuredOf(body: unknown): NemotronMeasured | undefined {
  const stashed = (body as Record<string, unknown> | undefined)?.[PROBED_KEY]
  if (!stashed || typeof stashed !== "object") return undefined
  const { creditId, durationSec } = stashed as Record<string, unknown>
  if (typeof creditId !== "string") return undefined
  return { creditId, ...(typeof durationSec === "number" ? { durationSec } : {}) }
}

function namesNemotron(body: unknown): boolean {
  return (body as Record<string, unknown> | undefined)?.provider === NEMOTRON_TRANSCRIBE_ID
}

/**
 * Nemotron 3.5 Transcribe is priced per started minute of the file (decided
 * 2026-11-12), so its file is measured BEFORE the credit guard: an invalid
 * body, a link the deployment refuses, anything but an https link to a public
 * host, a video's page link and a file over 60 minutes or 200 MB are all
 * refused with nothing held; a file whose length cannot be read is held at the
 * 60-minute price. The measurement is stashed on the body so the guard holds
 * `nemotron-3-5-transcribe:<N>m` without probing again; the worker then
 * settles at the minutes KIE reports. Every other engine's request passes
 * through untouched (validated in the handler, as before). The link checks run
 * before the probe: ffprobe is an outbound fetch.
 */
async function measureNemotronFirst(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!namesNemotron(req.body)) return
  const parsed = transcribeBody.safeParse(withoutStash(req.body))
  if (!parsed.success) {
    return void reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
  }
  const unusable = unusableLinkError(parsed.data.audioUrl)
  if (unusable) return void reply.status(400).send({ error: unusable })
  const switchRefusal = linkImportRefusal(parsed.data.audioUrl)
  if (switchRefusal) return void reply.status(403).send({ error: switchRefusal })
  const measured = await measureNemotronTranscribeInput(parsed.data.audioUrl, (err) => {
    req.log.warn({ err }, "transcribe (nemotron): ffprobe could not read the length; holding 60 minutes")
  })
  if (!measured.ok) {
    return void reply.status(400).send({ error: { code: measured.code, message: measured.message } })
  }
  const stash: NemotronMeasured = {
    creditId: measured.creditId,
    ...(measured.durationSec !== undefined ? { durationSec: measured.durationSec } : {}),
  }
  ;(req.body as Record<string, unknown>)[PROBED_KEY] = stash
}

/**
 * The id a request is checked and reserved on: the engine id (an absent
 * provider resolving to the route default), except Nemotron, whose id is the
 * started minutes of the measured file (the 60-minute id when its length could
 * not be read). One function for the guard and the reservation, so what is
 * checked is what is held.
 */
function transcribeCreditId(body: unknown, provider: string | undefined): string {
  if (provider === NEMOTRON_TRANSCRIBE_ID) {
    // Never unmeasured past the preHandler; the bare id (the 60-minute
    // maximum) bounds it if it ever were.
    return measuredOf(body)?.creditId ?? NEMOTRON_TRANSCRIBE_ID
  }
  return provider ?? DEFAULT_TRANSCRIBE_PROVIDER
}

export async function transcribeRoutes(app: FastifyInstance) {
  app.post("/v1/transcribe", {
    // The engine id IS the credit identifier for every engine priced per
    // request (`elevenlabs-stt`, `whisper`, `incredibly-fast-whisper` in
    // STATIC_CREDIT_COSTS + model_pricing); Nemotron's is its per-minute id,
    // from the length its own preHandler measured first. The guard here and
    // the reservation below resolve the id the same way, so what is checked is
    // what bills.
    preHandler: [
      measureNemotronFirst,
      creditGuard((req) => {
        const body = req.body as Record<string, unknown>
        return transcribeCreditId(body, body?.provider as string | undefined)
      }, { runModel: jobRunModel("transcribe") }),
    ],
  }, async (req, reply) => {
    const nemotronMeasured = measuredOf(req.body)
    const parsed = transcribeBody.safeParse(withoutStash(req.body))
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { audioUrl, provider, language, diarize, tagAudioEvents, targetLanguage, confirmationId } = parsed.data
    if (provider === NEMOTRON_TRANSCRIBE_ID && nemotronMeasured === undefined) {
      return reply.status(400).send({ error: { code: "validation_error", message: "The audio's length was not measured" } })
    }
    const unusable = unusableLinkError(audioUrl)
    if (unusable) return reply.status(400).send({ error: unusable })
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // A link to outside content on a deployment that turned link imports off
    // (lib/link-imports.ts): refused here, a social link or a direct file
    // alike, before any job row exists or credits are held.
    const switchRefusal = linkImportRefusal(audioUrl)
    if (switchRefusal) return reply.status(403).send({ error: switchRefusal })

    // A social link's sound is an import of the link (the worker extracts it
    // first, on the same test): the site's policy and the rights check (reads)
    // answer here, before any job row exists or credits are held; the worker
    // spends the confirmation when it fetches.
    if (isAllowedSocialVideoUrl(audioUrl)) {
      try {
        await requireImportAllowed(audioUrl, { userId, confirmationId, lane: "route", requestId: req.id, via: importViaOf(req) })
      } catch (e) {
        if (isImportRefusal(e)) return reply.status(403).send({ error: { code: e.code, message: e.message } })
        throw e
      }
    }

    // Determine model identifier for credit reservation
    const modelIdentifier = transcribeCreditId(req.body, provider)
    const mcpClient = extractMcpClient(req.body)
    // Nemotron: the measured length (when read) and the per-minute id it holds,
    // on the job (as Pitch & Tempo records them) and for the worker, which
    // settles at KIE's own length against that hold.
    const measured = provider === NEMOTRON_TRANSCRIBE_ID && nemotronMeasured !== undefined
      ? {
          ...(nemotronMeasured.durationSec !== undefined ? { duration_seconds: nemotronMeasured.durationSec } : {}),
          bucketKey: modelIdentifier,
        }
      : undefined

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: withResolvedModel({ ...buildJobInputData(parsed.data, "transcribe"), ...measured }, "transcribe"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await enqueueRouteJob(req, reply, job.id, () => videoQueue.add("transcribe", {
      jobId: job.id,
      audioUrl,
      provider,
      language,
      diarize,
      tagAudioEvents,
      wordTimestamps: parsed.data.wordTimestamps,
      ...(targetLanguage ? { targetLanguage } : {}),
      ...(measured ?? {}),
      usageLogId,
      // A link's sound is an import of the link: the confirmation, the way in
      // (and the connected app), for the worker's gate (`importRightsOf`).
      ...(confirmationId ? { confirmationId } : {}),
      ...importJobFields(req),
    }))
    if (reply.sent) return

    return { jobId: job.id }
  })
}
