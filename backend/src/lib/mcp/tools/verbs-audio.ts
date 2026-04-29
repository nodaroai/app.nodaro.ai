import { z } from "zod"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { config } from "../../config.js"
import type { RegisterOpts } from "./verbs-image.js"

const executeGate: ToolGate = { required: ["workflows:execute"] }

interface ParsedJobBody {
  jobId?: string
  job_id?: string
  id?: string
}

function parseJobId(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as ParsedJobBody
    return parsed.jobId ?? parsed.job_id ?? parsed.id ?? null
  } catch {
    return null
  }
}

function jobResult(jobId: string, label: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Submitted ${label} job ${jobId}. Track via tasks/get with task_id=${jobId} or open: https://app.nodaro.ai/library/jobs/${jobId}`,
      },
    ],
    _meta: { task_id: jobId },
  }
}

function errorResult(statusCode: number, body: string) {
  return {
    content: [{ type: "text" as const, text: `Error from Nodaro: ${statusCode} ${body}` }],
    isError: true,
  }
}

function parseFailure(body: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Submitted but couldn't parse job_id from response: ${body}`,
      },
    ],
    isError: true,
  }
}

export function registerAudioVerbs({ server, session, fastify }: RegisterOpts): void {
  if (!passesGate(session, executeGate)) return

  // ── generate_music ──
  server.registerTool(
    "generate_music",
    {
      title: "Generate Music",
      description:
        "Generate a music track from a text prompt (Suno or MiniMax). Returns a job_id; poll via tasks/get.",
      inputSchema: {
        prompt: z.string().min(1).max(2000),
        model: z.enum(["suno", "minimax"]).default("minimax"),
        duration: z.number().min(1).max(30).optional(),
        instrumental: z.boolean().optional(),
        lyrics: z.string().max(2000).optional(),
        genre: z.string().optional(),
        mood: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const payload = {
        prompt: args.prompt,
        provider: args.model,
        duration: args.duration,
        instrumental: args.instrumental,
        lyrics: args.lyrics,
        genre: args.genre,
        mood: args.mood,
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/generate-music",
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResult(jobId, "music generation")
    },
  )

  // ── generate_speech (text-to-speech) ──
  server.registerTool(
    "generate_speech",
    {
      title: "Generate Speech",
      description:
        "Generate speech from text using ElevenLabs (v3 supports [audio tags]; v2/turbo route via KIE). Returns a job_id; poll via tasks/get.",
      inputSchema: {
        text: z.string().min(1).max(5000),
        voice_id: z.string().optional().describe("ElevenLabs voice id (premade or custom)"),
        model: z
          .enum([
            "elevenlabs-v3",
            "elevenlabs-turbo",
            "elevenlabs-multilingual",
            "elevenlabs",
          ])
          .optional(),
        voice_type: z.enum(["premade", "custom", "library"]).optional(),
        stability: z.number().min(0).max(1).optional(),
        similarity_boost: z.number().min(0).max(1).optional(),
        style: z.number().min(0).max(1).optional(),
        speed: z.number().min(0.7).max(1.2).optional(),
        language_code: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const payload = {
        text: args.text,
        voice: args.voice_id,
        provider: args.model,
        voiceType: args.voice_type,
        stability: args.stability,
        similarityBoost: args.similarity_boost,
        style: args.style,
        speed: args.speed,
        languageCode: args.language_code,
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/text-to-speech",
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResult(jobId, "text-to-speech")
    },
  )

  // ── download_youtube_audio ──
  server.registerTool(
    "download_youtube_audio",
    {
      title: "Download YouTube Audio",
      description:
        "Extract the audio track from a YouTube video. Returns a job_id; poll via tasks/get.",
      inputSchema: {
        youtube_url: z.string().url().describe("YouTube video URL"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const payload = {
        youtubeUrl: args.youtube_url,
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/extract-youtube-audio",
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResult(jobId, "YouTube audio")
    },
  )
}
