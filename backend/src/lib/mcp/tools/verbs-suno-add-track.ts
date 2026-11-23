/**
 * `suno_add_vocals` / `suno_add_instrumental` — a new layer over a song, sung
 * or played, with the caller's direction: the MCP face of
 * POST /v1/suno/add-vocals and /v1/suno/add-instrumental (decided
 * 2026-11-23). Registered beside the other `suno_*` verbs by
 * `registerAudioVerbs`; the bounds are the route's own.
 */
import { z } from "zod"
import {
  DEFAULT_SUNO_MODEL,
  SUNO_ADD_TRACK_MODELS,
  SUNO_ADD_TRACK_NEGATIVE_MAX,
  SUNO_ADD_TRACK_PROMPT_MAX,
  SUNO_ADD_TRACK_STYLE_MAX,
  SUNO_TITLE_MAX,
} from "@nodaro/shared/models"
import { resolveAssetId } from "../asset-resolver.js"
import type { RegisterOpts } from "./verbs-image.js"
import { dispatchJob, JOB_OUTPUT_SCHEMA } from "./_verb-helpers.js"

type SunoIds = { sunoTaskId: string; sunoTrackId: string; audioUrl?: string } | null

export interface SunoAddTrackVerbOpts extends RegisterOpts {
  /** A job's Suno ids (`registerAudioVerbs`' own lookup). */
  readonly resolveSunoIds: (jobId: string, userId: string) => Promise<SunoIds>
}

const UI_META = {
  "ui/resourceUri": "ui://nodaro/widget/v5/job-audio",
  ui: { resourceUri: "ui://nodaro/widget/v5/job-audio", visibility: ["model", "app"] },
}

const weight = (what: string) => z.number().min(0).max(1).optional().describe(`${what}, 0-1.`)

// The fields both tools take; each tool's schema lists them by name (the
// schema walk reads `key: z.…` literally), with these shared descriptions.
const HELP = {
  asset: "Audio job id of the song: a Suno track made here, or any audio.",
  url: "Direct link to the song's audio file, instead of audio_asset_id.",
  model: `Suno model. Default ${DEFAULT_SUNO_MODEL}.`,
  style: "Style of the new layer. Unset: your original Suno song's style; required for any other audio.",
  title: "Result title. Unset: the original's.",
  negative: "Styles to avoid, comma separated.",
  gender: "Preferred voice; not guaranteed.",
} as const

type SharedArgs = {
  audio_asset_id?: string
  audio_url?: string
  model?: (typeof SUNO_ADD_TRACK_MODELS)[number]
  style?: string
  title?: string
  negative_tags?: string
  vocal_gender?: "male" | "female"
  style_weight?: number
  weirdness_constraint?: number
  audio_weight?: number
  prompt?: string
}

const fail = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true })

async function dispatchAddTrack(opts: SunoAddTrackVerbOpts, kind: "vocals" | "instrumental", args: SharedArgs) {
  const { session, fastify } = opts
  if (!args.audio_asset_id && !args.audio_url) return fail("Pass audio_asset_id or audio_url: the song to add to.")
  // A Suno track goes by its ids (the route sends its saved audio and reuses
  // its style); any other audio by its file.
  const ids = !args.audio_url && args.audio_asset_id ? await opts.resolveSunoIds(args.audio_asset_id, session.userId) : null
  const audioUrl = args.audio_url
    ?? (ids || !args.audio_asset_id ? undefined : await resolveAssetId({ assetId: args.audio_asset_id, userId: session.userId, expectedKind: "audio" }))
  if (!ids && !audioUrl) return fail(`No audio found for asset ${args.audio_asset_id}.`)
  const model = args.model ?? DEFAULT_SUNO_MODEL
  const payload = {
    ...(ids ? { taskId: ids.sunoTaskId, audioId: ids.sunoTrackId } : {}),
    ...(audioUrl ? { uploadUrl: audioUrl } : {}),
    model,
    ...(kind === "vocals" && args.prompt ? { prompt: args.prompt } : {}),
    ...(args.style ? { style: args.style } : {}),
    ...(args.title ? { title: args.title } : {}),
    ...(args.negative_tags ? { negativeTags: args.negative_tags } : {}),
    ...(args.vocal_gender ? { vocalGender: args.vocal_gender } : {}),
    ...(args.style_weight !== undefined ? { styleWeight: args.style_weight } : {}),
    ...(args.weirdness_constraint !== undefined ? { weirdnessConstraint: args.weirdness_constraint } : {}),
    ...(args.audio_weight !== undefined ? { audioWeight: args.audio_weight } : {}),
    mcp_client: session.clientName,
    userId: session.userId,
  }
  return dispatchJob(fastify, session, {
    url: kind === "vocals" ? "/v1/suno/add-vocals" : "/v1/suno/add-instrumental",
    payload,
    label: `Suno add ${kind}`,
    widgetKind: "audio",
    widgetData: { prompt: args.style?.slice(0, 60) || `(add ${kind})`, model },
  })
}

export function registerSunoAddTrackVerbs(opts: SunoAddTrackVerbOpts): void {
  const { server } = opts

  server.registerTool(
    "suno_add_instrumental",
    {
      title: "Suno Add Instrumental",
      description: "Add an instrumental under a song (e.g. a vocal), keeping the song itself. Direct it with style.",
      inputSchema: {
        audio_asset_id: z.string().min(1).optional().describe(HELP.asset),
        audio_url: z.string().url().optional().describe(HELP.url),
        model: z.enum(SUNO_ADD_TRACK_MODELS).optional().describe(HELP.model),
        style: z.string().max(SUNO_ADD_TRACK_STYLE_MAX).optional().describe(HELP.style),
        title: z.string().max(SUNO_TITLE_MAX).optional().describe(HELP.title),
        negative_tags: z.string().max(SUNO_ADD_TRACK_NEGATIVE_MAX).optional().describe(HELP.negative),
        vocal_gender: z.enum(["male", "female"]).optional().describe(HELP.gender),
        style_weight: weight("How closely to follow the style"),
        weirdness_constraint: weight("How far to stray creatively"),
        audio_weight: weight("How much the original audio weighs"),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: UI_META,
    },
    async (args) => dispatchAddTrack(opts, "instrumental", args),
  )

  server.registerTool(
    "suno_add_vocals",
    {
      title: "Suno Add Vocals",
      description: "Add a sung vocal over a song (e.g. an instrumental), keeping the music itself. Say what is sung with prompt and the singer's style with style.",
      inputSchema: {
        audio_asset_id: z.string().min(1).optional().describe(HELP.asset),
        audio_url: z.string().url().optional().describe(HELP.url),
        model: z.enum(SUNO_ADD_TRACK_MODELS).optional().describe(HELP.model),
        style: z.string().max(SUNO_ADD_TRACK_STYLE_MAX).optional().describe(HELP.style),
        title: z.string().max(SUNO_TITLE_MAX).optional().describe(HELP.title),
        negative_tags: z.string().max(SUNO_ADD_TRACK_NEGATIVE_MAX).optional().describe(HELP.negative),
        vocal_gender: z.enum(["male", "female"]).optional().describe(HELP.gender),
        style_weight: weight("How closely to follow the style"),
        weirdness_constraint: weight("How far to stray creatively"),
        audio_weight: weight("How much the original audio weighs"),
        prompt: z.string().max(SUNO_ADD_TRACK_PROMPT_MAX).optional().describe("The lyrics, or a direction for the voice. Unset: Suno writes them."),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: UI_META,
    },
    async (args) => dispatchAddTrack(opts, "vocals", args),
  )
}
