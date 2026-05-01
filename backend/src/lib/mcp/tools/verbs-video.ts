import { z } from "zod"
import { resolveAssetId } from "../asset-resolver.js"
import { buildCompositePrompt } from "../prompt-builder-bridge.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { config } from "../../config.js"
import type { RegisterOpts } from "./verbs-image.js"
import {
  parseJobId,
  errorResult,
  parseFailure,
  jobResultWithWidget,
} from "./_verb-helpers.js"
import { modelIdsByKindMode } from "@nodaro/shared"
import { normalizeVideoInput } from "../normalize.js"
import { getUserMcpPreferences } from "../user-preferences.js"

// Derive video model enums from MODEL_CATALOG. `includeHidden: true` keeps
// legacy ids (seedance V1.5 etc.) accepted for cached Claude.ai sessions —
// they're filtered out of `list_models` output but the schema is permissive.
//
// These are kept for description hints; the actual schema is `z.string()`
// so unknown values silently normalize to the catalog default in the
// handler (per the "tool calls should never reject" principle).
const T2V_MODEL_IDS = modelIdsByKindMode(null, ["t2v"], { includeHidden: true })
const I2V_MODEL_IDS = modelIdsByKindMode("video", ["i2v"], { includeHidden: true })

const executeGate: ToolGate = { required: ["workflows:execute"] }

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
        "Generate a video from a text prompt (text-to-video). Returns a job_id.\n\n" +
        "**Picking a model**: call `list_models { kind: \"video\", mode: \"t2v\" }` " +
        "first when the user hasn't specified a model. The recommendations " +
        "array tells you which is best for cinematic / cheap-batch / audio-" +
        "synced. Pricing is duration-tiered for most providers — check the " +
        "`pricing` array of the chosen model so cost matches what the user " +
        "expects.",
      inputSchema: {
        prompt: z.string().min(1).max(2500),
        // Schemas are permissive — handler normalizes to closest valid value.
        // Description carries the recommended set for Claude's guidance.
        model: z
          .string()
          .optional()
          .describe(
            `Video model. Default seedance-2-fast. Recommended: ${T2V_MODEL_IDS.join(", ")}. ` +
            `Unknown values silently fall back to the default. Call list_models ` +
            `{ kind: "video", mode: "t2v" } for capability details.`,
          ),
        duration: z
          .number()
          .optional()
          .describe("Duration (seconds). Snaps to nearest supported value."),
        aspect_ratio: z
          .string()
          .optional()
          .describe("Aspect ratio (16:9, 9:16, 1:1, etc.). Variations and unsupported values fall back."),
        sound: z.boolean().optional(),
        negative_prompt: z.string().max(2500).optional(),
        seed: z.number().int().min(10000).max(99999).optional(),
        structured: StructuredFields.optional(),
      },
              outputSchema: {
          jobId: z.string(),
          prompt: z.string().optional(),
          model: z.string().optional(),
          aspectRatio: z.string().optional(),
          resolution: z.string().optional(),
          duration: z.number().optional(),
          outputUrl: z.string().optional(),
        },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    _meta: {
      "ui/resourceUri": "ui://nodaro/widget/v3/job-video",
      ui: {
        resourceUri: "ui://nodaro/widget/v3/job-video",
        visibility: ["model", "app"],
      },
    },
    },
    async (args) => {
      // Silent normalization. Anything Claude sends gets mapped to the
      // closest valid value or the catalog default — never reject on
      // bad params. Saved video prefs are filtered against the resolved
      // model so stale picks don't break new generations.
      let userVid: Record<string, string | number | undefined> = {}
      try {
        const userPrefs = await getUserMcpPreferences(session.userId)
        userVid = (userPrefs.video as Record<string, string | number | undefined>) ?? {}
      } catch { /* swallow */ }
      const { model, aspectRatio, resolution, duration } = normalizeVideoInput(
        {
          model: args.model,
          aspect_ratio: args.aspect_ratio,
          resolution: undefined,
          duration: args.duration,
        },
        {
          model: userVid.model as string | undefined,
          aspectRatio: userVid.aspectRatio as string | undefined,
          resolution: userVid.resolution as string | undefined,
          duration: userVid.duration as number | undefined,
        },
        "seedance-2-fast",
      )

      const compositePrompt = buildCompositePrompt(args.prompt, args.structured)
      const payload = {
        prompt: compositePrompt,
        provider: model,
        duration,
        aspectRatio,
        resolution,
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
      return jobResultWithWidget({
        jobId,
        label: "text-to-video",
        session,
        widgetKind: "video",
        widgetData: {
          prompt: compositePrompt,
          model: args.model ?? "text-to-video",
          aspectRatio: args.aspect_ratio,
          duration: args.duration,
        },
      })
    },
  )

  // ── animate_image (image-to-video) ──
  server.registerTool(
    "animate_image",
    {
      title: "Animate Image",
      description:
        "Animate an image into a video (image-to-video). Provide either " +
        "image_url OR image_asset_id. Returns a job_id.\n\n" +
        "**Picking a model**: call `list_models { kind: \"video\", mode: \"i2v\" }` " +
        "for capability sheets and recommendations. If the user supplied a start " +
        "AND end frame, pick a model whose `features` includes `end-frame` (VEO, " +
        "MiniMax, Hailuo Standard, Bytedance Lite, Kling Turbo, Seedance). " +
        "Default `veo3.1` is the best price/quality balance with native audio.",
      inputSchema: {
        prompt: z.string().max(2500).optional(),
        image_url: z.string().url().optional(),
        image_asset_id: z.string().optional(),
        model: z
          .string()
          .optional()
          .describe(
            `Video model. Default seedance-2-fast. Recommended: ${I2V_MODEL_IDS.join(", ")}. ` +
            `Unknown values silently fall back. Call list_models ` +
            `{ kind: "video", mode: "i2v" } for capabilities + recommendations.`,
          ),
        duration: z.number().optional().describe("Duration (seconds). Snaps to nearest supported."),
        aspect_ratio: z.string().optional().describe("Aspect ratio. Variations / unsupported fall back."),
        sound: z.boolean().optional(),
        end_frame_url: z.string().url().optional(),
      },
              outputSchema: {
          jobId: z.string(),
          prompt: z.string().optional(),
          model: z.string().optional(),
          aspectRatio: z.string().optional(),
          resolution: z.string().optional(),
          duration: z.number().optional(),
          outputUrl: z.string().optional(),
        },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    _meta: {
      "ui/resourceUri": "ui://nodaro/widget/v3/job-video",
      ui: {
        resourceUri: "ui://nodaro/widget/v3/job-video",
        visibility: ["model", "app"],
      },
    },
    },
    async (args) => {
      let userVid: Record<string, string | number | undefined> = {}
      try {
        const userPrefs = await getUserMcpPreferences(session.userId)
        userVid = (userPrefs.video as Record<string, string | number | undefined>) ?? {}
      } catch { /* swallow */ }
      const { model, aspectRatio, resolution, duration } = normalizeVideoInput(
        {
          model: args.model,
          aspect_ratio: args.aspect_ratio,
          resolution: undefined,
          duration: args.duration,
        },
        {
          model: userVid.model as string | undefined,
          aspectRatio: userVid.aspectRatio as string | undefined,
          resolution: userVid.resolution as string | undefined,
          duration: userVid.duration as number | undefined,
        },
        "seedance-2-fast",
      )

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
        provider: model,
        duration,
        aspectRatio,
        resolution,
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
      return jobResultWithWidget({
        jobId,
        label: "image-to-video",
        session,
        widgetKind: "video",
        widgetData: {
          prompt: args.prompt ?? "(animate image)",
          model: args.model ?? "image-to-video",
          aspectRatio: args.aspect_ratio,
          duration: args.duration,
        },
      })
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
              outputSchema: {
          jobId: z.string(),
          prompt: z.string().optional(),
          model: z.string().optional(),
          aspectRatio: z.string().optional(),
          resolution: z.string().optional(),
          duration: z.number().optional(),
          outputUrl: z.string().optional(),
        },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    _meta: {
      "ui/resourceUri": "ui://nodaro/widget/v3/job-video",
      ui: {
        resourceUri: "ui://nodaro/widget/v3/job-video",
        visibility: ["model", "app"],
      },
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
      return jobResultWithWidget({
        jobId,
        label: "video extend",
        session,
        widgetKind: "video",
        widgetData: {
          prompt: args.prompt,
          model: args.model,
        },
      })
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
              outputSchema: {
          jobId: z.string(),
          prompt: z.string().optional(),
          model: z.string().optional(),
          aspectRatio: z.string().optional(),
          resolution: z.string().optional(),
          duration: z.number().optional(),
          outputUrl: z.string().optional(),
        },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    _meta: {
      "ui/resourceUri": "ui://nodaro/widget/v3/job-video",
      ui: {
        resourceUri: "ui://nodaro/widget/v3/job-video",
        visibility: ["model", "app"],
      },
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
      return jobResultWithWidget({
        jobId,
        label: "combine videos",
        session,
        widgetKind: "video",
        widgetData: {
          prompt: `Combine ${videoUrls.length} videos`,
          model: "combine-videos",
        },
      })
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
              outputSchema: {
          jobId: z.string(),
          prompt: z.string().optional(),
          model: z.string().optional(),
          aspectRatio: z.string().optional(),
          resolution: z.string().optional(),
          duration: z.number().optional(),
          outputUrl: z.string().optional(),
        },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    _meta: {
      "ui/resourceUri": "ui://nodaro/widget/v3/job-video",
      ui: {
        resourceUri: "ui://nodaro/widget/v3/job-video",
        visibility: ["model", "app"],
      },
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
      return jobResultWithWidget({
        jobId,
        label: "add captions",
        session,
        widgetKind: "video",
        widgetData: {
          prompt: args.text,
          model: "add-captions",
        },
      })
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
              outputSchema: {
          jobId: z.string(),
          prompt: z.string().optional(),
          model: z.string().optional(),
          aspectRatio: z.string().optional(),
          resolution: z.string().optional(),
          duration: z.number().optional(),
          outputUrl: z.string().optional(),
        },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    _meta: {
      "ui/resourceUri": "ui://nodaro/widget/v3/job-image",
      ui: {
        resourceUri: "ui://nodaro/widget/v3/job-image",
        visibility: ["model", "app"],
      },
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
      return jobResultWithWidget({
        jobId,
        label: "extract frame",
        session,
        widgetKind: "image",
        widgetData: {
          prompt: `Extract frame from ${videoUrl}`,
          model: "extract-frame",
        },
      })
    },
  )
}
