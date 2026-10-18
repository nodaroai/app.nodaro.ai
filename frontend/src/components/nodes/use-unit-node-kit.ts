// frontend/src/components/nodes/use-unit-node-kit.ts — the node-unit kit of a
// canvas component (frontend/src/nodes/kit.ts `UnitNodeKit`, §5.8 B, decided
// 2026-10-16; tools/units/README.md). A unit's node.tsx calls it instead of
// importing the workflow store, which sits in the editor's import cycle (G5);
// this module is outside that cycle and is not a registry composer, so a unit
// may import it like any shared node helper (BaseNode, RunNodeButton).
import { useMemo } from "react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { UnitNodeKit } from "@/nodes/kit"

/** The store services bound to node `nodeId`. Stable while the values it reads are. */
export function useUnitNodeKit(nodeId: string): UnitNodeKit {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === nodeId)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)
  return useMemo<UnitNodeKit>(() => ({
    isSettingsOpen,
    videoAutoplay,
    updateNodeData: (patch) => updateNodeData(nodeId, patch),
    run: () => { runSingleNode?.(nodeId) },
    toggleSettings: () => selectNode(isSettingsOpen ? null : nodeId),
    openFreeCut: (videoUrl, freecutProjectUrl) => openFreeCut(nodeId, videoUrl, freecutProjectUrl),
  }), [nodeId, isSettingsOpen, videoAutoplay, updateNodeData, runSingleNode, selectNode, openFreeCut])
}
