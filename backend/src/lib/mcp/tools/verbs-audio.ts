import { z } from "zod"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { config } from "../../config.js"
import type { RegisterOpts } from "./verbs-image.js"
import {
  parseJobId,
  errorResult,
  parseFailure,
  jobResultWithWidget,
} from "./_verb-helpers.js"
// Audio enums stay hardcoded for now — Suno music + ElevenLabs dialogue
// route through different backends than the standard /v1/generate-music
// and /v1/text-to-speech endpoints, so the catalog's audio set is broader
// than what any single MCP tool can dispatch. Migrate when those routes
// unify.

const executeGate: ToolGate = { required: ["workflows:execute"] }

export function registerAudioVerbs({ server, session, fastify }: RegisterOpts): void {
  if (!passesGate(session, executeGate)) return

  // ── generate_music ──
  server.registerTool(
    "generate_music",
    {
      title: "Generate Music",
      description:
        "Generate a music track from a text prompt. Returns a job_id.\n\n" +
        "**Picking a model**: Default `suno-v5` is the latest — best vocal " +
        "quality, full songs with lyrics. `suno` is the v4 alias (same price). " +
        "`minimax` is an alternative for short instrumental loops. For " +
        "instrumental tracks set `instrumental: true`; for songs with vocals " +
        "provide `lyrics`.",
      inputSchema: {
        prompt: z.string().min(1).max(2000),
        model: z
          .enum(["suno-v5", "suno", "minimax"])
          .default("suno-v5")
          .describe(
            "Music model. Suno v5 (default) is latest with best vocal quality; " +
            "Suno v4 (id `suno`) is the prior generation; MiniMax for short loops.",
          ),
        duration: z.number().min(1).max(30).optional(),
        instrumental: z.boolean().optional(),
        lyrics: z.string().max(2000).optional(),
        genre: z.string().optional(),
        mood: z.string().optional(),
      },
              outputSchema: {
          jobId: z.string(),
          prompt: z.string().optional(),
          model: z.string().optional(),
          aspectRatio: z.string().optional(),
          resolution: z.string().optional(),
          duration: z.number().optional(),
          outputUrl: z.string().optional(),
        },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    _meta: {
      "ui/resourceUri": "ui://nodaro/widget/v3/job-audio",
      ui: {
        resourceUri: "ui://nodaro/widget/v3/job-audio",
        visibility: ["model", "app"],
      },
    },
    },
    async (args) => {
      // Suno and MiniMax live behind different backend routes — Suno has
      // its own /v1/suno/generate (with internal version select) while
      // MiniMax goes through /v1/generate-music. Dispatch by model id.
      const isSuno = args.model === "suno" || args.model === "suno-v5"
      const url = isSuno ? "/v1/suno/generate" : "/v1/generate-music"
      const sunoVersion = args.model === "suno-v5" ? "V5" : "V4"
      const payload = isSuno
        ? {
            prompt: args.prompt,
            model: sunoVersion,
            instrumental: args.instrumental,
            lyrics: args.lyrics,
            // Map mcp's generic `genre` to suno's `style` — same intent.
            style: args.genre,
            mcp_client: session.clientName,
            userId: session.userId,
          }
        : {
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
        url,
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResultWithWidget({
        jobId,
        label: "music generation",
        session,
        widgetKind: "audio",
        widgetData: {
          prompt: args.prompt,
          model: args.model,
          duration: args.duration,
        },
      })
    },
  )

  // ── generate_speech (text-to-speech) ──
  server.registerTool(
    "generate_speech",
    {
      title: "Generate Speech",
      description:
        "Generate speech from text using ElevenLabs. Returns a job_id.\n\n" +
        "**Picking a model**: `elevenlabs-v3` (default) supports `[audio tags]` " +
        "like `[laughs]`, `[whispers]`, `[sighs]` for emotion / pacing — best " +
        "for expressive narration. `elevenlabs-turbo` is cheaper for plain " +
        "narration. `elevenlabs-multilingual` for non-English. Call " +
        "`list_models { kind: \"audio\", mode: \"tts\" }` for the full sheet.",
      inputSchema: {
        text: z.string().min(1).max(5000),
        voice_id: z
          .string()
          .optional()
          .describe(
            "Voice — pass a premade voice NAME (recommended) or an " +
            "ElevenLabs UUID (only for custom voices the user has " +
            "explicitly cloned). DO NOT invent UUIDs — passing an " +
            "unknown UUID fails with 'voice_not_found'.\n\n" +
            "Premade names: Rachel, Aria, Roger, Sarah, Laura, Charlie, " +
            "George, Callum, River, Liam, Charlotte, Alice, Matilda, " +
            "Will, Jessica, Eric, Chris, Brian, Daniel, Lily, Bill.\n\n" +
            "If unsure pick by character: female warm = Rachel; female " +
            "young = Aria / Lily; male deep = Roger / Brian; male " +
            "neutral = George / Daniel; British = Charlie / Charlotte. " +
            "Defaults to Rachel.",
          ),
        model: z
          .enum([
            "elevenlabs-v3",
            "elevenlabs-turbo",
            "elevenlabs-multilingual",
            "elevenlabs",
          ])
          .default("elevenlabs-v3")
          .describe(
            "TTS model. Default `elevenlabs-v3` (newest) supports `[audio tags]` " +
            "like `[laughs]`, `[whispers]`, `[sighs]` for emotion. " +
            "`elevenlabs-turbo` is cheaper for plain narration. Call " +
            "list_models { kind: \"audio\", mode: \"tts\" } for the full sheet.",
          ),
        voice_type: z.enum(["premade", "custom", "library"]).optional(),
        stability: z.number().min(0).max(1).optional(),
        similarity_boost: z.number().min(0).max(1).optional(),
        style: z.number().min(0).max(1).optional(),
        speed: z.number().min(0.7).max(1.2).optional(),
        language_code: z.string().optional(),
      },
              outputSchema: {
          jobId: z.string(),
          prompt: z.string().optional(),
          model: z.string().optional(),
          aspectRatio: z.string().optional(),
          resolution: z.string().optional(),
          duration: z.number().optional(),
          outputUrl: z.string().optional(),
        },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    _meta: {
      "ui/resourceUri": "ui://nodaro/widget/v3/job-audio",
      ui: {
        resourceUri: "ui://nodaro/widget/v3/job-audio",
        visibility: ["model", "app"],
      },
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
      return jobResultWithWidget({
        jobId,
        label: "text-to-speech",
        session,
        widgetKind: "audio",
        widgetData: {
          prompt: args.text,
          model: args.model ?? "elevenlabs",
        },
      })
    },
  )

  // ── download_youtube_audio ──
  server.registerTool(
    "download_youtube_audio",
    {
      title: "Download YouTube Audio",
      description:
        "Extract the audio track from a YouTube video. Returns a job_id",
      inputSchema: {
        youtube_url: z.string().url().describe("YouTube video URL"),
      },
              outputSchema: {
          jobId: z.string(),
          prompt: z.string().optional(),
          model: z.string().optional(),
          aspectRatio: z.string().optional(),
          resolution: z.string().optional(),
          duration: z.number().optional(),
          outputUrl: z.string().optional(),
        },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    _meta: {
      "ui/resourceUri": "ui://nodaro/widget/v3/job-audio",
      ui: {
        resourceUri: "ui://nodaro/widget/v3/job-audio",
        visibility: ["model", "app"],
      },
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
      return jobResultWithWidget({
        jobId,
        label: "YouTube audio",
        session,
        widgetKind: "audio",
        widgetData: {
          prompt: args.youtube_url,
          model: "youtube-audio",
        },
      })
    },
  )
}
