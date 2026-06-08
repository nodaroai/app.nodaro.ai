import { z } from "zod"
import {
  CHARACTER_ASSET_TYPES,
  CHARACTER_ATTACH_COLUMNS,
  LOCATION_ASSET_TYPES,
  LOCATION_ATTACH_COLUMNS,
} from "@nodaro/shared"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { config } from "../../config.js"
import type { RegisterOpts } from "./verbs-image.js"
import {
  parseJobId,
  errorResult,
  parseFailure,
  jobResultWithWidget,
} from "./_verb-helpers.js"

const executeGate: ToolGate = { required: ["workflows:execute"] }

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
        "Generate a character portrait (kind: 'main') or a variant asset (kind: 'asset' with asset_type + variant). Asset types: expressions, poses, lighting, angles, headAngles, bodyAngles, custom. When attach_to_character_id is set, the result auto-attaches to the character's matching bucket and the anchor portrait is reused as the i2i source.",
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
          .enum(CHARACTER_ASSET_TYPES)
          .optional()
          .describe(
            "Required when kind='asset'. One of: expressions, poses, lighting, angles, headAngles, bodyAngles, custom. `angles` is the legacy alias for `headAngles` (head-and-shoulders); prefer `headAngles` for new code. For animated clips, use `generate_character_motion` instead.",
          ),
        variant: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe(
            "Required when kind='asset'. Variant name — e.g. expressions: 'smile'/'angry'/...; headAngles/bodyAngles: 'front'/'3/4 left'/'left profile'/'right profile'/'3/4 right'/'back'; poses: 'standing'/'walking'/...; lighting: 'daylight'/'night'/'dramatic'; or any short label for custom.",
          ),
        attach_to_character_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            "If provided, the generated asset is auto-attached to this character row. The character's anchor portrait is reused as the i2i source; the route returns `portrait_required` (400) if no approved portrait exists. Required for the studio path.",
          ),
        attach_to_column: z
          .enum(CHARACTER_ATTACH_COLUMNS)
          .optional()
          .describe(
            "Required with attach_to_character_id when asset_type='custom' (the worker can't infer the bucket). For canonical asset types the column is derived automatically. One of: expressions, poses, angles, body_angles, lighting_variations.",
          ),
        attach_name: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe("Display name for the attached asset entry (defaults to variant)."),
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
        // Auto-attach studio fields — forwarded only on asset-mode requests.
        // The main route ignores them but we keep the payload tight so the
        // wire-shape mirrors `/v1/generate-character-asset`'s Zod schema.
        if (args.attach_to_character_id) {
          payload.attachToCharacterId = args.attach_to_character_id
        }
        if (args.attach_to_column) payload.attachToColumn = args.attach_to_column
        if (args.attach_name) payload.attachName = args.attach_name
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
      // The main /v1/generate-character route returns the dual shape
      // { jobId, jobIds } (Task 6 of character-studio PR 1). The asset
      // route still returns { jobId } only. MCP semantics resolve to a
      // single job result per call (this tool always implies count=1
      // — exposing `count` is PR 2 frontend territory), so we destructure
      // both and prefer jobIds[0] when present, falling back to jobId.
      let parsed: { jobId?: string; jobIds?: string[] } | null = null
      try {
        parsed = JSON.parse(res.body) as { jobId?: string; jobIds?: string[] }
      } catch {
        // fall through — parseFailure below handles the unparseable case
      }
      const jobId = parsed?.jobIds?.[0] ?? parsed?.jobId ?? parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResultWithWidget({
        jobId,
        label: isAsset ? "character asset" : "character",
        session,
        widgetKind: "image",
        widgetData: {
          prompt: args.description ?? args.name,
          model: args.model ?? "nano-banana",
        },
      })
    },
  )

  // ── generate_location ──
  server.registerTool(
    "generate_location",
    {
      title: "Generate Location",
      description:
        "Generate a location/scene image (kind: 'main') or a variant asset (kind: 'asset' with asset_type + variant). Asset types: timeOfDay, weather, seasons, angles, lighting, custom. When attach_to_location_id is set, the result auto-attaches to the location's matching bucket and the anchor establishing shot is reused as the i2i source.",
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
        asset_type: z
          .enum(LOCATION_ASSET_TYPES)
          .optional()
          .describe(
            "Required when kind='asset'. One of: timeOfDay, weather, seasons, angles, lighting, custom.",
          ),
        variant: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe(
            "Required when kind='asset'. e.g. timeOfDay: 'dawn'/'noon'/'dusk'/'night'; weather: 'rain'/'snow'/'fog'; seasons: 'spring'/'summer'/'autumn'/'winter'; angles: 'aerial'/'street-level'/'wide'; lighting: 'golden-hour'/'overcast'/'neon'; or any short label for custom.",
          ),
        attach_to_location_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            "If provided, the generated asset is auto-attached to this location row. The location's anchor establishing shot is reused as the i2i source; the route returns `main_image_required` (400) if no approved main image exists. Required for the studio path.",
          ),
        attach_to_column: z
          .enum(LOCATION_ATTACH_COLUMNS)
          .optional()
          .describe(
            "Required with attach_to_location_id when asset_type='custom' (the worker can't infer the bucket). For canonical asset types the column is derived automatically. One of: time_of_day, weather, seasons, angles, lighting, atmosphere_motions.",
          ),
        attach_name: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe("Display name for the attached asset entry (defaults to variant)."),
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
        // Auto-attach studio fields — forwarded only on asset-mode requests.
        // The main route ignores them but we keep the payload tight so the
        // wire-shape mirrors `/v1/generate-location-asset`'s Zod schema.
        if (args.attach_to_location_id) {
          payload.attachToLocationId = args.attach_to_location_id
        }
        if (args.attach_to_column) payload.attachToColumn = args.attach_to_column
        if (args.attach_name) payload.attachName = args.attach_name
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
      return jobResultWithWidget({
        jobId,
        label: isAsset ? "location asset" : "location",
        session,
        widgetKind: "image",
        widgetData: {
          prompt: args.description ?? args.name,
          model: args.model ?? "nano-banana",
        },
      })
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
      return jobResultWithWidget({
        jobId,
        label: isAsset ? "object asset" : "object",
        session,
        widgetKind: "image",
        widgetData: {
          prompt: args.description ?? args.name,
          model: args.model ?? "nano-banana",
        },
      })
    },
  )

  // ── generate_creature ──
  // 1:1 mirror of generate_object with the Animal/Creature delta: free-text
  // `species` (the creature delta vs object — a creature can be any animal),
  // free-text `category` + `style` (the creature CRUD/generate route uses open
  // strings, NOT object's fixed category/style enums), and the asset_type
  // enum swaps object's `materials` for `poses`. Hits
  // `/v1/generate-creature` (kind="main") / `/v1/generate-creature-asset`
  // (kind="asset"). The main route returns the dual `{ jobId, jobIds }` shape
  // (harmonized with characters) so we prefer `jobIds[0]`.
  server.registerTool(
    "generate_creature",
    {
      title: "Generate Creature",
      description:
        "Generate a creature/animal image (kind: 'main') or a variant (kind: 'asset' with asset_type — angles/poses/variations/custom). `species` (free text, e.g. 'dragon', 'wolf') is the creature delta vs objects.",
      inputSchema: {
        kind: z.enum(["main", "asset"]).default("main"),
        name: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        species: z
          .string()
          .max(200)
          .optional()
          .describe("Free-text species/type — e.g. 'dragon', 'wolf', 'griffin'. The creature delta vs objects."),
        category: z
          .string()
          .max(50)
          .optional()
          .describe("Free-text category (creatures use open strings, not a fixed enum) — e.g. 'mammal', 'mythical', 'reptile'."),
        style: z
          .string()
          .max(50)
          .optional()
          .describe("Free-text style — e.g. 'realistic', 'anime', '3d-pixar', 'illustration'."),
        source_image_url: z.string().url().optional(),
        model: z.string().optional().describe("Image model (defaults to nano-banana)"),
        // asset-only
        asset_type: z.enum(["angles", "poses", "variations", "custom"]).optional(),
        variant: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe("Required when kind='asset'. e.g. 'front', 'standing', 'weathered'."),
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
        species: args.species,
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
      const url = isAsset ? "/v1/generate-creature-asset" : "/v1/generate-creature"
      const res = await fastify.inject({
        method: "POST",
        url,
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
        },
        payload,
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      // The main /v1/generate-creature route returns the dual shape
      // { jobId, jobIds } (harmonized with characters); the asset route still
      // returns { jobId } only. MCP semantics resolve to a single job result
      // per call (this tool always implies count=1), so we destructure both
      // and prefer jobIds[0] when present, falling back to jobId.
      let parsed: { jobId?: string; jobIds?: string[] } | null = null
      try {
        parsed = JSON.parse(res.body) as { jobId?: string; jobIds?: string[] }
      } catch {
        // fall through — parseFailure below handles the unparseable case
      }
      const jobId = parsed?.jobIds?.[0] ?? parsed?.jobId ?? parseJobId(res.body)
      if (!jobId) return parseFailure(res.body)
      return jobResultWithWidget({
        jobId,
        label: isAsset ? "creature asset" : "creature",
        session,
        widgetKind: "image",
        widgetData: {
          prompt: args.description ?? args.name,
          model: args.model ?? "nano-banana",
        },
      })
    },
  )
}
