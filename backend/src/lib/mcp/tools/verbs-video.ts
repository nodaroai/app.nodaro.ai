import { z } from "zod"
import { resolveAssetId } from "../asset-resolver.js"
import { buildCompositePrompt } from "../prompt-builder-bridge.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { config } from "../../config.js"
import type { RegisterOpts } from "./verbs-image.js"
import { connectedReferenceSchema } from "../../connected-reference-schema.js"
import {
  parseJobId,
  errorResult,
  parseFailure,
  jobResultWithWidget,
  dispatchJob,
  resolveRefArray,
  StructuredFields,
  JOB_OUTPUT_SCHEMA,
  uiMeta,
} from "./_verb-helpers.js"
import { WIDGET_URI } from "../widgets/registrar.js"
import { modelIdsByKindMode, VIDEO_REF_LIMITS_BY_PROVIDER, ALL_CAPTION_STYLES, COMBINE_TRANSITION_IDS, AUDIO_CROSSFADE_CURVE_IDS, MOTION_TRANSFER_PROVIDERS, VIDEO_ANALYSIS_TIER_ORDER, resolveVideoAnalysisModel, DEFAULT_VIDEO_ANALYSIS_TIER, VIDEO_ANALYSIS_DURATION_BUCKETS, VIDEO_ANALYSIS_MAX_DURATION_SEC, VIDEO_ANALYSIS_MAX_SCENE_SEC, VIDEO_ANALYSIS_BUCKET_CREDITS, buildVideoAnalysisCreditId, VIDEO_AUDIT_BUCKET_CREDITS, buildVideoAuditCreditId } from "@nodaro/shared"

// Map list_models catalog/display ids → /v1/motion-transfer route providers.
// The catalog advertises `motion-transfer` / `kling-3.0-motion` (the credit/
// display layer); the route's Zod enum only accepts the canonical providers.
const MOTION_TRANSFER_PROVIDER_ALIASES: Record<string, string> = {
  "motion-transfer": "kling",
  "kling-3.0-motion": "kling-3.0",
}
import { normalizeVideoInput } from "../normalize.js"
import { getUserMcpPreferences } from "../user-preferences.js"
import { resolvePreset } from "../../presets/resolve-preset.js"

// Derive video model enums from MODEL_CATALOG. `includeHidden: true` keeps
// legacy ids (seedance V1.5 etc.) accepted for cached Claude.ai sessions —
// they're filtered out of `list_models` output but the schema is permissive.
//
// These are kept for description hints; the actual schema is `z.string()`
// so unknown values silently normalize to the catalog default in the
// handler (per the "tool calls should never reject" principle).
const T2V_MODEL_IDS = modelIdsByKindMode(null, ["t2v"], { includeHidden: true })
const I2V_MODEL_IDS = modelIdsByKindMode("video", ["i2v"], { includeHidden: true })

// Credit hint for the video_analysis tool description — derived from the
// shared duration-bucket formula (NEVER hand-write the numbers; the formula is
// the single source of truth, shape-guarded by packages/shared's pricing test; the $-formula itself lives in the private analysis plugin).
// Renders like: "fast <a>/<b>/<c>/<d> credits; pro …; mixed …" — deliberately
// no example VALUES here: this comment sat three repricings stale, which is
// exactly the failure the derived hint exists to prevent.
// Priced per quality TIER — the underlying model is never surfaced.
// resolveVideoAnalysisModel is sentinel-aware: mixed tiers resolve to their
// roll-plan sentinel, which buildVideoAnalysisCreditId prices under the shared
// `mixed` credit family (both mixed variants share one ladder).
const VIDEO_ANALYSIS_PRICING_HINT = VIDEO_ANALYSIS_TIER_ORDER.map(
  (tier) => `${tier} ${VIDEO_ANALYSIS_DURATION_BUCKETS.map((b) => VIDEO_ANALYSIS_BUCKET_CREDITS[buildVideoAnalysisCreditId(resolveVideoAnalysisModel(tier), b)]).join("/")} credits`,
).join("; ")

// Credit hint for the video_audit tool description — same derivation
// discipline as VIDEO_ANALYSIS_PRICING_HINT above (never hand-write the
// numbers). Two families instead of per-tier: `analysis wired` (an existing
// analysis was passed — re-audits it) and `auto-run analysis` (none passed —
// the tool runs a fast analysis first, hence the higher price).
const VIDEO_AUDIT_PRICING_HINT = [true, false]
  .map((analysisProvided) => {
    const familyLabel = analysisProvided ? "analysis wired" : "auto-run analysis"
    return `${familyLabel} ${VIDEO_ANALYSIS_DURATION_BUCKETS.map((b) => VIDEO_AUDIT_BUCKET_CREDITS[buildVideoAuditCreditId({ analysisProvided, durationSec: b })]).join("/")} credits`
  })
  .join("; ")

const executeGate: ToolGate = { required: ["workflows:execute"] }

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
        "expects.\n\n" +
        "**Seedance prompting (the default model family)**: storyboard " +
        "multi-moment videos as `Shot 1: … Shot 2: …` WITHOUT timestamps " +
        "(timed shots like '(0-3s)' destabilize generation). One camera move " +
        "per shot. Cue native audio inline: （background music）, <sound " +
        "effects>, quoted dialogue. End with: 'HD, rich details, stable " +
        "picture, keep it subtitle-free, do not generate a watermark.' " +
        "Full doctrine: `get_node_skill(\"generate-video\")`.\n\n" +
        "**Presets/templates**: call list_node_presets { nodeType: \"generate-video\" } " +
        "to browse built-ins (e.g. Slow Push-In, FPV Drone, Vertical Hero) + your saved " +
        "presets, get_node_preset to read one's config, or pass presetId here to apply " +
        "one directly.",
      inputSchema: {
        // Optional in the preset path: when presetId is supplied the preset
        // provides the prompt, so the caller may omit it. The handler enforces
        // "prompt OR presetId required" (the guard moved from Zod to hand-rolled).
        prompt: z.string().min(1).max(8000).optional(),
        presetId: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe(
            "Apply a built-in/custom preset by id from list_node_presets; " +
            "explicit fields below override it.",
          ),
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
          .describe("Output resolution. Provider-dependent — common values: 480p, 720p, 1080p, 4k."),
        sound: z.boolean().optional(),
        negative_prompt: z.string().max(8000).optional(),
        seed: z.number().int().min(0).max(2147483647).optional(),
        structured: StructuredFields.optional(),
        connected_references: z.array(connectedReferenceSchema).max(14).optional()
          .describe(
            "Advanced structured references — the editor's wired-reference shape (each needs at least " +
            "{id, defaultName, source, url}, url a public https URL). Assembled server-side into per-ref " +
            "@image_N directives + {image:N} token resolution (labeled/ordered refs, unlike flat " +
            "reference_image_urls). Only models with image-reference support attach them.",
          ),
        reference_order: z.array(z.string()).max(14).optional()
          .describe("Advanced: reorder connected_references by their stable ids; renumbers the @image_N bindings."),
        reference_image_urls: z
          .union([z.array(z.string()), z.string()])
          .optional()
          .describe(
            "Identity/reference images (URLs or Nodaro asset IDs), capped at the model's own " +
            "limit (seedance-2-5 30, seedance-2 family + minimax-h3 9, veo3/veo3.1 3, ...). " +
            "Dropped on models with no reference path. Accepts an array; a lone URL or " +
            "JSON-stringified array is coerced.",
          ),
        reference_video_urls: z
          .union([z.array(z.string()), z.string()])
          .optional()
          .describe(
            "Reference videos for style/motion transfer, capped at the model's own limit " +
            "(seedance-2-5 10, seedance-2 family + minimax-h3 3). Dropped on models without " +
            "video-reference support.",
          ),
        reference_audio_urls: z
          .union([z.array(z.string()), z.string()])
          .optional()
          .describe(
            "Reference audio for soundtrack-driven motion, capped at the model's own limit " +
            "(seedance-2-5 10, seedance-2 family + minimax-h3 3). Dropped on models without " +
            "audio-reference support.",
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
      "ui/resourceUri": "ui://nodaro/widget/v4/job-video",
      ui: {
        resourceUri: "ui://nodaro/widget/v4/job-video",
        visibility: ["model", "app"],
      },
    },
    },
    async (args) => {
      // ── Preset application (server-side, faithful) ──────────────────────
      // Mirrors generate_image: when the caller passes `presetId`, resolve the
      // preset's tuned config (factory catalog, or the caller's own custom
      // preset — owner-scoped) and use it as the BASE; only fields the CALLER
      // actually provided override it. This schema has NO `.default()` on any
      // field, so an absent caller value is exactly `undefined` here — that's
      // what lets a defaulted-but-not-passed lever lose to the preset (the
      // critical override rule). Preset `data` (camelCase node-data keys:
      // provider / aspectRatio / negativePrompt / …) is mapped onto THIS
      // handler's snake_case param namespace so the rest reads `effective`.
      let effective: Record<string, unknown> = { ...args }
      if (args.presetId) {
        const preset = await resolvePreset({
          nodeType: "generate-video",
          presetId: args.presetId,
          userId: session.userId,
        })
        if (!preset) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Preset not found: ${args.presetId}. List ids with list_node_presets { nodeType: "generate-video" }.`,
              },
            ],
            isError: true as const,
          }
        }
        const d = preset.data
        const presetParams: Record<string, unknown> = {}
        if (d.provider !== undefined) presetParams.model = d.provider
        if (d.prompt !== undefined) presetParams.prompt = d.prompt
        if (d.aspectRatio !== undefined) presetParams.aspect_ratio = d.aspectRatio
        if (d.resolution !== undefined) presetParams.resolution = d.resolution
        if (d.duration !== undefined) presetParams.duration = d.duration
        if (d.negativePrompt !== undefined) presetParams.negative_prompt = d.negativePrompt
        if (d.sound !== undefined) presetParams.sound = d.sound
        if (d.seed !== undefined) presetParams.seed = d.seed
        const callerProvided = Object.fromEntries(
          Object.entries(args).filter(([, v]) => v !== undefined),
        )
        effective = { ...presetParams, ...callerProvided }
      }
      // `presetId` is a control field — never submit it to the provider.
      delete effective.presetId

      // Prompt is required once a preset hasn't supplied one. (The schema
      // relaxes prompt to optional for the preset path; guard the no-preset
      // bare call so it fails clearly instead of generating empty.)
      if (effective.prompt === undefined || effective.prompt === "") {
        return {
          content: [
            {
              type: "text" as const,
              text: "A prompt is required (or pass a presetId whose preset includes one).",
            },
          ],
          isError: true as const,
        }
      }

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
          model: effective.model as string | undefined,
          aspect_ratio: effective.aspect_ratio as string | undefined,
          resolution: effective.resolution as string | undefined,
          duration: effective.duration as number | undefined,
        },
        {
          model: userVid.model as string | undefined,
          aspectRatio: userVid.aspectRatio as string | undefined,
          resolution: userVid.resolution as string | undefined,
          duration: userVid.duration as number | undefined,
        },
        "seedance-2-fast",
      )

      const compositePrompt = buildCompositePrompt(
        effective.prompt as string,
        effective.structured as Parameters<typeof buildCompositePrompt>[1],
      )
      // Flat identity/reference arrays, capped at the resolved model's own
      // limits from the shared table (same source the route enforces). Models
      // absent from the table have no reference path — args dropped, matching
      // route behavior.
      const t2vRefLimits = VIDEO_REF_LIMITS_BY_PROVIDER[model] ?? {}
      const t2vRefImages = t2vRefLimits.images ? await resolveRefArray(args.reference_image_urls, session.userId, "image", t2vRefLimits.images) : []
      const t2vRefVideos = t2vRefLimits.videos ? await resolveRefArray(args.reference_video_urls, session.userId, "video", t2vRefLimits.videos) : []
      const t2vRefAudio = t2vRefLimits.audio ? await resolveRefArray(args.reference_audio_urls, session.userId, "audio", t2vRefLimits.audio) : []
      const payload = {
        prompt: compositePrompt,
        provider: model,
        duration,
        aspectRatio,
        resolution,
        // Map the single `sound` toggle onto BOTH route levers: Kling-family
        // models read `sound`, but Seedance (the default) + VEO read
        // `generateAudio` (which defaults ON). Without forwarding both, a
        // `sound: false` was silently ignored on the default/VEO models.
        sound: effective.sound as boolean | undefined,
        generateAudio: effective.sound as boolean | undefined,
        negativePrompt: effective.negative_prompt as string | undefined,
        seed: effective.seed as number | undefined,
        ...(args.connected_references ? { connectedReferences: args.connected_references } : {}),
        ...(args.reference_order ? { referenceOrder: args.reference_order } : {}),
        ...(t2vRefImages.length ? { referenceImageUrls: t2vRefImages } : {}),
        ...(t2vRefVideos.length ? { referenceVideoUrls: t2vRefVideos } : {}),
        ...(t2vRefAudio.length ? { referenceAudioUrls: t2vRefAudio } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, {
        url: "/v1/text-to-video",
        payload,
        label: "generate-video",
        widgetKind: "video",
        widgetData: {
          prompt: compositePrompt,
          model: (effective.model as string | undefined) ?? "generate-video",
          aspectRatio: effective.aspect_ratio as string | undefined,
          duration: effective.duration as number | undefined,
        },
      })
    },
  )

  // ── animate_image (image-to-video) ──
  // Ref arrays resolve via the shared `resolveRefArray` in _verb-helpers.ts
  // (URL pass-through + asset-id resolution + tolerant string coercion).
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
        "**Reference modes** (auto-selected from the inputs you provide):\n" +
        "  • `'frames'` (default) — start/end-frame mode: provide `image_url` as " +
        "the first frame and optionally `end_frame_url` as the last frame.\n" +
        "  • `'references'` — reference-media mode: provide reference images " +
        "via `reference_image_urls`, reference videos via `reference_video_urls` " +
        "(style/motion transfer), and/or audio clips via `reference_audio_urls` " +
        "(soundtrack-driven motion). Every model takes refs at its OWN caps — " +
        "seedance-2-5 30/10/10, seedance-2 family + minimax-h3 9/3/3, " +
        "gemini-omni-video 7 images (first image = opening frame, the rest are " +
        "identity refs), kling-3-omni/grok-i2v 7, veo3/veo3.1 3 images. " +
        "`image_url` / `end_frame_url` are ignored in this mode. Reference " +
        "videos/audio cannot be combined with `end_frame_url`.\n" +
        "  • Reference order = priority: put the identity-critical image FIRST " +
        "and refer by ordinal in the prompt (@Image 1, Video 2). Identity = ONE " +
        "headshot + ONE full-body image — multi-view character sheets cause ID " +
        "drift and twin duplicates. 4-5 assets total beats maxing the caps.\n" +
        "  • Edit/extend phrasing: name clips directly ('Extend Video 1 backward', " +
        "'Remove X from Video 1') — saying 'reference Video 1' flips the model " +
        "into reference mode and breaks the edit. Track completion: 'Video 1 + " +
        "[transition] + followed by Video 2' (≤3 clips, ≤15s total). Full " +
        "doctrine: `get_node_skill(\"image-to-video\")`.\n\n" +
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
            "Output resolution. Provider-dependent — common values: 480p, 720p, 1080p, 4k. " +
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
        // Tolerant unions: clients sometimes send a JSON-stringified array or a
        // lone URL; the handler coerces via resolveRefArray and enforces the
        // per-kind caps there (the route re-validates them too).
        reference_image_urls: z
          .union([z.array(z.string()), z.string()])
          .optional()
          .describe(
            "Identity/reference images (URLs or Nodaro asset IDs), capped at the model's own " +
            "limit: seedance-2-5 30, seedance-2 family + minimax-h3 9, gemini-omni-video / " +
            "kling-3-omni / grok-i2v 7, happyhorse-ref2v 9, veo3/veo3.1 3. Resolved server-side; " +
            "silently dropped on models with no reference path. " +
            "Accepts an array; a lone URL or JSON-stringified array is coerced.",
          ),
        reference_video_urls: z
          .union([z.array(z.string()), z.string()])
          .optional()
          .describe(
            "Reference videos for style/motion transfer (URLs or Nodaro asset IDs). " +
            "seedance-2-5 up to 10, seedance-2 family + minimax-h3 up to 3, gemini-omni-video 1; " +
            "dropped on models without video-reference support. Ignored in 'frames' mode. " +
            "Accepts an array; a lone URL or JSON-stringified array is coerced.",
          ),
        reference_audio_urls: z
          .union([z.array(z.string()), z.string()])
          .optional()
          .describe(
            "Reference audio for soundtrack-driven motion (URLs or Nodaro asset IDs). " +
            "seedance-2-5 up to 10, seedance-2 family + minimax-h3 up to 3; dropped on models " +
            "without audio-reference support. Ignored in 'frames' mode. " +
            "Accepts an array; a lone URL or JSON-stringified array is coerced.",
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
        connected_references: z.array(connectedReferenceSchema).max(14).optional()
          .describe(
            "Advanced structured references — the editor's wired-reference shape (each needs at least " +
            "{id, defaultName, source, url}, url a public https URL). Assembled server-side into per-ref " +
            "@image_N directives + {image:N} token resolution (labeled/ordered refs, unlike flat " +
            "reference_image_urls). Only models with image-reference support attach them.",
          ),
        reference_order: z.array(z.string()).max(14).optional()
          .describe("Advanced: reorder connected_references by their stable ids; renumbers the @image_N bindings."),
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
      "ui/resourceUri": "ui://nodaro/widget/v4/job-video",
      ui: {
        resourceUri: "ui://nodaro/widget/v4/job-video",
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
      // Multimodal / identity refs — capped per model from the shared table
      // (the same source the routes and resolvers enforce), so every offered
      // model carries refs at its own caps: Seedance 2.5 30/10/10, the 2.0
      // family + Hailuo 3 9/3/3, gemini-omni 7 images, VEO 3.x 3 images, etc.
      // Models absent from the table have no reference-forwarding path —
      // their args are dropped here, matching route behavior.
      const refLimits = VIDEO_REF_LIMITS_BY_PROVIDER[model] ?? {}
      const refImageUrls = refLimits.images ? await resolveRefArray(args.reference_image_urls, session.userId, "image", refLimits.images) : []
      const refVideoUrls = refLimits.videos ? await resolveRefArray(args.reference_video_urls, session.userId, "video", refLimits.videos) : []
      const refAudioUrls = refLimits.audio ? await resolveRefArray(args.reference_audio_urls, session.userId, "audio", refLimits.audio) : []

      // KIE forbids combining multimodal-ref mode with start+end frame mode.
      // Fail fast with a clear MCP error rather than letting the route 400.
      if ((refVideoUrls.length || refAudioUrls.length) && endFrameUrl) {
        return {
          content: [{
            type: "text" as const,
            text: `${model}: reference videos/audio cannot be combined with end_frame_url / end_frame_asset_id. Pass one or the other.`,
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
        // Map the single `sound` toggle onto BOTH route levers — Kling reads
        // `sound`, Seedance (default) + VEO read `generateAudio` (default ON);
        // forwarding only `sound` silently ignored `sound:false` on those.
        sound: args.sound,
        generateAudio: args.sound,
        ...(refImageUrls.length ? { referenceImageUrls: refImageUrls } : {}),
        ...(refVideoUrls.length ? { referenceVideoUrls: refVideoUrls } : {}),
        ...(refAudioUrls.length ? { referenceAudioUrls: refAudioUrls } : {}),
        ...(args.connected_references ? { connectedReferences: args.connected_references } : {}),
        ...(args.reference_order ? { referenceOrder: args.reference_order } : {}),
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
      return dispatchJob(fastify, session, {
        url: "/v1/generate-video",
        payload,
        label: "generate-video",
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
        "Extend a video. veo-extend / runway-extend continue a previously-generated VEO or Runway video and require the kie_task_id from that job (NOT the URL). " +
        "seedance-2-extend extends ANY video by URL (or asset id) — it generates what happens next (audio included) and trim-stitches it into one seamless clip; " +
        "describe only the continuation content in `prompt` (plain action description — no 'reference video' phrasing needed).",
      inputSchema: {
        prompt: z.string().min(1).max(8000),
        kie_task_id: z.string().min(1).optional().describe("KIE task id from prior video generation (veo-extend / runway-extend only)"),
        video_url: z.string().url().optional().describe("Source video URL (seedance-2-extend only)"),
        video_asset_id: z.string().optional().describe("Nodaro job/upload asset id whose output is a video (seedance-2-extend only)"),
        model: z.enum(["veo-extend", "runway-extend", "seedance-2-extend"]),
        veo_quality: z.enum(["fast", "quality"]).optional(),
        runway_resolution: z.enum(["720p", "1080p"]).optional(),
        duration: z.number().int().min(4).max(15).optional().describe("Seconds to add (seedance-2-extend, default 8)"),
        resolution: z.enum(["480p", "720p", "1080p", "4k"]).optional().describe("Extension resolution (seedance-2-extend, default 720p — match the source for the cleanest seam)"),
        generate_audio: z.boolean().optional().describe("Continue the soundtrack into the extension (seedance-2-extend, default true)"),
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
      "ui/resourceUri": "ui://nodaro/widget/v4/job-video",
      ui: {
        resourceUri: "ui://nodaro/widget/v4/job-video",
        visibility: ["model", "app"],
      },
    },
    },
    async (args) => {
      if (args.model === "seedance-2-extend") {
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
              { type: "text", text: "seedance-2-extend requires video_url or video_asset_id" },
            ],
            isError: true,
          }
        }
        return dispatchJob(fastify, session, {
          url: "/v1/extend-video",
          payload: {
            videoUrl,
            prompt: args.prompt,
            provider: args.model,
            duration: args.duration,
            resolution: args.resolution,
            generateAudio: args.generate_audio,
            mcp_client: session.clientName,
            userId: session.userId,
          },
          label: "video extend",
          widgetKind: "video",
          widgetData: {
            prompt: args.prompt,
            model: args.model,
          },
        })
      }

      if (!args.kie_task_id) {
        return {
          content: [
            { type: "text", text: `${args.model} requires kie_task_id from the prior video generation job` },
          ],
          isError: true,
        }
      }
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
      return dispatchJob(fastify, session, {
        url: "/v1/extend-video",
        payload,
        label: "video extend",
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
        audio_crossfade_duration: z
          .number()
          .min(0)
          .max(5)
          .optional()
          .describe(
            "Audio-only crossfade length in seconds — blends the soundtracks without altering the video stream (at cuts the video is stream-copied untouched). Omitted: follows transition_duration.",
          ),
        smart_cut: z
          .boolean()
          .optional()
          .describe(
            "PSNR-match the last frames of each clip against the first frames of the next and cut where the chosen smart_cut_mode decides — seamless for continuation clips (next generated from prev's last frame). Replaces the fixed trim_* frame counts. nodaro.ai only (self-hosted editions return cloud_only_feature).",
          ),
        smart_cut_mode: z.enum(["best-pair", "preroll-keep-prev", "preroll-keep-next"]).optional()
          .describe(
            "Smart-cut cut-point algorithm. Default 'best-pair'. The preroll variants differ in which side of an overlap survives: 'preroll-keep-next' favors the incoming clip, 'preroll-keep-prev' the outgoing one. Same search windows and fixed-trims fallback in every mode.",
          ),
        smart_cut_frames_prev: z.number().int().min(1).max(24).optional()
          .describe("Smart-cut search window at each clip's END (frames, default 8)"),
        smart_cut_frames_next: z.number().int().min(1).max(24).optional()
          .describe("Smart-cut search window at each clip's START (frames, default 8)"),
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
      "ui/resourceUri": "ui://nodaro/widget/v4/job-video",
      ui: {
        resourceUri: "ui://nodaro/widget/v4/job-video",
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
        audioCrossfadeDuration: args.audio_crossfade_duration,
        smartCutEnabled: args.smart_cut,
        smartCutMode: args.smart_cut_mode,
        smartCutFramesPrev: args.smart_cut_frames_prev,
        smartCutFramesNext: args.smart_cut_frames_next,
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, {
        url: "/v1/combine-videos",
        payload,
        label: "combine videos",
        widgetKind: "video",
        widgetData: {
          prompt: `Combine ${videoUrls.length} videos`,
          model: "combine-videos",
        },
      })
    },
  )

  // ── assemble_narrated_video ──
  server.registerTool(
    "assemble_narrated_video",
    {
      title: "Assemble Narrated Video",
      description:
        "Fit N ordered (clip, voice) blocks into ONE narrated MP4. Per block: a shorter voice is centered over its clip with silence padding; a longer voice slows the clip to fit (capped, holding the last frame beyond the cap); audio is NEVER cropped. Clips must contain no spoken dialogue. Each block's video/audio is { url } or { asset_id } (a Nodaro job id). Returns a job_id with the assembled video.",
      inputSchema: {
        blocks: z
          .array(
            z.object({
              video_url: z.string().url().optional(),
              video_asset_id: z.string().optional(),
              audio_url: z.string().url().optional(),
              audio_asset_id: z.string().optional(),
            }),
          )
          .min(1)
          .max(60)
          .describe("1–60 blocks in play order. Each block: a video (url or asset_id) and an optional voice (url or asset_id)."),
        voice_volume: z.number().min(0).max(200).optional().describe("Voice loudness %, default 100."),
        clip_audio_volume: z.number().min(0).max(200).optional().describe("Clip ambient bed loudness % under the voice, default 40."),
        max_slowdown: z.number().min(1).max(2).optional().describe("Max slow factor for a long voice, default 1.5; beyond it the last frame holds."),
        trim_end_frames: z.number().int().min(0).max(120).optional().describe("Frames trimmed from the end of each non-final block (seamless-merge). Default 0."),
        trim_start_frames: z.number().int().min(0).max(120).optional().describe("Frames trimmed from the start of each non-first block. Default 0."),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v4/job-video",
        ui: { resourceUri: "ui://nodaro/widget/v4/job-video", visibility: ["model", "app"] },
      },
    },
    async (args) => {
      const blocks: { videoUrl: string; audioUrl?: string }[] = []
      for (const b of args.blocks) {
        const videoUrl =
          b.video_url ??
          (b.video_asset_id
            ? await resolveAssetId({ assetId: b.video_asset_id, userId: session.userId, expectedKind: "video" })
            : null)
        if (!videoUrl) {
          return { content: [{ type: "text" as const, text: "Each block needs a video_url or video_asset_id." }], isError: true }
        }
        const audioUrl =
          b.audio_url ??
          (b.audio_asset_id
            ? await resolveAssetId({ assetId: b.audio_asset_id, userId: session.userId, expectedKind: "audio" })
            : undefined)
        blocks.push({ videoUrl, ...(audioUrl ? { audioUrl } : {}) })
      }
      const payload: Record<string, unknown> = {
        blocks,
        ...(args.voice_volume !== undefined ? { voiceVolume: args.voice_volume } : {}),
        ...(args.clip_audio_volume !== undefined ? { clipAudioVolume: args.clip_audio_volume } : {}),
        ...(args.max_slowdown !== undefined ? { maxSlowdown: args.max_slowdown } : {}),
        ...(args.trim_end_frames !== undefined ? { trimEndFrames: args.trim_end_frames } : {}),
        ...(args.trim_start_frames !== undefined ? { trimStartFrames: args.trim_start_frames } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, {
        url: "/v1/assemble-narrated-video",
        payload,
        label: "assemble narrated video",
        widgetKind: "video",
        widgetData: { prompt: `Narrated video from ${blocks.length} blocks`, model: "assemble-narrated-video" },
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
      "ui/resourceUri": "ui://nodaro/widget/v4/job-video",
      ui: {
        resourceUri: "ui://nodaro/widget/v4/job-video",
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
      return dispatchJob(fastify, session, {
        url: "/v1/add-captions",
        payload,
        label: "add captions",
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
      "ui/resourceUri": "ui://nodaro/widget/v4/job-image",
      ui: {
        resourceUri: "ui://nodaro/widget/v4/job-image",
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
      return dispatchJob(fastify, session, {
        url: "/v1/extract-frame",
        payload,
        label: "extract frame",
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
        "  • **`seedance-2-fast`** (~18 cr @ 480p / 40 cr @ 720p, 8s w/audio ref; 480p/720p only) — same " +
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
        "for animating a portrait into a speaking head when no video exists.\n" +
        "  • **`volcengine-lipsync`** (2 cr/s — e.g. 30 cr/15s, 120 cr/60s) — KIE " +
        "**video-to-video AI dubbing**: re-syncs an existing clip's lips to a new " +
        "vocal track. Set `mode: basic` + `open_scenedet: true` for multi-speaker " +
        "(scene detection + speaker ID). Cheapest modern dubbing option. Requires video input.\n\n" +
        "**Input requirements by model**: seedance-2(-fast), kling-avatar(-pro), " +
        "infinitalk, sadtalker → image input only. latentsync, video-retalking, " +
        "volcengine-lipsync → video input only. wav2lip → image OR video.\n\n" +
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
            "Lip-sync model. Default kling-avatar. All 11 options: " +
            "seedance-2 (~50/75 cr, image, native phoneme lip-sync 8+ languages, premium), " +
            "seedance-2-fast (~40/60 cr, image, same lip-sync cheaper), " +
            "kling-avatar (28 cr, image, 720p), kling-avatar-pro (56 cr, image, 1080p), " +
            "infinitalk (11/42 cr, image, 480p|720p), " +
            "omnihuman-1-5 (102/203/405 cr for 15/30/60s, image, prompt-directed performance, 720p|1080p, premium), " +
            "latentsync (5 cr, video, singing), " +
            "wav2lip (1 cr, image|video, fastest+cheapest), video-retalking " +
            "(20 cr, video, face enhancement), sadtalker (9 cr, single image), " +
            "volcengine-lipsync (2 cr/s, video, AI dubbing, mode lite|basic for multi-speaker). " +
            "Unknown values fall back to kling-avatar.",
          ),
        resolution: z
          .enum(["480p", "720p", "1080p"])
          .optional()
          .describe(
            "Resolution lever. infinitalk: 480p|720p. seedance-2(-fast): 480p|720p|1080p. " +
            "omnihuman-1-5: 720p|1080p (default 1080p). Other models ignore this.",
          ),
        seed: z
          .number()
          .int()
          .min(0)
          .max(2147483647)
          .optional()
          .describe("Reproducibility seed (omnihuman-1-5). Same seed + inputs → near-identical result."),
        fast_mode: z
          .boolean()
          .optional()
          .describe("omnihuman-1-5 only — trade some quality for faster generation."),
        mode: z
          .enum(["lite", "basic"])
          .optional()
          .describe(
            "volcengine-lipsync only. 'lite' (default) = single-person frontal, faster. " +
            "'basic' = complex scenes; pair with open_scenedet for multi-speaker. Other models ignore this.",
          ),
        separate_vocal: z
          .boolean()
          .optional()
          .describe("volcengine-lipsync only. Strip background noise from the driving audio."),
        open_scenedet: z
          .boolean()
          .optional()
          .describe("volcengine-lipsync 'basic' mode only. Scene detection + speaker ID — enables multi-speaker dubbing."),
        align_audio: z
          .boolean()
          .optional()
          .describe("volcengine-lipsync 'lite' mode only. Loop the source video when the audio is longer (default on)."),
        align_audio_reverse: z
          .boolean()
          .optional()
          .describe("volcengine-lipsync 'lite' mode only. Ping-pong the loop (requires align_audio on)."),
        templ_start_seconds: z
          .number()
          .optional()
          .describe("volcengine-lipsync only. Start time (seconds) in the source video to drive from (advanced)."),
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
        "ui/resourceUri": "ui://nodaro/widget/v4/job-video",
        ui: {
          resourceUri: "ui://nodaro/widget/v4/job-video",
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
        ...(args.seed !== undefined ? { seed: args.seed } : {}),
        ...(args.fast_mode !== undefined ? { fastMode: args.fast_mode } : {}),
        ...(args.mode ? { mode: args.mode } : {}),
        // Volcengine dubbing toggles — snake_case MCP inputs → camelCase route body.
        ...(args.separate_vocal !== undefined ? { separateVocal: args.separate_vocal } : {}),
        ...(args.open_scenedet !== undefined ? { openScenedet: args.open_scenedet } : {}),
        ...(args.align_audio !== undefined ? { alignAudio: args.align_audio } : {}),
        ...(args.align_audio_reverse !== undefined ? { alignAudioReverse: args.align_audio_reverse } : {}),
        ...(args.templ_start_seconds !== undefined ? { templStartSeconds: args.templ_start_seconds } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, {
        url: "/v1/lip-sync",
        payload,
        label: "lip sync",
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
        "ui/resourceUri": "ui://nodaro/widget/v4/job-video",
        ui: {
          resourceUri: "ui://nodaro/widget/v4/job-video",
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
      return dispatchJob(fastify, session, {
        url: "/v1/video-to-video",
        payload,
        label: "video-to-video",
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

  // ── relight_video (Beeble SwitchX — relight / switch / composite) ──
  // Source-pixel-driven: keep the subject's motion, change the lighting /
  // background / look via a reference image + alpha mask. Distinct from
  // modify_video (generative restyle) — SwitchX relights the ORIGINAL pixels.
  server.registerTool(
    "relight_video",
    {
      title: "Relight & Switch Video",
      description:
        "Relight a video and switch/composite elements, driven by the SOURCE " +
        "video's own pixels (Beeble SwitchX) — relight a subject, swap/restyle a " +
        "background, or composite new elements. Use this directly for relight / " +
        "background-swap / restyle-with-reference workflows.\n\n" +
        "Provide ONE of:\n" +
        "  (a) `video_url` — public HTTPS URL\n" +
        "  (b) `video_asset_id` — a Nodaro job id whose output is a video\n\n" +
        "Plus at least one of `prompt` or `reference_image_url` (a reference " +
        "image is strongly recommended).\n\n" +
        "`alpha_mode` controls masking:\n" +
        "  • **auto** (default) — AI masks the foreground subject.\n" +
        "  • **fill** — keep the whole scene; restyle the entire frame.\n" +
        "  • **select** — `mask_url` is one keyframe mask image, propagated " +
        "(`alpha_keyframe_index` picks the frame it describes).\n" +
        "  • **custom** — `mask_url` is a full per-frame alpha matte video.\n\n" +
        "Source must be ≤240 frames and ≤2,770,000 px. Output 720p or 1080p " +
        "(default 1080p). Powered by SwitchX — attribution is shown on outputs.",
      inputSchema: {
        video_url: z.string().url().optional(),
        video_asset_id: z.string().optional(),
        prompt: z.string().max(2000).optional(),
        reference_image_url: z.string().url().optional(),
        alpha_mode: z.enum(["auto", "fill", "select", "custom"]).optional().describe("Default auto."),
        mask_url: z.string().url().optional().describe("Required for select (keyframe image) / custom (matte video)."),
        alpha_keyframe_index: z.number().int().min(0).optional().describe("select mode — 0-based reference frame."),
        max_resolution: z.enum(["720", "1080"]).optional().describe("Default 1080."),
        seed: z.number().int().min(0).max(4294967295).optional().describe("Reproducibility seed (0–4294967295)."),
      },
      outputSchema: {
        jobId: z.string(),
        prompt: z.string().optional(),
        alphaMode: z.string().optional(),
        resolution: z.string().optional(),
        outputUrl: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v4/job-video",
        ui: {
          resourceUri: "ui://nodaro/widget/v4/job-video",
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
      if (!args.prompt && !args.reference_image_url) {
        return {
          content: [{ type: "text", text: "Pass at least one of prompt or reference_image_url." }],
          isError: true,
        }
      }
      const alphaMode = args.alpha_mode ?? "auto"
      if ((alphaMode === "select" || alphaMode === "custom") && !args.mask_url) {
        return {
          content: [{ type: "text", text: `alpha_mode "${alphaMode}" requires mask_url.` }],
          isError: true,
        }
      }
      const payload: Record<string, unknown> = {
        videoUrl,
        alphaMode,
        maxResolution: Number(args.max_resolution ?? "1080"),
        ...(args.prompt ? { prompt: args.prompt } : {}),
        ...(args.reference_image_url ? { referenceImageUrl: args.reference_image_url } : {}),
        ...(args.mask_url ? { maskUrl: args.mask_url } : {}),
        ...(args.alpha_keyframe_index !== undefined ? { alphaKeyframeIndex: args.alpha_keyframe_index } : {}),
        ...(args.seed !== undefined ? { seed: args.seed } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, {
        url: "/v1/switchx",
        payload,
        label: "relight-switch",
        widgetKind: "video",
        widgetData: {
          prompt: args.prompt,
          model: "beeble-switchx",
          resolution: args.max_resolution,
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
        "ui/resourceUri": "ui://nodaro/widget/v4/job-video",
        ui: {
          resourceUri: "ui://nodaro/widget/v4/job-video",
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
        "ui/resourceUri": "ui://nodaro/widget/v4/job-video",
        ui: {
          resourceUri: "ui://nodaro/widget/v4/job-video",
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
        "ui/resourceUri": "ui://nodaro/widget/v4/job-video",
        ui: {
          resourceUri: "ui://nodaro/widget/v4/job-video",
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
      return dispatchJob(fastify, session, {
        url: "/v1/merge-video-audio",
        payload,
        label: "merge video + audio",
        widgetKind: "video",
        widgetData: { prompt: "(merge video + audio)", model: "merge-video-audio" },
      })
    },
  )

  // ── still_to_video ──
  // FFmpeg-only bridge from a still into the video pipeline: one image + one
  // audio track → MP4. No AI model, no GPU, ZERO credits. The output duration
  // IS the audio's duration — there is no duration parameter by design.
  server.registerTool(
    "still_to_video",
    {
      title: "Still to Video",
      description:
        "Turn ONE still image + ONE audio track into an MP4 — locally " +
        "rendered (FFmpeg), no AI model, ZERO credits. The output length is " +
        "exactly the audio's length; there is no duration parameter.\n\n" +
        "Use this for narrated slides (generated image + voiceover), music " +
        "visualizers (cover art + track), or photo moments inside a longer " +
        "edit — anywhere a still must become video WITHOUT spending " +
        "video-model credits. For AI motion/animation of the image, use " +
        "`animate_image` instead.\n\n" +
        "**Inputs:**\n" +
        "  • Image — `image_url` OR `image_asset_id`.\n" +
        "  • Audio — `audio_url` OR `audio_asset_id` (sets the length).\n\n" +
        "**Levers:**\n" +
        "  • `motion` — none (default, fast) / zoom-in / zoom-out / " +
        "pan-left / pan-right / ken-burns; `intensity` 1–10 (default 3).\n" +
        "  • `resolution` 720p / 1080p (default) / 4K — 4K with motion is " +
        "the slow path.\n" +
        "  • `aspect_ratio` 16:9 (default) / 9:16 / 1:1 / 4:3; `fps` 24 / " +
        "30 (default).\n" +
        "  • `fit` — cover (default, crops to fill) / contain (letterboxes " +
        "with `pad_color`, default #000000).\n\n" +
        "Returns a job_id; widget renders the video.",
      inputSchema: {
        image_url: z.string().url().optional(),
        image_asset_id: z.string().optional(),
        audio_url: z.string().url().optional(),
        audio_asset_id: z.string().optional(),
        motion: z.enum(["none", "zoom-in", "zoom-out", "pan-left", "pan-right", "ken-burns"]).optional(),
        intensity: z.number().int().min(1).max(10).optional().describe("Motion strength 1-10 (default 3). Ignored when motion is none."),
        resolution: z.enum(["720p", "1080p", "4K"]).optional(),
        aspect_ratio: z.enum(["16:9", "9:16", "1:1", "4:3"]).optional(),
        fps: z.union([z.literal(24), z.literal(30)]).optional(),
        fit: z.enum(["cover", "contain"]).optional(),
        pad_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Letterbox color when fit=contain (default #000000)."),
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
        "ui/resourceUri": "ui://nodaro/widget/v4/job-video",
        ui: {
          resourceUri: "ui://nodaro/widget/v4/job-video",
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
      if (!imageUrl) {
        return {
          content: [{ type: "text", text: "Pass image_url or image_asset_id." }],
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
          content: [{ type: "text", text: "Pass audio_url or audio_asset_id — the audio sets the output length." }],
          isError: true,
        }
      }
      const payload: Record<string, unknown> = {
        imageUrl,
        audioUrl,
        ...(args.motion !== undefined ? { motion: args.motion } : {}),
        ...(args.intensity !== undefined ? { intensity: args.intensity } : {}),
        ...(args.resolution !== undefined ? { resolution: args.resolution } : {}),
        ...(args.aspect_ratio !== undefined ? { aspectRatio: args.aspect_ratio } : {}),
        ...(args.fps !== undefined ? { fps: args.fps } : {}),
        ...(args.fit !== undefined ? { fit: args.fit } : {}),
        ...(args.pad_color !== undefined ? { padColor: args.pad_color } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, {
        url: "/v1/still-to-video",
        payload,
        label: "still to video",
        widgetKind: "video",
        widgetData: { prompt: "(still to video)", model: "still-to-video" },
      })
    },
  )

  // ── slideshow ──
  // N stills over one optional audio track → MP4, FFmpeg-only, ZERO credits.
  // The N-image companion of still_to_video: use THAT for exactly one image.
  server.registerTool(
    "slideshow",
    {
      title: "Slideshow",
      description:
        "Turn 2–100 images + ONE optional audio track into an MP4 slideshow " +
        "— locally rendered (FFmpeg), no AI model, ZERO credits.\n\n" +
        "Timing: with audio, the output duration IS the audio's duration " +
        "(never cropped — slides split it equally unless `image_durations` " +
        "pins rows; pinned sums that mismatch the audio scale proportionally " +
        "and the factor is disclosed in the job's output). Without audio, " +
        "each slide runs `per_image_duration` seconds and the output is " +
        "silent. Transitions consume time from the outgoing slide, so the " +
        "total stays exact.\n\n" +
        "For a SINGLE image use `still_to_video`. For AI motion between " +
        "images use `generate_video` / `animate_image`.\n\n" +
        "**Levers:** `transition` (xfade vocabulary or a transition-picker " +
        "id — e.g. cut, fade, dissolve, dip-to-black, wipe-left; unknown " +
        "values fall back to cut) + `transition_duration`; `motion` none / " +
        "zoom-in / zoom-out / ken-burns / alternate (flips zoom per slide) " +
        "with `intensity` 1–10; `resolution`, `aspect_ratio`, `fps`, `fit` / " +
        "`pad_color`.\n\n" +
        "Returns a job_id; widget renders the video.",
      inputSchema: {
        image_urls: z.array(z.string().url()).min(2).max(100).optional(),
        image_asset_ids: z.array(z.string()).min(2).max(100).optional(),
        audio_url: z.string().url().optional(),
        audio_asset_id: z.string().optional(),
        image_durations: z
          .array(z.number().min(0.1).max(600).nullable())
          .max(100)
          .optional()
          .describe("Per-slide pinned seconds, one entry per image; null = auto. With audio, mismatched sums scale proportionally (disclosed)."),
        per_image_duration: z.number().min(0.5).max(60).optional().describe("Seconds per slide when NO audio is wired (default 3)."),
        transition: z.string().max(64).optional(),
        transition_duration: z.number().min(0).max(5).optional(),
        motion: z.enum(["none", "zoom-in", "zoom-out", "ken-burns", "alternate"]).optional(),
        intensity: z.number().int().min(1).max(10).optional(),
        resolution: z.enum(["720p", "1080p", "4K"]).optional(),
        aspect_ratio: z.enum(["16:9", "9:16", "1:1", "4:3"]).optional(),
        fps: z.union([z.literal(24), z.literal(30)]).optional(),
        fit: z.enum(["cover", "contain"]).optional(),
        pad_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
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
        "ui/resourceUri": "ui://nodaro/widget/v4/job-video",
        ui: {
          resourceUri: "ui://nodaro/widget/v4/job-video",
          visibility: ["model", "app"],
        },
      },
    },
    async (args) => {
      let imageUrls = args.image_urls ?? []
      if (imageUrls.length === 0 && args.image_asset_ids) {
        const resolved: string[] = []
        // Sequential on purpose — up to 100 asset lookups must not stampede.
        for (const assetId of args.image_asset_ids) {
          const url = await resolveAssetId({ assetId, userId: session.userId, expectedKind: "image" })
          if (!url) {
            return { content: [{ type: "text", text: `Unknown image asset: ${assetId}` }], isError: true }
          }
          resolved.push(url)
        }
        imageUrls = resolved
      }
      if (imageUrls.length < 2) {
        return {
          content: [{ type: "text", text: "Slideshow needs 2–100 images (image_urls or image_asset_ids). For a single still, use still_to_video." }],
          isError: true,
        }
      }
      const audioUrl =
        args.audio_url ??
        (args.audio_asset_id
          ? await resolveAssetId({ assetId: args.audio_asset_id, userId: session.userId, expectedKind: "audio" })
          : null)
      const payload: Record<string, unknown> = {
        imageUrls,
        ...(audioUrl ? { audioUrl } : {}),
        ...(args.image_durations !== undefined ? { imageDurations: args.image_durations } : {}),
        ...(args.per_image_duration !== undefined ? { perImageDuration: args.per_image_duration } : {}),
        ...(args.transition !== undefined ? { transition: args.transition } : {}),
        ...(args.transition_duration !== undefined ? { transitionDuration: args.transition_duration } : {}),
        ...(args.motion !== undefined ? { motion: args.motion } : {}),
        ...(args.intensity !== undefined ? { intensity: args.intensity } : {}),
        ...(args.resolution !== undefined ? { resolution: args.resolution } : {}),
        ...(args.aspect_ratio !== undefined ? { aspectRatio: args.aspect_ratio } : {}),
        ...(args.fps !== undefined ? { fps: args.fps } : {}),
        ...(args.fit !== undefined ? { fit: args.fit } : {}),
        ...(args.pad_color !== undefined ? { padColor: args.pad_color } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, {
        url: "/v1/slideshow",
        payload,
        label: "slideshow",
        widgetKind: "video",
        widgetData: { prompt: `(slideshow · ${imageUrls.length} images)`, model: "slideshow" },
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
        "ui/resourceUri": "ui://nodaro/widget/v4/job-video",
        ui: {
          resourceUri: "ui://nodaro/widget/v4/job-video",
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
      // list_models advertises the catalog/display ids (motion-transfer,
      // kling-3.0-motion); the /v1/motion-transfer route validates against
      // MOTION_TRANSFER_PROVIDERS (kling, kling-3.0, wan-animate-*). Map the
      // display ids → route providers and snap anything unknown to the kling
      // default so an advertised id never 400s at the route enum.
      const rawProvider = args.provider ?? "kling"
      const mappedProvider =
        MOTION_TRANSFER_PROVIDER_ALIASES[rawProvider] ?? rawProvider
      const provider = (MOTION_TRANSFER_PROVIDERS as readonly string[]).includes(mappedProvider)
        ? mappedProvider
        : "kling"
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
      return dispatchJob(fastify, session, {
        url: "/v1/motion-transfer",
        payload,
        label: "motion transfer",
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
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v4/job-video",
        ui: { resourceUri: "ui://nodaro/widget/v4/job-video", visibility: ["model", "app"] },
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

      return dispatchJob(fastify, session, { url: "/v1/face-swap", payload: { videoUrl, faceImageUrl, provider: "roop", mcp_client: session.clientName, userId: session.userId }, label: "face swap", widgetKind: "video", widgetData: { prompt: "(face swap)", model: "roop" } })
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
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v4/job-video",
        ui: { resourceUri: "ui://nodaro/widget/v4/job-video", visibility: ["model", "app"] },
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
      return dispatchJob(fastify, session, { url: "/v1/video-upscale", payload, label: "video upscale", widgetKind: "video", widgetData: { prompt: `(upscale ${args.upscale_factor ?? "2"}×)`, model: provider } })
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
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v4/job-video",
        ui: { resourceUri: "ui://nodaro/widget/v4/job-video", visibility: ["model", "app"] },
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
      return dispatchJob(fastify, session, { url: "/v1/speech-to-video", payload, label: "speech to video", widgetKind: "video", widgetData: { prompt: args.prompt.slice(0, 80), model: "wan-s2v", resolution: args.resolution ?? "480p" } })
    },
  )

  // ── video_analysis ──
  // Scene-by-scene video → structured JSON (no media output). The job-auto
  // card renders the result; the full analysis stays in the job's output_data.
  server.registerTool(
    "video_analysis",
    {
      title: "Video Analysis",
      description:
        "Analyze a video into a scene-by-scene breakdown built for AI re-creation. " +
        `Scenes are cut at natural boundaries, each at most ${VIDEO_ANALYSIS_MAX_SCENE_SEC}s ` +
        "(one image/video generation per scene). Per scene: `visualResolved` — a " +
        "self-contained, prompt-ready visual description and THE field downstream " +
        "consumers read — plus shot type, camera movement, a mode-tagged audio " +
        "track (speech quoted verbatim in the language actually spoken unless " +
        "`translate_speech_to_english` is set, music/sfx as generation-ready " +
        "descriptions, or silence), and recurring people/objects/places extracted " +
        "as castable entity slots so they can be re-cast with your own " +
        "characters. Returns a job_id — poll `get_job`; the full analysis JSON " +
        "(`meta` + `slots` + `scenes[]`) is in the job's `output_data`.\n\n" +
        "**Source** — pass EXACTLY ONE of `video_asset_id`, `video_url`, or " +
        `\`youtube_url\`. Maximum duration ${VIDEO_ANALYSIS_MAX_DURATION_SEC / 60} minutes ` +
        `(${VIDEO_ANALYSIS_MAX_DURATION_SEC}s) for any source; YouTube live streams are rejected.\n\n` +
        "**Pricing** — duration-bucketed credits per model (buckets " +
        `${VIDEO_ANALYSIS_DURATION_BUCKETS.map((b) => `≤${b}s`).join(" / ")}): ` +
        `${VIDEO_ANALYSIS_PRICING_HINT}.`,
      inputSchema: {
        video_asset_id: z.string().uuid().optional().describe("Nodaro video job id or uploaded-asset id."),
        video_url: z.string().url().optional().describe("Direct URL of a video file."),
        youtube_url: z.string().optional().describe("YouTube video URL (youtube.com / youtu.be). Max 10 minutes; no live streams."),
        llm_model: z
          .enum(VIDEO_ANALYSIS_TIER_ORDER)
          .optional()
          .describe(`Analysis quality tier. Default "pro" (higher fidelity); "fast" is cheaper. Options: ${VIDEO_ANALYSIS_TIER_ORDER.join(", ")}.`),
        selection_mode: z
          .enum(["choose", "combine"])
          .optional()
          .describe(
            'Result strategy. "choose" (default): the standard result. "combine": an enhanced, verified result with maximum captured detail (slightly slower, recommended).',
          ),
        variations: z
          .boolean()
          .optional()
          .describe(
            "Cast-variations opt-in: the analysis also detects per-entity appearance LOOKS — a plain " +
              "wardrobe change between scenes counts exactly as much as a dream / flashback / disguise / " +
              "era look — and binds each look to its scenes (`slots[].variations` + `scenes[].slotVariations`). " +
              "Default false: the result keeps the pre-variations shape.",
          ),
        music_video: z
          .boolean()
          .optional()
          .describe(
            "Declare the clip a MUSIC VIDEO: the song IS the piece, so ALL sung lyrics are transcribed " +
              "verbatim as per-scene `speech` layers (the instrumental bed stays its own `music` layer). " +
              "Default false: soundtrack vocals nobody on screen performs are folded into the `music` " +
              "layer's description, and `speech` carries only words uttered inside the story world.",
          ),
        translate_speech_to_english: z
          .boolean()
          .optional()
          .describe(
            "Translate spoken and sung words to English. Default false: speech is quoted verbatim in the language " +
              "actually spoken. Independent of `translate_on_screen_text_to_english` — set this alone for English " +
              "narration over footage whose signage stays in its original script.",
          ),
        translate_on_screen_text_to_english: z
          .boolean()
          .optional()
          .describe(
            "Translate on-screen text (signs, captions, titles) to English. Default false: transcribed verbatim in " +
              "its original script. Note this text lives in `visual`, the generation prompt — so translating it means " +
              "a regenerated shot renders the English wording. Brand, product, person, and place names keep their " +
              "original form under both flags, and the result's `language` always reports the language actually " +
              "spoken in the footage.",
          ),
        analysis_focus: z
          .string()
          .max(2000)
          .optional()
          .describe("Optional steer for the analysis (e.g. 'focus on the product shots and on-screen text')."),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: uiMeta(WIDGET_URI.jobAuto),
    },
    async (args) => {
      // EXACTLY-ONE source — deliberately stricter than the route's precedence
      // rule (there, a stale youtubeUrl in node data must not reject a wired
      // videoUrl). MCP args are explicit, so two sources is caller ambiguity
      // worth surfacing — name what was provided so the LLM can self-correct.
      const provided = [
        args.video_asset_id ? "video_asset_id" : null,
        args.video_url ? "video_url" : null,
        args.youtube_url ? "youtube_url" : null,
      ].filter((s): s is string => s !== null)
      if (provided.length !== 1) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                provided.length === 0
                  ? "Pass exactly one of video_asset_id, video_url, or youtube_url (none provided)."
                  : `Pass exactly one of video_asset_id, video_url, or youtube_url — got ${provided.join(" + ")}.`,
            },
          ],
          isError: true,
        }
      }

      let videoUrl = args.video_url
      if (args.video_asset_id) {
        // resolveAssetId throws on not-found / foreign-user / wrong-kind ids
        // (loud-fail, same contract as every sibling *_asset_id param).
        videoUrl =
          (await resolveAssetId({ assetId: args.video_asset_id, userId: session.userId, expectedKind: "video" })) ??
          undefined
        if (!videoUrl) {
          return { content: [{ type: "text" as const, text: "Could not resolve video_asset_id to a video URL." }], isError: true }
        }
      }

      const payload: Record<string, unknown> = {
        ...(videoUrl ? { videoUrl } : {}),
        ...(args.youtube_url ? { youtubeUrl: args.youtube_url } : {}),
        ...(args.llm_model ? { llmModel: args.llm_model } : {}),
        ...(args.selection_mode ? { selectionMode: args.selection_mode } : {}),
        ...(args.variations ? { variations: true } : {}),
        ...(args.music_video ? { musicVideo: true } : {}),
        ...(args.translate_speech_to_english ? { translateSpeechToEnglish: true } : {}),
        ...(args.translate_on_screen_text_to_english ? { translateOnScreenTextToEnglish: true } : {}),
        ...(args.analysis_focus ? { analysisFocus: args.analysis_focus } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, {
        url: "/v1/video-analysis",
        payload,
        label: "Video analysis",
        widgetKind: "generic",
        widgetData: {
          prompt: args.analysis_focus ? args.analysis_focus.slice(0, 80) : "(video analysis)",
          model: args.llm_model ?? DEFAULT_VIDEO_ANALYSIS_TIER,
        },
      })
    },
  )

  // ── video_audit ──
  // Re-watch a clip against its analysis and fix what's wrong — "fix and
  // disclose": corrections are applied under guards and every one of them is
  // reported, nothing is silently rewritten. Same job-auto card / no-media-
  // output shape as video_analysis (the job's output_data carries the report).
  server.registerTool(
    "video_audit",
    {
      title: "Video Audit",
      description:
        "Re-watch a video against its analysis (the AI Audit node's server-side twin) and " +
        "fix what's wrong — a fix-and-disclose pass, not a silent rewrite. Corrections are " +
        "applied under guards and every one is reported: the job's `output_data` carries a " +
        "disclosed report of what was checked, what changed, and what was left open (flagged, " +
        "not auto-fixed). Returns a job_id — poll `get_job` for the report.\n\n" +
        "**Analysis** — pass `analysis` (the JSON result — `meta` + `slots` + `scenes[]` — " +
        "from a prior `video_analysis` or `video_audit` call) to re-verify that analysis " +
        "against the actual footage. Omit it and the tool auto-runs a fast analysis first, " +
        "then audits that.\n\n" +
        "**Pricing** — duration-bucketed credits per family (buckets " +
        `${VIDEO_ANALYSIS_DURATION_BUCKETS.map((b) => `≤${b}s`).join(" / ")}), selected by ` +
        `whether \`analysis\` was passed: ${VIDEO_AUDIT_PRICING_HINT}.`,
      inputSchema: {
        video_url: z.string().url().describe("Direct URL of the video to audit."),
        analysis: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "The analysis JSON from a prior video_analysis or video_audit call, passed " +
              "through verbatim. Wiring this prices the cheaper `video-audit` family; omit " +
              "it and the tool auto-runs a fast analysis first (the pricier `video-audit:auto` family).",
          ),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: uiMeta(WIDGET_URI.jobAuto),
    },
    async (args) => {
      const payload: Record<string, unknown> = {
        videoUrl: args.video_url,
        ...(args.analysis ? { analysis: args.analysis } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, {
        url: "/v1/video-audit",
        payload,
        label: "Video audit",
        widgetKind: "generic",
        widgetData: {
          prompt: args.analysis ? "(re-audit wired analysis)" : "(auto-run analysis + audit)",
        },
      })
    },
  )

  // ── stop_video_pro (graceful stop of a segmented pro run) ──
  server.registerTool(
    "stop_video_pro",
    {
      title: "Stop Video Pro Run",
      description:
        "Gracefully stop a RUNNING generate-video-pro job (the segmented long-video engine). " +
        "The engine abandons the segment currently generating (that segment is still billed — " +
        "the provider keeps rendering it), skips all remaining segments, stitches everything " +
        "completed so far into the job's FINAL video, and refunds the untouched remainder of " +
        "the credit reserve. A job that hasn't started yet is cancelled with a full refund. " +
        "Poll the job with get_job — it completes with output_data.pro.stopped=true and the " +
        "partial video as its result. Resume later with continue_video_pro.",
      inputSchema: {
        job_id: z.string().describe("The generate-video-pro job id to stop."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const res = await fastify.inject({
        method: "POST",
        url: `/v1/generate-video-pro/${encodeURIComponent(args.job_id)}/stop`,
        headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET },
        payload: { userId: session.userId },
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      return { content: [{ type: "text" as const, text: res.body }] }
    },
  )

  // ── continue_video_pro (resume a pro run from a segment) ──
  server.registerTool(
    "continue_video_pro",
    {
      title: "Continue Video Pro Run",
      description:
        "Continue a stopped, failed (with at least one delivered segment), or completed " +
        "generate-video-pro run as a NEW job. Segments before from_segment are reused from " +
        "the original run; everything from it on is regenerated (overriding the original's " +
        "takes). Billed only for the regenerated segments plus the flat pro fee. Omit " +
        "from_segment to continue from the first not-yet-delivered segment; pass an earlier " +
        "one to redo from that point (works on fully completed runs too — a tail re-roll). " +
        "Returns the NEW job_id to poll.",
      inputSchema: {
        job_id: z.string().describe("The original generate-video-pro job id."),
        from_segment: z.number().int().min(1).max(24).optional()
          .describe("1-based segment to regenerate from. Default: first missing segment."),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v4/job-video",
        ui: { resourceUri: "ui://nodaro/widget/v4/job-video", visibility: ["model", "app"] },
      },
    },
    async (args) => {
      const payload: Record<string, unknown> = {
        fromJobId: args.job_id,
        ...(args.from_segment !== undefined ? { fromSegment: args.from_segment } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, {
        url: "/v1/generate-video-pro/continue",
        payload,
        label: "video-pro continue",
        widgetKind: "video",
        widgetData: { prompt: `(continue ${args.job_id.slice(0, 8)}…${args.from_segment !== undefined ? ` from segment ${args.from_segment}` : ""})` },
      })
    },
  )
}
