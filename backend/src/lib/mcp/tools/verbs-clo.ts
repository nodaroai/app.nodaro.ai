import { z } from "zod"
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

const STYLE = z.enum(["realistic", "anime", "3d-pixar", "illustration"]).optional()

/**
 * Character/Location/Object generators.
 *
 * Each comes in two flavors — `kind: "main"` hits `/v1/generate-{character,location,object}`
 * (single canonical asset), `kind: "asset"` hits `/v1/generate-{...}-asset` (variant
 * generation: expressions/poses/lighting/angles/etc.). The asset endpoints require
 * `asset_type` + `variant`; the main endpoints don't.
 */
export function registerCloVerbs({ server, session, fastify }: RegisterOpts): void {
  if (!passesGate(session, executeGate)) return

  // ── generate_character ──
  server.registerTool(
    "generate_character",
    {
      title: "Generate Character",
      description:
        "Generate a character image (kind: 'main') or a variant (kind: 'asset' with asset_type + variant — e.g. expressions/poses/angles/lighting).",
      inputSchema: {
        kind: z.enum(["main", "asset"]).default("main"),
        name: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        gender: z.string().max(50).optional(),
        style: STYLE,
        base_outfit: z.string().max(1000).optional(),
        source_image_url: z.string().url().optional(),
        model: z.string().optional().describe("Image model (defaults to nano-banana)"),
        // asset-only fields
        asset_type: z
          .enum(["expressions", "poses", "lighting", "angles", "custom"])
          .optional(),
        variant: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe("Required when kind='asset'. e.g. 'smile', 'walking'."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const isAsset = args.kind === "asset"
      if (isAsset && (!args.asset_type || !args.variant)) {
        return {
          content: [
            { type: "text", text: "kind='asset' requires asset_type and variant" },
          ],
          isError: true,
        }
      }
      const payload: Record<string, unknown> = {
        name: args.name,
        description: args.description,
        gender: args.gender,
        style: args.style,
        baseOutfit: args.base_outfit,
        sourceImageUrl: args.source_image_url,
        provider: args.model,
        mcp_client: session.clientName,
        userId: session.userId,
      }
      if (isAsset) {
        payload.assetType = args.asset_type
        payload.variant = args.variant
      }
      const url = isAsset ? "/v1/generate-character-asset" : "/v1/generate-character"
      const res = await fastify.inject({
        method: "POST",
        url,
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResult(jobId, isAsset ? "character asset" : "character")
    },
  )

  // ── generate_location ──
  server.registerTool(
    "generate_location",
    {
      title: "Generate Location",
      description:
        "Generate a location/scene image (kind: 'main') or a variant (kind: 'asset' with asset_type — timeOfDay/weather/angles).",
      inputSchema: {
        kind: z.enum(["main", "asset"]).default("main"),
        name: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        category: z
          .enum([
            "indoor",
            "outdoor",
            "urban",
            "nature",
            "fantasy",
            "sci-fi",
            "historical",
            "futuristic",
            "other",
          ])
          .optional(),
        style: STYLE,
        source_image_url: z.string().url().optional(),
        model: z.string().optional().describe("Image model (defaults to nano-banana)"),
        // asset-only
        asset_type: z.enum(["timeOfDay", "weather", "angles", "custom"]).optional(),
        variant: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe("Required when kind='asset'. e.g. 'dawn', 'rain', 'aerial'."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const isAsset = args.kind === "asset"
      if (isAsset && (!args.asset_type || !args.variant)) {
        return {
          content: [
            { type: "text", text: "kind='asset' requires asset_type and variant" },
          ],
          isError: true,
        }
      }
      const payload: Record<string, unknown> = {
        name: args.name,
        description: args.description,
        category: args.category,
        style: args.style,
        sourceImageUrl: args.source_image_url,
        provider: args.model,
        mcp_client: session.clientName,
        userId: session.userId,
      }
      if (isAsset) {
        payload.assetType = args.asset_type
        payload.variant = args.variant
      }
      const url = isAsset ? "/v1/generate-location-asset" : "/v1/generate-location"
      const res = await fastify.inject({
        method: "POST",
        url,
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResult(jobId, isAsset ? "location asset" : "location")
    },
  )

  // ── generate_object ──
  server.registerTool(
    "generate_object",
    {
      title: "Generate Object",
      description:
        "Generate an object/prop image (kind: 'main') or a variant (kind: 'asset' with asset_type — angles/materials/variations).",
      inputSchema: {
        kind: z.enum(["main", "asset"]).default("main"),
        name: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        category: z
          .enum([
            "furniture",
            "vehicle",
            "weapon",
            "food",
            "clothing",
            "electronics",
            "nature",
            "tool",
            "animal",
            "other",
          ])
          .optional(),
        style: STYLE,
        source_image_url: z.string().url().optional(),
        model: z.string().optional().describe("Image model (defaults to nano-banana)"),
        // asset-only
        asset_type: z.enum(["angles", "materials", "variations", "custom"]).optional(),
        variant: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe("Required when kind='asset'. e.g. 'front', 'wood', 'weathered'."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const isAsset = args.kind === "asset"
      if (isAsset && (!args.asset_type || !args.variant)) {
        return {
          content: [
            { type: "text", text: "kind='asset' requires asset_type and variant" },
          ],
          isError: true,
        }
      }
      const payload: Record<string, unknown> = {
        name: args.name,
        description: args.description,
        category: args.category,
        style: args.style,
        sourceImageUrl: args.source_image_url,
        provider: args.model,
        mcp_client: session.clientName,
        userId: session.userId,
      }
      if (isAsset) {
        payload.assetType = args.asset_type
        payload.variant = args.variant
      }
      const url = isAsset ? "/v1/generate-object-asset" : "/v1/generate-object"
      const res = await fastify.inject({
        method: "POST",
        url,
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const jobId = parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResult(jobId, isAsset ? "object asset" : "object")
    },
  )
}
