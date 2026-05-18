import type { SupabaseClient } from "@supabase/supabase-js"
import { randomUUID } from "node:crypto"

/**
 * Canvas materialization service.
 *
 * Phase 1B.1: static creates only. After an entity is approved, the engine calls
 * `materializeEntityOnCanvas` to push a Character/Object/Location node onto the
 * parent workflow's canvas so the user sees the bound DB row reflected in the
 * editor. ELK auto-layout + insertion animations land in Phase 1B.4.
 *
 * Schema notes (verified against migrations 001 + 121):
 *  - `workflows` stores nodes in a `nodes` JSONB column and edges in a separate
 *    `edges` JSONB column (NOT a single `workflow_json` column).
 *  - `pipeline_entity_nodes` binds a `pipeline_entities.id` to a React Flow
 *    `node_id` string via `(entity_id, node_id, role, pipeline_state)`.
 *  - `assets` stores the public URL in `r2_url`.
 */

type CanvasNode = {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}

export interface MaterializeEntityArgs {
  supabase: SupabaseClient
  pipelineId: string
  pipelineEntityId: string
  entityType: "character" | "object" | "location"
  entityKey: string
  entityName: string
  visualDescription: string
  mainAssetId: string
  mainAssetUrl: string
  /**
   * Position on canvas. Phase 1B.1 uses a simple grid layout (see
   * `computeCanvasPosition` in entity-approval.ts). Phase 1B.4 swaps in ELK.
   */
  position: { x: number; y: number }
}

/**
 * Creates a Character/Object/Location node in the parent workflow's `nodes`
 * column AND inserts a `pipeline_entity_nodes` row binding the entity to the
 * canvas node.
 *
 * Idempotent: if a `pipeline_entity_nodes` row already exists for this entity
 * with role='main', the canvas write is skipped (re-running approve after a
 * restart won't double-insert nodes).
 *
 * No-op when the pipeline has no `workflow_id` (programmatic activation mode —
 * the pipeline runs without a canvas).
 */
export async function materializeEntityOnCanvas(
  args: MaterializeEntityArgs,
): Promise<void> {
  // 1. Idempotency check — skip if already bound.
  const { data: existing } = await args.supabase
    .from("pipeline_entity_nodes")
    .select("node_id")
    .eq("entity_id", args.pipelineEntityId)
    .eq("role", "main")
    .maybeSingle()
  if (existing?.node_id) return

  // 2. Resolve workflow_id from the pipeline row.
  const { data: pipeline } = await args.supabase
    .from("pipelines")
    .select("workflow_id")
    .eq("id", args.pipelineId)
    .single()
  if (!pipeline?.workflow_id) {
    // No canvas bound (programmatic mode) — nothing to materialize.
    return
  }
  const workflowId = pipeline.workflow_id as string

  // 3. Load existing nodes.
  const { data: workflow } = await args.supabase
    .from("workflows")
    .select("nodes")
    .eq("id", workflowId)
    .single()
  const existingNodes: CanvasNode[] = Array.isArray(workflow?.nodes)
    ? (workflow.nodes as CanvasNode[])
    : []

  // 4. Build the new node. Field shape mirrors `defaultData` in
  //    `frontend/src/types/nodes.ts` NODE_DEFINITIONS plus the
  //    pipeline-binding metadata the frontend needs to render the locked /
  //    pipeline_owned styling in Phase 1B.4.
  const nodeId = `${args.entityType}-${args.entityKey}-${randomUUID().slice(0, 8)}`
  const baseData = buildEntityNodeData(args)
  const node: CanvasNode = {
    id: nodeId,
    type: nodeTypeFor(args.entityType),
    position: args.position,
    data: baseData,
  }

  // 5. Persist canvas + binding. Update first, then insert the binding so a
  //    crash between the two leaves the binding absent (next approve attempt
  //    will see the node-in-nodes but no binding and a future Phase 1B.4
  //    reconciliation pass can detect / repair). For Phase 1B.1, the
  //    user-visible effect of a double-write is harmless (two nodes on canvas)
  //    and is gated upstream by `approveEntity`'s optimistic-concurrency check.
  await args.supabase
    .from("workflows")
    .update({ nodes: [...existingNodes, node] })
    .eq("id", workflowId)

  await args.supabase.from("pipeline_entity_nodes").insert({
    entity_id: args.pipelineEntityId,
    node_id: nodeId,
    role: "main",
    pipeline_state: "pipeline_owned_approved",
  })
}

function nodeTypeFor(
  entityType: "character" | "object" | "location",
): string {
  // Verified against `frontend/src/components/nodes/index.ts` nodeTypes map
  // and NODE_DEFINITIONS in `frontend/src/types/nodes.ts`.
  if (entityType === "character") return "character"
  if (entityType === "object") return "object"
  return "location"
}

/**
 * Builds the `data` payload for the new canvas node. Mirrors the shape of
 * NODE_DEFINITIONS[type].defaultData for the matching entity type so React
 * Flow renders the node without warnings, then layers pipeline-binding fields
 * on top so the frontend can recognize the node as pipeline-owned.
 */
function buildEntityNodeData(args: MaterializeEntityArgs): Record<string, unknown> {
  // Common fields — every entity node has these (verified in
  // frontend/src/types/nodes.ts NODE_DEFINITIONS).
  const pipelineMeta: Record<string, unknown> = {
    pipeline_entity_id: args.pipelineEntityId,
    pipeline_owned: true,
    visual_description: args.visualDescription,
    main_image_url: args.mainAssetUrl,
    main_asset_id: args.mainAssetId,
    pipeline_state: "pipeline_owned_approved",
  }

  if (args.entityType === "character") {
    return {
      label: args.entityName,
      characterDbId: "",
      characterName: args.entityName,
      description: args.visualDescription,
      sourceImageUrl: args.mainAssetUrl,
      gender: "other",
      style: "realistic",
      baseOutfit: "",
      characterSheet: null,
      projectId: "",
      createdAt: "",
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
      fieldMappings: {},
      expressionSheet: "",
      poseSheet: "",
      lightingSheet: "",
      anglesSheet: "",
      expressions: [],
      poses: [],
      lightingVariations: [],
      angles: [],
      bodyAngles: [],
      expressionStatus: "idle",
      poseStatus: "idle",
      lightingStatus: "idle",
      anglesStatus: "idle",
      bodyAnglesStatus: "idle",
      customVariations: [],
      motions: [],
      motionStatus: "idle",
      voice: null,
      personality: null,
      ...pipelineMeta,
    }
  }

  if (args.entityType === "object") {
    return {
      label: args.entityName,
      objectDbId: "",
      objectName: args.entityName,
      description: args.visualDescription,
      category: "other",
      style: "realistic",
      sourceImageUrl: args.mainAssetUrl,
      projectId: "",
      createdAt: "",
      executionStatus: "idle",
      generatedResults: [],
      activeResultIndex: 0,
      fieldMappings: {},
      angles: [],
      materials: [],
      variations: [],
      anglesStatus: "idle",
      materialsStatus: "idle",
      variationsStatus: "idle",
      customVariations: [],
      ...pipelineMeta,
    }
  }

  // location
  return {
    label: args.entityName,
    locationDbId: "",
    locationName: args.entityName,
    description: args.visualDescription,
    category: "other",
    style: "realistic",
    sourceImageUrl: args.mainAssetUrl,
    projectId: "",
    createdAt: "",
    executionStatus: "idle",
    generatedResults: [],
    activeResultIndex: 0,
    fieldMappings: {},
    timeOfDay: [],
    weather: [],
    angles: [],
    timeOfDayStatus: "idle",
    weatherStatus: "idle",
    anglesStatus: "idle",
    customVariations: [],
    ...pipelineMeta,
  }
}
