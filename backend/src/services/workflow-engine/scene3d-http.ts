import { buildPayload, type PayloadBuildContext } from "./payload-builder.js"
import type { OrchestratorContext, ResolvedInputs, SimpleNode } from "./types.js"

/**
 * The scene-authoring node types the orchestrator runs THROUGH their HTTP
 * route rather than by queueing a payload itself.
 *
 * One predicate, because every behaviour keyed on it — crash adoption, the
 * execution-id stamp, how a settled charge is read back — is a property of
 * "this node's route owns its own job", not of any individual node. A new
 * member added to the route map and forgotten here is exactly how one of
 * those behaviours silently stops applying.
 */
export const SCENE3D_HTTP_NODE_TYPES: ReadonlySet<string> = new Set([
  "generate-3d-scene",
  "edit-3d-scene",
  // `PRO3D_RENDER_NODE_TYPE`, spelled literally: this module loads inside
  // `node-executor`, which several suites import while partially mocking
  // `@nodaro/shared` — a constant read at module scope there resolves to
  // undefined and takes the whole file down. The other members are literals
  // for the same reason, and the route-parity suite pins the string.
  "pro-3d-render",
])

export function isScene3DAuthoringType(type: string | undefined): boolean {
  return type !== undefined && SCENE3D_HTTP_NODE_TYPES.has(type)
}

/** Reuse graph resolution, then let the authoring route own validation,
 * references/analysis, reservation and enqueueing on every execution surface. */
export function buildScene3DHttpBody(
  node: SimpleNode,
  inputs: ResolvedInputs,
  ctx: OrchestratorContext,
  graph: PayloadBuildContext,
  userPrompt?: string,
): Record<string, unknown> {
  const { payload } = buildPayload(node, node.id, inputs, undefined, graph)
  const common = {
    userId: ctx.userId,
    workflowId: ctx.workflowId,
    nodeId: node.id,
    ...(payload.engine ? {} : { llmModel: payload.llmModel, reasoningEffort: payload.reasoningEffort }),
    references: payload.references,
    ...(userPrompt === undefined ? {} : { userPrompt }),
    ...(ctx.uploadDescendantIds?.has(node.id) ? { forcePrivate: true } : {}),
  }
  if (node.type === "pro-3d-render") {
    // The SAME body an SDK or MCP caller posts to `/v1/pro-3d-render`, so the
    // in-graph run and the direct call are one transport with one set of
    // refusals. `payload.source` was built by the shared source builder, so a
    // render-only scene source keeps its absent `editPrompt` verbatim and the
    // timing overrides are already omitted unless the node asked to re-time.
    //
    // No model or effort field: the planner is fixed and server-owned
    // (`common` carries both for the Basic lane, which does let a caller pick).
    return {
      userId: common.userId, workflowId: common.workflowId, nodeId: common.nodeId,
      ...(userPrompt === undefined ? {} : { userPrompt }),
      ...(ctx.uploadDescendantIds?.has(node.id) ? { forcePrivate: true } : {}),
      source: payload.source,
      engine: payload.engine,
      ...(payload.quality === undefined ? {} : { quality: payload.quality }),
      ...(payload.style === undefined ? {} : { style: payload.style }),
      ...(payload.maxRepairPasses === undefined ? {} : { maxRepairPasses: payload.maxRepairPasses }),
      ...(payload.durationSeconds === undefined ? {} : { durationSeconds: payload.durationSeconds }),
      ...(payload.fps === undefined ? {} : { fps: payload.fps }),
      ...(payload.aspectRatio === undefined ? {} : { aspectRatio: payload.aspectRatio }),
    }
  }
  // The lane the shared resolver picked, carried onto the wire. Absent on the
  // Basic lane (which keeps its body byte-identical to what it always sent),
  // and the ONLY thing that makes `/v1/3d-scene/{generate,edit}` hand the
  // request to the installed advanced engine — so a headless run and a canvas
  // run of the same node reach the same engine.
  const lane = {
    ...(payload.engine === undefined ? {} : { engine: payload.engine }),
    ...(payload.acceptedSceneSchemaVersions === undefined
      ? {}
      : { acceptedSceneSchemaVersions: payload.acceptedSceneSchemaVersions }),
  }
  if (node.type === "generate-3d-scene") {
    return { ...common, ...lane, prompt: payload.prompt, fps: payload.fps,
      durationSeconds: Number(payload.durationInFrames) / Number(payload.fps),
      aspectRatio: node.data.aspectRatio ?? "16:9" }
  }
  return { ...common, ...lane, scenePlan: payload.plan, expectedRevisionId: payload.expectedRevisionId,
    prompt: payload.instruction, operations: payload.operations,
    lockedObjectIds: payload.lockedObjectIds, selectedObjectIds: payload.selectedObjectIds }
}
