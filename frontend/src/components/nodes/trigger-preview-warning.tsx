"use client"

import { AlertTriangle } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { triggerBranchPreviewKind } from "@/components/editor/workflow-editor/preview-gate"
import { previewRefusalKey } from "@/lib/preview-refusal-text"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { useT } from "@/lib/i18n"

/**
 * On an ARMED trigger whose branch holds a Preview render (or a review-on
 * use-case node): nobody is there to
 * review what a fire renders, so the server refuses every fire (decided
 * 2026-10-04). Said on the card before the first one is refused. Each trigger
 * card passes its own notion of armed (a schedule switched on, a listening
 * bot, an issued webhook URL).
 */
export function TriggerPreviewWarning({ nodeId, armed }: { readonly nodeId: string; readonly armed: boolean }) {
  const t = useT()
  // What holds the branch (a primitive, so the selector stays cheap): its remedy names it.
  const kind = useWorkflowStore((s: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }) =>
    armed ? triggerBranchPreviewKind(nodeId, s.nodes, s.edges) : null,
  )
  if (!kind) return null
  return (
    <p role="alert" className="mx-3.5 mb-2.5 flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-[10px] leading-snug text-amber-700 dark:text-amber-300">
      <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
      <span>{t(previewRefusalKey("trigger", kind))}</span>
    </p>
  )
}
