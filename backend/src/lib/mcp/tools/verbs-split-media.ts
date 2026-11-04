/**
 * `split_media` — the MCP face of the Split into Chunks node (`split-media`,
 * `POST /v1/split-media`): a video and/or a sound file cut into parts of at
 * most `chunk_duration` and at least `min_part_duration` seconds, exact to the
 * frame (video) or the sample (audio) — or, with `mode: "shots"`, a video cut
 * into one part per shot at its measured cuts. Its own module (the video verbs file is
 * already past 3,000 lines); `registerVideoVerbs` calls it after its
 * `workflows:execute` gate. Ungated by edition — community runs it — so the
 * wire text carries no price (the node doc and docs/mcp/tools.md do).
 *
 * The job has MANY outputs (`videoUrls[]` / `audioUrls[]`), so the card is the
 * generic job widget: the single-asset video/audio cards read one URL and
 * would render empty here.
 */
import { z } from "zod"
import { SPLIT_MEDIA_DEFAULT_MIN_PART_SEC, SPLIT_MEDIA_MAX_PARTS } from "@nodaro/render-rules"
import { resolveAssetId } from "../asset-resolver.js"
import { WIDGET_URI } from "../widgets/registrar.js"
import type { RegisterOpts } from "./verbs-image.js"
import { dispatchJob, JOB_OUTPUT_SCHEMA, uiMeta } from "./_verb-helpers.js"

function refuse(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** `<kind>_url` or `<kind>_asset_id` → a URL, nothing when neither is given, or a refusal naming the id. */
async function sourceFrom(
  kind: "video" | "audio",
  url: string | undefined,
  assetId: string | undefined,
  userId: string,
): Promise<{ url: string | undefined } | { refusal: ReturnType<typeof refuse> }> {
  if (url) return { url }
  if (!assetId) return { url: undefined }
  try {
    const resolved = await resolveAssetId({ assetId, userId, expectedKind: kind })
    if (resolved) return { url: resolved }
    return { refusal: refuse(`${kind}_asset_id: no ${kind} found for ${assetId}.`) }
  } catch (err) {
    return { refusal: refuse(`${kind}_asset_id: ${messageOf(err)}`) }
  }
}

export function registerSplitMediaVerb({ server, session, fastify }: RegisterOpts): void {
  server.registerTool(
    "split_media",
    {
      title: "Split into Chunks",
      description:
        "Cut a video and/or an audio file into consecutive parts — local ffmpeg, no AI. Every part is at most `chunk_duration` seconds " +
        `and at least \`min_part_duration\` (default ${SPLIT_MEDIA_DEFAULT_MIN_PART_SEC} s, never above chunk_duration): a short leftover is evened out with the parts before it. ` +
        "Video parts are cut on whole frames, each part's sound never past its picture; audio parts are sample-exact (aac: whole AAC frames). Sources up to 3 hours. " +
        "Pass `video_url` / `video_asset_id`, `audio_url` / `audio_asset_id`, or both (each is split on its own). " +
        `At most ${SPLIT_MEDIA_MAX_PARTS} parts per input — a longer source fails with the shortest part length that fits; a source shorter than the minimum fails too. ` +
        "`mode: \"shots\"` instead cuts a VIDEO into one part per shot, at the cuts measured from the file (the `shot_cuts` rule; hard cuts, not dissolves): no chunk_duration, " +
        `no separate audio (each part keeps the video's own sound), videos up to 30 minutes and at most ${SPLIT_MEDIA_MAX_PARTS} shots. ` +
        "Returns a job_id; read the parts from `get_job` / `wait_for_job` `outputData`: `videoUrls[]`, `audioUrls[]`, `chunkCount`, `partDurationsSec[]` " +
        "(shots mode adds `shotCount` and `shots[]`: `{ index, startSec, endSec, durationSec }` of each part on the video). " +
        "To process each part, pass a part URL as another tool's `video_url` / `audio_url` (this job id is not an asset id).",
      inputSchema: {
        video_url: z.string().url().optional().describe("Video to split."),
        video_asset_id: z.string().optional().describe("Video to split, as a Nodaro video job id or an uploaded video's id."),
        audio_url: z.string().url().optional().describe("Audio file to split."),
        audio_asset_id: z.string().optional().describe("Audio to split, as a Nodaro audio job id or an uploaded audio's id."),
        mode: z.enum(["duration", "shots"]).optional().describe("\"duration\" (default): parts of at most chunk_duration. \"shots\": one part per shot of the video (video only; chunk_duration, min_part_duration and audio_format are not used)."),
        chunk_duration: z.number().min(1).optional().describe("Longest a part may be, in seconds (every part is at most this). Required unless mode is \"shots\"."),
        min_part_duration: z
          .number()
          .min(0)
          .optional()
          .describe(`Shortest a part may be, in seconds (default ${SPLIT_MEDIA_DEFAULT_MIN_PART_SEC}); must not exceed chunk_duration.`),
        audio_format: z.enum(["mp3", "wav", "aac"]).optional().describe("Format of the audio parts. Default mp3."),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: uiMeta(WIDGET_URI.jobAuto),
    },
    async (args) => {
      const video = await sourceFrom("video", args.video_url, args.video_asset_id, session.userId)
      if ("refusal" in video) return video.refusal
      const audio = await sourceFrom("audio", args.audio_url, args.audio_asset_id, session.userId)
      if ("refusal" in audio) return audio.refusal
      if (args.mode === "shots") {
        if (!video.url) return refuse("mode \"shots\" splits a video: pass video_url or video_asset_id.")
        if (audio.url) return refuse("mode \"shots\" splits a video (each part keeps its own sound): leave out audio_url / audio_asset_id, or split by chunk_duration.")
        return dispatchJob(fastify, session, {
          url: "/v1/split-media",
          payload: { videoUrl: video.url, mode: "shots", mcp_client: session.clientName, userId: session.userId },
          label: "split into chunks",
          widgetKind: "generic",
          widgetData: { prompt: "split at the shots", model: "split-media" },
        })
      }
      if (!video.url && !audio.url) {
        return refuse("Pass video_url / video_asset_id, audio_url / audio_asset_id, or both.")
      }
      if (args.chunk_duration === undefined) {
        return refuse("chunk_duration is required (or pass mode \"shots\" to cut a video at its shots).")
      }
      if (args.min_part_duration !== undefined && args.min_part_duration > args.chunk_duration) {
        return refuse("min_part_duration must not be longer than chunk_duration.")
      }
      const payload: Record<string, unknown> = {
        ...(video.url ? { videoUrl: video.url } : {}),
        ...(audio.url ? { audioUrl: audio.url } : {}),
        chunkDuration: args.chunk_duration,
        ...(args.min_part_duration !== undefined ? { minPartDuration: args.min_part_duration } : {}),
        ...(args.audio_format ? { audioFormat: args.audio_format } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, {
        url: "/v1/split-media",
        payload,
        label: "split into chunks",
        widgetKind: "generic",
        widgetData: { prompt: `split into parts of at most ${args.chunk_duration} s`, model: "split-media" },
      })
    },
  )
}
