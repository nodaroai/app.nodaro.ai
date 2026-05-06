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
import {
  modelIdsByKindMode,
  SEEDANCE_2_REF_LIMITS,
  isSeedance2Provider,
  ALL_CAPTION_STYLES,
} from "@nodaro/shared"
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
        prompt: z.string().min(1).max(8000),
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
        resolution: z
          .string()
          .optional()
          .describe("Output resolution. Provider-dependent — common values: 480p, 720p, 1080p."),
        sound: z.boolean().optional(),
        negative_prompt: z.string().max(8000).optional(),
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
          resolution: args.resolution,
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
  /**
   * Resolve a mixed array where each item is either a public URL or a Nodaro
   * asset id. Asset ids are resolved via `resolveAssetId` (kind-typed). Returns
   * the URL list, dropping any unresolvable entries.
   */
  async function resolveRefArray(
    items: string[] | undefined,
    userId: string,
    expectedKind: "image" | "video" | "audio",
  ): Promise<string[]> {
    if (!items?.length) return []
    const out: string[] = []
    for (const item of items) {
      if (/^https?:\/\//.test(item)) {
        out.push(item)
        continue
      }
      const resolved = await resolveAssetId({ assetId: item, userId, expectedKind })
      if (resolved) out.push(resolved)
    }
    return out
  }
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
        "Default `veo3.1` is the best price/quality balance with native audio.\n\n" +
        "**Seedance 2 only**: pass `reference_video_urls` / `reference_audio_urls` " +
        "for style transfer or soundtrack-driven motion (max 3 each), or " +
        "`reference_image_urls` for extra reference images beyond `image_url` " +
        "(max 9). Multimodal refs cannot be combined with `end_frame_url` — " +
        "choose one mode.\n\n" +
        "**Perfect loop** (the canonical recipe — three calls):\n" +
        "  1. `animate_image` with `model: \"veo3.1\"`, `sound: false`, and the " +
        "**same image** as both `image_url` (start) and `end_frame_url` (or the " +
        "same `image_asset_id` and `end_frame_asset_id`). VEO3.1's first+last-" +
        "frame mode + Nodaro's auto tail-trim produces a frame-perfect VISUAL " +
        "loop. `sound: false` is important — VEO3.1's generated audio does NOT " +
        "loop seamlessly (start and end audio differ even when frames match), " +
        "so leaving it on creates audible seams when copies are stitched.\n" +
        "  2. `combine_videos` with N copies of that single clip's `asset_id` " +
        "(`transition: \"cut\"`, `audio_mode: \"remove\"`) to extend the loop to " +
        "the desired duration. The visual seam is invisible because the last " +
        "frame of clip K equals the first frame of clip K+1.\n" +
        "  3. `merge_video_audio` to attach a pre-made looping audio track to " +
        "the FINAL stitched video (not to the individual loop clip). The " +
        "user-supplied audio should match the total stitched duration.",
      inputSchema: {
        prompt: z.string().max(8000).optional(),
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
        resolution: z
          .string()
          .optional()
          .describe(
            "Output resolution. Provider-dependent — common values: 480p, 720p, 1080p. " +
            "Unknown values fall back to the model's default.",
          ),
        sound: z.boolean().optional(),
        // End-frame face source. Pass ONE of:
        //   - end_frame_url: a public HTTPS URL to an image
        //   - end_frame_asset_id: a Nodaro job id or upload asset id
        // The asset id form is the safe path — Claude.ai constructed
        // invalid URLs like /jobs/.../output before this existed.
        end_frame_url: z.string().url().optional(),
        end_frame_asset_id: z
          .string()
          .optional()
          .describe(
            "Nodaro job id or upload asset id whose image is used as the END frame. " +
            "Use this instead of end_frame_url when you have a Nodaro asset — never " +
            "construct /jobs/.../output URLs manually, those don't exist.",
          ),
        reference_image_urls: z
          .array(z.string())
          .max(SEEDANCE_2_REF_LIMITS.images)
          .optional()
          .describe(
            "Seedance 2 only: extra reference images (URLs or Nodaro asset IDs) " +
            "beyond `image_url`. Resolved server-side. Silently ignored on other providers.",
          ),
        reference_video_urls: z
          .array(z.string())
          .max(SEEDANCE_2_REF_LIMITS.videos)
          .optional()
          .describe(
            "Seedance 2 only: reference videos for style/motion transfer (URLs or " +
            "Nodaro asset IDs). Mutually exclusive with end_frame_url / end_frame_asset_id.",
          ),
        reference_audio_urls: z
          .array(z.string())
          .max(SEEDANCE_2_REF_LIMITS.audio)
          .optional()
          .describe(
            "Seedance 2 only: reference audio for soundtrack-driven motion (URLs or " +
            "Nodaro asset IDs). Mutually exclusive with end_frame_url / end_frame_asset_id.",
          ),
        auto_loop_trim: z
          .boolean()
          .optional()
          .describe(
            "VEO 3.1 only, applies when start AND end frames are supplied. VEO 3.1's " +
            "first+last-frame mode adds a ~333ms tail dissolve that breaks loop seams. " +
            "Default true: Nodaro strips the last 8 frames @ 24fps so the rendered last " +
            "frame matches the supplied end frame exactly. Set false to keep the dissolve " +
            "(useful for inspecting the raw provider output, or when the end frame differs " +
            "from the start frame and you want the soft transition). Silently ignored on " +
            "non-veo3.1 providers — those models never receive the trim.",
          ),
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
      // End frame — resolve asset id to a real CDN URL (never trust a
      // hand-constructed /jobs/.../output URL; that endpoint doesn't exist).
      const endFrameUrl =
        args.end_frame_url ??
        (args.end_frame_asset_id
          ? await resolveAssetId({
              assetId: args.end_frame_asset_id,
              userId: session.userId,
              expectedKind: "image",
            })
          : undefined)
      // Seedance 2 multimodal refs — resolve per-item URL/asset_id, then
      // gate by provider. Other providers silently drop these args.
      const isSd2 = isSeedance2Provider(model)
      const refImageUrls = isSd2 ? await resolveRefArray(args.reference_image_urls, session.userId, "image") : []
      const refVideoUrls = isSd2 ? await resolveRefArray(args.reference_video_urls, session.userId, "video") : []
      const refAudioUrls = isSd2 ? await resolveRefArray(args.reference_audio_urls, session.userId, "audio") : []

      // KIE forbids combining multimodal-ref mode with start+end frame mode.
      // Fail fast with a clear MCP error rather than letting the route 400.
      if ((refVideoUrls.length || refAudioUrls.length) && endFrameUrl) {
        return {
          content: [{
            type: "text" as const,
            text: "Seedance 2: reference videos/audio cannot be combined with end_frame_url / end_frame_asset_id. Pass one or the other.",
          }],
          isError: true,
        }
      }
      // Resolution: caller's explicit value wins; otherwise inherit the
      // user's saved MCP video preference; otherwise leave undefined and
      // let the route handler / provider default kick in.
      const callResolution =
        args.resolution ??
        (userVid.resolution as string | undefined) ??
        resolution
      const payload = {
        imageUrl,
        endFrameUrl,
        prompt: args.prompt,
        provider: model,
        duration,
        aspectRatio,
        resolution: callResolution,
        sound: args.sound,
        ...(refImageUrls.length ? { referenceImageUrls: refImageUrls } : {}),
        ...(refVideoUrls.length ? { referenceVideoUrls: refVideoUrls } : {}),
        ...(refAudioUrls.length ? { referenceAudioUrls: refAudioUrls } : {}),
        // Pass through only when explicitly set so the route's default (true)
        // applies when the caller doesn't specify. Worker still gates on
        // `provider === "veo3.1"` — non-veo3.1 jobs ignore this flag.
        ...(args.auto_loop_trim !== undefined ? { autoLoopTrim: args.auto_loop_trim } : {}),
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
        prompt: z.string().min(1).max(8000),
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
        "Burn captions into a video. Provide either video_url OR video_asset_id, plus captions data. Static styles (subtitle) accept `text`. Kinetic styles (word-highlight, karaoke, tiktok-words, word-pop, bouncy) need word-timed `captions[]` OR set `auto_transcribe: true` (default) to transcribe the input video's audio.",
      inputSchema: {
        text: z.string().min(1).optional(),
        captions: z.array(z.object({
          text: z.string(),
          startMs: z.number().min(0),
          endMs: z.number().min(0),
          timestampMs: z.number().min(0).nullable(),
          confidence: z.number().min(0).max(1).nullable(),
        })).optional(),
        auto_transcribe: z.boolean().optional(),
        transcribe_provider: z.enum(["whisper", "incredibly-fast-whisper", "elevenlabs-stt"]).optional(),
        video_url: z.string().url().optional(),
        video_asset_id: z.string().optional(),
        style: z.enum(ALL_CAPTION_STYLES).optional(),
        position: z.enum(["bottom", "top", "center"]).optional(),
        font_size: z.number().int().min(12).max(200).optional(),
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
        captions: args.captions,
        auto_transcribe: args.auto_transcribe,
        transcribe_provider: args.transcribe_provider,
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

  // ── lip_sync ──
  // Drives a face image (or face video) with an audio track to produce a
  // talking-head video. Default model is kling-avatar (good quality, half
  // the cost of kling-avatar-pro). InfiniTalk is the cheapest option and
  // supports 480p/720p resolution control.
  server.registerTool(
    "lip_sync",
    {
      title: "Lip Sync",
      description:
        "Make a face talk to an audio track. PRIMARY tool for lip-sync / " +
        "talking-head / dub-onto-character workflows. Use this directly — do " +
        "NOT search the apps marketplace for lip-sync.\n\n" +
        "Provide ONE face source — image_url / image_asset_id (a portrait), " +
        "OR video_url / video_asset_id (an existing clip whose mouth gets " +
        "re-driven) — and ONE audio source: audio_url / audio_asset_id.\n\n" +
        "**Picking a model** (sorted by quality, with cost as tiebreaker):\n" +
        "  • **`seedance-2`** (~50 cr @ 720p / 82 cr @ 1080p) — ByteDance " +
        "multimodal video model with **native phoneme-level lip sync in " +
        "8+ languages**. Cinematic full-body output (not just talking " +
        "heads), strong identity preservation, premium quality. Pick this " +
        "for hero scenes, multi-language dubs, or when the user wants the " +
        "absolute best quality.\n" +
        "  • **`seedance-2-fast`** (~40 cr @ 720p / 66 cr @ 1080p) — same " +
        "Seedance 2 phoneme lip sync, cheaper / faster tier. Pick when the " +
        "user wants Seedance quality on a budget.\n" +
        "  • **`kling-avatar`** (default, 28 cr) — KIE talking head, 720p, " +
        "speech-optimized. Best balance of cost and quality for plain " +
        "talking-head shots.\n" +
        "  • **`kling-avatar-pro`** (56 cr) — KIE premium talking head, " +
        "1080p. Sharper mouth sync + better micro-expressions than the " +
        "standard Kling avatar.\n" +
        "  • **`infinitalk`** (11 cr @ 480p / 42 cr @ 720p) — KIE flexible " +
        "resolution lever via the `resolution` param. Cheapest KIE option at 480p.\n" +
        "  • **`latentsync`** (5 cr) — diffusion-based; **best for singing** " +
        "or strong vocal performance. Requires video input.\n" +
        "  • **`wav2lip`** (1 cr) — fastest and cheapest. Accepts image OR video. " +
        "Pick when the user wants a quick draft or many iterations on a budget.\n" +
        "  • **`video-retalking`** (20 cr) — built-in face enhancement, clean " +
        "output. Requires video input. Good when the source clip's face is " +
        "small / blurry and you want sharpening on top of the lip sync.\n" +
        "  • **`sadtalker`** (9 cr) — talking avatar from a SINGLE image. Good " +
        "for animating a portrait into a speaking head when no video exists.\n\n" +
        "**Input requirements by model**: seedance-2(-fast), kling-avatar(-pro), " +
        "infinitalk, sadtalker → image input only. latentsync, video-retalking → " +
        "video input only. wav2lip → image OR video.\n\n" +
        "Returns a job_id. The widget renders the resulting video inline.",
      inputSchema: {
        image_url: z
          .string()
          .url()
          .optional()
          .describe("Portrait/face image. Use this for kling-avatar(-pro) and infinitalk."),
        image_asset_id: z.string().optional(),
        video_url: z
          .string()
          .url()
          .optional()
          .describe("Face video (for video-input providers like latentsync / video-retalking). Most users want image_url."),
        video_asset_id: z.string().optional(),
        audio_url: z.string().url().optional(),
        audio_asset_id: z.string().optional(),
        prompt: z
          .string()
          .max(500)
          .optional()
          .describe("Optional performance hint (e.g. 'a confident TED speaker'). Some models use it; others ignore."),
        model: z
          .string()
          .optional()
          .describe(
            "Lip-sync model. Default kling-avatar. All 9 options: " +
            "seedance-2 (~50/82 cr, image, native phoneme lip-sync 8+ languages, premium), " +
            "seedance-2-fast (~40/66 cr, image, same lip-sync cheaper), " +
            "kling-avatar (28 cr, image, 720p), kling-avatar-pro (56 cr, image, 1080p), " +
            "infinitalk (11/42 cr, image, 480p|720p), latentsync (5 cr, video, singing), " +
            "wav2lip (1 cr, image|video, fastest+cheapest), video-retalking " +
            "(20 cr, video, face enhancement), sadtalker (9 cr, single image). " +
            "Unknown values fall back to kling-avatar.",
          ),
        resolution: z
          .enum(["480p", "720p", "1080p"])
          .optional()
          .describe(
            "Resolution lever. infinitalk: 480p|720p. seedance-2(-fast): 480p|720p|1080p. " +
            "Other models ignore this.",
          ),
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
      // Resolve face source — prefer image, fall back to video. The route
      // handles validation that the chosen provider supports the kind of
      // input it received (image vs video).
      const imageUrl =
        args.image_url ??
        (args.image_asset_id
          ? await resolveAssetId({
              assetId: args.image_asset_id,
              userId: session.userId,
              expectedKind: "image",
            })
          : null)
      const videoUrl =
        args.video_url ??
        (args.video_asset_id
          ? await resolveAssetId({
              assetId: args.video_asset_id,
              userId: session.userId,
              expectedKind: "video",
            })
          : null)
      if (!imageUrl && !videoUrl) {
        return {
          content: [
            {
              type: "text",
              text:
                "Lip-sync needs a face source — pass image_url / image_asset_id " +
                "(portrait) OR video_url / video_asset_id (existing clip).",
            },
          ],
          isError: true,
        }
      }
      const audioUrl =
        args.audio_url ??
        (args.audio_asset_id
          ? await resolveAssetId({
              assetId: args.audio_asset_id,
              userId: session.userId,
              expectedKind: "audio",
            })
          : null)
      if (!audioUrl) {
        return {
          content: [
            {
              type: "text",
              text:
                "Lip-sync needs audio — pass audio_url or audio_asset_id (the " +
                "voice line that drives the mouth).",
            },
          ],
          isError: true,
        }
      }

      const provider = args.model ?? "kling-avatar"
      const payload: Record<string, unknown> = {
        ...(imageUrl ? { imageUrl } : {}),
        ...(videoUrl ? { videoUrl } : {}),
        audioUrl,
        provider,
        ...(args.prompt ? { prompt: args.prompt } : {}),
        ...(args.resolution ? { resolution: args.resolution } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/lip-sync",
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
        label: "lip sync",
        session,
        widgetKind: "video",
        widgetData: {
          prompt: args.prompt ?? "(lip sync)",
          model: provider,
          resolution: args.resolution,
        },
      })
    },
  )

  // ── modify_video (video-to-video) ──
  // Wan 2.6 / Wan Flash for KIE-side restyles, Runway Aleph for stylised
  // edits with reference-image guidance. Mirrors modify_image for the video
  // domain — gallery widget already pushes "edit this video" follow-ups.
  server.registerTool(
    "modify_video",
    {
      title: "Modify Video",
      description:
        "PRIMARY tool for video-to-video / restyle / clip-edit workflows. Use " +
        "this directly — do NOT search the apps marketplace for video editing.\n\n" +
        "Provide ONE of:\n" +
        "  (a) `video_url` — public HTTPS URL\n" +
        "  (b) `video_asset_id` — a Nodaro job id whose output is a video\n\n" +
        "Plus a `prompt` describing the change.\n\n" +
        "**Picking a model**:\n" +
        "  • **`wan`** (default, Wan 2.6) — KIE restyle / transformation. " +
        "5s or 10s; 720p or 1080p. Best general-purpose choice.\n" +
        "  • **`wan-flash`** — faster Wan variant. Supports `audio: true` " +
        "to keep / regenerate audio, and `multiShots: true` for multi-shot " +
        "scene changes.\n" +
        "  • **`runway-aleph`** — stylised edits guided by an optional " +
        "`reference_image_url`. More aspect-ratio options (16:9, 9:16, 4:3, " +
        "3:4, 1:1, 21:9).",
      inputSchema: {
        prompt: z.string().min(1).max(8000),
        video_url: z.string().url().optional(),
        video_asset_id: z.string().optional(),
        model: z
          .string()
          .optional()
          .describe(
            "v2v model. Default `wan`. Options: wan, wan-flash, runway-aleph. " +
            "Unknown values fall back to wan.",
          ),
        duration: z.enum(["5", "10"]).optional().describe("Wan / Wan Flash only — 5s or 10s output."),
        resolution: z.enum(["720p", "1080p"]).optional().describe("Wan / Wan Flash only."),
        aspect_ratio: z
          .enum(["16:9", "9:16", "4:3", "3:4", "1:1", "21:9"])
          .optional()
          .describe("Runway Aleph only."),
        audio: z.boolean().optional().describe("Wan Flash only — preserve/regenerate audio."),
        multi_shots: z.boolean().optional().describe("Wan Flash only — allow multi-shot scene changes."),
        reference_image_url: z.string().url().optional().describe("Runway Aleph only — style reference image."),
        seed: z.number().int().min(0).optional(),
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
            { type: "text", text: "Pass video_url or video_asset_id." },
          ],
          isError: true,
        }
      }
      const provider = args.model ?? "wan"
      const payload: Record<string, unknown> = {
        videoUrl,
        prompt: args.prompt,
        provider,
        ...(args.duration ? { duration: args.duration } : {}),
        ...(args.resolution ? { resolution: args.resolution } : {}),
        ...(args.aspect_ratio ? { aspectRatio: args.aspect_ratio } : {}),
        ...(args.audio !== undefined ? { audio: args.audio } : {}),
        ...(args.multi_shots !== undefined ? { multiShots: args.multi_shots } : {}),
        ...(args.reference_image_url ? { referenceImageUrl: args.reference_image_url } : {}),
        ...(args.seed !== undefined ? { seed: args.seed } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/video-to-video",
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
        label: "video-to-video",
        session,
        widgetKind: "video",
        widgetData: {
          prompt: args.prompt,
          model: provider,
          aspectRatio: args.aspect_ratio,
          resolution: args.resolution,
        },
      })
    },
  )

  // ── trim_video ──
  // Cuts a clip out of a longer video — start/end seconds. Optional flag
  // strips audio entirely (silent output).
  server.registerTool(
    "trim_video",
    {
      title: "Trim Video",
      description:
        "Trim a video to a specific time window via FFmpeg. Provide ONE " +
        "video source — video_url OR video_asset_id (a Nodaro video job " +
        "id or upload asset id) — plus start_time and end_time in seconds.\n\n" +
        "Set `silent: true` to strip the audio track from the trimmed clip.",
      inputSchema: {
        video_url: z.string().url().optional(),
        video_asset_id: z.string().optional(),
        start_time: z
          .number()
          .min(0)
          .describe("Start of the trim window, in seconds (0 = clip start)."),
        end_time: z
          .number()
          .min(0)
          .describe("End of the trim window, in seconds. Must be > start_time."),
        silent: z
          .boolean()
          .optional()
          .describe("Strip audio from the output. Default false."),
      },
      outputSchema: {
        jobId: z.string(),
        prompt: z.string().optional(),
        model: z.string().optional(),
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
          content: [{ type: "text", text: "Pass video_url or video_asset_id." }],
          isError: true,
        }
      }
      if (args.end_time <= args.start_time) {
        return {
          content: [{ type: "text", text: "end_time must be greater than start_time." }],
          isError: true,
        }
      }
      const payload = {
        videoUrl,
        startTime: args.start_time,
        endTime: args.end_time,
        outputSilentVideo: args.silent ?? false,
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/trim-video",
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
        label: "trim video",
        session,
        widgetKind: "video",
        widgetData: {
          prompt: `trim ${args.start_time}s → ${args.end_time}s` + (args.silent ? " (silent)" : ""),
          model: "trim-video",
        },
      })
    },
  )

  // ── merge_video_audio ──
  // FFmpeg compose: take a video + one or more audio sources, mix them,
  // and produce a new video. PRIMARY tool for "add this voiceover to my
  // video" / "swap the audio" / "duck the music under the dialogue" /
  // "combine these tracks onto this clip" flows.
  server.registerTool(
    "merge_video_audio",
    {
      title: "Merge Video + Audio",
      description:
        "Combine a video with one or more audio tracks (FFmpeg). Use this " +
        "for voiceovers, soundtracks, dubbing handoffs, or replacing the " +
        "audio on a generated clip.\n\n" +
        "**Inputs:**\n" +
        "  • Video — `video_url` OR `video_asset_id` (a Nodaro video job id " +
        "    or upload asset id).\n" +
        "  • Audio — pass `audio_url` / `audio_asset_id` for the simple " +
        "    one-track case, OR `audio_tracks` for multi-track mixing with " +
        "    per-track start time + volume.\n\n" +
        "**Levers:**\n" +
        "  • `voiceover_volume` (0–200, default 100) — volume for the new " +
        "    audio track relative to original.\n" +
        "  • `background_volume` (0–200, default 30) — volume for the source " +
        "    video's original audio (when `keep_original_audio: true`).\n" +
        "  • `keep_original_audio` (default true) — when false, the source " +
        "    video's audio is muted entirely.\n\n" +
        "Returns a job_id; widget renders the merged video.",
      inputSchema: {
        video_url: z.string().url().optional(),
        video_asset_id: z.string().optional(),
        audio_url: z.string().url().optional(),
        audio_asset_id: z.string().optional(),
        audio_tracks: z
          .array(
            z.object({
              url: z.string().url(),
              start_time: z.number().min(0).optional().describe("Seconds into the video where this track begins. Default 0."),
              volume: z.number().min(0).max(200).optional().describe("0-200, where 100 = original volume."),
            }),
          )
          .optional()
          .describe("Multi-track mode. When omitted, audio_url / audio_asset_id is used as the single track."),
        voiceover_volume: z.number().min(0).max(200).optional(),
        background_volume: z.number().min(0).max(200).optional(),
        keep_original_audio: z.boolean().optional(),
      },
      outputSchema: {
        jobId: z.string(),
        prompt: z.string().optional(),
        model: z.string().optional(),
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
          content: [{ type: "text", text: "Pass video_url or video_asset_id." }],
          isError: true,
        }
      }
      const singleAudioUrl =
        args.audio_url ??
        (args.audio_asset_id
          ? await resolveAssetId({
              assetId: args.audio_asset_id,
              userId: session.userId,
              expectedKind: "audio",
            })
          : null)
      const hasMultiTracks = args.audio_tracks && args.audio_tracks.length > 0
      if (!singleAudioUrl && !hasMultiTracks) {
        return {
          content: [
            {
              type: "text",
              text:
                "Pass audio_url / audio_asset_id (single track) or audio_tracks (multi-track).",
            },
          ],
          isError: true,
        }
      }
      const payload: Record<string, unknown> = {
        videoUrl,
        ...(singleAudioUrl ? { audioUrl: singleAudioUrl } : {}),
        ...(hasMultiTracks
          ? {
              audioTracks: args.audio_tracks!.map((t) => ({
                url: t.url,
                startTime: t.start_time ?? 0,
                volume: t.volume,
              })),
            }
          : {}),
        ...(args.voiceover_volume !== undefined ? { voiceoverVolume: args.voiceover_volume } : {}),
        ...(args.background_volume !== undefined ? { backgroundVolume: args.background_volume } : {}),
        ...(args.keep_original_audio !== undefined ? { keepOriginalAudio: args.keep_original_audio } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/merge-video-audio",
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
        label: "merge video + audio",
        session,
        widgetKind: "video",
        widgetData: { prompt: "(merge video + audio)", model: "merge-video-audio" },
      })
    },
  )

  // ── motion_transfer ──
  // Drives a character image with the motion of a driver video. KIE provides
  // multiple providers; default `kling` matches the route default.
  server.registerTool(
    "motion_transfer",
    {
      title: "Motion Transfer",
      description:
        "Transfer the motion from a driver video onto a character image. " +
        "Provide BOTH a character (image_url / image_asset_id) AND a driver " +
        "video (video_url / video_asset_id). Optionally describe the desired " +
        "result via `prompt`.\n\n" +
        "**Provider**: default `kling` (KIE). Resolution lever 480p / 580p / " +
        "720p / 1080p (default 720p). `character_orientation` controls " +
        "whether the image's pose or the video's pose drives framing " +
        "(default `image`).",
      inputSchema: {
        image_url: z.string().url().optional(),
        image_asset_id: z.string().optional(),
        video_url: z.string().url().optional(),
        video_asset_id: z.string().optional(),
        prompt: z.string().max(8000).optional(),
        character_orientation: z
          .enum(["image", "video"])
          .optional()
          .describe("Which source's framing wins. Default `image`."),
        resolution: z
          .enum(["480p", "580p", "720p", "1080p"])
          .optional()
          .describe("Output resolution. Default 720p."),
        provider: z
          .string()
          .optional()
          .describe("Motion transfer provider. Default kling."),
        background_source: z
          .enum(["input_video", "input_image"])
          .optional()
          .describe("Which source provides the background. Provider-dependent."),
        video_duration: z
          .number()
          .min(1)
          .max(60)
          .optional()
          .describe("Output duration in seconds. Provider-dependent."),
      },
      outputSchema: {
        jobId: z.string(),
        prompt: z.string().optional(),
        model: z.string().optional(),
        resolution: z.string().optional(),
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
      const imageUrl =
        args.image_url ??
        (args.image_asset_id
          ? await resolveAssetId({
              assetId: args.image_asset_id,
              userId: session.userId,
              expectedKind: "image",
            })
          : null)
      const videoUrl =
        args.video_url ??
        (args.video_asset_id
          ? await resolveAssetId({
              assetId: args.video_asset_id,
              userId: session.userId,
              expectedKind: "video",
            })
          : null)
      if (!imageUrl) {
        return {
          content: [
            {
              type: "text",
              text: "Motion transfer needs a character image — pass image_url or image_asset_id.",
            },
          ],
          isError: true,
        }
      }
      if (!videoUrl) {
        return {
          content: [
            {
              type: "text",
              text: "Motion transfer needs a driver video — pass video_url or video_asset_id.",
            },
          ],
          isError: true,
        }
      }
      const provider = args.provider ?? "kling"
      const resolution = args.resolution ?? "720p"
      const payload: Record<string, unknown> = {
        imageUrl,
        videoUrl,
        prompt: args.prompt,
        provider,
        resolution,
        characterOrientation: args.character_orientation ?? "image",
        ...(args.background_source ? { backgroundSource: args.background_source } : {}),
        ...(args.video_duration !== undefined ? { videoDuration: args.video_duration } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/motion-transfer",
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
        label: "motion transfer",
        session,
        widgetKind: "video",
        widgetData: {
          prompt: args.prompt ?? "(motion transfer)",
          model: provider,
          resolution,
        },
      })
    },
  )
}
