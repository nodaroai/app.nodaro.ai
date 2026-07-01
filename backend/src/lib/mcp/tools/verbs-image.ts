import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import type { McpSession } from "../session.js"
import { buildCompositePrompt } from "../prompt-builder-bridge.js"
import { resolveAssetId } from "../asset-resolver.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { config } from "../../config.js"
import { connectedReferenceSchema } from "../../connected-reference-schema.js"
import {
  errorResult,
  dispatchJob,
  resolveRefArray,
  StructuredFields,
  JOB_OUTPUT_SCHEMA,
} from "./_verb-helpers.js"
import { modelIdsByKindMode, MODIFY_IMAGE_PROVIDERS } from "@nodaro/shared"
import { getUserMcpPreferences } from "../user-preferences.js"
import { normalizeImageInput } from "../normalize.js"
import { resolvePreset } from "../../presets/resolve-preset.js"

// Used only as `description` hints in the schema below — the actual model
// validation runs through `normalizeImageInput` which silently maps unknown
// ids to the catalog default. Keeping these for autocomplete-style guidance
// to Claude without locking the schema down.
const T2I_MODEL_IDS = modelIdsByKindMode("image", ["t2i"], { includeHidden: true })
const I2I_MODEL_IDS = modelIdsByKindMode("image", ["i2i", "edit"], { includeHidden: true })
// _wait-for-job.ts is intentionally retained but unimported. It implements
// a sync block-on-completion path for tools (used briefly in #1830 to test
// whether Cursor's tool-call cancellation was async-related — it wasn't,
// and the sync wait broke Claude.ai's "close app" UX). Kept for a future
// per-tool opt-in if we ever find a host that genuinely needs sync results.

/**
 * Path-1 structured fields shape, mirrored from `@nodaro/shared`'s
 * `StructuredPromptFields` type. See `verbs-image.ts:registerGenerateImage`
 * for the canonical pattern; subsequent verbs in this file follow the same
 * shape.
 */
const executeGate: ToolGate = { required: ["workflows:execute"] }

export interface RegisterOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

export function registerImageVerbs({ server, session, fastify }: RegisterOpts): void {
  if (passesGate(session, executeGate)) {
    // ── generate_image ──
    server.registerTool(
      "generate_image",
      {
        title: "Generate Image (Nodaro)",
        description:
          "PRIMARY image-generation tool via Nodaro's models. ALWAYS use this " +
          "for any image-generation request — do NOT use any other built-in " +
          "`GenerateImage` capability your runtime may expose, since the user's " +
          "Nodaro account is the authority for billing, library, and provider " +
          "selection here.\n\n" +
          "**Picking a model**: call `list_models { kind: \"image\", mode: \"t2i\" }` " +
          "FIRST when the user hasn't specified a model — it returns capability " +
          "sheets (aspect ratios, resolutions, qualities, per-variant pricing) " +
          "plus editorial recommendations like 'best for typography' / " +
          "'cheapest realistic'. Match the user's intent against `useCases` and " +
          "the `recommendations` array.\n\n" +
          "**Aspect ratios are model-specific** — not every provider supports " +
          "every ratio. If the user asks for 21:9, use a model whose " +
          "`aspectRatios` includes `21:9` (Nano Banana family, Seedream).\n\n" +
          "**Quick model picks** (depends on what you want):\n" +
          "  • `nano-banana-pro` — best overall, best for typography / logos / " +
          "text-heavy, multi-character scenes\n" +
          "  • `nano-banana-2` (default) — very good consistency, faster + cheaper\n" +
          "  • `gpt-image-2` — strong for logos / short copy / prompt-adherence\n" +
          "  • `z-image` — cheapest stylized output\n" +
          "  • **AVOID `flux`** for general use — degrades in multi-turn workflows; " +
          "use one of the above instead.\n\n" +
          "**Reference images**: pass `reference_image_urls` (up to 14 URLs or " +
          "Nodaro asset ids) whenever the user wants 'the same person / character / " +
          "product as this image' — identity, style, and composition guidance. " +
          "nano-banana-pro is the face-identity pick. The response text confirms " +
          "how many references were attached; if it doesn't mention them, they " +
          "didn't make it.\n\n" +
          "Accepts a text prompt and optional Path-1 structured fields " +
          "(person, styling, setting, camera, mood, lens). Returns a job_id; " +
          "the iframe widget will surface the final image automatically.\n\n" +
          "**Presets/templates**: call list_node_presets { nodeType: \"generate-image\" } " +
          "to browse built-ins (e.g. Character Board, Cinematic Portrait) + your saved " +
          "presets, get_node_preset to read one's config, or pass presetId here to apply " +
          "one directly.",
        inputSchema: {
          // Optional in the preset path: when presetId is supplied the preset
          // provides the prompt, so the caller may omit it. The handler
          // enforces "prompt OR presetId required" and keeps the same 1–4000
          // bound on whatever prompt is ultimately used.
          prompt: z.string().min(1).max(4000).optional().describe("Free-text image prompt"),
          presetId: z
            .string()
            .min(1)
            .max(200)
            .optional()
            .describe(
              "Apply a built-in/custom preset by id from list_node_presets; " +
              "explicit fields below override it.",
            ),
          // Schemas are intentionally permissive — handler normalizes
          // anything unknown to the closest valid value (silent fallback).
          // Description carries the recommended set so Claude has guidance.
          model: z
            .string()
            .optional()
            .describe(
              `Image model. Default nano-banana-2. Recommended: ${T2I_MODEL_IDS.join(", ")}. ` +
              `Unknown values silently fall back to the default. ` +
              `Call list_models for capability details.`,
            ),
          resolution: z
            .string()
            .optional()
            .describe("Resolution: 1K / 2K / 4K. Falls back to nearest supported value."),
          quality: z
            .string()
            .optional()
            .describe("Quality: medium / high (model-dependent). Synonyms accepted."),
          aspect_ratio: z
            .string()
            .optional()
            .describe(
              "Aspect ratio (e.g. 16:9, 9:16, 1:1, 4:3, 3:4, 21:9). Default 16:9. " +
              "Variations like 16x9 / 16-9 are accepted; unsupported values fall back.",
            ),
          negative_prompt: z.string().max(2000).optional(),
          reference_image_urls: z
            .union([z.array(z.string()), z.string()])
            .optional()
            .describe(
              "Reference images (URLs or Nodaro asset ids, up to 14) for identity / " +
              "style / composition guidance — use whenever the output must match a " +
              "given person, character, or product. Accepts an array; a lone URL or " +
              "a JSON-stringified array is tolerated and coerced.",
            ),
          base_image_url: z.string().url().optional().describe("Image to edit; the masked region is regenerated and composited back over it. Enables inpaint."),
          mask_url: z.string().url().optional().describe("Inpainting mask image URL (white=edit, black=keep). Requires base_image_url."),
          strength: z.number().min(0).max(1).optional().describe("How much the prompt overrides the base image (0=subtle, 1=full repaint). Provider-dependent."),
          guidance_scale: z.number().min(0).max(20).optional().describe("Guidance scale (provider-dependent)."),
          structured: StructuredFields.optional().describe(
            "Path-1 structured fields composed into the final prompt.",
          ),
          connected_references: z.array(connectedReferenceSchema).max(14).optional()
            .describe(
              "Advanced structured references — the editor's wired-reference shape (each needs at least " +
              "{id, defaultName, source, url}, url a public https URL). Assembled server-side into per-ref " +
              "@image_N directives + {image:N} token resolution (labeled/ordered refs, unlike flat " +
              "reference_image_urls).",
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
          // Saved-pref snapshot the widget reads to render the favorite-
          // settings star next to the metadata badges. Strict clients
          // (Cursor) cache outputSchema via tools/list — re-fetch the tool
          // list (refresh Cursor / reconnect) after this field is added or
          // the cached schema rejects the new property as "additional".
          userDefaults: z
            .object({
              model: z.string().optional(),
              aspectRatio: z.string().optional(),
              resolution: z.string().optional(),
              quality: z.string().optional(),
            })
            .optional(),
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
        // ── Preset application (server-side, faithful) ──────────────────────
        // When the caller passes `presetId`, resolve the preset's tuned config
        // (factory catalog, or the caller's own custom preset — owner-scoped)
        // and use it as the BASE; only fields the CALLER actually provided
        // override it. The schema has NO `.default()` on any field, so an
        // absent caller value is exactly `undefined` here — that's what lets a
        // defaulted-but-not-passed lever lose to the preset (the critical
        // override rule). Preset `data` is already extractPresetData-stripped.
        //
        // The preset's keys mirror the node's data fields (camelCase:
        // provider / aspectRatio / negativePrompt / …); we map them onto THIS
        // handler's snake_case param namespace so the rest of the handler can
        // read `effective` exactly as it read `args`.
        let effective: Record<string, unknown> = { ...args }
        if (args.presetId) {
          const preset = await resolvePreset({
            nodeType: "generate-image",
            presetId: args.presetId,
            userId: session.userId,
          })
          if (!preset) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Preset not found: ${args.presetId}. List ids with list_node_presets { nodeType: "generate-image" }.`,
                },
              ],
              isError: true as const,
            }
          }
          // preset.data (camelCase node-data keys) → this handler's params.
          const d = preset.data
          const presetParams: Record<string, unknown> = {}
          if (d.provider !== undefined) presetParams.model = d.provider
          if (d.prompt !== undefined) presetParams.prompt = d.prompt
          if (d.aspectRatio !== undefined) presetParams.aspect_ratio = d.aspectRatio
          if (d.resolution !== undefined) presetParams.resolution = d.resolution
          if (d.quality !== undefined) presetParams.quality = d.quality
          if (d.negativePrompt !== undefined) presetParams.negative_prompt = d.negativePrompt
          // Carry portable node-data fields a custom preset may have captured
          // that THIS handler actually forwards (factory image presets don't
          // set these, but extractPresetData keeps them for user-saved presets
          // — apply them faithfully). `seed` is intentionally NOT mapped: the
          // generate_image payload has no seed lever, so it would be dead.
          if (d.referenceImageUrls !== undefined) presetParams.reference_image_urls = d.referenceImageUrls
          if (d.strength !== undefined) presetParams.strength = d.strength
          if (d.guidanceScale !== undefined) presetParams.guidance_scale = d.guidanceScale
          // Preset is the base; only caller-PROVIDED fields win. `args[k] !==
          // undefined` precisely means "the caller passed it" here (no defaults).
          const callerProvided = Object.fromEntries(
            Object.entries(args).filter(([, v]) => v !== undefined),
          )
          effective = { ...presetParams, ...callerProvided }
        }
        // `presetId` is a control field — never submit it to the provider.
        delete effective.presetId

        // Prompt is required once a preset hasn't supplied one. (The schema
        // relaxes prompt to optional for the preset path; guard the no-preset
        // bare call so it still fails clearly instead of generating empty.)
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

        // Silent normalization — never reject on bad params. Anything
        // Claude sends (typos, wrong-tier values, made-up model ids) gets
        // mapped to the closest valid alternative or the catalog default.
        // The user said: tool calls should never fail because of param
        // values; they should always run with sensible substitutes.
        let userImg: Record<string, string | undefined> = {}
        try {
          const userPrefs = await getUserMcpPreferences(session.userId)
          userImg = (userPrefs.image as Record<string, string | undefined>) ?? {}
        } catch {
          // Pref read failed (DB blip, missing column) → proceed with no saved prefs.
        }
        const { model, aspectRatio, resolution, quality, modelEntry: _modelEntry } =
          normalizeImageInput(
            {
              model: effective.model as string | undefined,
              aspect_ratio: effective.aspect_ratio as string | undefined,
              resolution: effective.resolution as string | undefined,
              quality: effective.quality as string | undefined,
            },
            {
              model: userImg.model,
              aspectRatio: userImg.aspectRatio,
              resolution: userImg.resolution,
              quality: userImg.quality,
            },
            "nano-banana-2",
          )

        const compositePrompt = buildCompositePrompt(
          effective.prompt as string,
          effective.structured as Parameters<typeof buildCompositePrompt>[1],
        )
        // Tolerant: array | JSON-string | lone URL; asset ids resolved to URLs.
        // The route's referenceImageUrls schema is URL-only (max 14).
        const refUrls = await resolveRefArray(effective.reference_image_urls, session.userId, "image", 14)
        const payload = {
          prompt: compositePrompt,
          provider: model,
          aspectRatio,
          resolution,
          quality,
          negativePrompt: effective.negative_prompt as string | undefined,
          ...(refUrls.length ? { referenceImageUrls: refUrls } : {}),
          ...(args.connected_references ? { connectedReferences: args.connected_references } : {}),
          ...(args.reference_order ? { referenceOrder: args.reference_order } : {}),
          ...(effective.base_image_url ? { baseImageUrl: effective.base_image_url } : {}),
          ...(effective.mask_url ? { maskUrl: effective.mask_url } : {}),
          ...(effective.strength !== undefined ? { strength: effective.strength } : {}),
          ...(effective.guidance_scale !== undefined ? { guidanceScale: effective.guidance_scale } : {}),
          mcp_client: session.clientName,
          userId: session.userId,
        }

        return dispatchJob(fastify, session, {
          url: "/v1/generate-image",
          payload,
          // Ref count in the label = visible confirmation in the response
          // text, so a silently-dropped reference can't masquerade as success.
          label: refUrls.length
            ? `image generation (using ${refUrls.length} reference image${refUrls.length === 1 ? "" : "s"})`
            : "image generation",
          widgetKind: "image",
          widgetData: {
            prompt: compositePrompt,
            model,
            aspectRatio,
            resolution,
            userDefaults: {
              model: userImg.model,
              aspectRatio: userImg.aspectRatio,
              resolution: userImg.resolution,
              quality: userImg.quality,
            },
          },
        })
      },
    )

    // ── modify_image (image-to-image) ──
    server.registerTool(
      "modify_image",
      {
        title: "Modify Image",
        description:
          "PRIMARY tool for image-to-image / edit / transform / restyle / " +
          "outpaint / inpaint workflows. Use this directly — do NOT search the " +
          "apps marketplace for image editing.\n\n" +
          "**Picking a model** — depends on the task. Call " +
          "`list_models { kind: \"image\", mode: \"i2i\" }` or `mode: \"edit\"` for " +
          "the full capability sheets. Quick guidance:\n" +
          "  • **`nano-banana-pro`** — best overall + best for face/character " +
          "identity preservation across multi-turn edits. Handles up to 14 " +
          "reference images and ~5 distinct characters. Also leads on text/" +
          "typography. First pick when in doubt.\n" +
          "  • **`nano-banana-2`** (default) — very good consistency, faster " +
          "and cheaper than Pro. Good cost-effective default.\n" +
          "  • **`gpt-image-2`** — strong for typography / logos / text-heavy " +
          "edits and prompt-adherence-critical work. Solid alternative when " +
          "Nano Banana family doesn't nail a specific case.\n" +
          "  • **`ideogram-remix`** — character-aware, good for stylized remix.\n" +
          "  • **`seedream-edit`** — high-res output for instruction-style edits.\n" +
          "  • **`recraft-remove-bg`** — background removal (1 credit, no prompt).\n" +
          "  • **AVOID `flux-kontext`** for general use — degrades quickly across " +
          "multi-turn edits in practice. Only consider for one-shot texture-heavy " +
          "edits, and even then prefer Nano Banana Pro.\n\n" +
          "Provide ONE of:\n" +
          "  (a) `image_url` — any publicly fetchable HTTPS URL\n" +
          "  (b) `image_asset_id` — a Nodaro job id whose output is an image\n\n" +
          "**Getting a URL for a user-attached image** (bytes only in chat, no URL yet):\n\n" +
          "Path A (preferred — Claude.ai web/Android with widget rendering): " +
          "`upload_image_widget` → opens an in-chat file picker. Supports " +
          "multi-file via `max_files` (e.g. character training, headshot " +
          "sets). The widget uploads the file(s) and auto-announces the " +
          "resulting URL(s) in chat — wait for that announcement, then call " +
          "this tool with `public_url` as `image_url`.\n\n" +
          "Path B (Apps clients without widget UI): `request_image_upload` " +
          "→ returns `{ upload_page_url, public_url }`. Render a download " +
          "link/button for the attached image AND the `upload_page_url`. " +
          "The user saves the image to disk, drops it on the upload page " +
          "(in their own browser, outside any sandbox), confirms.\n\n" +
          "Path C (only for non-sandboxed CLI clients — Cursor, Cline, " +
          "Claude Desktop, Claude Code CLI): `prepare_image_upload` → " +
          "`curl -X PUT --data-binary @<path> -H 'Content-Type: <mime>' " +
          "'<upload_url>'`. Streams disk → R2 directly. Will 403 on " +
          "Claude.ai web (egress proxy blocks all object-storage hosts), " +
          "use Path A or B there.",
        inputSchema: {
          prompt: z.string().min(1).max(8000),
          image_url: z.string().url().optional(),
          image_asset_id: z.string().optional(),
          model: z
            .string()
            .optional()
            .describe(
              `I2I / edit model. Default nano-banana-2. Recommended: ${I2I_MODEL_IDS.join(", ")}. ` +
              `For identity-preserving edits use flux-kontext. Unknown values fall back. ` +
              `Call list_models for capability details.`,
            ),
          resolution: z.string().optional().describe("Resolution: falls back to nearest supported."),
          quality: z.string().optional().describe("Quality: medium/high/basic. Synonyms accepted."),
          aspect_ratio: z.string().optional().describe("Aspect ratio. Variations and unsupported values fall back."),
          negative_prompt: z.string().max(2000).optional(),
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
          // Saved-pref snapshot the widget reads to render the favorite-
          // settings star next to the metadata badges. Strict clients
          // (Cursor) cache outputSchema via tools/list — re-fetch the tool
          // list (refresh Cursor / reconnect) after this field is added or
          // the cached schema rejects the new property as "additional".
          userDefaults: z
            .object({
              model: z.string().optional(),
              aspectRatio: z.string().optional(),
              resolution: z.string().optional(),
              quality: z.string().optional(),
            })
            .optional(),
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
        let userImg: Record<string, string | undefined> = {}
        try {
          const userPrefs = await getUserMcpPreferences(session.userId)
          userImg = (userPrefs.image as Record<string, string | undefined>) ?? {}
        } catch {
          /* swallow */
        }
        const { model, aspectRatio, resolution, quality } = normalizeImageInput(
          {
            model: args.model,
            aspect_ratio: args.aspect_ratio,
            resolution: args.resolution,
            quality: args.quality,
          },
          {
            model: userImg.model,
            aspectRatio: userImg.aspectRatio,
            resolution: userImg.resolution,
            quality: userImg.quality,
          },
          "nano-banana-2",
        )

        // The /v1/image-to-image route validates against MODIFY_IMAGE_PROVIDERS.
        // normalizeImageInput keeps any valid catalog id verbatim — including
        // edit-only models (recraft-remove-bg, gpt-image-2) that this i2i route
        // can't run. Snap anything outside the accepted set to the default so an
        // advertised-but-unsupported model degrades to a working edit, not a 400.
        const provider = (MODIFY_IMAGE_PROVIDERS as readonly string[]).includes(model)
          ? model
          : "nano-banana-2"

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
              {
                type: "text",
                text: "Either image_url or image_asset_id is required",
              },
            ],
            isError: true,
          }
        }

        const compositePrompt = buildCompositePrompt(args.prompt, args.structured)
        const payload = {
          imageUrl,
          prompt: compositePrompt,
          provider,
          aspectRatio,
          resolution,
          quality,
          negativePrompt: args.negative_prompt,
          mcp_client: session.clientName,
          userId: session.userId,
        }

        return dispatchJob(fastify, session, {
          url: "/v1/image-to-image",
          payload,
          label: "image-to-image",
          widgetKind: "image",
          widgetData: {
            prompt: compositePrompt,
            model: provider,
            aspectRatio,
            resolution,
            userDefaults: {
              model: userImg.model,
              aspectRatio: userImg.aspectRatio,
              resolution: userImg.resolution,
              quality: userImg.quality,
            },
          },
        })
      },
    )

    // ── save_image_defaults ──
    // Persist sticky picks for image generation. Triggered by the widget's
    // "Save as default" chip via NodaroMCP.suggestTool — Claude relays the
    // call here, we PATCH /v1/user/settings, and the next image tool call
    // reads from the updated user preferences.
    server.registerTool(
      "save_image_defaults",
      {
        title: "Save as image default",
        description:
          "Save the user's preferred image-generation settings (model, " +
          "aspect ratio, resolution, quality). Sparse — only saves the " +
          "fields you pass, leaving others untouched. Pass `null` for a " +
          "field to clear that preference and fall back to the catalog " +
          "default. Triggered by the in-widget \"Save as default\" chip; " +
          "you can also call this directly when the user explicitly says " +
          "\"always use X for images\".",
        inputSchema: {
          model: z.string().nullable().optional(),
          aspect_ratio: z.string().nullable().optional(),
          resolution: z.string().nullable().optional(),
          quality: z.string().nullable().optional(),
        },
        annotations: { readOnlyHint: false },
      },
      async (args) => {
        const image: Record<string, string | null> = {}
        if (args.model !== undefined) image.model = args.model
        if (args.aspect_ratio !== undefined) image.aspectRatio = args.aspect_ratio
        if (args.resolution !== undefined) image.resolution = args.resolution
        if (args.quality !== undefined) image.quality = args.quality

        if (Object.keys(image).length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "Nothing to save — pass at least one of model / aspect_ratio / resolution / quality.",
              },
            ],
            isError: true,
          }
        }

        const res = await fastify.inject({
          method: "PATCH",
          url: "/v1/user/settings",
          headers: {
            "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
          },
          // userId in body is how the internal-secret auth path resolves
          // req.userId — see middleware/auth.ts.
          payload: { mcpPreferences: { image }, userId: session.userId },
        })

        if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)

        const summary = Object.entries(image)
          .map(([k, v]) => (v === null ? `${k} cleared` : `${k}=${v}`))
          .join(", ")
        return {
          content: [
            { type: "text" as const, text: `Saved image defaults: ${summary}.` },
          ],
        }
      },
    )
  }
  if (!passesGate(session, executeGate)) return

  // ── image_to_image ──
  server.registerTool(
    "image_to_image",
    {
      title: "Image to Image",
      description:
        "Transform an image guided by a text prompt (img2img). Supports style " +
        "transfer, re-styling, inpainting with a mask, and multi-reference " +
        "composition. Returns a job_id.\n\n" +
        "**Recommended models**: nano-banana (default, fast+cheap), nano-banana-2, " +
        "flux-kontext (photorealistic edits), gpt-image-i2i (creative repaints), " +
        "flux-i2i, ideogram-remix. Call `list_models { kind: \"image\", mode: \"i2i\" }` " +
        "for the full list.",
      inputSchema: {
        image_url: z.string().url().optional().describe("Source image URL."),
        image_asset_id: z.string().optional().describe("Nodaro image job id."),
        prompt: z.string().min(1).max(2000).describe("Transformation description."),
        model: z.string().optional().describe(
          `img2img model. Default nano-banana. Options: ${I2I_MODEL_IDS.join(", ")}. Unknown values fall back to nano-banana.`,
        ),
        reference_image_urls: z
          .union([z.array(z.string()), z.string()])
          .optional()
          .describe(
            "Extra reference images (URLs or Nodaro asset ids, up to 13) for multi-ref " +
            "models — asset ids are resolved server-side. Accepts an array; a lone URL " +
            "or a JSON-stringified array is coerced.",
          ),
        resolution: z.enum(["1K", "2K", "4K"]).optional(),
        quality: z.enum(["medium", "high", "basic"]).optional(),
        strength: z.number().min(0).max(1).optional().describe("How much the prompt overrides the source image (0=subtle, 1=full repaint)."),
        aspect_ratio: z.string().optional(),
        negative_prompt: z.string().max(5000).optional(),
        seed: z.number().int().min(0).optional(),
        mask_url: z.string().url().optional().describe("Inpainting mask image URL (white=edit, black=keep)."),
      },
      outputSchema: {
        jobId: z.string(),
        prompt: z.string().optional(),
        model: z.string().optional(),
        outputUrl: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v4/job-image",
        ui: { resourceUri: "ui://nodaro/widget/v4/job-image", visibility: ["model", "app"] },
      },
    },
    async (args) => {
      const imageUrl =
        args.image_url ??
        (args.image_asset_id
          ? await resolveAssetId({ assetId: args.image_asset_id, userId: session.userId, expectedKind: "image" })
          : null)
      if (!imageUrl) return { content: [{ type: "text" as const, text: "Pass image_url or image_asset_id." }], isError: true }

      // Resolve asset ids → URLs (route's referenceImageUrls is URL-only);
      // tolerant of array | lone string | JSON-stringified array inputs.
      const i2iRefs = await resolveRefArray(args.reference_image_urls, session.userId, "image", 13)
      const payload: Record<string, unknown> = {
        imageUrl,
        prompt: args.prompt,
        provider: args.model ?? "nano-banana",
        ...(i2iRefs.length ? { referenceImageUrls: i2iRefs } : {}),
        ...(args.resolution ? { resolution: args.resolution } : {}),
        ...(args.quality ? { quality: args.quality } : {}),
        ...(args.strength !== undefined ? { strength: args.strength } : {}),
        ...(args.aspect_ratio ? { aspectRatio: args.aspect_ratio } : {}),
        ...(args.negative_prompt ? { negativePrompt: args.negative_prompt } : {}),
        ...(args.seed !== undefined ? { seed: args.seed } : {}),
        ...(args.mask_url ? { maskUrl: args.mask_url } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, { url: "/v1/image-to-image", payload, label: "image to image", widgetKind: "image", widgetData: { prompt: args.prompt, model: args.model ?? "nano-banana" } })
    },
  )

  // ── edit_image ──
  server.registerTool(
    "edit_image",
    {
      title: "Edit Image",
      description:
        "Upscale, remove background, or apply AI edits to an image. Returns a job_id.\n\n" +
        "**Models by operation**:\n" +
        "  • `recraft-upscale` (default) — high-quality upscale, no prompt needed.\n" +
        "  • `topaz-image-upscale` — Topaz AI upscale (1×/2×/4×).\n" +
        "  • `recraft-remove-bg` — remove background, returns PNG with transparency.\n" +
        "  • `nano-banana-edit` — AI-guided edit with a prompt (inpainting/outpainting).\n" +
        "  • `grok-upscale` — Grok creative upscale (pass kie_task_id from prior Grok generation instead of image_url).",
      inputSchema: {
        image_url: z.string().url().optional().describe("Source image URL (all providers except grok-upscale)."),
        image_asset_id: z.string().optional().describe("Nodaro image job id."),
        model: z.enum(["recraft-upscale", "topaz-image-upscale", "recraft-remove-bg", "nano-banana-edit", "grok-upscale"]).optional().describe("Edit operation. Default recraft-upscale."),
        upscale_factor: z.enum(["1", "2", "4"]).optional().describe("Upscale factor (for topaz-image-upscale). Default 2."),
        target_resolution: z.enum(["2K", "4K", "8K"]).optional().describe("Target output resolution."),
        prompt: z.string().max(2000).optional().describe("Edit prompt (required for nano-banana-edit)."),
        kie_task_id: z.string().optional().describe("KIE task id from prior Grok generation (required for grok-upscale instead of image_url)."),
        negative_prompt: z.string().max(5000).optional(),
        style: z.string().max(500).optional(),
        seed: z.number().int().min(0).optional(),
        mask_url: z.string().url().optional().describe("Inpainting mask (white=edit). Used by nano-banana-edit."),
      },
      // Superset schema — edit_image emits prompt+model in structuredContent
      // (the prompt fallback `(${provider})` is unconditional), so the previous
      // {jobId,model,outputUrl} schema omitted `prompt` and strict clients
      // (Cursor) rejected every result. Matches the sibling verbs.
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v4/job-image",
        ui: { resourceUri: "ui://nodaro/widget/v4/job-image", visibility: ["model", "app"] },
      },
    },
    async (args) => {
      const provider = args.model ?? "recraft-upscale"
      const isGrokUpscale = provider === "grok-upscale"

      if (isGrokUpscale && !args.kie_task_id) {
        return { content: [{ type: "text" as const, text: "grok-upscale requires kie_task_id from the original Grok image generation." }], isError: true }
      }
      if (provider === "nano-banana-edit" && !args.prompt) {
        return { content: [{ type: "text" as const, text: "nano-banana-edit requires a prompt." }], isError: true }
      }

      const imageUrl =
        args.image_url ??
        (args.image_asset_id
          ? await resolveAssetId({ assetId: args.image_asset_id, userId: session.userId, expectedKind: "image" })
          : null)
      if (!isGrokUpscale && !imageUrl) {
        return { content: [{ type: "text" as const, text: "Pass image_url or image_asset_id." }], isError: true }
      }

      const payload: Record<string, unknown> = {
        provider,
        ...(imageUrl ? { imageUrl } : {}),
        ...(args.kie_task_id ? { taskId: args.kie_task_id } : {}),
        ...(args.upscale_factor ? { upscaleFactor: args.upscale_factor } : {}),
        ...(args.target_resolution ? { targetResolution: args.target_resolution } : {}),
        ...(args.prompt ? { prompt: args.prompt } : {}),
        ...(args.negative_prompt ? { negativePrompt: args.negative_prompt } : {}),
        ...(args.style ? { style: args.style } : {}),
        ...(args.seed !== undefined ? { seed: args.seed } : {}),
        ...(args.mask_url ? { maskUrl: args.mask_url } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, { url: "/v1/edit-image", payload, label: "edit image", widgetKind: "image", widgetData: { prompt: args.prompt ?? `(${provider})`, model: provider } })
    },
  )

  // ── generate_mask ──
  server.registerTool(
    "generate_mask",
    {
      title: "Generate Mask",
      description:
        "Generate a binary segmentation mask for an image by describing what to select. " +
        "Returns a job_id with a black-and-white PNG mask (white=selected region). " +
        "Use the mask with edit_image or image_to_image for inpainting.",
      inputSchema: {
        image_url: z.string().url().optional().describe("Source image URL."),
        image_asset_id: z.string().optional().describe("Nodaro image job id."),
        prompt: z.string().min(1).max(500).describe("What to mask (e.g. 'the person' or 'sky and clouds')."),
        threshold: z.number().min(0).max(1).optional().describe("Segmentation confidence threshold (0–1). Default 0.3."),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v4/job-image",
        ui: { resourceUri: "ui://nodaro/widget/v4/job-image", visibility: ["model", "app"] },
      },
    },
    async (args) => {
      const imageUrl =
        args.image_url ??
        (args.image_asset_id
          ? await resolveAssetId({ assetId: args.image_asset_id, userId: session.userId, expectedKind: "image" })
          : null)
      if (!imageUrl) return { content: [{ type: "text" as const, text: "Pass image_url or image_asset_id." }], isError: true }
      const payload: Record<string, unknown> = {
        imageUrl,
        prompt: args.prompt,
        ...(args.threshold !== undefined ? { threshold: args.threshold } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, { url: "/v1/generate-mask", payload, label: "generate mask", widgetKind: "image", widgetData: { prompt: args.prompt, model: "generate-mask" } })
    },
  )

  // ── image_collage ──
  server.registerTool(
    "image_collage",
    {
      title: "Image Collage",
      description:
        "Composite multiple images into ONE large 2K/4K image. Each item is either { url } or { asset_id } (a Nodaro job id whose output is an image). " +
        "No image is ever cropped: 'smart' layout justifies images into aspect-balanced rows at their exact aspect ratios (Google-Photos style; the output height floats to fit); 'grid' uses uniform cells with off-ratio images letterboxed in the background color. " +
        "Returns a job_id with the composited image.",
      inputSchema: {
        images: z
          .array(
            z.object({
              url: z.string().url().optional(),
              asset_id: z.string().optional(),
            }),
          )
          .min(2)
          .max(30)
          .describe("2–30 image sources, each { url } or { asset_id }."),
        layout: z.enum(["smart", "grid"]).optional().describe("Arrangement algorithm. Default 'smart' (justified rows; output height floats to avoid cropping)."),
        resolution: z.enum(["2K", "4K"]).optional().describe("Output long-edge resolution. Default '4K' (3840px)."),
        aspect_ratio: z
          .string()
          .regex(/^([1-9]\d?):([1-9]\d?)$/)
          .optional()
          .describe("Output canvas ratio as W:H, e.g. '1:1','4:3','3:2','16:9','21:9','4:5','3:4','2:3','9:16'. Exact in 'grid'; a target that steers row count in 'smart'. Default '4:3'."),
        gap: z.number().int().min(0).max(200).optional().describe("Gap between images + outer margin, in px. Default 24."),
        background_color: z
          .string()
          .regex(/^#?[0-9a-fA-F]{6}$/)
          .optional()
          .describe("Background shown in the gaps, #RRGGBB. Default #ffffff."),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: {
        "ui/resourceUri": "ui://nodaro/widget/v4/job-image",
        ui: { resourceUri: "ui://nodaro/widget/v4/job-image", visibility: ["model", "app"] },
      },
    },
    async (args) => {
      const imageUrls: string[] = []
      for (const item of args.images) {
        const url =
          item.url ??
          (item.asset_id
            ? await resolveAssetId({ assetId: item.asset_id, userId: session.userId, expectedKind: "image" })
            : null)
        if (!url) {
          return { content: [{ type: "text" as const, text: "Each image must have either a url or an asset_id." }], isError: true }
        }
        imageUrls.push(url)
      }
      const payload: Record<string, unknown> = {
        imageUrls,
        ...(args.layout ? { layout: args.layout } : {}),
        ...(args.resolution ? { resolution: args.resolution } : {}),
        ...(args.aspect_ratio ? { aspectRatio: args.aspect_ratio } : {}),
        ...(args.gap !== undefined ? { gap: args.gap } : {}),
        ...(args.background_color ? { backgroundColor: args.background_color } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, {
        url: "/v1/image-collage",
        payload,
        label: "image collage",
        widgetKind: "image",
        widgetData: { prompt: `Collage of ${imageUrls.length} images`, model: "image-collage" },
      })
    },
  )

  // ── image_to_text ──
  server.registerTool(
    "image_to_text",
    {
      title: "Image to Text",
      description:
        "Describe or analyse an image using a vision LLM. Returns a job_id; " +
        "the description is in the job output text. Use for captions, alt-text, " +
        "scene analysis, or custom questions about the image.",
      inputSchema: {
        image_url: z.string().url().optional().describe("Image URL to describe."),
        image_asset_id: z.string().optional().describe("Nodaro image job id."),
        detail_level: z.enum(["brief", "detailed", "comprehensive"]).optional().describe("How much detail to include. Default detailed."),
        custom_prompt: z.string().max(2000).optional().describe("Override the default system prompt with a specific question (e.g. 'List all text visible in the image')."),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      const imageUrl =
        args.image_url ??
        (args.image_asset_id
          ? await resolveAssetId({ assetId: args.image_asset_id, userId: session.userId, expectedKind: "image" })
          : null)
      if (!imageUrl) return { content: [{ type: "text" as const, text: "Pass image_url or image_asset_id." }], isError: true }
      const payload: Record<string, unknown> = {
        imageUrl,
        ...(args.detail_level ? { detailLevel: args.detail_level } : {}),
        ...(args.custom_prompt ? { customPrompt: args.custom_prompt } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, { url: "/v1/image-to-text/describe", payload, label: "image to text", widgetKind: "generic", widgetData: { prompt: args.custom_prompt ?? `(${args.detail_level ?? "detailed"} description)`, model: "image-to-text" } })
    },
  )

  // ── generate_script ──
  server.registerTool(
    "generate_script",
    {
      title: "Generate Script",
      description:
        "Generate a structured video script from a text prompt using an LLM. " +
        "Returns a job_id; the script text is in the job output. Use the scenes " +
        "to drive a sequence of generate_image or generate_video calls.\n\n" +
        "Models: gemini (default), claude, gpt.",
      inputSchema: {
        prompt: z.string().min(1).max(10000).describe("High-level description of the video (topic, style, audience, etc.)."),
        scene_count: z.number().int().min(1).max(20).optional().describe("Number of scenes. Default determined by model."),
        tone: z.string().max(200).optional().describe("Tone/mood of the script (e.g. 'dramatic', 'lighthearted')."),
        target_duration: z.number().int().min(5).max(600).optional().describe("Approximate total video duration in seconds."),
        model: z.enum(["gemini", "claude", "gpt"]).optional().describe("LLM to use. Default gemini."),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      const payload: Record<string, unknown> = {
        prompt: args.prompt,
        ...(args.scene_count !== undefined ? { sceneCount: args.scene_count } : {}),
        ...(args.tone ? { tone: args.tone } : {}),
        ...(args.target_duration !== undefined ? { targetDuration: args.target_duration } : {}),
        ...(args.model ? { provider: args.model } : {}),
        mcp_client: session.clientName,
        userId: session.userId,
      }
      return dispatchJob(fastify, session, { url: "/v1/generate-script", payload, label: "generate script", widgetKind: "generic", widgetData: { prompt: args.prompt.slice(0, 80), model: args.model ?? "gemini" } })
    },
  )
}
