/**
 * Hook that reactively adopts an upstream URL when an upload node's "in" handle
 * is connected to a source with output data. Uses a derived selector so the
 * component only re-renders when the actual upstream output changes — not on
 * every unrelated node update in the workflow.
 */

import { useCallback, useEffect } from "react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"

export function useUpstreamUrl(
  id: string,
  currentExternalUrl: string | undefined,
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): void {
  const upstreamUrl = useWorkflowStore(
    useCallback((s) => {
      const inEdge = s.edges.find((e) => e.target === id && e.targetHandle === "in")
      if (!inEdge) return undefined
      const srcNode = s.nodes.find((n) => n.id === inEdge.source)
      if (!srcNode) return undefined
      return extractNodeOutput(srcNode, inEdge.sourceHandle ?? undefined)
    }, [id]),
  )

  useEffect(() => {
    if (!upstreamUrl || upstreamUrl === currentExternalUrl) return
    updateNodeData(id, { url: upstreamUrl, externalUrl: upstreamUrl })
  }, [id, upstreamUrl, currentExternalUrl, updateNodeData])
}
