"use client"

import { PauseCircle } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { editorPreviewGatedIds } from "@/components/editor/workflow-editor/preview-gate"
import { isExecutableNode } from "@/components/editor/workflow-editor/types"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { useT } from "@/lib/i18n"

/**
 * "After Render final" on a node a Preview render gates (decided 2026-10-04).
 *
 * A run stops at a render set to Preview: this node is not run, counted or
 * billed in that run, and runs on the final. Derived from the graph alone
 * (`editorPreviewGatedIds`, the toolbar Run's view), so the chip is right
 * before any run, after one, and on reload. Mounted once by BaseNode and read
 * by node id, like <NodeConnectionBadge>: every node card, no prop.
 */
const NONE: never[] = []

export function NodePreviewGateChip({ nodeId }: { readonly nodeId: string }) {
  const t = useT()
  const gated = useWorkflowStore((s: { nodes?: WorkflowNode[]; edges?: WorkflowEdge[] }) => {
    const nodes = s.nodes ?? NONE
    if (!editorPreviewGatedIds(nodes, s.edges ?? NONE).has(nodeId)) return false
    const node = nodes.find((n) => n.id === nodeId)
    return !!node && isExecutableNode(node)
  })

  if (!gated) return null

  return (
    <div
      role="note"
      title={t("previewGate.chipHint")}
      className="absolute -top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-sky-500/50 bg-sky-950/85 px-2 py-0.5 text-[10px] font-medium text-sky-100 backdrop-blur-[2px]"
    >
      <PauseCircle className="h-3 w-3 text-sky-300" aria-hidden />
      <span>{t("previewGate.chip")}</span>
      <span className="sr-only">{t("previewGate.chipHint")}</span>
    </div>
  )
}
