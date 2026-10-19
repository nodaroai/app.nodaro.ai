/**
 * The recordings of a use-case verb (decided 2026-10-19): `media_url`, or
 * `media_urls` (the cameras of one conversation, in order), an optional
 * `master_audio_url` and the `cameras` settings — one wording and one body
 * mapper for every use-case verb that takes several recordings (Tighten
 * Episode first). Its own module so verbs-use-case.ts stays under its size
 * budget and every verb says it the same way.
 *
 * The route is the gate: several recordings or a Master audio run only for a
 * caller who may use Speaker Map (the step that tells who is on which
 * camera); anyone else is refused 403 before anything is probed.
 */
import { z } from "zod"
import { USE_CASE_MAX_RECORDINGS as MAX } from "@nodaro/render-rules"

/** A speaker ordinal a Cameras override may name: "1" (the first voice heard) to the most recordings a run takes. */
const SPEAKER_ORDINAL = new RegExp(`^(${Array.from({ length: MAX }, (_, i) => i + 1).join("|")})$`)

/** The recording fields, spread into a verb's input schema. */
export const recordingsInputShape = {
  media_url: z.string().url().optional().describe("The recording (video or audio URL). Or `media_urls`."),
  media_urls: z
    .array(z.string().url())
    .min(1)
    .max(MAX)
    .optional()
    .describe(
      `Instead of media_url: 1–${MAX} recordings of one conversation (cameras; one may be sound only), in order; without master_audio_url, 2+ cameras keep one place for the sound, so up to ${MAX - 1}. ` +
        "With 2 or more the run lines them up, works out who is on which camera and cuts to whoever is talking.",
    ),
  master_audio_url: z
    .string()
    .url()
    .optional()
    .describe(`The mixer or recorder track: the episode's sound and the clock the recordings are lined up to. Up to ${MAX} recordings in all, this one included.`),
  cameras: z
    .object({
      wide_camera: z.number().int().min(1).max(MAX).optional().describe("Which recording (1-based) is the wide shot: shown when a speaker has no camera of their own."),
      already_synced: z.boolean().optional().describe("The recordings already share one clock: skip lining them up."),
      speaker_cameras: z
        .record(z.string().regex(SPEAKER_ORDINAL), z.number().int().min(0).max(MAX))
        .optional()
        .describe("Who is on which camera: speaker number (1 = the first voice heard) → recording number, 0 = the wide shot. Overrides the automatic map."),
    })
    .optional()
    .describe("With several recordings or a Master audio: the Cameras settings."),
}

export type RecordingsArgs = {
  readonly media_url?: string
  readonly media_urls?: readonly string[]
  readonly master_audio_url?: string
  readonly cameras?: {
    readonly wide_camera?: number
    readonly already_synced?: boolean
    readonly speaker_cameras?: Readonly<Record<string, number>>
  }
}

/** What a description says about several recordings: who may run them, and what the run reports. */
export const RECORDINGS_SENTENCE =
  "Several recordings or a Master audio need Speaker Map: where it is not available to you (not yet on nodaro.ai) " +
  "the request is refused 403 — send one recording. Such a run reports who is on which camera in `output_data.cameras` " +
  "(`speakers` [{ speaker, ordinal, camera, marginDb }], camera null = the wide shot; `syncNotes`, `mapNotes`)."

type ToolError = { content: { type: "text"; text: string }[]; isError: true }
const toolError = (text: string): ToolError => ({ content: [{ type: "text" as const, text }], isError: true as const })

/**
 * The body's recording fields (`mediaUrls`, `masterAudioUrl`, `cameras`, each
 * only when given), or the tool error to answer before any request.
 */
export function recordingsPayload(args: RecordingsArgs): { readonly payload: Record<string, unknown> } | { readonly error: ToolError } {
  if (args.media_url !== undefined && args.media_urls !== undefined) return { error: toolError("Pass media_url or media_urls, not both.") }
  const mediaUrls = args.media_urls ?? (args.media_url !== undefined ? [args.media_url] : undefined)
  if (!mediaUrls) return { error: toolError("Pass media_url (the recording) or media_urls (the recordings of one conversation).") }
  const c = args.cameras
  const cameras = c
    ? {
        ...(c.wide_camera !== undefined ? { wide: c.wide_camera } : {}),
        ...(c.already_synced !== undefined ? { synced: c.already_synced } : {}),
        ...(c.speaker_cameras !== undefined ? { speakerCameras: { ...c.speaker_cameras } } : {}),
      }
    : undefined
  return {
    payload: {
      mediaUrls: [...mediaUrls],
      ...(args.master_audio_url !== undefined ? { masterAudioUrl: args.master_audio_url } : {}),
      ...(cameras ? { cameras } : {}),
    },
  }
}
