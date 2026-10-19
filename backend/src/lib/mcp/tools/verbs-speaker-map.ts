/**
 * `speaker_map` — which camera each speaker is on, from the cameras' own
 * microphones: the MCP face of POST /v1/speaker-map (the Speaker Map node).
 * Core and keyless, like audio_sync, registered beside it by
 * `registerVideoVerbs`. Unlisted while the deployment does not offer the node
 * to its users (Admin → Availability, or a surface profile) — the route refuses
 * it then too.
 */
import { z } from "zod"
import { SPEAKER_MAP_MAX_SOURCES, SPEAKER_MAP_MIN_CAMERAS } from "@nodaro/shared/edl"
import { SPEAKER_MAP_MAX_MARGIN_DB } from "@nodaro/render-rules"
import { isNodeDenied, USER_VIEWER } from "../../surface-deny.js"
import type { RegisterOpts } from "./verbs-image.js"
import { dispatchJob, JOB_OUTPUT_SCHEMA, uiMeta } from "./_verb-helpers.js"
import { creditHint } from "./_credit-hint.js"
import { WIDGET_URI } from "../widgets/registrar.js"

export const SPEAKER_MAP_TOOL = "speaker_map"

/** The node this verb runs — its availability decides whether the verb is listed. */
const NODE_TYPE = "speaker-map"

export function speakerMapDescription(): string {
  return (
    "Work out which camera each speaker is on, from the cameras' own microphones. " +
    `\`sources\`: ${SPEAKER_MAP_MIN_CAMERAS}–${SPEAKER_MAP_MAX_SOURCES} \`{ id, url, kind? }\` (the cameras, and the master/wide when you name them; \`kind: "audio"\` for a sound-only recording); ` +
    "`transcript`: a diarized transcript (transcribe with speaker detection); " +
    "`offsets`: an `audio_sync` result (omit when the recordings already share a clock); " +
    "`wide_source_id` / `master_source_id`: recordings that are no one's camera. " +
    "While a speaker talks, the camera that hears them loudest by at least `margin_db` (default 3 dB) is theirs. " +
    "Returns a job id — `output_data.json` is `{ version, speakerMap, confidence, notes, edl? }`; pass that result to " +
    "`switch_cameras` as `speaker_map_result` (or its `speakerMap` as `speaker_map`). A speaker with no clear camera " +
    "gets \"\" (shown on the wide shot); a camera that heard nothing is a note, never a failure. " +
    `${creditHint(NODE_TYPE)} per run.`
  )
}

export function registerSpeakerMapVerb({ server, session, fastify }: RegisterOpts): void {
  if (isNodeDenied(NODE_TYPE, USER_VIEWER)) return
  server.registerTool(
    SPEAKER_MAP_TOOL,
    {
      title: "Speaker Map",
      description: speakerMapDescription(),
      inputSchema: {
        sources: z
          .array(z.object({
            id: z.string().min(1).max(200).describe("Your id for this recording — the camera id the map names (use the EDL's source id)."),
            url: z.string().url().describe("Audio OR video URL — the audio track is read either way."),
            kind: z.enum(["video", "audio"]).optional().describe("\"audio\" for a sound-only recording (never anyone's camera). Default video."),
          }))
          .min(SPEAKER_MAP_MIN_CAMERAS)
          .max(SPEAKER_MAP_MAX_SOURCES)
          .describe("The cameras (and the master / wide recordings), each with a unique id."),
        transcript: z.union([z.record(z.string(), z.unknown()), z.string()]).describe("The word transcript with speaker labels, object or JSON string."),
        offsets: z.union([z.record(z.string(), z.unknown()), z.string()]).optional().describe("An audio_sync job's output_data.json (object or JSON string). Omit when the recordings share a clock."),
        master_source_id: z.string().min(1).max(200).optional().describe("The id of the master audio: hears everyone, so it is no one's camera."),
        wide_source_id: z.string().min(1).max(200).optional().describe("The id of the wide shot: no one's camera; a speaker with no clear camera is shown on it."),
        margin_db: z.number().min(0).max(SPEAKER_MAP_MAX_MARGIN_DB).optional().describe("How much louder (dB) the loudest camera must be than the next for a speaker to get it. Default 3."),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: uiMeta(WIDGET_URI.jobAuto),
    },
    async (args) => {
      const payload: Record<string, unknown> = {
        sources: args.sources,
        transcript: args.transcript,
        ...(args.offsets !== undefined ? { offsets: args.offsets } : {}),
        ...(args.master_source_id !== undefined ? { masterSourceId: args.master_source_id } : {}),
        ...(args.wide_source_id !== undefined ? { wideSourceId: args.wide_source_id } : {}),
        ...(args.margin_db !== undefined ? { marginDb: args.margin_db } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, {
        url: "/v1/speaker-map",
        payload,
        label: "Speaker map",
        widgetKind: "generic",
        widgetData: { prompt: `(speaker map, ${args.sources.length} sources)` },
      })
    },
  )
}
