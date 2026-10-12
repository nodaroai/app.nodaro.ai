/**
 * `video_mask` + `mask_composite` — the MCP faces of the `video-mask` and
 * `mask-composite` nodes (`POST /v1/video-mask`, `POST /v1/mask-composite`).
 * Their own module (the video verbs file is already past 3,000 lines);
 * `registerVideoVerbs` calls it after its `workflows:execute` gate. The wire
 * text carries no price (the node docs and docs/mcp/tools.md do).
 */
import { z } from "zod"
import {
  MASK_COMPOSITE_AUDIO_SOURCES,
  MASK_COMPOSITE_BACKGROUND_FITS,
  MASK_COMPOSITE_BOUNDS,
  VIDEO_MASK_LIMITS,
  VIDEO_MASK_PROVIDERS,
} from "@nodaro/shared"
import { resolveAssetId } from "../asset-resolver.js"
import type { RegisterOpts } from "./verbs-image.js"
import { dispatchJob, JOB_OUTPUT_SCHEMA } from "./_verb-helpers.js"

const VIDEO_WIDGET = {
  "ui/resourceUri": "ui://nodaro/widget/v4/job-video",
  ui: { resourceUri: "ui://nodaro/widget/v4/job-video", visibility: ["model", "app"] },
}

function refuse(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** `<name>_url` or `<name>_asset_id` → a video URL, or a refusal naming the input. */
async function videoFrom(
  name: string,
  url: string | undefined,
  assetId: string | undefined,
  userId: string,
): Promise<{ url: string } | { refusal: ReturnType<typeof refuse> }> {
  if (url) return { url }
  if (assetId) {
    try {
      const resolved = await resolveAssetId({ assetId, userId, expectedKind: "video" })
      if (resolved) return { url: resolved }
    } catch (err) {
      return { refusal: refuse(`${name}_asset_id: ${messageOf(err)}`) }
    }
  }
  return { refusal: refuse(`Provide the ${name.replace(/_/g, " ")} video as ${name}_url or ${name}_asset_id.`) }
}

const L = VIDEO_MASK_LIMITS
const B = MASK_COMPOSITE_BOUNDS

export function registerVideoMaskVerbs({ server, session, fastify }: RegisterOpts): void {
  server.registerTool(
    "video_mask",
    {
      title: "Video Mask",
      description:
        "Track a subject described in plain text through a video and return a black-and-white MASK VIDEO (white = the subject, black = everything else), using SAM 3.1 (default) or SAM 3 (half the price). " +
        `Clips up to ${L.MAX_BILLED_SEC} s at ${L.FPS_BASIS} fps (a faster clip counts proportionally longer); priced by the clip's length. ` +
        "Name the subject with a short noun phrase ('the dancer', 'the red car'); separate several with commas ('person, dog'). " +
        "Feed the result to mask_composite to place the subject over another video. Returns a job_id; widget renders the mask video.",
      inputSchema: {
        video_url: z.string().url().optional().describe("Source video URL."),
        video_asset_id: z.string().optional().describe("Source video as a Nodaro video job id or an uploaded video's id."),
        prompt: z.string().min(1).max(L.PROMPT_MAX_LENGTH).describe("What to track (e.g. 'the woman in the red coat')."),
        threshold: z
          .number()
          .min(L.THRESHOLD_MIN)
          .max(L.THRESHOLD_MAX)
          .optional()
          .describe(`Detection confidence (default ${L.THRESHOLD_DEFAULT}). Lower finds more — try 0.3 when nothing matches.`),
        provider: z.enum(VIDEO_MASK_PROVIDERS).optional().describe("Segmentation model: sam-3.1 (default) or sam-3 (half the price)."),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: VIDEO_WIDGET,
    },
    async (args) => {
      const video = await videoFrom("video", args.video_url, args.video_asset_id, session.userId)
      if ("refusal" in video) return video.refusal
      const payload: Record<string, unknown> = {
        videoUrl: video.url,
        prompt: args.prompt,
        ...(args.threshold !== undefined ? { threshold: args.threshold } : {}),
        ...(args.provider ? { provider: args.provider } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, {
        url: "/v1/video-mask",
        payload,
        label: "video mask",
        widgetKind: "video",
        widgetData: { prompt: args.prompt, model: "video-mask" },
      })
    },
  )

  server.registerTool(
    "mask_composite",
    {
      title: "Mask Composite",
      description:
        "Place a foreground video over a background video through a mask video (white = foreground shows, black = background shows) — local ffmpeg, no AI. " +
        "Typical use: the mask from video_mask cuts the subject out of its own footage and drops it into a new scene. " +
        "The result follows the FOREGROUND's size, frame rate and length; the background is fitted to that frame (`background_fit`: cover / contain / stretch, default cover) and loops when shorter; the mask is stretched to the frame and holds its last frame when shorter. " +
        `Optional: \`invert_mask\`, \`feather\` (0–${B.FEATHER_MAX} px edge softening, default 2), \`grow\` (${B.GROW_MIN}–${B.GROW_MAX} px — positive widens the foreground, negative trims halos), ` +
        `priced per started 5 s of the result (foreground up to ${B.MAX_DURATION_SEC} s), ` +
        "`audio_source` (foreground / background / mix / none, default foreground). Returns a job_id; widget renders the video.",
      inputSchema: {
        foreground_url: z.string().url().optional().describe("Foreground video URL (the subject's footage)."),
        foreground_asset_id: z.string().optional().describe("Foreground video as a Nodaro video job id or an uploaded video's id."),
        background_url: z.string().url().optional().describe("Background video URL (the new scene)."),
        background_asset_id: z.string().optional().describe("Background video as a Nodaro video job id or an uploaded video's id."),
        mask_url: z.string().url().optional().describe("Mask video URL (white = foreground)."),
        mask_asset_id: z.string().optional().describe("Mask video as a Nodaro job id — e.g. a video_mask job."),
        invert_mask: z.boolean().optional().describe("Swap which side of the mask shows the foreground."),
        feather: z.number().int().min(B.FEATHER_MIN).max(B.FEATHER_MAX).optional().describe("Edge softening, px (default 2)."),
        grow: z.number().int().min(B.GROW_MIN).max(B.GROW_MAX).optional().describe("Grow (+) or shrink (−) the foreground region, px (default 0)."),
        background_fit: z.enum(MASK_COMPOSITE_BACKGROUND_FITS).optional().describe("How the background fills the foreground's frame (default cover)."),
        audio_source: z.enum(MASK_COMPOSITE_AUDIO_SOURCES).optional().describe("Which sound the result carries (default foreground)."),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: VIDEO_WIDGET,
    },
    async (args) => {
      const fg = await videoFrom("foreground", args.foreground_url, args.foreground_asset_id, session.userId)
      if ("refusal" in fg) return fg.refusal
      const bg = await videoFrom("background", args.background_url, args.background_asset_id, session.userId)
      if ("refusal" in bg) return bg.refusal
      const mask = await videoFrom("mask", args.mask_url, args.mask_asset_id, session.userId)
      if ("refusal" in mask) return mask.refusal
      const payload: Record<string, unknown> = {
        foregroundUrl: fg.url,
        backgroundUrl: bg.url,
        maskUrl: mask.url,
        ...(args.invert_mask !== undefined ? { invertMask: args.invert_mask } : {}),
        ...(args.feather !== undefined ? { feather: args.feather } : {}),
        ...(args.grow !== undefined ? { grow: args.grow } : {}),
        ...(args.background_fit ? { backgroundFit: args.background_fit } : {}),
        ...(args.audio_source ? { audioSource: args.audio_source } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, {
        url: "/v1/mask-composite",
        payload,
        label: "mask composite",
        widgetKind: "video",
        widgetData: { prompt: "(mask composite)", model: "mask-composite" },
      })
    },
  )
}
