import { z } from "zod"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { config } from "../../config.js"
import { supabase } from "../../supabase.js"
import { resolveAssetId } from "../asset-resolver.js"
import type { RegisterOpts } from "./verbs-image.js"
import {
  parseJobId,
  errorResult,
  parseFailure,
  jobResultWithWidget,
} from "./_verb-helpers.js"
import { SUNO_MODELS, SUNO_ADD_TRACK_MODELS } from "@nodaro/shared"

/**
 * Look up the Suno task / track ids stored on a completed Nodaro job's
 * output_data. The Suno follow-up endpoints (extend / cover / separate /
 * add-instrumental / replace-section / etc.) all key off these ids rather
 * than the audio URL — they're internal to KIE's Suno wrapper.
 *
 * Returns null when the job isn't a Suno generation or the ids are missing
 * (e.g. minimax music — no Suno ids written). Caller should error in that
 * case so the user knows to point at a Suno track specifically.
 */
async function resolveSunoIds(
  jobId: string,
  userId: string,
): Promise<{ sunoTaskId: string; sunoTrackId: string } | null> {
  const { data } = await supabase
    .from("jobs")
    .select("output_data, user_id, is_public, status")
    .eq("id", jobId)
    .maybeSingle()
  if (!data) return null
  // Allow caller's own jobs OR public completed jobs (mirrors get_asset).
  const isOwn = data.user_id === userId
  const isPublic = data.is_public === true && data.status === "completed"
  if (!isOwn && !isPublic) return null
  const out = (data.output_data ?? {}) as Record<string, unknown>
  const sunoTaskId = out.sunoTaskId as string | undefined
  const sunoTrackId = out.sunoTrackId as string | undefined
  if (!sunoTaskId || !sunoTrackId) return null
  return { sunoTaskId, sunoTrackId }
}
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
        prompt: z.string().min(1).max(8000),
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

  // ── voice_changer ──
  // Re-voice an existing audio track via ElevenLabs. The voice_id can be a
  // premade voice name (Rachel, Aria, ...) or a custom-clone UUID.
  server.registerTool(
    "voice_changer",
    {
      title: "Voice Changer",
      description:
        "Replace the voice on an existing audio track while preserving the " +
        "delivery / cadence (ElevenLabs Voice Changer). Provide ONE audio " +
        "source — audio_url OR audio_asset_id (a Nodaro audio job id) — " +
        "plus a target voice_id.\n\n" +
        "Use the same voice naming as `generate_speech`: pass a premade " +
        "voice NAME (Rachel, Aria, Roger, ...) or an ElevenLabs UUID for " +
        "a custom clone. Don't invent UUIDs — passing an unknown one fails.",
      inputSchema: {
        audio_url: z.string().url().optional(),
        audio_asset_id: z.string().optional(),
        voice_id: z.string().min(1).describe("Target voice — premade name (Rachel, Aria, Roger, ...) or ElevenLabs UUID for a custom clone."),
        stability: z.number().min(0).max(1).optional(),
        similarity_boost: z.number().min(0).max(1).optional(),
        remove_background_noise: z.boolean().optional(),
      },
      outputSchema: {
        jobId: z.string(),
        prompt: z.string().optional(),
        model: z.string().optional(),
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
      const audioUrl =
        args.audio_url ??
        (args.audio_asset_id
          ? await resolveAssetId({
              assetId: args.audio_asset_id,
              userId: session.userId,
              expectedKind: "audio",
            })
          : null)
      if (!audioUrl) {
        return {
          content: [
            { type: "text", text: "Pass audio_url or audio_asset_id." },
          ],
          isError: true,
        }
      }
      const payload = {
        audioUrl,
        voiceId: args.voice_id,
        stability: args.stability,
        similarityBoost: args.similarity_boost,
        removeBackgroundNoise: args.remove_background_noise,
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/voice-changer",
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
        label: "voice changer",
        session,
        widgetKind: "audio",
        widgetData: { prompt: `voice → ${args.voice_id}`, model: "elevenlabs-voice-changer" },
      })
    },
  )

  // ── dubbing ──
  server.registerTool(
    "dubbing",
    {
      title: "Dubbing",
      description:
        "Translate audio into another language while preserving the voice " +
        "and timing (ElevenLabs Dubbing). Provide ONE audio source — " +
        "audio_url OR audio_asset_id — and a target_language code.\n\n" +
        "Common language codes: en, es, fr, de, it, pt, pl, hi, ja, zh, ko, " +
        "ar, ru, tr, nl, sv, id. Pass num_speakers when the source has " +
        "multiple distinct voices (improves separation).",
      inputSchema: {
        audio_url: z.string().url().optional(),
        audio_asset_id: z.string().optional(),
        target_language: z
          .string()
          .min(2)
          .max(10)
          .describe("Target language code (en, es, fr, de, it, pt, hi, ja, zh, ar, ...)."),
        source_language: z
          .string()
          .min(2)
          .max(10)
          .optional()
          .describe("Optional source-language hint. ElevenLabs auto-detects when omitted."),
        num_speakers: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Number of distinct voices in the source (improves separation)."),
      },
      outputSchema: {
        jobId: z.string(),
        prompt: z.string().optional(),
        model: z.string().optional(),
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
      const audioUrl =
        args.audio_url ??
        (args.audio_asset_id
          ? await resolveAssetId({
              assetId: args.audio_asset_id,
              userId: session.userId,
              expectedKind: "audio",
            })
          : null)
      if (!audioUrl) {
        return {
          content: [
            { type: "text", text: "Pass audio_url or audio_asset_id." },
          ],
          isError: true,
        }
      }
      const payload = {
        audioUrl,
        targetLanguage: args.target_language,
        sourceLanguage: args.source_language,
        numSpeakers: args.num_speakers,
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/dubbing",
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
        label: "dubbing",
        session,
        widgetKind: "audio",
        widgetData: { prompt: `dub → ${args.target_language}`, model: "elevenlabs-dubbing" },
      })
    },
  )

  // ── voice_design ──
  // Generate a custom voice from a description; ElevenLabs returns a sample.
  server.registerTool(
    "voice_design",
    {
      title: "Voice Design",
      description:
        "Design a custom voice from a free-text description and a sample " +
        "script (ElevenLabs Voice Design). Returns an audio sample of the " +
        "designed voice — use it to preview before cloning.\n\n" +
        "**`text`** must be 100–1000 characters of script for the voice to " +
        "speak. **`voice_description`** is the design prompt — gender, age, " +
        "accent, tone, character (e.g. \"warm female narrator with a soft " +
        "British accent, low-pitched, calm pacing\").",
      inputSchema: {
        text: z
          .string()
          .min(100)
          .max(1000)
          .describe("Sample script (100–1000 chars) the designed voice will speak."),
        voice_description: z
          .string()
          .min(1)
          .max(1000)
          .describe("Free-text description of the voice (gender, age, accent, tone)."),
        loudness: z.number().min(-1).max(1).optional(),
        guidance_scale: z.number().min(0).max(100).optional(),
        seed: z.number().int().optional(),
        quality: z.number().optional(),
        should_enhance: z.boolean().optional(),
      },
      outputSchema: {
        jobId: z.string(),
        prompt: z.string().optional(),
        model: z.string().optional(),
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
        voiceDescription: args.voice_description,
        loudness: args.loudness,
        guidanceScale: args.guidance_scale,
        seed: args.seed,
        quality: args.quality,
        shouldEnhance: args.should_enhance,
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/voice-design",
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
        label: "voice design",
        session,
        widgetKind: "audio",
        widgetData: { prompt: args.voice_description, model: "elevenlabs-voice-design" },
      })
    },
  )

  // ── voice_clone ──
  // Wraps the JSON variant of /v1/voice-clones (the multipart route is for
  // direct browser uploads). Caller passes a sample audio URL + a name; the
  // backend fetches the audio, registers the voice with ElevenLabs, and
  // returns the new voice id (NOT a media URL — voices are long-lived
  // resources, not one-off generations).
  server.registerTool(
    "voice_clone",
    {
      title: "Voice Clone",
      description:
        "Clone a voice from a sample audio file (ElevenLabs Instant Voice " +
        "Clone). Provide a sample (audio_url or audio_asset_id from a " +
        "Nodaro audio job) and a name for the clone.\n\n" +
        "Returns the new ElevenLabs voice_id — pass it to `generate_speech` " +
        "or `voice_changer` as the voice_id to use the cloned voice.\n\n" +
        "Sample requirements: 30s–10min of CLEAN speech, single speaker, " +
        "minimal background noise. The route enforces a 10MB cap.",
      inputSchema: {
        audio_url: z.string().url().optional(),
        audio_asset_id: z.string().optional(),
        name: z
          .string()
          .min(1)
          .max(200)
          .describe("Name for the cloned voice (shows up in the user's voice list)."),
      },
      outputSchema: {
        jobId: z.string(),
        voiceId: z.string().optional(),
        name: z.string().optional(),
        sampleAudioUrl: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      // No widget — voice clones aren't playable media; the caller wants the
      // voice_id back, not an iframe preview.
    },
    async (args) => {
      const audioUrl =
        args.audio_url ??
        (args.audio_asset_id
          ? await resolveAssetId({
              assetId: args.audio_asset_id,
              userId: session.userId,
              expectedKind: "audio",
            })
          : null)
      if (!audioUrl) {
        return {
          content: [
            { type: "text", text: "Pass audio_url or audio_asset_id." },
          ],
          isError: true,
        }
      }
      const payload = {
        audioUrl,
        name: args.name,
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/voice-clones/from-url",
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      let parsed: { jobId?: string; id?: string; elevenlabsVoiceId?: string; name?: string; sampleAudioUrl?: string }
      try {
        parsed = JSON.parse(res.body)
      } catch {
        return parseFailure(res.body)
      }
      const jobId = parsed.jobId ?? parsed.id
      if (!jobId) return parseFailure(res.body)
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Voice clone "${parsed.name}" created. ` +
              `voice_id: ${parsed.elevenlabsVoiceId} — pass it to generate_speech or voice_changer.`,
          },
        ],
        structuredContent: {
          jobId,
          voiceId: parsed.elevenlabsVoiceId,
          name: parsed.name,
          sampleAudioUrl: parsed.sampleAudioUrl,
        },
      }
    },
  )

  // ── suno_separate_stems ──
  // Splits a Suno track into vocals + instrumental (or up to N stems).
  // Resolves Suno's internal taskId/audioId from the source Nodaro job's
  // output_data — callers only pass the Nodaro job_id of the Suno track.
  server.registerTool(
    "suno_separate_stems",
    {
      title: "Suno Separate Stems",
      description:
        "Separate a Suno-generated track into vocals + instrumental " +
        "(`separate_vocal`) or full per-instrument stems (`split_stem`). " +
        "Pass the Nodaro audio_asset_id of a Suno generation — non-Suno " +
        "tracks (minimax, ElevenLabs, etc.) cannot be separated this way.",
      inputSchema: {
        audio_asset_id: z
          .string()
          .min(1)
          .describe("Nodaro audio job id of a Suno generation (sunoTaskId/sunoTrackId are looked up server-side)."),
        type: z
          .enum(["separate_vocal", "split_stem"])
          .optional()
          .describe("`separate_vocal` (default) = vocals + instrumental. `split_stem` = full multi-stem split."),
      },
      outputSchema: {
        jobId: z.string(),
        prompt: z.string().optional(),
        model: z.string().optional(),
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
      const ids = await resolveSunoIds(args.audio_asset_id, session.userId)
      if (!ids) {
        return {
          content: [
            {
              type: "text",
              text:
                "Could not find Suno taskId/audioId for asset " +
                args.audio_asset_id +
                ". Pass a Nodaro audio job id from a Suno generation.",
            },
          ],
          isError: true,
        }
      }
      const payload = {
        taskId: ids.sunoTaskId,
        audioId: ids.sunoTrackId,
        type: args.type ?? "separate_vocal",
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/suno/separate",
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
        label: "stem separation",
        session,
        widgetKind: "audio",
        widgetData: { prompt: args.type ?? "separate_vocal", model: "suno-separate" },
      })
    },
  )

  // ── suno_music_video ──
  // Generates an MP4 music video clip for a Suno-generated track. The KIE
  // endpoint is input-only (no style / prompt control) — it derives visuals
  // from the source audio. Resolves Suno taskId/audioId server-side from
  // the source Nodaro job's output_data.
  server.registerTool(
    "suno_music_video",
    {
      title: "Suno Music Video",
      description:
        "Generate an MP4 music video for a Suno track. Pass the Nodaro " +
        "audio_asset_id of a Suno generation — non-Suno tracks (minimax, " +
        "ElevenLabs, etc.) cannot be turned into music videos this way. " +
        "The visuals are derived from the audio; there are no style or " +
        "prompt controls.",
      inputSchema: {
        audio_asset_id: z
          .string()
          .min(1)
          .describe("Nodaro audio job id of a Suno generation (sunoTaskId/sunoTrackId are looked up server-side)."),
      },
      outputSchema: {
        jobId: z.string(),
        prompt: z.string().optional(),
        model: z.string().optional(),
        outputUrl: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v3/job-video",
        ui: {
          resourceUri: "ui://nodaro/widget/v3/job-video",
          visibility: ["model", "app"],
        },
      },
    },
    async (args) => {
      const ids = await resolveSunoIds(args.audio_asset_id, session.userId)
      if (!ids) {
        return {
          content: [
            {
              type: "text",
              text:
                "Could not find Suno taskId/audioId for asset " +
                args.audio_asset_id +
                ". Pass a Nodaro audio job id from a Suno generation.",
            },
          ],
          isError: true,
        }
      }
      const payload = {
        taskId: ids.sunoTaskId,
        audioId: ids.sunoTrackId,
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/suno/music-video",
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
        label: "Suno music video",
        session,
        widgetKind: "video",
        widgetData: { prompt: "(music video)", model: "suno-music-video" },
      })
    },
  )

  // ── suno_extend ──
  server.registerTool(
    "suno_extend",
    {
      title: "Suno Extend",
      description:
        "Extend a Suno-generated track with more music. Pass the Nodaro " +
        "audio_asset_id of the source Suno track; optionally provide a new " +
        "prompt / style / continueAt timestamp to steer the extension.",
      inputSchema: {
        audio_asset_id: z
          .string()
          .min(1)
          .describe("Nodaro audio job id of a Suno generation."),
        prompt: z.string().max(5000).optional(),
        style: z.string().max(1000).optional(),
        title: z.string().max(80).optional(),
        continue_at: z
          .number()
          .min(0)
          .optional()
          .describe("Timestamp (seconds) in the source where the extension picks up. Omit for default."),
        model: z.enum(["V4", "V5"]).optional().describe("Suno version. Default V5 (latest)."),
        vocal_gender: z.enum(["male", "female"]).optional(),
      },
      outputSchema: {
        jobId: z.string(),
        prompt: z.string().optional(),
        model: z.string().optional(),
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
      const ids = await resolveSunoIds(args.audio_asset_id, session.userId)
      if (!ids) {
        return {
          content: [
            {
              type: "text",
              text:
                "Could not find Suno taskId/audioId for asset " +
                args.audio_asset_id +
                ". Pass a Nodaro audio job id from a Suno generation.",
            },
          ],
          isError: true,
        }
      }
      const payload = {
        audioId: ids.sunoTrackId,
        // taskId is NOT in the extend body schema, but the route reads
        // sunoTaskId off the source job under the hood. Pass for safety.
        taskId: ids.sunoTaskId,
        prompt: args.prompt,
        style: args.style,
        title: args.title,
        continueAt: args.continue_at,
        model: args.model ?? "V5",
        vocalGender: args.vocal_gender,
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/suno/extend",
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
        label: "Suno extend",
        session,
        widgetKind: "audio",
        widgetData: { prompt: args.prompt ?? "(extend)", model: args.model === "V4" ? "suno" : "suno-v5" },
      })
    },
  )

  // ── suno_cover ──
  server.registerTool(
    "suno_cover",
    {
      title: "Suno Cover",
      description:
        "Cover an audio track with a new Suno style — same melody / lyrics, " +
        "different musical treatment. Provide the source via audio_url OR " +
        "audio_asset_id (any Nodaro audio job, not just Suno). Required: a " +
        "`prompt` describing the cover style.\n\n" +
        "Set `instrumental: true` for a vocal-stripped instrumental cover. " +
        "Provide `lyrics` to override the lyrics; otherwise Suno reuses what " +
        "it transcribes from the source.",
      inputSchema: {
        prompt: z.string().min(1).max(3000).describe("Style description for the cover."),
        audio_url: z.string().url().optional(),
        audio_asset_id: z.string().optional(),
        lyrics: z.string().max(3000).optional(),
        style: z.string().max(500).optional(),
        title: z.string().max(200).optional(),
        instrumental: z.boolean().optional(),
        custom_mode: z.boolean().optional(),
        vocal_gender: z.enum(["male", "female"]).optional(),
        model: z.enum(["V4", "V5"]).optional().describe("Suno version. Default V5."),
      },
      outputSchema: {
        jobId: z.string(),
        prompt: z.string().optional(),
        model: z.string().optional(),
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
      const audioUrl =
        args.audio_url ??
        (args.audio_asset_id
          ? await resolveAssetId({
              assetId: args.audio_asset_id,
              userId: session.userId,
              expectedKind: "audio",
            })
          : null)
      if (!audioUrl) {
        return {
          content: [
            { type: "text", text: "Pass audio_url or audio_asset_id." },
          ],
          isError: true,
        }
      }
      const payload = {
        prompt: args.prompt,
        uploadUrl: audioUrl,
        model: args.model ?? "V5",
        lyrics: args.lyrics,
        style: args.style,
        title: args.title,
        instrumental: args.instrumental ?? false,
        customMode: args.custom_mode ?? false,
        vocalGender: args.vocal_gender,
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/suno/cover",
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
        label: "Suno cover",
        session,
        widgetKind: "audio",
        widgetData: { prompt: args.prompt, model: args.model === "V4" ? "suno" : "suno-v5" },
      })
    },
  )

  // ── trim_audio ──
  // FFmpeg-based audio trim. The underlying route uses `-vn` so the input
  // can be either an audio file OR a video file (it strips video and
  // returns audio either way). Hence both audio_url/audio_asset_id AND
  // video_url/video_asset_id are accepted — the same endpoint handles
  // both flows.
  server.registerTool(
    "trim_audio",
    {
      title: "Trim Audio",
      description:
        "Trim audio to a time window, or extract+trim audio from a video. " +
        "Pass ONE source — audio_url / audio_asset_id (audio file) OR " +
        "video_url / video_asset_id (extract audio from video). " +
        "Optional start_time / end_time in seconds; omitting both keeps " +
        "the full track. Output format defaults to mp3 (also accepts wav, aac).",
      inputSchema: {
        audio_url: z.string().url().optional(),
        audio_asset_id: z.string().optional(),
        video_url: z.string().url().optional(),
        video_asset_id: z.string().optional(),
        start_time: z
          .number()
          .min(0)
          .optional()
          .describe("Start of the trim window in seconds. Omit to keep the start of the source."),
        end_time: z
          .number()
          .min(0)
          .optional()
          .describe("End of the trim window in seconds. Omit to keep the end of the source."),
        audio_format: z
          .enum(["mp3", "wav", "aac"])
          .optional()
          .describe("Output audio format. Default mp3."),
      },
      outputSchema: {
        jobId: z.string(),
        prompt: z.string().optional(),
        model: z.string().optional(),
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
      // Resolve audio source first; fall back to video source. The route
      // expects a `videoUrl` field but FFmpeg's -vn flag handles both.
      const sourceUrl =
        args.audio_url ??
        (args.audio_asset_id
          ? await resolveAssetId({
              assetId: args.audio_asset_id,
              userId: session.userId,
              expectedKind: "audio",
            })
          : null) ??
        args.video_url ??
        (args.video_asset_id
          ? await resolveAssetId({
              assetId: args.video_asset_id,
              userId: session.userId,
              expectedKind: "video",
            })
          : null)
      if (!sourceUrl) {
        return {
          content: [
            {
              type: "text",
              text: "Pass audio_url / audio_asset_id (audio source) or video_url / video_asset_id (extract from video).",
            },
          ],
          isError: true,
        }
      }
      if (
        args.start_time !== undefined &&
        args.end_time !== undefined &&
        args.end_time <= args.start_time
      ) {
        return {
          content: [{ type: "text", text: "end_time must be greater than start_time." }],
          isError: true,
        }
      }
      const payload = {
        videoUrl: sourceUrl,
        audioFormat: args.audio_format ?? "mp3",
        ...(args.start_time !== undefined ? { startTime: args.start_time } : {}),
        ...(args.end_time !== undefined ? { endTime: args.end_time } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/trim-audio",
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      const promptHint =
        args.start_time !== undefined || args.end_time !== undefined
          ? `trim ${args.start_time ?? 0}s → ${args.end_time ?? "end"}`
          : "extract audio"
      return jobResultWithWidget({
        jobId,
        label: "trim audio",
        session,
        widgetKind: "audio",
        widgetData: { prompt: promptHint, model: "trim-audio" },
      })
    },
  )

  // ── text_to_audio (sound effects) ──
  server.registerTool(
    "text_to_audio",
    {
      title: "Generate Sound Effect",
      description:
        "Generate a sound effect (SFX) from a text prompt using ElevenLabs. " +
        "Returns a job_id. Use for foley, ambience, UI sounds, etc. — NOT for " +
        "speech (use generate_speech) or music (use generate_music).",
      inputSchema: {
        prompt: z.string().min(1).max(2000).describe("Describe the sound effect (e.g. 'thunderstorm with heavy rain')."),
        duration: z.number().min(0.5).max(30).optional().describe("Duration in seconds (0.5–30). Defaults to model choice."),
        loop: z.boolean().optional().describe("Whether the output should loop seamlessly."),
        prompt_influence: z.number().min(0).max(1).optional().describe("How strongly the prompt guides generation (0–1)."),
      },
      outputSchema: { jobId: z.string(), outputUrl: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v3/job-audio",
        ui: { resourceUri: "ui://nodaro/widget/v3/job-audio", visibility: ["model", "app"] },
      },
    },
    async (args) => {
      const payload: Record<string, unknown> = {
        prompt: args.prompt,
        ...(args.duration !== undefined ? { duration: args.duration } : {}),
        ...(args.loop !== undefined ? { loop: args.loop } : {}),
        ...(args.prompt_influence !== undefined ? { promptInfluence: args.prompt_influence } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/text-to-audio",
        headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResultWithWidget({ jobId, label: "sound effect", session, widgetKind: "audio", widgetData: { prompt: args.prompt, model: "elevenlabs-sfx" } })
    },
  )

  // ── audio_isolation ──
  server.registerTool(
    "audio_isolation",
    {
      title: "Isolate Audio",
      description:
        "Remove background noise and isolate the primary audio (speech, vocals, " +
        "or instrument) from a mixed audio or video file. Returns a job_id with " +
        "a clean audio output.",
      inputSchema: {
        audio_url: z.string().url().optional(),
        audio_asset_id: z.string().optional().describe("Nodaro audio or video job id."),
      },
      outputSchema: { jobId: z.string(), outputUrl: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v3/job-audio",
        ui: { resourceUri: "ui://nodaro/widget/v3/job-audio", visibility: ["model", "app"] },
      },
    },
    async (args) => {
      const audioUrl =
        args.audio_url ??
        (args.audio_asset_id
          ? await resolveAssetId({ assetId: args.audio_asset_id, userId: session.userId, expectedKind: "audio" })
          : null)
      if (!audioUrl) return { content: [{ type: "text" as const, text: "Pass audio_url or audio_asset_id." }], isError: true }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/audio-isolation",
        headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET },
        payload: { audioUrl, mcp_client: session.clientName, userId: session.userId },
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResultWithWidget({ jobId, label: "audio isolation", session, widgetKind: "audio", widgetData: { prompt: "(isolate audio)", model: "audio-isolation" } })
    },
  )

  // ── transcribe ──
  server.registerTool(
    "transcribe",
    {
      title: "Transcribe Audio",
      description:
        "Transcribe speech from an audio or video file to text using ElevenLabs STT. " +
        "Returns a job_id; the transcript text is in the job output.",
      inputSchema: {
        audio_url: z.string().url().optional(),
        audio_asset_id: z.string().optional().describe("Nodaro audio or video job id."),
        language: z.string().max(10).optional().describe("BCP-47 language code (e.g. 'en', 'es', 'fr'). Auto-detected when omitted."),
        diarize: z.boolean().optional().describe("Label each speaker (speaker 1, speaker 2, …). Default false."),
        tag_audio_events: z.boolean().optional().describe("Annotate non-speech events like [laughter], [music]. Default false."),
        word_timestamps: z.boolean().optional().describe("Include per-word start/end timestamps. Default false."),
      },
      outputSchema: { jobId: z.string(), outputUrl: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      const audioUrl =
        args.audio_url ??
        (args.audio_asset_id
          ? await resolveAssetId({ assetId: args.audio_asset_id, userId: session.userId, expectedKind: "audio" })
          : null)
      if (!audioUrl) return { content: [{ type: "text" as const, text: "Pass audio_url or audio_asset_id." }], isError: true }
      const payload: Record<string, unknown> = {
        audioUrl,
        ...(args.language ? { language: args.language } : {}),
        ...(args.diarize !== undefined ? { diarize: args.diarize } : {}),
        ...(args.tag_audio_events !== undefined ? { tagAudioEvents: args.tag_audio_events } : {}),
        ...(args.word_timestamps !== undefined ? { wordTimestamps: args.word_timestamps } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/transcribe",
        headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResultWithWidget({ jobId, label: "transcribe", session, widgetKind: "generic", widgetData: { prompt: "(transcribe)", model: "elevenlabs-stt" } })
    },
  )

  // ── voice_remix ──
  server.registerTool(
    "voice_remix",
    {
      title: "Voice Remix",
      description:
        "Generate speech from text using a natural-language voice description " +
        "(instead of a voice_id). Great for one-off voices without cloning — " +
        "describe the voice and the text to speak.",
      inputSchema: {
        text: z.string().min(1).max(5000).describe("Text to speak."),
        voice_description: z.string().min(1).max(1000).describe("Natural-language description of the voice (e.g. 'a warm, mid-40s British woman with a calm news-anchor tone')."),
      },
      outputSchema: { jobId: z.string(), outputUrl: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v3/job-audio",
        ui: { resourceUri: "ui://nodaro/widget/v3/job-audio", visibility: ["model", "app"] },
      },
    },
    async (args) => {
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/voice-remix",
        headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET },
        payload: { text: args.text, voiceDescription: args.voice_description, mcp_client: session.clientName, userId: session.userId },
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResultWithWidget({ jobId, label: "voice remix", session, widgetKind: "audio", widgetData: { prompt: args.text.slice(0, 80), model: "voice-remix" } })
    },
  )

  // ── suno_generate ──
  server.registerTool(
    "suno_generate",
    {
      title: "Suno Generate",
      description:
        "Generate an original song with Suno AI. Returns a job_id. The job " +
        "output contains sunoTaskId + sunoTrackId needed by follow-up tools " +
        "(suno_extend, suno_cover, suno_separate_stems, etc.).\n\n" +
        "**Custom mode** (`custom_mode: true`): supply `lyrics` and `style` " +
        "explicitly — Suno uses them verbatim instead of generating them from " +
        "the prompt.\n\n" +
        `Models: ${SUNO_MODELS.join(", ")}. Default V5_5.`,
      inputSchema: {
        prompt: z.string().min(1).max(3000).describe("Song description or inspiration prompt."),
        model: z.enum(SUNO_MODELS).optional().describe(`Suno model. Default V5_5. Options: ${SUNO_MODELS.join(", ")}.`),
        style: z.string().max(500).optional().describe("Musical style tags (e.g. 'lo-fi hip-hop, melancholy, piano')."),
        title: z.string().max(200).optional(),
        lyrics: z.string().max(3000).optional().describe("Full lyrics (only used when custom_mode=true)."),
        negative_style: z.string().max(500).optional().describe("Styles to avoid."),
        vocal_gender: z.enum(["male", "female"]).optional(),
        custom_mode: z.boolean().optional().describe("When true, uses prompt as style descriptor and lyrics verbatim."),
        instrumental: z.boolean().optional().describe("Generate instrumental only (no vocals)."),
        style_weight: z.number().min(0).max(1).optional(),
        weirdness: z.number().min(0).max(1).optional(),
        audio_weight: z.number().min(0).max(1).optional(),
      },
      outputSchema: { jobId: z.string(), outputUrl: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v3/job-audio",
        ui: { resourceUri: "ui://nodaro/widget/v3/job-audio", visibility: ["model", "app"] },
      },
    },
    async (args) => {
      const payload: Record<string, unknown> = {
        prompt: args.prompt,
        model: args.model ?? "V5_5",
        ...(args.style ? { style: args.style } : {}),
        ...(args.title ? { title: args.title } : {}),
        ...(args.lyrics ? { lyrics: args.lyrics } : {}),
        ...(args.negative_style ? { negativeStyle: args.negative_style } : {}),
        ...(args.vocal_gender ? { vocalGender: args.vocal_gender } : {}),
        ...(args.custom_mode !== undefined ? { customMode: args.custom_mode } : {}),
        ...(args.instrumental !== undefined ? { instrumental: args.instrumental } : {}),
        ...(args.style_weight !== undefined ? { styleWeight: args.style_weight } : {}),
        ...(args.weirdness !== undefined ? { weirdnessConstraint: args.weirdness } : {}),
        ...(args.audio_weight !== undefined ? { audioWeight: args.audio_weight } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/suno/generate",
        headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResultWithWidget({ jobId, label: "Suno generate", session, widgetKind: "audio", widgetData: { prompt: args.prompt.slice(0, 80), model: args.model ?? "V5_5" } })
    },
  )

  // ── suno_lyrics ──
  server.registerTool(
    "suno_lyrics",
    {
      title: "Suno Generate Lyrics",
      description:
        "Generate song lyrics from a prompt using Suno AI. Returns a job_id; " +
        "the lyrics text is in the job output. Use the result as `lyrics` in " +
        "suno_generate (custom_mode: true) for full control.",
      inputSchema: {
        prompt: z.string().min(1).max(1000).describe("Topic or theme for the lyrics (e.g. 'a heartbreak ballad about summer')."),
      },
      outputSchema: { jobId: z.string(), outputUrl: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/suno/lyrics",
        headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET },
        payload: { prompt: args.prompt, mcp_client: session.clientName, userId: session.userId },
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResultWithWidget({ jobId, label: "Suno lyrics", session, widgetKind: "generic", widgetData: { prompt: args.prompt, model: "suno-lyrics" } })
    },
  )

  // ── suno_mashup ──
  server.registerTool(
    "suno_mashup",
    {
      title: "Suno Mashup",
      description:
        "Blend two audio tracks into a mashup using Suno AI. Both inputs must be " +
        "public URLs or Nodaro audio asset ids. Returns a job_id.",
      inputSchema: {
        audio_url_1: z.string().url().optional().describe("First track URL."),
        audio_asset_id_1: z.string().optional().describe("First track Nodaro audio job id."),
        audio_url_2: z.string().url().optional().describe("Second track URL."),
        audio_asset_id_2: z.string().optional().describe("Second track Nodaro audio job id."),
        style: z.string().max(500).optional(),
        title: z.string().max(200).optional(),
        negative_style: z.string().max(500).optional(),
        vocal_gender: z.enum(["male", "female"]).optional(),
        custom_mode: z.boolean().optional(),
      },
      outputSchema: { jobId: z.string(), outputUrl: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v3/job-audio",
        ui: { resourceUri: "ui://nodaro/widget/v3/job-audio", visibility: ["model", "app"] },
      },
    },
    async (args) => {
      const url1 =
        args.audio_url_1 ??
        (args.audio_asset_id_1 ? await resolveAssetId({ assetId: args.audio_asset_id_1, userId: session.userId, expectedKind: "audio" }) : null)
      const url2 =
        args.audio_url_2 ??
        (args.audio_asset_id_2 ? await resolveAssetId({ assetId: args.audio_asset_id_2, userId: session.userId, expectedKind: "audio" }) : null)
      if (!url1 || !url2) return { content: [{ type: "text" as const, text: "Two audio sources are required (audio_url_1 + audio_url_2 or asset ids)." }], isError: true }
      const payload: Record<string, unknown> = {
        uploadUrlList: [url1, url2],
        ...(args.style ? { style: args.style } : {}),
        ...(args.title ? { title: args.title } : {}),
        ...(args.negative_style ? { negativeStyle: args.negative_style } : {}),
        ...(args.vocal_gender ? { vocalGender: args.vocal_gender } : {}),
        ...(args.custom_mode !== undefined ? { customMode: args.custom_mode } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/suno/mashup",
        headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResultWithWidget({ jobId, label: "Suno mashup", session, widgetKind: "audio", widgetData: { prompt: "(mashup)", model: "suno-mashup" } })
    },
  )

  // ── suno_replace_section ──
  server.registerTool(
    "suno_replace_section",
    {
      title: "Suno Replace Section",
      description:
        "Replace a time segment of a Suno-generated track with newly generated content. " +
        "Pass the Nodaro audio_asset_id of a Suno track. infill_end_s must be ≥ infill_start_s + 6.",
      inputSchema: {
        audio_asset_id: z.string().min(1).describe("Nodaro audio job id of a Suno track."),
        infill_start_s: z.number().min(0).describe("Start time in seconds of the region to replace."),
        infill_end_s: z.number().min(6).max(60).describe("End time in seconds (must be ≥ start + 6, max 60)."),
        prompt: z.string().min(1).max(3000).describe("Description of what to generate for the replaced region."),
        tags: z.string().max(500).describe("Style tags for the replacement segment."),
        title: z.string().max(200).optional(),
      },
      outputSchema: { jobId: z.string(), outputUrl: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v3/job-audio",
        ui: { resourceUri: "ui://nodaro/widget/v3/job-audio", visibility: ["model", "app"] },
      },
    },
    async (args) => {
      const ids = await resolveSunoIds(args.audio_asset_id, session.userId)
      if (!ids) return { content: [{ type: "text" as const, text: `No Suno ids found for asset ${args.audio_asset_id}. Pass a Suno track job id.` }], isError: true }
      const payload: Record<string, unknown> = {
        taskId: ids.sunoTaskId,
        audioId: ids.sunoTrackId,
        infillStartS: args.infill_start_s,
        infillEndS: args.infill_end_s,
        prompt: args.prompt,
        tags: args.tags,
        ...(args.title ? { title: args.title } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/suno/replace-section",
        headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResultWithWidget({ jobId, label: "Suno replace section", session, widgetKind: "audio", widgetData: { prompt: args.prompt.slice(0, 60), model: "suno-replace-section" } })
    },
  )

  // ── suno_style_boost ──
  server.registerTool(
    "suno_style_boost",
    {
      title: "Suno Style Boost",
      description:
        "Enhance a Suno style/genre description using AI to produce richer style tags. " +
        "Returns a job_id; the improved style string is in the job output. Use the result " +
        "as `style` in suno_generate.",
      inputSchema: {
        content: z.string().min(1).max(3000).describe("Style description to enhance (e.g. 'lo-fi chill')."),
      },
      outputSchema: { jobId: z.string(), outputUrl: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/suno/style-boost",
        headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET },
        payload: { content: args.content, mcp_client: session.clientName, userId: session.userId },
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResultWithWidget({ jobId, label: "Suno style boost", session, widgetKind: "generic", widgetData: { prompt: args.content.slice(0, 60), model: "suno-style-boost" } })
    },
  )

  // ── suno_add_instrumental ──
  server.registerTool(
    "suno_add_instrumental",
    {
      title: "Suno Add Instrumental",
      description:
        "Add an AI-generated instrumental layer to a Suno track. " +
        "Pass the Nodaro audio_asset_id of a Suno generation.",
      inputSchema: {
        audio_asset_id: z.string().min(1).describe("Nodaro audio job id of a Suno track."),
        model: z.enum(SUNO_ADD_TRACK_MODELS).optional().describe(`Suno model for the new layer. Options: ${SUNO_ADD_TRACK_MODELS.join(", ")}. Default V5_5.`),
      },
      outputSchema: { jobId: z.string(), outputUrl: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v3/job-audio",
        ui: { resourceUri: "ui://nodaro/widget/v3/job-audio", visibility: ["model", "app"] },
      },
    },
    async (args) => {
      const ids = await resolveSunoIds(args.audio_asset_id, session.userId)
      if (!ids) return { content: [{ type: "text" as const, text: `No Suno ids found for asset ${args.audio_asset_id}.` }], isError: true }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/suno/add-instrumental",
        headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET },
        payload: { taskId: ids.sunoTaskId, audioId: ids.sunoTrackId, model: args.model ?? "V5_5", mcp_client: session.clientName, userId: session.userId },
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResultWithWidget({ jobId, label: "Suno add instrumental", session, widgetKind: "audio", widgetData: { prompt: "(add instrumental)", model: args.model ?? "V5_5" } })
    },
  )

  // ── suno_add_vocals ──
  server.registerTool(
    "suno_add_vocals",
    {
      title: "Suno Add Vocals",
      description:
        "Add AI-generated vocals to an existing Suno instrumental track. " +
        "Pass the Nodaro audio_asset_id of a Suno generation.",
      inputSchema: {
        audio_asset_id: z.string().min(1).describe("Nodaro audio job id of a Suno track."),
        model: z.enum(SUNO_ADD_TRACK_MODELS).optional().describe(`Suno model for the vocals. Options: ${SUNO_ADD_TRACK_MODELS.join(", ")}. Default V5_5.`),
      },
      outputSchema: { jobId: z.string(), outputUrl: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v3/job-audio",
        ui: { resourceUri: "ui://nodaro/widget/v3/job-audio", visibility: ["model", "app"] },
      },
    },
    async (args) => {
      const ids = await resolveSunoIds(args.audio_asset_id, session.userId)
      if (!ids) return { content: [{ type: "text" as const, text: `No Suno ids found for asset ${args.audio_asset_id}.` }], isError: true }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/suno/add-vocals",
        headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET },
        payload: { taskId: ids.sunoTaskId, audioId: ids.sunoTrackId, model: args.model ?? "V5_5", mcp_client: session.clientName, userId: session.userId },
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResultWithWidget({ jobId, label: "Suno add vocals", session, widgetKind: "audio", widgetData: { prompt: "(add vocals)", model: args.model ?? "V5_5" } })
    },
  )

  // ── suno_convert_wav ──
  server.registerTool(
    "suno_convert_wav",
    {
      title: "Suno Convert to WAV",
      description:
        "Convert a Suno-generated track to lossless WAV format. " +
        "Pass the Nodaro audio_asset_id of a Suno generation. Returns a job_id with WAV output.",
      inputSchema: {
        audio_asset_id: z.string().min(1).describe("Nodaro audio job id of a Suno track."),
      },
      outputSchema: { jobId: z.string(), outputUrl: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v3/job-audio",
        ui: { resourceUri: "ui://nodaro/widget/v3/job-audio", visibility: ["model", "app"] },
      },
    },
    async (args) => {
      const ids = await resolveSunoIds(args.audio_asset_id, session.userId)
      if (!ids) return { content: [{ type: "text" as const, text: `No Suno ids found for asset ${args.audio_asset_id}.` }], isError: true }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/suno/convert-wav",
        headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET },
        payload: { taskId: ids.sunoTaskId, audioId: ids.sunoTrackId, mcp_client: session.clientName, userId: session.userId },
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResultWithWidget({ jobId, label: "Suno convert WAV", session, widgetKind: "audio", widgetData: { prompt: "(convert to WAV)", model: "suno-convert-wav" } })
    },
  )

  // ── suno_upload_extend ──
  server.registerTool(
    "suno_upload_extend",
    {
      title: "Suno Upload & Extend",
      description:
        "Extend an externally uploaded audio track using Suno AI (not a prior Suno " +
        "generation — use suno_extend for that). Provide a public URL to the audio file " +
        "and a continue_at timestamp in seconds.",
      inputSchema: {
        audio_url: z.string().url().describe("Public URL of the audio file to extend."),
        continue_at: z.number().min(0).describe("Timestamp (seconds) from which Suno continues generating."),
        model: z.enum(SUNO_MODELS).optional().describe(`Suno model. Default V5_5. Options: ${SUNO_MODELS.join(", ")}.`),
        style: z.string().max(500).optional(),
        title: z.string().max(200).optional(),
        negative_style: z.string().max(500).optional(),
        vocal_gender: z.enum(["male", "female"]).optional(),
        use_default_params: z.boolean().optional().describe("Use Suno defaults instead of the supplied style/title. Default false."),
      },
      outputSchema: { jobId: z.string(), outputUrl: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v3/job-audio",
        ui: { resourceUri: "ui://nodaro/widget/v3/job-audio", visibility: ["model", "app"] },
      },
    },
    async (args) => {
      const payload: Record<string, unknown> = {
        uploadUrl: args.audio_url,
        continueAt: args.continue_at,
        model: args.model ?? "V5_5",
        defaultParamFlag: args.use_default_params ?? false,
        ...(args.style ? { style: args.style } : {}),
        ...(args.title ? { title: args.title } : {}),
        ...(args.negative_style ? { negativeStyle: args.negative_style } : {}),
        ...(args.vocal_gender ? { vocalGender: args.vocal_gender } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/suno/upload-extend",
        headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResultWithWidget({ jobId, label: "Suno upload extend", session, widgetKind: "audio", widgetData: { prompt: "(upload extend)", model: args.model ?? "V5_5" } })
    },
  )
}
