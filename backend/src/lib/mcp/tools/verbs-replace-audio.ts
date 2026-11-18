import { z } from "zod"
import { REPLACE_AUDIO_LEVERS, REPLACE_AUDIO_MODES, REPLACE_AUDIO_MUSIC_PROMPT_MAX } from "@nodaro/render-rules"
import { resolveAssetId } from "../asset-resolver.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import type { RegisterOpts } from "./verbs-image.js"
import { clientRequestIdSchema, dispatchJob } from "./_verb-helpers.js"

const executeGate: ToolGate = { required: ["workflows:execute"] }

/** A failed call's own wording: the deployment not serving the route (its bare 404), else the standard error text. */
export function replaceAudioRefusal(statusCode: number, body: string): string | null {
  if (statusCode !== 404) return null
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown } }
    if (typeof parsed?.error?.code === "string") return null
  } catch {
    // Not a route's error body: the router's own 404.
  }
  return "Replace Audio is not available on this server: it runs on Nodaro Cloud."
}

const lever = (name: keyof typeof REPLACE_AUDIO_LEVERS, what: string) => {
  const l = REPLACE_AUDIO_LEVERS[name]
  return z.number().min(l.min).max(l.max).optional().describe(`${what} (${l.min}–${l.max}, default ${l.default}).`)
}

/**
 * `replace_audio` — a client of `POST /v1/replace-audio` (served by the cloud
 * plugin; registered on Cloud only). Resolves the asset ids it is handed,
 * sends the body as the route takes it and returns the job.
 */
export function registerReplaceAudioTools({ server, session, fastify }: RegisterOpts): void {
  if (!passesGate(session, executeGate)) return
  server.registerTool(
    "replace_audio",
    {
      title: "Replace Audio",
      description:
        "Replace a video's music and keep its speech, as one job: the speech is separated from the rest of the sound, " +
        "the new music dips under it while someone talks, and the mix replaces the video's sound (as long as the video). " +
        "`mode: \"replace-all\"` replaces ALL the sound with the new music instead.\n\n" +
        "**Inputs:** the video (`video_url` or `video_asset_id`), and the new music — EITHER a file " +
        "(`music_url` or `music_asset_id`: an audio, or a video whose sound is used) OR `music_prompt` " +
        `(an instrumental track as long as the video is made from it; up to ${REPLACE_AUDIO_MUSIC_PROMPT_MAX} characters, ` +
        "for a video up to 6 minutes). Videos up to 10 minutes, files up to 500 MB.\n\n" +
        "**Levers:** `music_volume`, `speech_volume`, `duck_amount` (how far the music dips under the speech; 0 = not at all).\n\n" +
        "Priced per run by mode and music source; a keep-speech run on a video with no sound is charged as replace-all. " +
        "Returns a job_id; its output has the video (`videoUrl`) and, beside it, the final mix (`audioUrl`), the music " +
        "(`musicUrl`) and the speech (`speechUrl`, keep-speech only).",
      inputSchema: {
        video_url: z.string().url().optional(),
        video_asset_id: z.string().optional(),
        music_url: z.string().url().optional().describe("The new music: an audio, or a video whose sound is used."),
        music_asset_id: z.string().optional().describe("The new music as the id of one of your audios or videos (a job or an upload)."),
        music_prompt: z.string().max(REPLACE_AUDIO_MUSIC_PROMPT_MAX).optional().describe("Make the music from this description instead of a file."),
        mode: z.enum(REPLACE_AUDIO_MODES).optional().describe("keep-speech (default): keep the speech, replace the music. replace-all: replace all the sound."),
        music_volume: lever("musicVolume", "The music's volume, percent"),
        speech_volume: lever("speechVolume", "The speech's volume, percent"),
        duck_amount: lever("duckAmount", "How far the music dips under the speech"),
        client_request_id: clientRequestIdSchema.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v4/job-video",
        ui: { resourceUri: "ui://nodaro/widget/v4/job-video", visibility: ["model", "app"] },
      },
    },
    async (args) => {
      const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true as const })
      const videoUrl = args.video_url ?? (args.video_asset_id ? await resolveAssetId({ assetId: args.video_asset_id, userId: session.userId, expectedKind: "video" }) : null)
      if (!videoUrl) return fail("Pass video_url or video_asset_id.")
      const musicFiles = [args.music_url, args.music_asset_id].filter((v) => v !== undefined).length
      const prompted = typeof args.music_prompt === "string" && args.music_prompt.trim() !== ""
      if (musicFiles + (prompted ? 1 : 0) !== 1) return fail("Pass exactly one music source: music_url, music_asset_id or music_prompt.")
      let musicUrl: string | null = args.music_url ?? null
      if (!musicUrl && args.music_asset_id) {
        // The music may be an audio or a video (its sound is used).
        musicUrl = await resolveAssetId({ assetId: args.music_asset_id, userId: session.userId, expectedKind: "audio" })
          .catch(() => null)
          ?? await resolveAssetId({ assetId: args.music_asset_id, userId: session.userId, expectedKind: "video" })
        if (!musicUrl) return fail("music_asset_id names no audio or video of yours.")
      }
      const payload: Record<string, unknown> = {
        videoUrl,
        ...(musicUrl ? { musicUrl } : { musicPrompt: args.music_prompt!.trim() }),
        ...(args.mode !== undefined ? { mode: args.mode } : {}),
        ...(args.music_volume !== undefined ? { musicVolume: args.music_volume } : {}),
        ...(args.speech_volume !== undefined ? { speechVolume: args.speech_volume } : {}),
        ...(args.duck_amount !== undefined ? { duckAmount: args.duck_amount } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, {
        url: "/v1/replace-audio",
        payload,
        label: "replace audio",
        widgetKind: "video",
        widgetData: { prompt: "(replace audio)", model: "replace-audio" },
        clientRequestId: args.client_request_id,
        formatRefusal: replaceAudioRefusal,
      })
    },
  )
}
