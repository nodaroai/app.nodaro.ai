import type { Scene3DV2EditOperation } from "@nodaro/shared"
import type { Edit3DSceneData, Generate3DSceneData } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { nodaroClient } from "@/lib/nodaro-client"
import { planRevisionId } from "@/lib/scene3d/plan-view"
import { resolveSceneCompletion } from "@/lib/scene3d/revisions"

/** Persist first; adopt against the current node rather than a captured panel snapshot. */
export async function saveScene3DEdit(nodeId: string, edit: {
  operations: Scene3DV2EditOperation[]; expectedRevisionId: string; expectedContentHash: string;
}): Promise<void> {
  const initial = useWorkflowStore.getState()
  const node = initial.nodes.find((candidate) => candidate.id === nodeId)
  if (!node || initial.readOnlyReason) throw new Error("Scene editing is unavailable")
  const data = node.data as Generate3DSceneData | Edit3DSceneData
  if (planRevisionId(data.scenePlan) !== edit.expectedRevisionId) throw new Error("The scene changed before this edit was saved")
  const lockedObjectIds = data.lockedObjectIds ? [...data.lockedObjectIds] : undefined
  const result = await nodaroClient.scene3d.applyEdits(edit.expectedRevisionId, {
    newRevisionId: crypto.randomUUID(), expectedContentHash: edit.expectedContentHash,
    operations: edit.operations, lockedObjectIds,
  })
  const latest = useWorkflowStore.getState()
  if (latest.workflowId !== initial.workflowId || latest.loadGeneration !== initial.loadGeneration || latest.readOnlyReason) return
  const currentNode = latest.nodes.find((candidate) => candidate.id === nodeId)
  if (!currentNode) return
  const current = currentNode.data as Generate3DSceneData | Edit3DSceneData
  const { patch } = resolveSceneCompletion({
    current: current.scenePlan, baseRevisionId: edit.expectedRevisionId,
    incoming: result.scenePlan as unknown as Record<string, unknown>,
    changeSummary: result.changeSummary, history: current.sceneHistory, source: "manual",
    context: { lockedObjectIds },
  })
  // A free manual edit must not clear another authoring job's resume marker.
  const { sceneJobBaseRevisionId: _authoringMarker, ...scenePatch } = patch
  latest.updateNodeData(nodeId, scenePatch)
}
