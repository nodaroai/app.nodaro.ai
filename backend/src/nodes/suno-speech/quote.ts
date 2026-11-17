// The price of a Suno Speech run before it starts (POST /v1/quote): the run
// route's own body and pricing chain, declared once. route.ts registers the
// same chain as its preHandlers, so a quote and a run read one schema and one
// price — the node's flat row, for the run's two takes.
import type { FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { SUNO_SPEECH_LIMITS, SUNO_SPEECH_MODES, SUNO_SPEECH_VOCAL_GENDERS, sunoSpeechProblem, sunoSpeechRun } from "@nodaro/render-rules"
import type { UnitQuote } from "../kit.js"
import { formatZodError } from "../../lib/zod-error.js"
import { descriptor } from "./descriptor.generated.js"

// Brief (`mode: "brief"`, the default): `prompt`, a one-line scene. Script
// (`mode: "script"`): `script`, plus `tone`, `variety`, `vocalGender` and
// `backgroundMusic`. The fields of the other mode are accepted and not sent
// (the provider takes the two sets apart). The caller is req.userId (auth),
// never the body. `sessionId` / `origin` are read by the job funnel (insertJob).
// The limits are part of the schema, counted as the provider counts them
// (after trimming, on the mode's own fields): an empty brief or script, one
// over its cap, a tone over 1,000. The raw strings get twice the cap so that
// padding is trimmed, not refused.
function buildBody() {
  return z.object({
    mode: z.enum(SUNO_SPEECH_MODES).optional(),
    prompt: z.string().max(SUNO_SPEECH_LIMITS.promptMax * 2).optional(),
    script: z.string().max(SUNO_SPEECH_LIMITS.scriptMax * 2).optional(),
    tone: z.string().max(SUNO_SPEECH_LIMITS.toneMax * 2).optional(),
    variety: z.number().int().min(SUNO_SPEECH_LIMITS.varietyMin).max(SUNO_SPEECH_LIMITS.varietyMax).optional(),
    vocalGender: z.enum(SUNO_SPEECH_VOCAL_GENDERS).optional(),
    backgroundMusic: z.boolean().optional(),
    userId: z.string().uuid().optional(),
  }).superRefine((b, ctx) => {
    const run = sunoSpeechRun(b)
    const problem = sunoSpeechProblem(run)
    if (!problem) return
    // The script is judged before the tone, so a tone is the problem only under a script that passes.
    const scriptLength = run.script?.length ?? 0
    const scriptFits = scriptLength > 0 && scriptLength <= SUNO_SPEECH_LIMITS.scriptMax
    const field = run.mode === "brief" ? "prompt" : scriptFits ? "tone" : "script"
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: problem })
  })
}

let body: ReturnType<typeof buildBody> | undefined

/** POST /v1/suno-speech's body (built on first use: a unit module runs no code while it loads). */
export function sunoSpeechBody(): ReturnType<typeof buildBody> {
  body ??= buildBody()
  return body
}

/**
 * Validate FIRST, so a malformed request hears the 400 that names its problem
 * rather than a 402: the schema, limits included.
 */
async function validateSunoSpeech(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const parsed = sunoSpeechBody().safeParse(req.body)
  if (!parsed.success) return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
  return undefined
}

export const quote: UnitQuote = {
  body: sunoSpeechBody,
  pricing: {
    prechecks: [validateSunoSpeech],
    // Flat: every run holds the node's own row (price.ee.ts).
    modelResolver: () => descriptor.type,
  },
}
