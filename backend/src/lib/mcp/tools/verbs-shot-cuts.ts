/**
 * `shot_cuts` — where every shot of a video starts and ends, measured from the
 * file, with each shot's first and last frame on request: the MCP face of
 * POST /v1/shot-cuts (the Shot Cuts node). Core and keyless (local ffmpeg),
 * registered beside `split_media` by `registerVideoVerbs`. Unlisted while the
 * deployment does not offer the node to its users (Admin → Availability, or a
 * surface profile). The node's type is read from the unit that declares this
 * tool (`mcp.widgetModelFor`), so the verb names no type id.
 */
import { z } from "zod"
import { resolveAssetId } from "../asset-resolver.js"
import { isNodeDenied, USER_VIEWER } from "../../surface-deny.js"
import { widgetModelOf } from "../widget-models.js"
import { WIDGET_URI } from "../widgets/registrar.js"
import type { RegisterOpts } from "./verbs-image.js"
import { dispatchJob, JOB_OUTPUT_SCHEMA, uiMeta } from "./_verb-helpers.js"
import { creditHint } from "./_credit-hint.js"

export const SHOT_CUTS_TOOL = "shot_cuts"

function refuse(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function shotCutsDescription(nodeType: string): string {
  return (
    "Find where every shot of a video starts and ends — measured from the file (local ffmpeg, no AI): every decoded frame is scored " +
    "and each hard cut starts a new shot (dissolves and fades are not cuts; a returning flash is not a cut). Videos up to 30 minutes (MP4, MOV, MKV, WebM). " +
    "Pass `video_url` or `video_asset_id`. `frames: true` also saves each shot's exact first and last frame as PNG images (up to 1,000 shots; same price). " +
    "Returns a job_id; read `get_job` / `wait_for_job` `outputData.json`: `{ shotCount, cutsSec, durationSec, shots: [{ index, startSec, endSec, durationSec, firstFrameUrl?, lastFrameUrl? }] }` " +
    "— seconds from the first frame; `cutsSec` ascending, never 0, `[]` for a single shot. With frames, `outputData.firstFrames` / `lastFrames` list the frame URLs in shot order. " +
    "To cut the video into one clip per shot instead, use `split_media` with `mode: \"shots\"`. " +
    `${creditHint(nodeType)} per run.`
  )
}

export function registerShotCutsVerb({ server, session, fastify }: RegisterOpts): void {
  const nodeType = widgetModelOf(SHOT_CUTS_TOOL)
  if (isNodeDenied(nodeType, USER_VIEWER)) return
  server.registerTool(
    SHOT_CUTS_TOOL,
    {
      title: "Shot Cuts",
      description: shotCutsDescription(nodeType),
      inputSchema: {
        video_url: z.string().url().optional().describe("Video to measure."),
        video_asset_id: z.string().optional().describe("Video to measure, as a Nodaro video job id or an uploaded video's id."),
        frames: z.boolean().optional().describe("Also save each shot's first and last frame as images. Default false."),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: uiMeta(WIDGET_URI.jobAuto),
    },
    async (args) => {
      let videoUrl = args.video_url
      if (!videoUrl && args.video_asset_id) {
        try {
          videoUrl = (await resolveAssetId({ assetId: args.video_asset_id, userId: session.userId, expectedKind: "video" })) ?? undefined
        } catch (err) {
          return refuse(`video_asset_id: ${messageOf(err)}`)
        }
        if (!videoUrl) return refuse(`video_asset_id: no video found for ${args.video_asset_id}.`)
      }
      if (!videoUrl) return refuse("Pass video_url or video_asset_id.")
      const payload: Record<string, unknown> = {
        videoUrl,
        ...(args.frames !== undefined ? { frames: args.frames } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, {
        url: `/v1/${nodeType}`,
        payload,
        label: "shot cuts",
        widgetKind: "generic",
        widgetData: { prompt: args.frames ? "(shot cuts, with frames)" : "(shot cuts)", model: nodeType },
      })
    },
  )
}
