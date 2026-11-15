/**
 * `generate_text` — Generate Text on any LLM, with media for it to read: the
 * MCP face of POST /v1/llm-chat/generate (the Generate Text node). Registered
 * beside `image_to_text` by `registerImageVerbs`. Unlisted while the deployment
 * does not offer the node to its users (`lib/mcp/tool-needs.ts`).
 *
 * The route answers in the same call, so the tool's result IS the answer, whole:
 * no job to poll and nothing cut. Before this tool an agent that wanted a model
 * to look at a video or listen to a recording had to build a workflow (an
 * upload node wired into a Generate Text node) and read the node's text back.
 *
 * Media is passed by link or by a Nodaro id (a job's output or an upload),
 * resolved for the caller only (`resolveRefArray`). The route owns every rule:
 * which model reads which kind, the per-kind limits, the content gate, the
 * frame-rate rule and the charge.
 */
import { z } from "zod"
import { LLM_REFERENCE_FILES_MAX } from "@nodaro/shared/llm-models"
import { LLM_TEXT_INPUT_MAX } from "@nodaro/shared/models"
import { LLM_VIDEO_FPS_MAX } from "../../llm/types.js"
import { mcpInject } from "../internal-request.js"
import type { RegisterOpts } from "./verbs-image.js"
import { errorResult, parseFailure, resolveRefArray } from "./_verb-helpers.js"
import { llmMcpFields, llmPayloadFields } from "./_llm-fields.js"
import { meteredLlmPriceSentence } from "./_credit-hint.js"

export const GENERATE_TEXT_TOOL = "generate_text"

/** The route's own per-kind limits (`llmChatBody` in `routes/llm-chat.ts`). */
export const GENERATE_TEXT_LIMITS = { images: 5, videos: 3, audios: 3 } as const

function refuse(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** A list of links or Nodaro ids, as a client sends it: an array, or one string. */
const mediaList = () => z.union([z.array(z.string()), z.string()]).optional()

export function generateTextDescription(): string {
  return (
    "Ask any LLM, with media for it to read: images, videos (picture and sound), audio and PDFs, each a link or a Nodaro id. " +
    "The whole answer is this call's result: no job to poll, nothing cut, no workflow to build. " +
    "Video and audio need a Gemini model; a PDF needs a model that reads documents. " +
    "To judge sound alone, pass the recording in `audio_urls` rather than its video. " +
    meteredLlmPriceSentence("llm-chat")
  )
}

export function registerGenerateTextVerb({ server, session, fastify }: RegisterOpts): void {
  server.registerTool(
    GENERATE_TEXT_TOOL,
    {
      title: "Generate Text",
      description: generateTextDescription(),
      inputSchema: {
        prompt: z.string().min(1).max(LLM_TEXT_INPUT_MAX).describe("What to ask or write."),
        system_prompt: z.string().max(LLM_TEXT_INPUT_MAX).optional().describe("The model's instructions: its role and the shape of the answer."),
        image_urls: mediaList().describe(`Up to ${GENERATE_TEXT_LIMITS.images} images (links or Nodaro ids).`),
        video_urls: mediaList().describe(`Up to ${GENERATE_TEXT_LIMITS.videos} videos (links or Nodaro ids), read with their sound.`),
        audio_urls: mediaList().describe(`Up to ${GENERATE_TEXT_LIMITS.audios} audio files (links or Nodaro ids).`),
        file_urls: z.array(z.string().url()).max(LLM_REFERENCE_FILES_MAX).optional().describe("PDF links."),
        video_fps: z
          .number()
          .gt(0)
          .max(LLM_VIDEO_FPS_MAX)
          .optional()
          .describe(
            "Frames sampled per second of each video (default 1). More frames cost more tokens; the sound is read the same. Needs advanced_mode on a Gemini model.",
          ),
        ...llmMcpFields("llm-chat"),
      },
      outputSchema: { jobId: z.string(), text: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      let images: string[]
      let videos: string[]
      let audios: string[]
      try {
        ;[images, videos, audios] = await Promise.all([
          resolveRefArray(args.image_urls, session.userId, "image", GENERATE_TEXT_LIMITS.images),
          resolveRefArray(args.video_urls, session.userId, "video", GENERATE_TEXT_LIMITS.videos),
          resolveRefArray(args.audio_urls, session.userId, "audio", GENERATE_TEXT_LIMITS.audios),
        ])
      } catch (err) {
        return refuse(`generate_text: ${messageOf(err)}`)
      }
      const payload: Record<string, unknown> = {
        // The route takes a system prompt always; none asked is an empty one.
        systemPrompt: args.system_prompt ?? "",
        userInput: args.prompt,
        ...(images.length > 0 ? { referenceImageUrls: images } : {}),
        ...(videos.length > 0 ? { referenceVideoUrls: videos } : {}),
        ...(args.video_fps !== undefined ? { referenceVideoFps: args.video_fps } : {}),
        ...(audios.length > 0 ? { referenceAudioUrls: audios } : {}),
        ...(args.file_urls && args.file_urls.length > 0 ? { referenceFileUrls: args.file_urls } : {}),
        ...llmPayloadFields(args),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await mcpInject(fastify, session, { method: "POST", url: "/v1/llm-chat/generate", payload })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      let answer: { jobId?: unknown; generatedText?: unknown }
      try {
        answer = JSON.parse(res.body) as { jobId?: unknown; generatedText?: unknown }
      } catch {
        return parseFailure(res.body)
      }
      if (typeof answer.jobId !== "string" || typeof answer.generatedText !== "string") return parseFailure(res.body)
      return {
        // The answer itself, whole: what the caller asked for is the text.
        content: [{ type: "text" as const, text: answer.generatedText }],
        structuredContent: { jobId: answer.jobId, text: answer.generatedText },
      }
    },
  )
}
