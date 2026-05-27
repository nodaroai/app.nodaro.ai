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
  COMBINE_TRANSITION_IDS,
  AUDIO_CROSSFADE_CURVE_IDS,
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
        label: "generate-video",
        session,
        widgetKind: "video",
        widgetData: {
          prompt: compositePrompt,
          model: args.model ?? "generate-video",
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
        "**Seedance 2 modes** (use `seedance2_input_mode` to switch explicitly):\n" +
        "  • `'frames'` (default) — start/end-frame mode: provide `image_url` as " +
        "the first frame and optionally `end_frame_url` as the last frame.\n" +
        "  • `'references'` — reference-media mode: provide up to 9 reference images " +
        "via `reference_image_urls`, up to 3 reference videos via `reference_video_urls` " +
        "(style/motion transfer), and/or up to 3 audio clips via `reference_audio_urls` " +
        "(soundtrack-driven motion). `image_url` / `end_frame_url` are ignored in " +
        "this mode. Reference videos/audio cannot be combined with `end_frame_url`.\n\n" +
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
        "user-supplied audio should match the total stitched duration.\n\n" +
        "**Prompt phrasing tip for step 1**: describe the loop as a *frame-" +
        "match constraint*, not a *motion-reversal command*. Use \"motion " +
        "begins and ends in the exact same composition and lighting so the " +
        "first and last frames match perfectly\" — NOT \"all elements return " +
        "to their starting positions\". The first phrasing aligns with VEO's " +
        "end-frame interpolation; the second tends to conflict with any " +
        "directional motion in the same prompt (e.g. \"clouds drifting left " +
        "to right\") and gets ignored, leaving a video that doesn't actually " +
        "loop.",
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
            "Seedance 2 only: reference images (URLs or Nodaro asset IDs) used in " +
            "'references' mode. Max 9. Resolved server-side. Silently ignored on other providers.",
          ),
        reference_video_urls: z
          .array(z.string())
          .max(SEEDANCE_2_REF_LIMITS.videos)
          .optional()
          .describe(
            "Seedance 2 only: reference videos for style/motion transfer (URLs or " +
            "Nodaro asset IDs). Max 3. Used in 'references' mode; ignored in 'frames' mode.",
          ),
        reference_audio_urls: z
          .array(z.string())
          .max(SEEDANCE_2_REF_LIMITS.audio)
          .optional()
          .describe(
            "Seedance 2 only: reference audio for soundtrack-driven motion (URLs or " +
            "Nodaro asset IDs). Max 3. Used in 'references' mode; ignored in 'frames' mode.",
          ),
        seedance2_input_mode: z
          .enum(["frames", "references"])
          .optional()
          .describe(
            "Seedance 2 only: 'frames' = start/end-frame mode (use image_url + end_frame_url); " +
            "'references' = reference-media mode (use reference_image_urls / reference_video_urls / reference_audio_urls). " +
            "Silently ignored on other providers.",
          ),
        loop_trim: z.object({
          enabled: z.boolean(),
          frames_to_test: z.number().int().min(1).max(64).optional(),
          quality: z.enum(["lossless", "precise"]).optional(),
        }).optional()
          .describe("Smart-loop-cut post-process. When enabled, trims the output to its cleanest loop boundary. quality=lossless for byte-perfect stream-copy at keyframes, precise for frame-precise re-encode."),
        // Legacy alias — accepted for one release, normalized internally.
        auto_loop_trim: z.boolean().optional()
          .describe("DEPRECATED: use loop_trim instead. Maps to loop_trim={enabled,frames_to_test:8,quality:'precise'}."),
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
        ...(args.seedance2_input_mode !== undefined ? { seedance2InputMode: args.seedance2_input_mode } : {}),
        // Pass through only when explicitly set so the route's default (true)
        // applies when the caller doesn't specify. Worker still gates on
        // `provider === "veo3.1"` — non-veo3.1 jobs ignore this flag.
        ...(args.loop_trim !== undefined
          ? { loopTrim: {
              enabled: args.loop_trim.enabled,
              ...(args.loop_trim.frames_to_test !== undefined ? { framesToTest: args.loop_trim.frames_to_test } : {}),
              ...(args.loop_trim.quality !== undefined ? { quality: args.loop_trim.quality } : {}),
            } }
          : args.auto_loop_trim !== undefined
            ? { loopTrim: args.auto_loop_trim
                ? { enabled: true, framesToTest: 8, quality: "precise" as const }
                : { enabled: false } }
            : {}),
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
        label: "generate-video",
        session,
        widgetKind: "video",
        widgetData: {
          prompt: args.prompt ?? "(animate image)",
          model: args.model ?? "generate-video",
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
          .enum(COMBINE_TRANSITION_IDS as unknown as [string, ...string[]])
          .optional(),
        transition_duration: z.number().min(0).max(5).optional(),
        audio_mode: z.enum(["keep", "crossfade", "remove"]).optional(),
        audio_crossfade_curve: z
          .enum(AUDIO_CROSSFADE_CURVE_IDS as unknown as [string, ...string[]])
          .optional()
          .describe("Curve shape for audio crossfade (only consulted when audio_mode='crossfade')"),
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
        audioCrossfadeCurve: args.audio_crossfade_curve,
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
        "  • **`seedance-2`** (~50 cr @ 720p / 75 cr @ 1080p, 8s w/audio ref) — ByteDance " +
        "multimodal video model with **native phoneme-level lip sync in " +
        "8+ languages**. Cinematic full-body output (not just talking " +
        "heads), strong identity preservation, premium quality. Pick this " +
        "for hero scenes, multi-language dubs, or when the user wants the " +
        "absolute best quality.\n" +
        "  • **`seedance-2-fast`** (~40 cr @ 720p / 60 cr @ 1080p, 8s w/audio ref) — same " +
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
            "seedance-2 (~50/75 cr, image, native phoneme lip-sync 8+ languages, premium), " +
            "seedance-2-fast (~40/60 cr, image, same lip-sync cheaper), " +
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
  // Three trim modes: by time (default — start_time/end_time seconds), by
  // frames (trim_start_frames/trim_end_frames; worker probes source fps),
  // or smart loop cut (worker picks the trailing frame closest to frame 0
  // by PSNR and trims there — best for cleaning up VEO 3.1 first+last-frame
  // outputs). Optional flag strips audio entirely (silent output).
  server.registerTool(
    "trim_video",
    {
      title: "Trim Video",
      description:
        "Trim a video via FFmpeg. Provide ONE video source — video_url OR " +
        "video_asset_id (a Nodaro video job id or upload asset id) — plus " +
        "ONE of three trim modes:\n\n" +
        "1. **By time** (default): pass `start_time` and `end_time` in seconds.\n" +
        "2. **By frames**: pass `trim_start_frames` and/or `trim_end_frames`. " +
        "The worker probes the source's reported fps and converts to seconds. " +
        "Useful for VEO 3.1 outputs (24fps fixed) and any case where exact " +
        "frame alignment matters more than time.\n" +
        "3. **Smart loop cut**: set `smart_loop_cut: true`. The worker " +
        "extracts frame 0 plus the last `smart_loop_cut_lookback` (default " +
        "16) candidates, computes PSNR pixel similarity against frame 0, " +
        "and trims at the best match. Beats a fixed offset on stochastic " +
        "outputs because the actually-cleanest cut isn't always at the same " +
        "frame. Returns the chosen frame index + PSNR in `output_data.smartLoopCut` " +
        "for telemetry.\n\n" +
        "Set `silent: true` to strip the audio track from the output.",
      inputSchema: {
        video_url: z.string().url().optional(),
        video_asset_id: z.string().optional(),
        start_time: z
          .number()
          .min(0)
          .optional()
          .describe("Start of the trim window, in seconds (0 = clip start). Used in time mode."),
        end_time: z
          .number()
          .min(0)
          .optional()
          .describe("End of the trim window, in seconds. Must be > start_time. Used in time mode."),
        trim_start_frames: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Frame-based trim from start. Overrides start_time when set."),
        trim_end_frames: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("Frame-based trim from end (e.g. 8 = drop the last 8 frames). Overrides end_time when set."),
        smart_loop_cut: z
          .boolean()
          .optional()
          .describe("Smart loop cut mode — worker picks trailing frame closest to frame 0 (PSNR) and trims there. Overrides time/frame trim."),
        smart_loop_cut_lookback: z
          .number()
          .int()
          .min(2)
          .max(64)
          .optional()
          .describe("How many trailing frames to evaluate as candidate cut points. Default 16, max 64."),
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
      // Decide which trim mode the caller specified. Order of precedence:
      // smart-loop-cut > frame-based > time-based.
      const isSmartCut = args.smart_loop_cut === true
      const isFrameTrim =
        !isSmartCut &&
        (args.trim_start_frames !== undefined || args.trim_end_frames !== undefined)
      const isTimeTrim = !isSmartCut && !isFrameTrim
      if (isTimeTrim) {
        if (args.start_time === undefined || args.end_time === undefined) {
          return {
            content: [{
              type: "text",
              text: "Time-based trim requires both start_time and end_time. " +
                "Or pass trim_start_frames/trim_end_frames for frame-based " +
                "trim, or smart_loop_cut: true for the smart cut mode.",
            }],
            isError: true,
          }
        }
        if (args.end_time <= args.start_time) {
          return {
            content: [{ type: "text", text: "end_time must be greater than start_time." }],
            isError: true,
          }
        }
      }
      const payload: Record<string, unknown> = {
        videoUrl,
        outputSilentVideo: args.silent ?? false,
        mcp_client: session.clientName,
        userId: session.userId,
      }
      if (isSmartCut) {
        payload.smartLoopCut = true
        if (args.smart_loop_cut_lookback !== undefined) {
          payload.smartLoopCutLookback = args.smart_loop_cut_lookback
        }
      } else if (isFrameTrim) {
        if (args.trim_start_frames !== undefined) payload.trimStartFrames = args.trim_start_frames
        if (args.trim_end_frames !== undefined) payload.trimEndFrames = args.trim_end_frames
      } else {
        payload.startTime = args.start_time
        payload.endTime = args.end_time
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
      const widgetPrompt = isSmartCut
        ? `smart loop cut (lookback ${args.smart_loop_cut_lookback ?? 16})`
        : isFrameTrim
          ? `trim ${args.trim_start_frames ?? 0} frames from start, ${args.trim_end_frames ?? 0} from end`
          : `trim ${args.start_time}s → ${args.end_time}s` + (args.silent ? " (silent)" : "")
      return jobResultWithWidget({
        jobId,
        label: "trim video",
        session,
        widgetKind: "video",
        widgetData: {
          prompt: widgetPrompt,
          model: "trim-video",
        },
      })
    },
  )

  // ── loop_video ──
  // FFmpeg concat-based looping with optional smart-cut preprocess. PRIMARY
  // tool for "extend this 8-second clip into a 60-second background" /
  // "make this loop seamlessly N times" flows. Pair with smart_cut_before_repeat
  // when the source has a stochastic tail (e.g. VEO 3.1 first+last-frame
  // outputs) — eliminates seam discontinuity at every internal repeat
  // boundary, not just the final wrap.
  server.registerTool(
    "loop_video",
    {
      title: "Loop Video",
      description:
        "Loop a video N times (repeat mode) or until it reaches a target " +
        "duration (duration mode). Provide ONE video source — video_url OR " +
        "video_asset_id (a Nodaro video job id or upload asset id).\n\n" +
        "Mode `repeat`: pass `repeat_count` (2–20). The output is the input " +
        "concatenated to itself that many times.\n" +
        "Mode `duration`: pass `target_duration` (seconds). The worker concatenates " +
        "enough copies to cover the target, then trims to exact length.\n\n" +
        "Optional `smart_cut_before_repeat: true` — the worker first runs a " +
        "smart loop cut on the source (picks the trailing frame closest to " +
        "frame 0 by PSNR pixel similarity, trims there) BEFORE concatenating. " +
        "This eliminates the seam discontinuity at every internal repeat boundary, " +
        "not just the final wrap. Highly recommended for VEO 3.1 first+last-frame " +
        "outputs and any clip where the tail is stochastic.",
      inputSchema: {
        video_url: z.string().url().optional(),
        video_asset_id: z.string().optional(),
        mode: z.enum(["repeat", "duration"]).describe("repeat = N copies; duration = loop until target seconds reached then trim."),
        repeat_count: z
          .number()
          .int()
          .min(2)
          .max(20)
          .optional()
          .describe("Number of times to repeat the input. Required when mode = repeat."),
        target_duration: z
          .number()
          .min(1)
          .max(300)
          .optional()
          .describe("Target output duration in seconds (1–300). Required when mode = duration."),
        smart_cut_before_repeat: z
          .boolean()
          .optional()
          .describe("Smart loop cut preprocess. Trims source to its cleanest loop boundary before concatenating. Recommended for stochastic-tail sources."),
        smart_cut_lookback: z
          .number()
          .int()
          .min(2)
          .max(64)
          .optional()
          .describe("Smart-cut lookback window in frames. Default 16, max 64."),
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
      if (args.mode === "repeat" && args.repeat_count === undefined) {
        return {
          content: [{ type: "text", text: "repeat_count required when mode = repeat." }],
          isError: true,
        }
      }
      if (args.mode === "duration" && args.target_duration === undefined) {
        return {
          content: [{ type: "text", text: "target_duration required when mode = duration." }],
          isError: true,
        }
      }
      const payload: Record<string, unknown> = {
        videoUrl,
        mode: args.mode,
        mcp_client: session.clientName,
        userId: session.userId,
      }
      if (args.mode === "repeat") payload.repeatCount = args.repeat_count
      if (args.mode === "duration") payload.targetDuration = args.target_duration
      if (args.smart_cut_before_repeat) payload.smartLoopCutBeforeRepeat = true
      if (args.smart_cut_lookback !== undefined) payload.smartLoopCutLookback = args.smart_cut_lookback
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/loop-video",
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      const widgetPrompt =
        args.mode === "repeat"
          ? `loop ${args.repeat_count}× ${args.smart_cut_before_repeat ? "(smart cut)" : ""}`.trim()
          : `loop to ${args.target_duration}s ${args.smart_cut_before_repeat ? "(smart cut)" : ""}`.trim()
      return jobResultWithWidget({
        jobId,
        label: "loop video",
        session,
        widgetKind: "video",
        widgetData: {
          prompt: widgetPrompt,
          model: "loop-video",
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

  // ── face_swap ──
  server.registerTool(
    "face_swap",
    {
      title: "Face Swap",
      description:
        "Replace the face in a video with a face from a reference image. " +
        "Provide the source video and a portrait image whose face will be transplanted. " +
        "Returns a job_id with the face-swapped video.",
      inputSchema: {
        video_url: z.string().url().optional().describe("Source video URL."),
        video_asset_id: z.string().optional().describe("Nodaro video job id."),
        face_image_url: z.string().url().optional().describe("Portrait image whose face to use."),
        face_image_asset_id: z.string().optional().describe("Nodaro image job id for the face."),
      },
      outputSchema: { jobId: z.string(), outputUrl: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v3/job-video",
        ui: { resourceUri: "ui://nodaro/widget/v3/job-video", visibility: ["model", "app"] },
      },
    },
    async (args) => {
      const videoUrl =
        args.video_url ??
        (args.video_asset_id
          ? await resolveAssetId({ assetId: args.video_asset_id, userId: session.userId, expectedKind: "video" })
          : null)
      if (!videoUrl) return { content: [{ type: "text" as const, text: "Pass video_url or video_asset_id." }], isError: true }

      const faceImageUrl =
        args.face_image_url ??
        (args.face_image_asset_id
          ? await resolveAssetId({ assetId: args.face_image_asset_id, userId: session.userId, expectedKind: "image" })
          : null)
      if (!faceImageUrl) return { content: [{ type: "text" as const, text: "Pass face_image_url or face_image_asset_id (portrait for the replacement face)." }], isError: true }

      const res = await fastify.inject({
        method: "POST",
        url: "/v1/face-swap",
        headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET },
        payload: { videoUrl, faceImageUrl, provider: "roop", mcp_client: session.clientName, userId: session.userId },
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResultWithWidget({ jobId, label: "face swap", session, widgetKind: "video", widgetData: { prompt: "(face swap)", model: "roop" } })
    },
  )

  // ── video_upscale ──
  server.registerTool(
    "video_upscale",
    {
      title: "Video Upscale",
      description:
        "Upscale a video to higher resolution using Topaz AI or VEO upscale. " +
        "Returns a job_id with the enhanced video.\n\n" +
        "**Models**:\n" +
        "  • `topaz` (default) — Topaz AI upscale, 1×/2×/4× factor.\n" +
        "  • `veo-1080p` — VEO upscale to 1080p (requires kie_task_id from original VEO generation).\n" +
        "  • `veo-4k` — VEO upscale to 4K (requires kie_task_id from original VEO generation).",
      inputSchema: {
        video_url: z.string().url().optional().describe("Source video URL (required for topaz)."),
        video_asset_id: z.string().optional().describe("Nodaro video job id (required for topaz)."),
        model: z.enum(["topaz", "veo-1080p", "veo-4k"]).optional().describe("Upscale model. Default topaz."),
        upscale_factor: z.enum(["1", "2", "4"]).optional().describe("Upscale factor for topaz (1×/2×/4×). Default 2."),
        kie_task_id: z.string().optional().describe("KIE task id from the original VEO generation — required for veo-1080p / veo-4k."),
      },
      outputSchema: { jobId: z.string(), outputUrl: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v3/job-video",
        ui: { resourceUri: "ui://nodaro/widget/v3/job-video", visibility: ["model", "app"] },
      },
    },
    async (args) => {
      const provider = args.model ?? "topaz"
      const isVeo = provider === "veo-1080p" || provider === "veo-4k"

      if (isVeo && !args.kie_task_id) {
        return { content: [{ type: "text" as const, text: "veo-1080p and veo-4k require kie_task_id from the original VEO generation." }], isError: true }
      }

      const videoUrl =
        args.video_url ??
        (args.video_asset_id
          ? await resolveAssetId({ assetId: args.video_asset_id, userId: session.userId, expectedKind: "video" })
          : null)
      if (!isVeo && !videoUrl) {
        return { content: [{ type: "text" as const, text: "Pass video_url or video_asset_id." }], isError: true }
      }

      const payload: Record<string, unknown> = {
        provider,
        upscaleFactor: args.upscale_factor ?? "2",
        ...(videoUrl ? { videoUrl } : {}),
        ...(args.kie_task_id ? { kieTaskId: args.kie_task_id } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/video-upscale",
        headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResultWithWidget({ jobId, label: "video upscale", session, widgetKind: "video", widgetData: { prompt: `(upscale ${args.upscale_factor ?? "2"}×)`, model: provider } })
    },
  )

  // ── speech_to_video ──
  server.registerTool(
    "speech_to_video",
    {
      title: "Speech to Video",
      description:
        "Animate a portrait image to speak a line of audio (Wan SpeechToVideo / Wan S2V). " +
        "Provide a portrait image and an audio clip — the face will be lip-synced and " +
        "animated to match the speech. Returns a job_id.",
      inputSchema: {
        image_url: z.string().url().optional().describe("Portrait image URL."),
        image_asset_id: z.string().optional().describe("Nodaro image job id."),
        audio_url: z.string().url().optional().describe("Speech audio URL."),
        audio_asset_id: z.string().optional().describe("Nodaro audio job id."),
        prompt: z.string().min(1).max(2500).describe("Motion/scene description to guide the animation."),
        resolution: z.enum(["480p", "580p", "720p"]).optional().describe("Output resolution. Default 480p."),
        negative_prompt: z.string().max(2500).optional(),
      },
      outputSchema: { jobId: z.string(), outputUrl: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v3/job-video",
        ui: { resourceUri: "ui://nodaro/widget/v3/job-video", visibility: ["model", "app"] },
      },
    },
    async (args) => {
      const imageUrl =
        args.image_url ??
        (args.image_asset_id
          ? await resolveAssetId({ assetId: args.image_asset_id, userId: session.userId, expectedKind: "image" })
          : null)
      if (!imageUrl) return { content: [{ type: "text" as const, text: "Pass image_url or image_asset_id (portrait)." }], isError: true }

      const audioUrl =
        args.audio_url ??
        (args.audio_asset_id
          ? await resolveAssetId({ assetId: args.audio_asset_id, userId: session.userId, expectedKind: "audio" })
          : null)
      if (!audioUrl) return { content: [{ type: "text" as const, text: "Pass audio_url or audio_asset_id (speech)." }], isError: true }

      const payload: Record<string, unknown> = {
        imageUrl,
        audioUrl,
        prompt: args.prompt,
        resolution: args.resolution ?? "480p",
        ...(args.negative_prompt ? { negativePrompt: args.negative_prompt } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/speech-to-video",
        headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResultWithWidget({ jobId, label: "speech to video", session, widgetKind: "video", widgetData: { prompt: args.prompt.slice(0, 80), model: "wan-s2v", resolution: args.resolution ?? "480p" } })
    },
  )
}
