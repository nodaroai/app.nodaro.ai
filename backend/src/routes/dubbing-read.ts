import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import {
  DUBBING_CAPTION_FORMATS,
  DUBBING_LANGUAGE_STATUSES,
  DUBBING_SOURCE_LANGUAGE,
  type DubbingStructure,
} from "@nodaro/shared/media"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { CAPTION_CONTENT_TYPES } from "../lib/dubbing-captions.js"
import { DUBBING_PROBLEMS, dubbingProblemBody, type DubbingProblem } from "../lib/dubbing-problems.js"
import { readDubbingCaptions, readDubbingStructure } from "../lib/dubbing-read-service.js"

/**
 * The two reads of a dub that is already made (lib/dubbing-read-service.ts):
 *
 *   GET /v1/dubbing/:jobId           its structure: the original lines, every
 *                                    language with its lines, the speakers,
 *                                    what can be done to it now, and what
 *                                    adding a language is charged.
 *   GET /v1/dubbing/:jobId/captions  the captions of one language, or of the
 *                                    original speech, as the text of an SRT or
 *                                    WebVTT file.
 *
 * `:jobId` is the job the dub was created by, or the job of a language added
 * to it later: both read the same dub. The owner only, as a rating: anyone
 * else's job, an admin's request included, is `404 not_found`. Free, and
 * nothing is written. An OAuth app needs `assets:read`. No cache keeps an
 * answer: it is the owner's alone, and it changes while a language is made.
 *
 * A refusal answers its row of DUBBING_PROBLEMS. What the dubbing service
 * said when it did not answer goes to the server log, never to the caller.
 */

const jobIdParams = z.object({ jobId: z.string().uuid() })

// `language` is bounded as the create call bounds `targetLanguage`; which
// codes this dub has is the read's own answer (`dubbing_language_not_found`).
const captionsQuery = z.object({
  language: z
    .string()
    .trim()
    .min(2)
    .max(10)
    .describe(`A language code the dub lists (\`es\`, \`pt-BR\`), or \`${DUBBING_SOURCE_LANGUAGE}\` for the original speech.`),
  format: z.enum(DUBBING_CAPTION_FORMATS).default("srt").describe("`srt` (SubRip, the default) or `vtt` (WebVTT)."),
})

const sourceSegmentSchema = z.object({
  id: z.string(),
  speakerId: z.string().nullable(),
  start: z.number().describe("Seconds from the start of the media."),
  end: z.number().describe("Seconds from the start of the media."),
  text: z.string(),
})

const segmentSchema = sourceSegmentSchema.extend({
  sourceSegmentId: z
    .string()
    .nullable()
    .describe("The id of the source line this one translates; null where the dub's lines carry no link to the source lines."),
  sourceText: z
    .string()
    .nullable()
    .describe(
      "The original text this line translates, as the dub keeps it beside the line; null where it keeps none. " +
        "It can be told where sourceSegmentId is null.",
    ),
})

// Typed against the shared contract, so a field added there fails the
// typecheck here until the document tells it too.
const structureSchema: z.ZodType<DubbingStructure> = z.object({
  jobId: z.string().uuid().describe("The job the dub was created by. Languages added later hang off it."),
  durationSec: z.number().nullable().describe("Seconds of media the dub covers; null when not known."),
  source: z
    .object({ language: z.string().nullable(), segments: z.array(sourceSegmentSchema) })
    .nullable()
    .describe("The original speech; null when its lines are not readable."),
  languages: z.array(
    z.object({
      code: z.string().describe("The language code the dub was asked for; unique within a dub."),
      jobId: z
        .string()
        .uuid()
        .nullable()
        .describe("The job whose result is this language's dubbed media; null when no job of the account holds it."),
      status: z.enum(DUBBING_LANGUAGE_STATUSES),
      segments: z.array(segmentSchema).describe("Empty unless `status` is `completed` or `stale`."),
    }),
  ),
  speakers: z.array(
    z.object({
      id: z.string().describe("The `speakerId` its lines carry."),
      name: z.string().nullable(),
      voice: z.object({ id: z.string(), name: z.string().nullable(), previewUrl: z.string().nullable() }).nullable(),
      segmentCount: z.number().int(),
    }),
  ),
  capabilities: z
    .object({
      editSegments: z.boolean(),
      regenerate: z.boolean(),
      setSpeakerVoice: z.boolean(),
      render: z.boolean(),
      addLanguage: z.boolean(),
      captions: z.boolean(),
    })
    .describe("What can be done to this dub now. Offer an action only when its capability is true."),
  addLanguage: z
    .object({
      billableMinutes: z.number().int().nullable(),
      creditId: z.string().nullable(),
      creditIdByLanguage: z.record(z.string(), z.string()),
    })
    .describe(
      "What adding a language is charged: the answer of `POST /v1/credits/model-costs` for `creditIdByLanguage[language] ?? creditId`. " +
        "Both are null when the length is only known once it runs.",
    ),
})

const READ_LIMIT = { rateLimit: { max: 60, timeWindow: "1 minute" } }

const WHICH_JOB =
  "`jobId` is the job the dub was created by, or the job of a language added to it later: both read the same dub. " +
  "The owner only: anyone else's job is `404 not_found`. Free. OAuth apps need `assets:read`."

const READ_REFUSALS = {
  401: { description: "Unauthorized" },
  403: { description: "An OAuth token without assets:read" },
  409: { description: "`dubbing_not_ready`: the dub is still being made" },
  410: { description: "`dubbing_unavailable`: the dub is no longer held where it was made" },
  502: { description: "`dubbing_read_failed`: the dubbing service did not answer; try again" },
}

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/dubbing/{jobId}",
  description:
    "Read a dub that is already made: the original lines, every language it speaks with its lines, the speakers, what can be done to it now (`capabilities`), " +
    `and what adding a language is charged. ${WHICH_JOB}`,
  security: [{ bearerAuth: [] }],
  request: { params: jobIdParams },
  responses: {
    200: { description: "The dub's structure", content: { "application/json": { schema: structureSchema } } },
    ...READ_REFUSALS,
    404: { description: "Job not found (or not yours)" },
    422: { description: "`not_a_dubbing_job`: the job is not a dub. `dubbing_failed`: the dub was not made" },
  },
})

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/dubbing/{jobId}/captions",
  description:
    "Export the captions of one language of a dub, or of its original speech (`language=source`), as the text of a SubRip or WebVTT file. " +
    `A language is exported once its status is \`completed\` or \`stale\`, as long as the dubbing service gives its captions. ${WHICH_JOB}`,
  security: [{ bearerAuth: [] }],
  request: { params: jobIdParams, query: captionsQuery },
  responses: {
    200: {
      description: "The caption file's text, in the format asked for",
      content: { "application/x-subrip": { schema: z.string() }, "text/vtt": { schema: z.string() } },
    },
    400: { description: "A missing or malformed `language`, or a `format` that is not `srt` or `vtt`" },
    ...READ_REFUSALS,
    404: { description: "Job not found (or not yours). `dubbing_language_not_found`: the dub has no such language" },
    409: {
      description:
        "`dubbing_not_ready`: the dub is still being made. " +
        "`dubbing_language_processing`: that language is still being made",
    },
    422: {
      description:
        "`not_a_dubbing_job`: the job is not a dub. `dubbing_failed`: the dub was not made. " +
        "`dubbing_captions_unavailable`: that language has no captions to export (it failed, or the dubbing service does not give them)",
    },
  },
})

interface AskedDub {
  readonly userId: string
  readonly jobId: string
}

/** Who asks, and about which job. null once the request is refused: the reply is sent. */
function askedDub(req: FastifyRequest, reply: FastifyReply): AskedDub | null {
  if (!req.userId) {
    void reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    return null
  }
  // An id that cannot be a job is no job of theirs.
  const params = jobIdParams.safeParse(req.params)
  if (!params.success) {
    void reply.status(404).send(dubbingProblemBody(DUBBING_PROBLEMS.notFound))
    return null
  }
  return { userId: req.userId, jobId: params.data.jobId }
}

/** A refusal's answer. What went wrong underneath is logged here and never sent. */
function refuse(
  req: FastifyRequest,
  reply: FastifyReply,
  jobId: string,
  refusal: { readonly problem: DubbingProblem; readonly cause?: unknown },
): FastifyReply {
  if (refusal.cause !== undefined) {
    req.log.warn({ err: refusal.cause, jobId }, "dubbing: the dubbing service did not answer a read")
  }
  return reply.status(refusal.problem.status).send(dubbingProblemBody(refusal.problem))
}

export async function dubbingReadRoutes(app: FastifyInstance): Promise<void> {
  // The owner's alone, and it changes while a language is made: no cache
  // keeps an answer, a refusal included.
  app.addHook("onRequest", async (_req, reply) => {
    reply.header("Cache-Control", "private, no-store")
  })

  const read = { preHandler: requireAppScope("assets:read"), config: READ_LIMIT }

  app.get("/v1/dubbing/:jobId", read, async (req, reply) => {
    const asked = askedDub(req, reply)
    if (!asked) return reply
    let outcome
    try {
      outcome = await readDubbingStructure(asked.userId, asked.jobId)
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to read the dub")
    }
    if (!outcome.ok) return refuse(req, reply, asked.jobId, outcome)
    return outcome.value
  })

  app.get("/v1/dubbing/:jobId/captions", read, async (req, reply) => {
    const asked = askedDub(req, reply)
    if (!asked) return reply
    const query = captionsQuery.safeParse(req.query ?? {})
    if (!query.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(query.error) } })
    }
    let outcome
    try {
      outcome = await readDubbingCaptions(asked.userId, asked.jobId, query.data)
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to read the dub's captions")
    }
    if (!outcome.ok) return refuse(req, reply, asked.jobId, outcome)
    return reply.type(CAPTION_CONTENT_TYPES[query.data.format]).send(outcome.value)
  })
}
