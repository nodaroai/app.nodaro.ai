import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import type { McpSession } from "../session.js"
import { buildCompositePrompt } from "../prompt-builder-bridge.js"
import { resolveAssetId } from "../asset-resolver.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { config } from "../../config.js"
import {
  parseJobId,
  errorResult,
  parseFailure,
  jobResultWithWidget,
} from "./_verb-helpers.js"
import { waitForJob } from "./_wait-for-job.js"

/**
 * Path-1 structured fields shape, mirrored from `@nodaro/shared`'s
 * `StructuredPromptFields` type. See `verbs-image.ts:registerGenerateImage`
 * for the canonical pattern; subsequent verbs in this file follow the same
 * shape.
 */
const StructuredFields = z
  .object({
    person: z
      .object({
        age: z.number().int().min(0).max(120).optional(),
        gender: z.enum(["man", "woman", "child", "non-binary"]).optional(),
        hair: z.string().optional(),
        eyes: z.string().optional(),
        expression: z.string().optional(),
        profession: z.string().optional(),
        warriorType: z.string().optional(),
      })
      .optional(),
    styling: z
      .object({
        mood: z.string().optional(),
        lighting: z.string().optional(),
        aesthetic: z.string().optional(),
        colorLook: z.string().optional(),
      })
      .optional(),
    setting: z
      .object({
        era: z.string().optional(),
        atmosphere: z.string().optional(),
        backdrop: z.string().optional(),
      })
      .optional(),
    camera: z
      .object({
        framing: z.string().optional(),
        motion: z.string().optional(),
        format: z.string().optional(),
      })
      .optional(),
    lens: z
      .object({
        focalLength: z.string().optional(),
        aperture: z.string().optional(),
      })
      .optional(),
    mood: z.string().optional(),
  })
  .partial()

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
        title: "Generate Image",
        description:
          "Generate an image from a text prompt and optional Path-1 structured fields (person, styling, setting, camera, mood, lens). Returns a job_id",
        inputSchema: {
          prompt: z.string().min(1).max(4000).describe("Free-text image prompt"),
          model: z
            .enum([
              "nano-banana",
              "nano-banana-pro",
              "flux",
              "flux-flex",
              "ideogram-v3",
              "imagen4",
              "qwen",
              "gpt-image",
              "z-image",
              "grok",
            ])
            .default("nano-banana")
            .describe("Image model. Each has different price/quality tradeoffs."),
          resolution: z.enum(["1K", "2K", "4K"]).optional(),
          quality: z.enum(["medium", "high"]).optional(),
          aspect_ratio: z
            .enum(["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"])
            .default("16:9"),
          negative_prompt: z.string().max(2000).optional(),
          structured: StructuredFields.optional().describe(
            "Path-1 structured fields composed into the final prompt.",
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
        // NOTE: readOnlyHint:true is technically inaccurate (we mutate state
        // by enqueuing a job + reserving credits) but Cursor 3.2.16's
        // approval flow auto-cancels non-readOnly tools after a few
        // seconds without ever sending tools/call (Claude.ai works fine
        // either way). The job-mutation isn't user-data-mutating, just
        // queue-state, so the lie is a controlled trade-off to unblock
        // Cursor users until upstream fixes the approval bug.
        annotations: {
          readOnlyHint: true,
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
        const compositePrompt = buildCompositePrompt(args.prompt, args.structured)
        const payload = {
          prompt: compositePrompt,
          provider: args.model,
          aspectRatio: args.aspect_ratio,
          resolution: args.resolution,
          quality: args.quality,
          negativePrompt: args.negative_prompt,
          mcp_client: session.clientName,
          userId: session.userId,
        }

        const res = await fastify.inject({
          method: "POST",
          url: "/v1/generate-image",
          headers: {
            "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
          },
          payload,
        })

        if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
        const jobId = parseJobId(res.body)
        if (!jobId) return parseFailure(res.body)

        // Block until the worker finishes (or 120s timeout). Cursor and
        // similar clients cancel tool calls that return only a jobId
        // without a final result. Claude.ai's widget would still render
        // the result via tool-result event using the same returned URL.
        const result = await waitForJob({ jobId, timeoutMs: 120_000 })
        if (result.status === "timeout") {
          return jobResultWithWidget({
            jobId,
            label: "image generation",
            session,
            widgetKind: "image",
            widgetData: {
              prompt: compositePrompt,
              model: args.model,
              aspectRatio: args.aspect_ratio,
              resolution: args.resolution,
            },
          })
        }
        if (result.status !== "completed" || !result.outputUrl) {
          return errorResult(
            500,
            JSON.stringify({
              jobId,
              status: result.status,
              error: result.error ?? "Unknown failure",
            }),
          )
        }
        return jobResultWithWidget({
          jobId,
          label: "image generation",
          session,
          widgetKind: "image",
          widgetData: {
            prompt: compositePrompt,
            model: args.model,
            aspectRatio: args.aspect_ratio,
            resolution: args.resolution,
            outputUrl: result.outputUrl,
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
          "Transform an existing image using a text prompt (image-to-image). " +
          "Provide either `image_url` (a publicly fetchable HTTPS URL the " +
          "downstream provider can fetch) OR `image_asset_id` (a Nodaro job " +
          "id whose output is an image). For user-attached images whose URLs " +
          "are auth-gated (claude.ai / chatgpt.com previews), call " +
          "`upload_image` first to get a public URL and pass that.",
        inputSchema: {
          prompt: z.string().min(1).max(2000),
          image_url: z.string().url().optional(),
          image_asset_id: z.string().optional(),
          model: z
            .enum([
              "nano-banana",
              "nano-banana-pro",
              "flux-i2i",
              "flux-pro-i2i",
              "gpt-image-i2i",
              "ideogram-edit",
              "ideogram-remix",
              "qwen-i2i",
            ])
            .optional(),
          resolution: z.enum(["1K", "2K", "4K"]).optional(),
          quality: z.enum(["medium", "high", "basic"]).optional(),
          aspect_ratio: z
            .enum(["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"])
            .optional(),
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
          provider: args.model,
          aspectRatio: args.aspect_ratio,
          resolution: args.resolution,
          quality: args.quality,
          negativePrompt: args.negative_prompt,
          mcp_client: session.clientName,
          userId: session.userId,
        }

        const res = await fastify.inject({
          method: "POST",
          url: "/v1/image-to-image",
          headers: {
            "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
          },
          payload,
        })

        if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
        const jobId = parseJobId(res.body)
        if (!jobId) return parseFailure(res.body)

        const result = await waitForJob({ jobId, timeoutMs: 120_000 })
        if (result.status === "timeout") {
          return jobResultWithWidget({
            jobId,
            label: "image-to-image",
            session,
            widgetKind: "image",
            widgetData: {
              prompt: compositePrompt,
              model: args.model ?? "image-to-image",
              aspectRatio: args.aspect_ratio,
              resolution: args.resolution,
            },
          })
        }
        if (result.status !== "completed" || !result.outputUrl) {
          return errorResult(
            500,
            JSON.stringify({
              jobId,
              status: result.status,
              error: result.error ?? "Unknown failure",
            }),
          )
        }
        return jobResultWithWidget({
          jobId,
          label: "image-to-image",
          session,
          widgetKind: "image",
          widgetData: {
            prompt: compositePrompt,
            model: args.model ?? "image-to-image",
            aspectRatio: args.aspect_ratio,
            resolution: args.resolution,
            outputUrl: result.outputUrl,
          },
        })
      },
    )
  }
}
