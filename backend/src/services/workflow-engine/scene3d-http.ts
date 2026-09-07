import { buildPayload, type PayloadBuildContext } from "./payload-builder.js"
import type { OrchestratorContext, ResolvedInputs, SimpleNode } from "./types.js"

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
    llmModel: payload.llmModel,
    reasoningEffort: payload.reasoningEffort,
    references: payload.references,
    ...(userPrompt === undefined ? {} : { userPrompt }),
    ...(ctx.uploadDescendantIds?.has(node.id) ? { forcePrivate: true } : {}),
  }
  if (node.type === "generate-3d-scene") {
    return { ...common, prompt: payload.prompt, fps: payload.fps,
      durationSeconds: Number(payload.durationInFrames) / Number(payload.fps),
      aspectRatio: node.data.aspectRatio ?? "16:9" }
  }
  return { ...common, scenePlan: payload.plan, expectedRevisionId: payload.expectedRevisionId,
    prompt: payload.instruction, operations: payload.operations,
    lockedObjectIds: payload.lockedObjectIds, selectedObjectIds: payload.selectedObjectIds }
}
