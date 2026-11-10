/**
 * `speaker_view` — render an edit with its speakers laid out on screen: the
 * MCP face of POST /v1/speaker-view (the Speaker View node). Registered by
 * `registerVideoVerbs` beside `switch_cameras` and `plan_edit`, inside the
 * same `hasCredits()` block (the route is the Cloud plugin's), and unlisted
 * while the deployment does not offer the node to its users — the route
 * refuses it then too.
 *
 * It takes the route's settings, never face tracks: an agent renders an edit
 * or a whole video framed by the settings and drawn boxes; following faces
 * (Speaker Frames' tracks) is set up in the editor. What the route refuses is
 * refused here first, in the agent's words, when it can be told from the
 * arguments alone: exactly one of `edl` and `video_url`, a transcript that
 * names its speakers with `video_url`, and an `edl` string that is not JSON.
 */
import { z } from "zod"
import { EDL_TARGET_ASPECTS, isKnownSpeakerEmphasisStyle, transcriptSpeakerLabels } from "@nodaro/shared/edl"
import { SPEAKER_VIEW_ACCENT_PATTERN, SPEAKER_VIEW_LAYOUT_SETTINGS, SPEAKER_VIEW_MAX_TWEEN_MS, SPEAKER_VIEW_MIN_REGION, isSpeakerViewSwitchDrawn } from "@nodaro/render-rules"
import { isNodeDenied, USER_VIEWER } from "../../surface-deny.js"
import { WIDGET_URI } from "../widgets/registrar.js"
import type { RegisterOpts } from "./verbs-image.js"
import { dispatchJob, JOB_OUTPUT_SCHEMA, uiMeta } from "./_verb-helpers.js"

export const SPEAKER_VIEW_TOOL = "speaker_view"

/** The node this verb runs — its availability decides whether the verb is listed. */
const NODE_TYPE = "speaker-view"

const tuple = (list: readonly string[]) => list as unknown as [string, ...string[]]
const tweenMs = z.number().int().min(0).max(SPEAKER_VIEW_MAX_TWEEN_MS).optional()
const fraction = z.number().min(0).max(1)
/** The route's limits on `speakerRegions`: an id's length and the number of crops. */
const REGION_ID_MAX = 200
const REGIONS_MAX = 500

const toolError = (text: string) => ({ content: [{ type: "text" as const, text: `speaker_view: ${text}` }], isError: true as const })

/** A JSON string parsed (undefined when it is not JSON); anything else as it came. */
function parseMaybe(v: unknown): unknown {
  if (typeof v !== "string") return v
  try {
    return JSON.parse(v)
  } catch {
    return undefined
  }
}

export function registerSpeakerViewVerb({ server, session, fastify }: RegisterOpts): void {
  if (isNodeDenied(NODE_TYPE, USER_VIEWER)) return
  server.registerTool(
    SPEAKER_VIEW_TOOL,
    {
      title: "Speaker View",
      description:
        "Render an edit with its speakers laid out on screen — a layout, a switch at each speaker change, an emphasis on whoever is " +
        "talking — from the original cameras, with the edit's own sound. Pass `edl` (one edit: a plan_edit or switch_cameras result; " +
        "its `transcript` when the edit does not name its speakers) or `video_url` (a public video, cut whole at the speakers' turns; " +
        "`transcript` with speaker labels required). With no `switch` the speakers are cut, with no `emphasis` none is drawn. " +
        "Returns a job id: `output_data.videoUrl`, the edit as drawn on `output_data.json`, the transcript remapped through it on " +
        "`output_data.transcript`. Priced per minute of output, higher with three or more speakers on screen or a zoom; a `proxy` " +
        "preview has its own, lower rate.",
      inputSchema: {
        edl: z.union([z.record(z.string(), z.unknown()), z.string()]).optional().describe("One edit (object or JSON string). Or `video_url`."),
        video_url: z.string().url().optional().describe("Instead of `edl`: a public video URL, up to 500 MB."),
        transcript: z
          .union([z.record(z.string(), z.unknown()), z.string()])
          .optional()
          .describe("The word transcript with speaker labels (object or JSON string). Required with `video_url`."),
        target_aspect: z.enum(tuple(EDL_TARGET_ASPECTS)).optional().describe("Output shape (default: the edit's, else 16:9; 9:16 with `video_url`)."),
        layout: z.enum(tuple(SPEAKER_VIEW_LAYOUT_SETTINGS)).optional().describe("Default auto; one the shape or speaker count rules out is snapped."),
        switch: z
          .object({
            type: z.string().max(40).refine(isSpeakerViewSwitchDrawn, 'cut, pan, zoom or "xfade:<transition>"').describe('cut, pan, zoom or "xfade:<transition>".'),
            duration_ms: tweenMs.describe("Pan / zoom tween length, ms."),
          })
          .optional()
          .describe("The switch at each speaker change."),
        emphasis: z
          .object({
            style: z.string().max(40).refine(isKnownSpeakerEmphasisStyle, 'none, or scale, border, dim joined with "+"').describe('none, or scale, border, dim joined with "+".'),
            duration_ms: tweenMs.describe("Ease length, ms."),
          })
          .optional()
          .describe("How the speaker talking is marked."),
        quality: z.enum(["final", "proxy"]).optional().describe("final (default) or proxy (a private 720p preview)."),
        speaker_regions: z
          .array(
            z.object({
              source: z.string().min(1).max(REGION_ID_MAX).describe("The edit's source id (the camera)."),
              speaker: z.string().min(1).max(REGION_ID_MAX),
              region: z
                .object({ x: fraction, y: fraction, w: fraction.min(SPEAKER_VIEW_MIN_REGION), h: fraction.min(SPEAKER_VIEW_MIN_REGION) })
                // The route's own limit: the crop lies inside the frame.
                .refine((r) => r.x + r.w <= 1 + 1e-9 && r.y + r.h <= 1 + 1e-9, "the crop must lie inside the frame (x + w ≤ 1, y + h ≤ 1)")
                .describe("The crop, as fractions of the frame."),
            }),
          )
          .max(REGIONS_MAX)
          .optional()
          .describe("A crop of a camera per speaker."),
        accent_color: z.string().regex(SPEAKER_VIEW_ACCENT_PATTERN).optional().describe("The Border emphasis colour, #RRGGBB (default white)."),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: uiMeta(WIDGET_URI.jobAuto),
    },
    async (args) => {
      if (args.edl !== undefined && args.video_url !== undefined) return toolError("pass `edl` or `video_url`, not both.")
      if (args.edl === undefined && args.video_url === undefined) {
        return toolError("pass `edl` (one edit: a plan_edit or switch_cameras result) or `video_url` (a video, with `transcript`).")
      }
      const edl = parseMaybe(args.edl)
      if (typeof args.edl === "string" && edl === undefined) return toolError("`edl` is a string but not valid JSON — pass the edit object, or a correctly JSON-encoded string.")
      const transcript = parseMaybe(args.transcript)
      if (typeof args.transcript === "string" && transcript === undefined) return toolError("`transcript` is a string but not valid JSON.")
      if (args.video_url !== undefined) {
        if (transcript === undefined) return toolError("with `video_url`, pass `transcript` — a transcript with speaker labels (transcribe with speaker detection).")
        if (transcriptSpeakerLabels(transcript).length === 0) return toolError("the transcript has no speaker labels — transcribe with speaker detection on.")
      }
      const payload: Record<string, unknown> = {
        ...(args.video_url !== undefined ? { videoUrl: args.video_url } : { edl }),
        ...(transcript !== undefined ? { transcript } : {}),
        ...(args.target_aspect ? { targetAspect: args.target_aspect } : {}),
        ...(args.layout ? { layout: args.layout } : {}),
        ...(args.switch ? { switch: { type: args.switch.type, ...(args.switch.duration_ms !== undefined ? { durationMs: args.switch.duration_ms } : {}) } } : {}),
        ...(args.emphasis
          ? { emphasis: { style: args.emphasis.style, ...(args.emphasis.duration_ms !== undefined ? { durationMs: args.emphasis.duration_ms } : {}) } }
          : {}),
        ...(args.quality ? { quality: args.quality } : {}),
        ...(args.speaker_regions ? { speakerRegions: args.speaker_regions } : {}),
        ...(args.accent_color ? { accentColor: args.accent_color } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, {
        url: "/v1/speaker-view",
        payload,
        label: "Speaker View",
        widgetKind: "video",
        widgetData: { prompt: `(speaker view · ${args.quality ?? "final"})` },
      })
    },
  )
}
