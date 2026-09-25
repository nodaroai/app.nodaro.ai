/**
 * `overlay_images` — timed image layers over a video, the MCP face of the
 * `video-overlay` node and `POST /v1/video-overlay`. Its own module (the
 * video verbs file is already past 3,000 lines); `registerVideoVerbs` calls
 * it after its `workflows:execute` gate. Ungated by edition — community runs
 * it — so the wire text carries no price (the node doc and docs/mcp/tools.md
 * do).
 */
import { z } from "zod"
import {
  OVERLAY_ANCHORS,
  VIDEO_OVERLAY_BOUNDS,
  VIDEO_OVERLAY_CORNERS,
  VIDEO_OVERLAY_FITS,
  VIDEO_OVERLAY_MAX_LAYERS,
  VIDEO_OVERLAY_MAX_TIME_SEC,
  VIDEO_OVERLAY_OUTPUT_ASPECTS,
  VIDEO_OVERLAY_PRESET_IDS,
} from "@nodaro/shared"
import { resolveAssetId } from "../asset-resolver.js"
import type { RegisterOpts } from "./verbs-image.js"
import { dispatchJob, JOB_OUTPUT_SCHEMA } from "./_verb-helpers.js"

const B = VIDEO_OVERLAY_BOUNDS
const seconds = z.number().min(0).max(VIDEO_OVERLAY_MAX_TIME_SEC)

function refuse(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function registerOverlayImagesVerb({ server, session, fastify }: RegisterOpts): void {
  server.registerTool(
    "overlay_images",
    {
      title: "Overlay Images on Video",
      description:
        `Place 1–${VIDEO_OVERLAY_MAX_LAYERS} timed image layers (logos, product shots, screenshots, cards) over a video — local, deterministic, no AI. The base audio is kept untouched.\n\n` +
        "Per layer: `url` or `asset_id` (an image job or upload; an image_overlay result works), `start` and optional `end` in seconds (no `end` = to the end of the video). " +
        "Placement: `preset` card (centred, fitted into 78% × 60% of the frame), corner-badge (18% wide, 4% in from `corner`, default bottom-right) or full-frame — " +
        "or an explicit box in image_overlay's percent vocabulary (`anchor`, `x`, `y`, `width`, `height`, `fit`). An explicit box field overrides the preset; with neither, the layer is a corner badge. " +
        "Also `opacity`, `animate` (a 0.15 s fade and slight scale in and out, default on) and `z_index` (default: array order).\n\n" +
        "Optional `output_aspect` with `base_fit` (cover / contain) and `background_color`; by default the output keeps the video's own size and frame rate. " +
        "Layers past the video's end are clipped or skipped, and an animated image renders its first frame — both reported as warnings in the job output. Returns a job_id; widget renders the video.",
      inputSchema: {
        video_url: z.string().url().optional().describe("Base video URL."),
        video_asset_id: z.string().optional().describe("Base video as a Nodaro video job id or an uploaded video's id."),
        layers: z
          .array(
            z.object({
              url: z.string().url().optional(),
              asset_id: z.string().optional(),
              start: seconds,
              end: seconds.optional(),
              preset: z.enum(VIDEO_OVERLAY_PRESET_IDS).optional(),
              corner: z.enum(VIDEO_OVERLAY_CORNERS).optional(),
              anchor: z.enum(OVERLAY_ANCHORS).optional(),
              x: z.number().min(B.x[0]).max(B.x[1]).optional(),
              y: z.number().min(B.y[0]).max(B.y[1]).optional(),
              width: z.number().min(B.width[0]).max(B.width[1]).optional(),
              height: z.number().min(B.height[0]).max(B.height[1]).optional(),
              fit: z.enum(VIDEO_OVERLAY_FITS).optional(),
              opacity: z.number().min(B.opacity[0]).max(B.opacity[1]).optional(),
              animate: z.boolean().optional(),
              z_index: z.number().int().min(B.zIndex[0]).max(B.zIndex[1]).optional(),
            }),
          )
          .min(1)
          .max(VIDEO_OVERLAY_MAX_LAYERS)
          .describe(`1–${VIDEO_OVERLAY_MAX_LAYERS} layers, each { url } or { asset_id } plus start (and optionally end) in seconds.`),
        output_aspect: z.enum(VIDEO_OVERLAY_OUTPUT_ASPECTS).optional().describe("Render onto this aspect's canvas instead of the video's own size."),
        base_fit: z.enum(VIDEO_OVERLAY_FITS).optional().describe("How the video fills output_aspect (default cover)."),
        background_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Padding colour for base_fit contain (default #000000)."),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v4/job-video",
        ui: { resourceUri: "ui://nodaro/widget/v4/job-video", visibility: ["model", "app"] },
      },
    },
    async (args) => {
      let videoUrl: string | null = args.video_url ?? null
      if (!videoUrl && args.video_asset_id) {
        // resolveAssetId THROWS for every real failure (not found, another
        // user's, wrong kind, no url yet) — say which input it was.
        try {
          videoUrl = await resolveAssetId({ assetId: args.video_asset_id, userId: session.userId, expectedKind: "video" })
        } catch (err) {
          return refuse(`video_asset_id: ${messageOf(err)}`)
        }
      }
      if (!videoUrl) return refuse("Provide the base video as video_url or video_asset_id.")

      const layers: Record<string, unknown>[] = []
      // Sequential on purpose — up to 20 asset lookups must not stampede.
      for (const [i, layer] of args.layers.entries()) {
        let imageUrl: string | null = layer.url ?? null
        if (!imageUrl && layer.asset_id) {
          try {
            imageUrl = await resolveAssetId({ assetId: layer.asset_id, userId: session.userId, expectedKind: "image" })
          } catch (err) {
            return refuse(`layers[${i}]: ${messageOf(err)}`)
          }
        }
        if (!imageUrl) return refuse(`layers[${i}]: give the image as url or asset_id`)
        const { url: _url, asset_id: _assetId, z_index, ...placement } = layer
        layers.push({
          ...Object.fromEntries(Object.entries(placement).filter(([, v]) => v !== undefined)),
          imageUrl,
          ...(z_index !== undefined ? { zIndex: z_index } : {}),
        })
      }

      const payload: Record<string, unknown> = {
        videoUrl,
        layers,
        ...(args.output_aspect ? { outputAspect: args.output_aspect } : {}),
        ...(args.base_fit ? { baseFit: args.base_fit } : {}),
        ...(args.background_color ? { backgroundColor: args.background_color } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, {
        url: "/v1/video-overlay",
        payload,
        label: "video-overlay",
        widgetKind: "video",
        widgetData: { prompt: `(video overlay · ${layers.length} layer${layers.length === 1 ? "" : "s"})`, model: "video-overlay" },
      })
    },
  )
}
