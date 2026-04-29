import { z } from "zod"
import { resolveAssetId } from "../asset-resolver.js"
import { buildCompositePrompt } from "../prompt-builder-bridge.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { config } from "../../config.js"
import type { RegisterOpts } from "./verbs-image.js"

const executeGate: ToolGate = { required: ["workflows:execute"] }

interface ParsedJobBody {
  jobId?: string
  job_id?: string
  id?: string
}

function parseJobId(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as ParsedJobBody
    return parsed.jobId ?? parsed.job_id ?? parsed.id ?? null
  } catch {
    return null
  }
}

function jobResult(jobId: string, label: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Submitted ${label} job ${jobId}. Track via tasks/get with task_id=${jobId} or open: https://app.nodaro.ai/library/jobs/${jobId}`,
      },
    ],
    _meta: { task_id: jobId },
  }
}

function errorResult(statusCode: number, body: string) {
  return {
    content: [{ type: "text" as const, text: `Error from Nodaro: ${statusCode} ${body}` }],
    isError: true,
  }
}

function parseFailure(body: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Submitted but couldn't parse job_id from response: ${body}`,
      },
    ],
    isError: true,
  }
}

const StructuredFields = z
  .object({
    person: z.record(z.string(), z.unknown()).optional(),
    styling: z.record(z.string(), z.unknown()).optional(),
    setting: z.record(z.string(), z.unknown()).optional(),
    camera: z.record(z.string(), z.unknown()).optional(),
    lens: z.record(z.string(), z.unknown()).optional(),
    mood: z.string().optional(),
  })
  .partial()

export function registerVideoVerbs({ server, session, fastify }: RegisterOpts): void {
  if (!passesGate(session, executeGate)) return

  // ── generate_video (text-to-video) ──
  server.registerTool(
    "generate_video",
    {
      title: "Generate Video",
      description:
        "Generate a video from a text prompt (text-to-video). Returns a job_id; poll via tasks/get.",
      inputSchema: {
        prompt: z.string().min(1).max(2500),
        model: z
          .enum([
            "minimax",
            "veo3",
            "veo3.1",
            "kling",
            "kling-turbo",
            "kling-3.0",
            "grok",
            "seedance",
            "seedance-2",
            "wan",
            "wan-turbo",
            "hailuo-standard",
            "bytedance-lite",
            "bytedance-pro",
          ])
          .optional(),
        duration: z.number().int().min(1).max(60).optional(),
        aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).optional(),
        sound: z.boolean().optional(),
        negative_prompt: z.string().max(2500).optional(),
        seed: z.number().int().min(10000).max(99999).optional(),
        structured: StructuredFields.optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const compositePrompt = buildCompositePrompt(args.prompt, args.structured)
      const payload = {
        prompt: compositePrompt,
        provider: args.model,
        duration: args.duration,
        aspectRatio: args.aspect_ratio,
        sound: args.sound,
        negativePrompt: args.negative_prompt,
        seed: args.seed,
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/text-to-video",
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResult(jobId, "text-to-video")
    },
  )

  // ── animate_image (image-to-video) ──
  server.registerTool(
    "animate_image",
    {
      title: "Animate Image",
      description:
        "Animate an image into a video (image-to-video). Provide either image_url OR image_asset_id. Returns a job_id; poll via tasks/get.",
      inputSchema: {
        prompt: z.string().max(2500).optional(),
        image_url: z.string().url().optional(),
        image_asset_id: z.string().optional(),
        model: z
          .enum([
            "minimax",
            "veo3",
            "veo3.1",
            "kling",
            "kling-turbo",
            "kling-3.0",
            "kling-master",
            "seedance",
            "seedance-2",
            "hailuo-2.3-pro",
            "hailuo-2.3",
            "hailuo-standard",
            "wan-i2v",
            "wan-turbo",
            "bytedance-lite",
            "bytedance-pro",
            "grok-i2v",
          ])
          .optional(),
        duration: z.number().int().min(1).max(60).optional(),
        aspect_ratio: z.enum(["16:9", "9:16", "1:1"]).optional(),
        sound: z.boolean().optional(),
        end_frame_url: z.string().url().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const imageUrl =
        args.image_url ??
        (args.image_asset_id
          ? await resolveAssetId({
              assetId: args.image_asset_id,
              userId: session.userId,
              expectedKind: "image",
            })
          : null)
      if (!imageUrl) {
        return {
          content: [
            { type: "text", text: "Either image_url or image_asset_id is required" },
          ],
          isError: true,
        }
      }
      const payload = {
        imageUrl,
        endFrameUrl: args.end_frame_url,
        prompt: args.prompt,
        provider: args.model,
        duration: args.duration,
        aspectRatio: args.aspect_ratio,
        sound: args.sound,
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/generate-video",
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResult(jobId, "image-to-video")
    },
  )

  // ── extend_video ──
  server.registerTool(
    "extend_video",
    {
      title: "Extend Video",
      description:
        "Extend a previously-generated VEO or Runway video. Requires the kie_task_id from the prior video generation job (NOT the URL).",
      inputSchema: {
        prompt: z.string().min(1).max(2000),
        kie_task_id: z.string().min(1).describe("KIE task id from prior video generation"),
        model: z.enum(["veo-extend", "runway-extend"]),
        veo_quality: z.enum(["fast", "quality"]).optional(),
        runway_resolution: z.enum(["720p", "1080p"]).optional(),
        seed: z.number().int().min(10000).max(99999).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const payload = {
        kieTaskId: args.kie_task_id,
        prompt: args.prompt,
        provider: args.model,
        model: args.veo_quality,
        seeds: args.seed,
        quality: args.runway_resolution,
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/extend-video",
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResult(jobId, "video extend")
    },
  )

  // ── combine_videos ──
  server.registerTool(
    "combine_videos",
    {
      title: "Combine Videos",
      description:
        "Concatenate multiple videos into one. Each item is either { url } or { asset_id } (a Nodaro job id whose output is a video).",
      inputSchema: {
        videos: z
          .array(
            z.object({
              url: z.string().url().optional(),
              asset_id: z.string().optional(),
            }),
          )
          .min(2)
          .describe("At least 2 video sources"),
        transition: z
          .enum(["cut", "fade", "dissolve", "dip-to-black", "dip-to-white"])
          .optional(),
        transition_duration: z.number().min(0).max(5).optional(),
        audio_mode: z.enum(["keep", "crossfade", "remove"]).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const videoUrls: string[] = []
      for (const item of args.videos) {
        const url =
          item.url ??
          (item.asset_id
            ? await resolveAssetId({
                assetId: item.asset_id,
                userId: session.userId,
                expectedKind: "video",
              })
            : null)
        if (!url) {
          return {
            content: [
              {
                type: "text",
                text: "Each video must have either a url or an asset_id",
              },
            ],
            isError: true,
          }
        }
        videoUrls.push(url)
      }
      const payload = {
        videoUrls,
        transition: args.transition,
        transitionDuration: args.transition_duration,
        audioMode: args.audio_mode,
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/combine-videos",
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResult(jobId, "combine videos")
    },
  )

  // ── add_captions ──
  server.registerTool(
    "add_captions",
    {
      title: "Add Captions",
      description:
        "Burn captions into a video. Provide either video_url OR video_asset_id, plus the caption text.",
      inputSchema: {
        text: z.string().min(1),
        video_url: z.string().url().optional(),
        video_asset_id: z.string().optional(),
        style: z.enum(["subtitle", "word-highlight", "karaoke"]).optional(),
        position: z.enum(["bottom", "top", "center"]).optional(),
        font_size: z.number().int().min(12).max(72).optional(),
        color: z.string().optional(),
        background_color: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const videoUrl =
        args.video_url ??
        (args.video_asset_id
          ? await resolveAssetId({
              assetId: args.video_asset_id,
              userId: session.userId,
              expectedKind: "video",
            })
          : null)
      if (!videoUrl) {
        return {
          content: [
            { type: "text", text: "Either video_url or video_asset_id is required" },
          ],
          isError: true,
        }
      }
      const payload = {
        videoUrl,
        text: args.text,
        style: args.style,
        position: args.position,
        fontSize: args.font_size,
        color: args.color,
        backgroundColor: args.background_color,
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/add-captions",
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResult(jobId, "add captions")
    },
  )

  // ── extract_frame ──
  server.registerTool(
    "extract_frame",
    {
      title: "Extract Frame",
      description:
        "Extract a single frame from a video as an image. Provide either video_url OR video_asset_id, and either mode (first/last) or a timestamp in seconds.",
      inputSchema: {
        video_url: z.string().url().optional(),
        video_asset_id: z.string().optional(),
        mode: z.enum(["first", "last", "timestamp"]).optional(),
        time_seconds: z.number().min(0).optional().describe("Used when mode is 'timestamp'"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const videoUrl =
        args.video_url ??
        (args.video_asset_id
          ? await resolveAssetId({
              assetId: args.video_asset_id,
              userId: session.userId,
              expectedKind: "video",
            })
          : null)
      if (!videoUrl) {
        return {
          content: [
            { type: "text", text: "Either video_url or video_asset_id is required" },
          ],
          isError: true,
        }
      }
      const payload = {
        videoUrl,
        mode: args.mode ?? "first",
        timestamp: args.time_seconds,
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/extract-frame",
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResult(jobId, "extract frame")
    },
  )
}
