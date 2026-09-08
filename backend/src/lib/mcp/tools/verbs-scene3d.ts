import { z } from "zod"
import { randomUUID } from "node:crypto"
import {
  PRO3D_RENDER_ASPECT_RATIOS,
  PRO3D_RENDER_DEFAULT_REPAIR_PASSES,
  PRO3D_RENDER_ENGINES,
  PRO3D_RENDER_LIMITS,
  PRO3D_RENDER_MAX_REPAIR_PASSES,
  PRO3D_RENDER_MIN_REPAIR_PASSES,
  PRO3D_RENDER_QUALITY_PROFILES,
  PRO3D_RENDER_STYLES,
  SCENE3D_LIMITS,
  SCENE3D_AUTHORING_ENGINES,
  scene3DInputAssetsSchema,
  scene3DReferenceSchema,
} from "@nodaro/shared"
import { safeUrlSchema } from "../../url-validator.js"
import { passesGate } from "../tool-schemas.js"
import { WIDGET_URI } from "../widgets/registrar.js"
import { scene3DProAvailable } from "../../../services/scene3d/scene3d-engine.js"
import { clientRequestIdSchema, dispatchJob, errorResult, JOB_OUTPUT_SCHEMA, parseFailure, uiMeta } from "./_verb-helpers.js"
import { mcpInject } from "../internal-request.js"
import type { RegisterOpts } from "./verbs-image.js"

const referenceSchema = scene3DReferenceSchema.extend({
  url: scene3DReferenceSchema.shape.url.pipe(safeUrlSchema),
})

export const SCENE3D_MCP_AUTHORING_FIELDS = {
  engine: z.enum(SCENE3D_AUTHORING_ENGINES).optional()
    .describe("Basic by default. An unavailable advanced engine is refused without a fallback."),
  accepted_scene_schema_versions: z.array(z.number().int()).min(1).max(8).optional(),
  local_connection_id: z.string().min(1).max(200).optional(),
  max_repair_passes: z.number().int().min(0).max(2).optional(),
  references: z.array(referenceSchema).max(SCENE3D_LIMITS.maxReferences).optional()
    .describe("Up to 8 references, at most 1 video. Images guide appearance/layout; video guides layout/motion. V1 uses whole clips; trim a segment first. Reconstruction is approximate."),
  llm_model: z.string().optional(),
  reasoning_effort: z.string().optional(),
}

const annotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: true } as const

/** Scene authoring verbs share the same jobs and render route as the canvas. */
export function registerScene3DVerbs({ server, session, fastify }: RegisterOpts): void {
  if (!passesGate(session, { required: ["workflows:execute"] })) return

  server.registerTool("generate_3d_scene", {
    title: "Generate 3D Scene",
    description: "Create an editable animated 3D clay scene from a prompt and optional image/video references. " +
      "Returns a job_id; get_job returns output_data.scenePlan when completed. " +
      "Use edit_3d_scene to change the scene and render_3d_scene to export MP4. " +
      "Scene generation does not generate a photorealistic video.",
    inputSchema: {
      prompt: z.string().min(1).max(8000),
      duration_seconds: z.number().min(1).max(SCENE3D_LIMITS.maxDurationSeconds).optional(),
      fps: z.number().int().min(SCENE3D_LIMITS.minFps).max(SCENE3D_LIMITS.maxFps).optional(),
      aspect_ratio: z.string().optional(),
      input_assets: scene3DInputAssetsSchema.optional()
        .describe("Selected GLBs: {id, revisionId, assetId, label?}. Requires an import-capable advanced engine. No URLs or byte receipts."),
      ...SCENE3D_MCP_AUTHORING_FIELDS,
    },
    outputSchema: JOB_OUTPUT_SCHEMA,
    annotations,
    _meta: uiMeta(WIDGET_URI.jobAuto),
  }, async (args) => dispatchJob(fastify, session, {
    url: "/v1/3d-scene/generate",
    payload: {
      prompt: args.prompt, durationSeconds: args.duration_seconds,
      fps: args.fps, aspectRatio: args.aspect_ratio, references: args.references,
      ...(args.input_assets === undefined ? {} : { inputAssets: args.input_assets }),
      ...(args.engine === undefined ? {} : { engine: args.engine }),
      ...(args.accepted_scene_schema_versions === undefined ? {} : { acceptedSceneSchemaVersions: args.accepted_scene_schema_versions }),
      ...(args.local_connection_id === undefined ? {} : { localConnectionId: args.local_connection_id }),
      ...(args.max_repair_passes === undefined ? {} : { maxRepairPasses: args.max_repair_passes }),
      llmModel: args.llm_model, reasoningEffort: args.reasoning_effort,
      userId: session.userId, mcp_client: session.clientName,
    },
    label: "3D scene generation", widgetKind: "generic",
    widgetData: { prompt: args.prompt, model: args.llm_model },
  }))

  server.registerTool("edit_3d_scene", {
    title: "Edit 3D Scene",
    description: "Edit an existing Scene3DPlan, preserving its prior revision. Supply either a prompt or " +
      "deterministic operations. Operations avoid an LLM call. expected_revision_id must match the " +
      "scene's revisionId. Returns a job_id whose output_data contains scenePlan and changeSummary. " +
      "An MP4 alone is not an editable scene; use generate_3d_scene with a video reference to reconstruct it.",
    inputSchema: {
      scene_plan: z.record(z.string(), z.unknown()).describe("The complete scenePlan returned by a scene job."),
      expected_revision_id: z.string().uuid(),
      replace_references: z.boolean().optional(),
      prompt: z.string().min(1).max(8000).optional(),
      operations: z.array(z.record(z.string(), z.unknown())).min(1).max(SCENE3D_LIMITS.maxOperations).optional()
        .describe("set-object, add-object, remove-object, set-camera, set-lighting, or set-background operations."),
      locked_object_ids: z.array(z.string()).max(SCENE3D_LIMITS.maxObjects).optional(),
      selected_object_ids: z.array(z.string()).max(SCENE3D_LIMITS.maxObjects).optional(),
      ...SCENE3D_MCP_AUTHORING_FIELDS,
    },
    outputSchema: JOB_OUTPUT_SCHEMA,
    annotations,
    _meta: uiMeta(WIDGET_URI.jobAuto),
  }, async (args) => dispatchJob(fastify, session, {
    url: "/v1/3d-scene/edit",
    payload: {
      scenePlan: args.scene_plan, expectedRevisionId: args.expected_revision_id,
      ...(args.replace_references === undefined ? {} : { replaceReferences: args.replace_references }),
      ...(args.engine === undefined ? {} : { engine: args.engine }),
      ...(args.accepted_scene_schema_versions === undefined ? {} : { acceptedSceneSchemaVersions: args.accepted_scene_schema_versions }),
      ...(args.local_connection_id === undefined ? {} : { localConnectionId: args.local_connection_id }),
      ...(args.max_repair_passes === undefined ? {} : { maxRepairPasses: args.max_repair_passes }),
      prompt: args.prompt, operations: args.operations,
      lockedObjectIds: args.locked_object_ids, selectedObjectIds: args.selected_object_ids,
      references: args.references, llmModel: args.llm_model, reasoningEffort: args.reasoning_effort,
      userId: session.userId, mcp_client: session.clientName,
    },
    label: "3D scene edit", widgetKind: "generic",
    widgetData: { prompt: args.prompt ?? "Edit scene properties", model: args.llm_model },
  }))

  // Registered only while an installed engine actually implements the
  // operation — the same predicate `GET /v1/nodes`, the capabilities document
  // and the route read. An agent is never shown a tool whose only possible
  // answer today is 503.
  if (scene3DProAvailable()) {
    server.registerTool("pro_3d_render", {
      title: "3D Render Pro",
      description: "ONE operation that produces a finished 3D shot: a source goes in, and the settled job carries BOTH " +
        "scenePlan (the exact composition) and videoUrl (the MP4). " +
        "source.kind='prompt' authors a new scene from a brief plus optional references. " +
        "source.kind='scene' names an existing revision by revision_id (source_job_id is needed for Basic job-only scenes): WITHOUT edit_prompt this is a " +
        "render-only export that costs no authoring, WITH edit_prompt it revises the scene first. " +
        "source.kind='local-export' uses a completed export from a paired desktop Blender, where that is available. " +
        "The tool quotes and submits with the same parameters and returns a job_id. " +
        "Use generate_3d_scene for an editable preview without the MP4 export.",
      inputSchema: {
        source: z.discriminatedUnion("kind", [
          z.object({
            kind: z.literal("prompt"),
            prompt: z.string().min(1).max(PRO3D_RENDER_LIMITS.promptMax),
            input_assets: scene3DInputAssetsSchema.optional(),
            references: z.array(referenceSchema).max(PRO3D_RENDER_LIMITS.maxReferences).optional()
              .describe("Up to 8 references, at most 1 video. Images guide appearance/layout; video guides layout/motion."),
          }).strict(),
          z.object({
            kind: z.literal("scene"),
            revision_id: z.string().min(1).max(PRO3D_RENDER_LIMITS.maxIdLength),
            source_job_id: z.string().min(1).max(PRO3D_RENDER_LIMITS.maxIdLength).optional()
              .describe("Required for Basic scenes retained only in job history. Optional for retained revisions, which use current scene permissions."),
            edit_prompt: z.string().min(1).max(PRO3D_RENDER_LIMITS.editPromptMax).optional()
              .describe("OMIT for a render-only export. Supplying it revises the scene and costs authoring."),
          }).strict(),
          z.object({
            kind: z.literal("local-export"),
            export_id: z.string().min(1).max(PRO3D_RENDER_LIMITS.maxIdLength),
            connection_id: z.string().min(1).max(PRO3D_RENDER_LIMITS.maxIdLength),
          }).strict(),
        ]).describe("Exactly one of prompt / scene / local-export."),
        engine: z.enum(PRO3D_RENDER_ENGINES).optional(),
        duration_seconds: z.number().min(PRO3D_RENDER_LIMITS.minDurationSeconds).max(PRO3D_RENDER_LIMITS.maxDurationSeconds).optional()
          .describe("Omit for a scene source unless deliberately re-timing it; a conflicting override is rejected."),
        fps: z.number().int().min(PRO3D_RENDER_LIMITS.minFps).max(PRO3D_RENDER_LIMITS.maxFps).optional(),
        aspect_ratio: z.enum(PRO3D_RENDER_ASPECT_RATIOS).optional(),
        quality: z.enum(PRO3D_RENDER_QUALITY_PROFILES).optional(),
        style: z.enum(PRO3D_RENDER_STYLES).optional(),
        max_repair_passes: z.number().int().min(PRO3D_RENDER_MIN_REPAIR_PASSES).max(PRO3D_RENDER_MAX_REPAIR_PASSES).optional()
          .describe(`Correction budget, ${PRO3D_RENDER_MIN_REPAIR_PASSES}-${PRO3D_RENDER_MAX_REPAIR_PASSES}. Each pass is paid work; default ${PRO3D_RENDER_DEFAULT_REPAIR_PASSES}.`),
        client_request_id: clientRequestIdSchema.optional(),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations,
      _meta: uiMeta(WIDGET_URI.jobAuto),
    }, async (args) => {
      // The source travels VERBATIM. In particular `edit_prompt` absent stays
      // absent: it is the render-only request, and inventing an empty string
      // here would buy the caller an authoring pass they did not ask for.
      const source =
        args.source.kind === "prompt"
          ? { kind: "prompt" as const, prompt: args.source.prompt, ...(args.source.references ? { references: args.source.references } : {}),
              ...(args.source.input_assets === undefined ? {} : { inputAssets: args.source.input_assets }) }
          : args.source.kind === "scene"
            ? {
                kind: "scene" as const,
                revisionId: args.source.revision_id,
                ...(args.source.source_job_id === undefined ? {} : { sourceJobId: args.source.source_job_id }),
                ...(args.source.edit_prompt === undefined ? {} : { editPrompt: args.source.edit_prompt }),
              }
            : { kind: "local-export" as const, exportId: args.source.export_id, connectionId: args.source.connection_id }

      const body = {
        source,
        ...(args.engine === undefined ? {} : { engine: args.engine }),
        ...(args.duration_seconds === undefined ? {} : { durationSeconds: args.duration_seconds }),
        ...(args.fps === undefined ? {} : { fps: args.fps }),
        ...(args.aspect_ratio === undefined ? {} : { aspectRatio: args.aspect_ratio }),
        ...(args.quality === undefined ? {} : { quality: args.quality }),
        ...(args.style === undefined ? {} : { style: args.style }),
        ...(args.max_repair_passes === undefined ? {} : { maxRepairPasses: args.max_repair_passes }),
        userId: session.userId, mcp_client: session.clientName,
      }

      // Quote, then submit the SAME body. Two requests, still one paid job:
      // the quote spends nothing and its hash is what admission re-checks, so
      // an agent can never start a run at a price nothing produced.
      const quoted = await mcpInject(fastify, session, { method: "POST", url: "/v1/pro-3d-render/quote", payload: body })
      if (quoted.statusCode >= 400) return errorResult(quoted.statusCode, quoted.body)
      let quoteId: unknown
      try { quoteId = (JSON.parse(quoted.body) as { quoteId?: unknown }).quoteId } catch { quoteId = undefined }
      if (typeof quoteId !== "string" || quoteId.length === 0) return parseFailure(quoted.body)

      return dispatchJob(fastify, session, {
        // The SAME route the SDK and the canvas post to — one transport, one
        // set of refusals, one result shape.
        url: "/v1/pro-3d-render",
        payload: { ...body, quoteId },
        // The run route requires a bounded key. A FRESH one per call, never
        // derived from the arguments: two deliberate "again" calls must be two
        // runs, while an explicit `client_request_id` makes a retry safe.
        clientRequestId: args.client_request_id ?? `pro3d-${randomUUID()}`,
        label: "3D Render Pro", widgetKind: "video",
        widgetData: { prompt: source.kind === "prompt" ? source.prompt : source.kind === "scene" ? (source.editPrompt ?? "Render existing scene") : "Local export", model: "3d-render-pro" },
      })
    })
  }

  server.registerTool("render_3d_scene", {
    title: "Render 3D Scene",
    description: "Render an exact Scene3DPlan revision to MP4 using Nodaro's existing render-video engine. " +
      "No LLM call. Camera, duration and framing come from the scene plan. Returns a job_id; " +
      "use the completed video as a motion/layout reference alongside the original appearance images.",
    inputSchema: { scene_plan: z.record(z.string(), z.unknown()) },
    outputSchema: JOB_OUTPUT_SCHEMA,
    annotations,
    _meta: uiMeta(WIDGET_URI.jobAuto),
  }, async (args) => dispatchJob(fastify, session, {
    url: "/v1/render-video/plan",
    payload: { planType: "3d-scene", plan: args.scene_plan, userId: session.userId, mcp_client: session.clientName },
    label: "3D scene render", widgetKind: "video",
    widgetData: { prompt: "3D clay scene", model: "3d-scene" },
  }))
}
