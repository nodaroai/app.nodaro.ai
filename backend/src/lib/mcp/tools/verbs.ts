import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import type { McpSession } from "../session.js"
import { buildCompositePrompt } from "../prompt-builder-bridge.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { config } from "../../config.js"

/**
 * Path-1 structured fields shape, mirrored from `@nodaro/shared`'s
 * `StructuredPromptFields` type.
 *
 * We re-declare the Zod here so the MCP `inputSchema` (a raw Zod shape, see
 * v1.0 Task 8) can describe each nested object to client LLMs. The shared
 * runtime renderer (`renderStructuredFields`) remains the canonical source for
 * how values are composed into the final prompt; this Zod is purely the
 * tool-input contract.
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

/**
 * Generation verbs reserve credits and enqueue jobs, so they require
 * `workflows:execute`. When the gate fails, the tool isn't registered at all
 * (omitted from `tools/list`) — see `passesGate` semantics.
 */
const generateImageGate: ToolGate = { required: ["workflows:execute"] }

export interface RegisterVerbsOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

/**
 * Register all v1.1 generation verb tools on the given MCP server.
 *
 * Pattern (canonical for v1.1 verbs):
 *  1. Parse arguments via the SDK's raw-shape `inputSchema`.
 *  2. Compose Path-1 structured fields onto the free-text prompt.
 *  3. Hit the existing `/v1/...` route via `fastify.inject()` with the
 *     internal-orchestrator-secret header so the auth middleware accepts
 *     `userId` from the body.
 *  4. Tag the job with `mcp_client` so trigger badges + admin views show
 *     which connector originated the work.
 *  5. Return a JSON-RPC tool result whose `_meta.task_id` carries the job id
 *     for v1.2 progress streaming and for the client to poll via `tasks/get`.
 *
 * Subsequent verb tools (Task 7+) follow this exact shape with different
 * params and route URLs.
 */
export function registerVerbs({ server, session, fastify }: RegisterVerbsOpts): void {
  if (passesGate(session, generateImageGate)) {
    server.registerTool(
      "generate_image",
      {
        title: "Generate Image",
        description:
          "Generate an image from a text prompt and optional Path-1 structured fields (person, styling, setting, camera, mood, lens). Returns a job_id; poll via tasks/get.",
        // Raw Zod shape, NOT z.object(...). MCP SDK v1.29 takes a
        // ZodRawShapeCompat — a Record<string, ZodTypeAny>. See ping in
        // server.ts for the same pattern with an empty shape.
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
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: true,
        },
      },
      async (args) => {
        const compositePrompt = buildCompositePrompt(args.prompt, args.structured)
        // The /v1/generate-image Zod schema uses camelCase
        // (aspectRatio / negativePrompt); MCP convention is snake_case for
        // tool inputs, so we translate at the boundary here.
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

        if (res.statusCode >= 400) {
          return {
            content: [
              {
                type: "text",
                text: `Error from Nodaro: ${res.statusCode} ${res.body}`,
              },
            ],
            isError: true,
          }
        }

        // Route returns `{ jobId }`. Be generous with the parse so a future
        // rename to `job_id` or `id` doesn't break the verb.
        const body = JSON.parse(res.body) as {
          jobId?: string
          job_id?: string
          id?: string
        }
        const jobId = body.jobId ?? body.job_id ?? body.id
        if (!jobId) {
          return {
            content: [
              {
                type: "text",
                text: `Submitted but couldn't parse job_id from response: ${res.body}`,
              },
            ],
            isError: true,
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `Submitted image generation job ${jobId}. Track via tasks/get with task_id=${jobId} or open: https://app.nodaro.ai/library/jobs/${jobId}`,
            },
          ],
          _meta: { task_id: jobId },
        }
      },
    )
  }
}
