import { z } from "zod"
import { SCENE3D_LIMITS, scene3DReferenceSchema } from "@nodaro/shared"
import { safeUrlSchema } from "../../url-validator.js"
import { passesGate } from "../tool-schemas.js"
import { WIDGET_URI } from "../widgets/registrar.js"
import { dispatchJob, JOB_OUTPUT_SCHEMA, uiMeta } from "./_verb-helpers.js"
import type { RegisterOpts } from "./verbs-image.js"

const referenceSchema = scene3DReferenceSchema.extend({
  url: scene3DReferenceSchema.shape.url.pipe(safeUrlSchema),
})

export const SCENE3D_MCP_AUTHORING_FIELDS = {
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
      prompt: args.prompt, operations: args.operations,
      lockedObjectIds: args.locked_object_ids, selectedObjectIds: args.selected_object_ids,
      references: args.references, llmModel: args.llm_model, reasoningEffort: args.reasoning_effort,
      userId: session.userId, mcp_client: session.clientName,
    },
    label: "3D scene edit", widgetKind: "generic",
    widgetData: { prompt: args.prompt ?? "Edit scene properties", model: args.llm_model },
  }))

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
