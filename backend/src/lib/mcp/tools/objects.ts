import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { CHARACTER_STYLES, OBJECT_MOTION_PROVIDERS, OBJECT_ASPECT_OPTIONS } from "@nodaro/shared"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { config } from "../../config.js"
import {
  parseJobId,
  errorResult,
  parseFailure,
  jobResultWithWidget,
} from "./_verb-helpers.js"

const writeGate: ToolGate = { required: ["assets:write"] }
const executeGate: ToolGate = { required: ["workflows:execute"] }

/**
 * Object Studio MCP tools — `assets:write` + `workflows:execute` slice only.
 *
 * Mirrors `lib/mcp/tools/locations.ts` in structure but exposes only the 3
 * Studio-action tools (NOT the CRUD parity tools): `approve_object_main_image`,
 * `recaption_object`, `generate_object_motion`. Read/list/create/update
 * tools are DEFERRED — object workflows are typically wired upstream of
 * generation pipelines (less MCP-driven than location). Object candidate +
 * variant-asset generation already lives as a verb tool in
 * `verbs-clo.ts::generate_object` — we do NOT duplicate it here.
 * `generate_object_motion` stays in this file because it dispatches to a
 * distinct route (`/v1/generate-object-motion`) with its own
 * motion-specific input shape (`motion_prompt`, `source_image_url`,
 * `attach_to_object_id`) and a different i2v credit profile — mirrors the
 * `generate_location_motion` placement in `locations.ts`.
 *
 * INTENTIONAL OMISSIONS (mirror location precedent at locations.ts:35-40):
 * `delete_object` + `restore_object` + `permanent_delete_object` are NOT
 * exposed via MCP. Destructive (or destructive-adjacent) operations driven
 * by an LLM are dangerous — prompt injection or hallucination can trigger
 * them unexpectedly, and the LLM doesn't always have the user context to
 * make those calls safely. Users still archive + restore through REST
 * (`DELETE /v1/objects/:id`, `POST /v1/objects/:id/restore`) — those are
 * explicit user actions, not LLM-driven. The same principle applies to any
 * future tool addition here: MCP exposes creation, modification, and
 * reversible state changes; deletion, restoration, and permanent
 * destructive operations stay REST/SDK/CLI only.
 *
 * Spec correction noted: Object Studio spec Pass 6 F-76 incorrectly said
 * `assets:write` scope "doesn't exist" — verified at locations.ts:16-18 it
 * DOES exist alongside `assets:read` and `workflows:execute`, and is the
 * canonical scope for write tools. C1c uses the actual location scope
 * assignments verbatim:
 *   - `assets:write` — approve_object_main_image, recaption_object
 *   - `workflows:execute` — generate_object_motion (it produces an i2v job
 *     that consumes credits, same gate as generate_location_motion)
 *
 * Dispatch pattern: all 3 tools use `fastify.inject()` to call the
 * underlying REST routes (Phase C1b: object-main-image-approval.ts,
 * object-llm-caption.ts, generate-object-motion.ts). The routed-through
 * requests carry the internal-orchestrator-secret header, so the auth
 * middleware accepts `userId` from the request body. Direct DB calls are
 * reserved for read tools (none in this PR).
 */

function err(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true as const }
}

function okText(text: string, structuredContent?: Record<string, unknown>) {
  return structuredContent
    ? { content: [{ type: "text" as const, text }], structuredContent }
    : { content: [{ type: "text" as const, text }] }
}

export interface RegisterObjectToolsOpts {
  server: McpServer
  session: McpSession
  /**
   * Optional Fastify instance for tools that proxy through `/v1/...` routes
   * (`approve_object_main_image`, `recaption_object`, `generate_object_motion`).
   * When omitted, those tools won't register — primarily for the read-only
   * test path (mirrors `RegisterLocationToolsOpts` in `locations.ts`).
   */
  fastify?: FastifyInstance
}

export function registerObjectTools(opts: RegisterObjectToolsOpts): void {
  registerWriteTools(opts)
  registerGenerationTools(opts)
}

// ─────────────────────────────────────────────────────────────────────────────
// WRITE tools — approve_object_main_image / recaption_object
// (assets:write)
// ─────────────────────────────────────────────────────────────────────────────

function registerWriteTools(opts: RegisterObjectToolsOpts): void {
  const { server, session, fastify } = opts
  if (!passesGate(session, writeGate)) return

  // ── approve_object_main_image ──
  server.registerTool(
    "approve_object_main_image",
    {
      title: "Approve Object Main Image",
      description:
        "Approve a completed `generate_object` candidate job as the " +
        "object's main image. Sets `source_image_url` on the object row " +
        "and fires an LLM caption (Claude Sonnet vision) inline to populate " +
        "`canonical_description` (form / material / condition / purpose). " +
        "Returns the new main-image URL plus the caption. The caption is " +
        "the empty string on LLM sub-failure (main image still set; retry " +
        "with `recaption_object`). The candidate's stored " +
        "`attachToObjectId` MUST match `object_id` (cross-link IDOR gate) " +
        "— mismatch returns a `candidate_object_mismatch` error. Pass " +
        "`expected_updated_at` from the studio snapshot to enable " +
        "optimistic-concurrency control: a stale token surfaces as a " +
        "`concurrent_modification` error so the caller can re-fetch + retry.",
      inputSchema: {
        object_id: z.string().uuid().describe("The object id (uuid)."),
        candidate_job_id: z
          .string()
          .uuid()
          .describe(
            "The job id from a completed `generate_object` call. The job " +
            "must be status=completed, have `output_data.imageUrl` set, " +
            "belong to the caller, AND its `input_data.attachToObjectId` " +
            "MUST match `object_id` (cross-link IDOR gate).",
          ),
        expected_updated_at: z
          .string()
          .datetime()
          .optional()
          .describe(
            "Optimistic-concurrency token (the `updatedAt` from the studio " +
            "snapshot). When provided and stale, the call returns a " +
            "`concurrent_modification` error with the fresh `updatedAt` so " +
            "the caller can re-fetch + retry.",
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      if (!fastify) {
        return err(
          "approve_object_main_image is not available in this server build (no Fastify instance).",
        )
      }
      const res = await fastify.inject({
        method: "POST",
        url: `/v1/objects/${encodeURIComponent(args.object_id)}/approve-main-image`,
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload: {
          candidateJobId: args.candidate_job_id,
          expectedUpdatedAt: args.expected_updated_at,
          userId: session.userId,
        },
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      let parsed: { sourceImageUrl?: string; canonicalDescription?: string } | null = null
      try {
        parsed = JSON.parse(res.body) as {
          sourceImageUrl?: string
          canonicalDescription?: string
        }
      } catch {
        /* fall through */
      }
      const captionEmpty = !parsed?.canonicalDescription
      return okText(
        `Approved main image for object ${args.object_id}.${captionEmpty ? " (LLM caption sub-failed — retry with recaption_object.)" : ""}`,
        {
          objectId: args.object_id,
          sourceImageUrl: parsed?.sourceImageUrl,
          canonicalDescription: parsed?.canonicalDescription ?? "",
        },
      )
    },
  )

  // ── recaption_object ──
  server.registerTool(
    "recaption_object",
    {
      title: "Recaption Object",
      description:
        "Re-run the LLM caption (Claude Sonnet vision) against the object's " +
        "current main image and persist the new `canonical_description` " +
        "(form / material / condition / purpose, ~80-120 words). Use after " +
        "a main-image update or when the previous caption is unsatisfactory " +
        "(typically after `approve_object_main_image` returned with " +
        "`canonicalDescription: \"\"` because the inline LLM call failed). " +
        "Returns a `main_image_required` error if the object has no " +
        "`source_image_url` set (approve a candidate first); returns " +
        "`caption_failed` on LLM failure (frontend keeps a retry button " +
        "visible). Differs from `approve_object_main_image` in that LLM " +
        "failure is FATAL here — this route has no side-effect to preserve, " +
        "the only purpose IS the caption.",
      inputSchema: { object_id: z.string().uuid().describe("The object id (uuid).") },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      if (!fastify) {
        return err(
          "recaption_object is not available in this server build (no Fastify instance).",
        )
      }
      const res = await fastify.inject({
        method: "POST",
        url: `/v1/objects/${encodeURIComponent(args.object_id)}/llm-caption`,
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload: { userId: session.userId },
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      let parsed: { canonicalDescription?: string } | null = null
      try {
        parsed = JSON.parse(res.body) as { canonicalDescription?: string }
      } catch {
        /* fall through */
      }
      return okText(
        `Refreshed canonical description for object ${args.object_id}.`,
        {
          objectId: args.object_id,
          canonicalDescription: parsed?.canonicalDescription ?? "",
        },
      )
    },
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATION tools — generate_object_motion only
// (workflows:execute)
//
// Object candidate + variant-asset generation lives in
// `verbs-clo.ts::generate_object` (kind="main" / kind="asset"). Motion
// clips stay here because they dispatch to a distinct route
// (`/v1/generate-object-motion`) with a different input shape and i2v
// credit profile — mirrors `generate_location_motion` in `locations.ts`.
// ─────────────────────────────────────────────────────────────────────────────

function registerGenerationTools(opts: RegisterObjectToolsOpts): void {
  const { server, session, fastify } = opts
  if (!passesGate(session, executeGate)) return
  if (!fastify) return

  server.registerTool(
    "generate_object_motion",
    {
      title: "Generate Object Motion Clip",
      description:
        "Animate an object into an ambient motion clip via image-to-video " +
        "(rotate / hover / spin / parallax). The motion_prompt describes the " +
        "object / camera move (e.g. 'slow 360-degree rotation', 'object " +
        "hovering with subtle bob', 'parallax pan from left to right'). " +
        "Pass `attach_to_object_id` to auto-append the result to the " +
        "object's `motion_clips[]` bucket on completion (single attach " +
        "column for objects — unlike location's multi-bucket asset model). " +
        "`source_image_url` is REQUIRED — typically the object's approved " +
        "main image. Default aspect ratio is 1:1 (product-showcase " +
        "framing), default provider is kling-turbo. Returns the i2v job id " +
        "— poll via `get_job` until completion. Credit cost depends on the " +
        "provider.",
      inputSchema: {
        motion_prompt: z
          .string()
          .min(1)
          .max(2000)
          .describe(
            "Object/camera-move description (e.g. 'slow 360-degree rotation', 'parallax pan').",
          ),
        source_image_url: z
          .string()
          .url()
          .describe(
            "Source frame — typically the object's approved main image URL.",
          ),
        provider: z
          .enum(OBJECT_MOTION_PROVIDERS)
          .optional()
          .default("kling-turbo")
          .describe("i2v provider. Defaults to 'kling-turbo' (5s, 10 credits)."),
        name: z
          .string()
          .min(1)
          .max(200)
          .describe(
            "Display name for the object (used in the generated prompt context).",
          ),
        category: z.string().max(100).optional(),
        style: z.enum(CHARACTER_STYLES).optional(),
        canonical_description: z
          .string()
          .max(4000)
          .optional()
          .describe(
            "Canonical object description (preferred prompt context; falls back to category + name).",
          ),
        attach_to_object_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            "When set, append the result to this object's motion_clips[] bucket. " +
            "Ownership is re-verified BEFORE credit reservation, so a forged " +
            "id is rejected with `not_found` and no credits are charged.",
          ),
        attach_name: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe("Display name for the motion-clip entry (defaults to motion description)."),
        aspect_ratio: z
          .enum(OBJECT_ASPECT_OPTIONS)
          .optional()
          .describe(
            "Output aspect ratio. Defaults to 1:1 (product-showcase framing) — " +
            "objects favor square framing vs. location's 16:9 cinematic default.",
          ),
        refine_from_video_url: z
          .string()
          .url()
          .optional()
          .describe(
            "Refinement path: when set, route to video-to-video using THIS " +
            "clip as the source instead of running image-to-video from " +
            "`source_image_url`. Use to iterate on an existing motion clip " +
            "with a new prompt (e.g. 'same shot but faster rotation'). " +
            "Routes through providers with video-to-video capability.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const payload: Record<string, unknown> = {
        motionPrompt: args.motion_prompt,
        sourceImageUrl: args.source_image_url,
        provider: args.provider,
        name: args.name,
        userId: session.userId,
        mcp_client: session.clientName,
      }
      if (args.category) payload.category = args.category
      if (args.style) payload.style = args.style
      if (args.canonical_description) {
        payload.canonicalDescription = args.canonical_description
      }
      if (args.attach_to_object_id) {
        payload.attachToObjectId = args.attach_to_object_id
      }
      if (args.attach_name) payload.attachName = args.attach_name
      if (args.aspect_ratio) payload.aspectRatio = args.aspect_ratio
      if (args.refine_from_video_url) {
        payload.refineFromVideoUrl = args.refine_from_video_url
      }

      const res = await fastify.inject({
        method: "POST",
        url: "/v1/generate-object-motion",
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      // Video widget — the iframe polls `get_asset` for the rendered clip.
      return jobResultWithWidget({
        jobId,
        label: "object motion",
        session,
        widgetKind: "video",
        widgetData: {
          prompt: args.motion_prompt,
          model: args.provider ?? "kling-turbo",
          aspectRatio: args.aspect_ratio,
        },
      })
    },
  )
}
