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
  MASK_COMPOSITE_FILLS,
  VIDEO_MASK_LIMITS,
  VIDEO_MASK_PROVIDERS,
} from "@nodaro/shared/media"
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

const zoneMargin = z.number().min(L.ZONE_MARGIN_PCT_MIN).max(L.ZONE_MARGIN_PCT_MAX).optional()

/** The `zone` arg in the route's names, only the margins given (the route reads a missing one as 0);
 *  undefined when none is given (`{}`): the zone is then left out, off, as the route reads an all-0 zone. */
function zoneBody(zone: { left_pct?: number; right_pct?: number; top_pct?: number; bottom_pct?: number } | undefined): Record<string, number> | undefined {
  if (!zone) return undefined
  const body = {
    ...(zone.left_pct !== undefined ? { leftPct: zone.left_pct } : {}),
    ...(zone.right_pct !== undefined ? { rightPct: zone.right_pct } : {}),
    ...(zone.top_pct !== undefined ? { topPct: zone.top_pct } : {}),
    ...(zone.bottom_pct !== undefined ? { bottomPct: zone.bottom_pct } : {}),
  }
  return Object.keys(body).length > 0 ? body : undefined
}

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
        hold_last_mask: z.boolean().optional().describe("Keep the last mask on frames where the subject is lost (default false)."),
        min_subject_height_pct: z.number().min(L.MIN_SUBJECT_HEIGHT_PCT_MIN).max(L.MIN_SUBJECT_HEIGHT_PCT_MAX).optional().describe("Drop regions shorter than this % of the frame height (default 0 = off)."),
        max_subject_height_pct: z.number().min(L.MAX_SUBJECT_HEIGHT_PCT_MIN).max(L.MAX_SUBJECT_HEIGHT_PCT_MAX).optional().describe("Drop regions taller than this % of the frame height (default 0 = off)."),
        zone: z
          .object({ left_pct: zoneMargin, right_pct: zoneMargin, top_pct: zoneMargin, bottom_pct: zoneMargin })
          .optional()
          .describe("Keep only regions whose centre is inside these margins (% of the frame; each 0 when left out; default off — an empty zone {} is off too)."),
        per_shot: z.boolean().optional().describe("Detect the subject again in every shot after a scene cut (default false)."),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: VIDEO_WIDGET,
    },
    async (args) => {
      const video = await videoFrom("video", args.video_url, args.video_asset_id, session.userId)
      if ("refusal" in video) return video.refusal
      const zone = zoneBody(args.zone)
      const payload: Record<string, unknown> = {
        videoUrl: video.url,
        prompt: args.prompt,
        ...(args.threshold !== undefined ? { threshold: args.threshold } : {}),
        ...(args.provider ? { provider: args.provider } : {}),
        ...(args.hold_last_mask !== undefined ? { holdLastMask: args.hold_last_mask } : {}),
        ...(args.min_subject_height_pct !== undefined ? { minSubjectHeightPct: args.min_subject_height_pct } : {}),
        ...(args.max_subject_height_pct !== undefined ? { maxSubjectHeightPct: args.max_subject_height_pct } : {}),
        ...(zone ? { zone } : {}),
        ...(args.per_shot !== undefined ? { perShot: args.per_shot } : {}),
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
        `Optional: \`invert_mask\`, \`feather\` (0–${B.FEATHER_MAX} px edge softening, default 2), \`grow\` (${B.GROW_MIN}–${B.GROW_MAX} px — positive widens the foreground, negative trims halos), \`opacity\` (0–1, default 1), \`fill\` (pixelate / blur: the background itself, no foreground needed), ` +
        `priced per started 5 s of the result (the video it follows up to ${B.MAX_DURATION_SEC} s), ` +
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
        opacity: z.number().min(B.OPACITY_MIN).max(B.OPACITY_MAX).optional().describe("How strongly the fill covers the background inside the mask, 0–1 (default 1 = fully)."),
        fill: z.enum(MASK_COMPOSITE_FILLS).optional().describe("What fills the mask (default video)."),
        pixel_size_pct: z.number().min(B.PIXEL_SIZE_PCT_MIN).max(B.PIXEL_SIZE_PCT_MAX).optional().describe("Pixelate block size, % of frame width (default 1.25)."),
        blur_strength_pct: z.number().min(B.BLUR_STRENGTH_PCT_MIN).max(B.BLUR_STRENGTH_PCT_MAX).optional().describe("Blur sigma, % of frame width (default 2)."),
        background_fit: z.enum(MASK_COMPOSITE_BACKGROUND_FITS).optional().describe("How the background fills the foreground's frame (default cover)."),
        audio_source: z.enum(MASK_COMPOSITE_AUDIO_SOURCES).optional().describe("Which sound the result carries (default foreground)."),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: VIDEO_WIDGET,
    },
    async (args) => {
      // Pixelate / blur take no foreground: none is resolved or sent.
      const withForeground = (args.fill ?? "video") === "video"
      const fg = withForeground ? await videoFrom("foreground", args.foreground_url, args.foreground_asset_id, session.userId) : undefined
      if (fg && "refusal" in fg) return fg.refusal
      const bg = await videoFrom("background", args.background_url, args.background_asset_id, session.userId)
      if ("refusal" in bg) return bg.refusal
      const mask = await videoFrom("mask", args.mask_url, args.mask_asset_id, session.userId)
      if ("refusal" in mask) return mask.refusal
      const payload: Record<string, unknown> = {
        ...(fg ? { foregroundUrl: fg.url } : {}),
        backgroundUrl: bg.url,
        maskUrl: mask.url,
        ...(args.invert_mask !== undefined ? { invertMask: args.invert_mask } : {}),
        ...(args.feather !== undefined ? { feather: args.feather } : {}),
        ...(args.grow !== undefined ? { grow: args.grow } : {}),
        ...(args.opacity !== undefined ? { opacity: args.opacity } : {}),
        ...(args.fill ? { fill: args.fill } : {}),
        ...(args.pixel_size_pct !== undefined ? { pixelSizePct: args.pixel_size_pct } : {}),
        ...(args.blur_strength_pct !== undefined ? { blurStrengthPct: args.blur_strength_pct } : {}),
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
