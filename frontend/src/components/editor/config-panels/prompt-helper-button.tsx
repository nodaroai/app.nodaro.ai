"use client"

import { useState, useMemo } from "react"
import { Sparkles } from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { hasCredits } from "@/lib/edition"
import { isWizardSupported, type ModelChange } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { PromptHelperDialog } from "./prompt-helper-dialog"

interface PromptHelperButtonProps {
  readonly nodeType: string
  readonly currentPrompt: string
  readonly provider?: string
  readonly aspectRatio?: string
  readonly duration?: number
  readonly onAccept: (enhancedPrompt: string, modelChange?: ModelChange) => void
  /** Visual size. "sm" (default) is the inline config-panel chip; "md" is a
   *  slightly larger, more prominent variant for surfaces where it's the
   *  primary action (e.g. the quick-edit Prompt modal). */
  readonly size?: "sm" | "md"
}

const IMAGE_SOURCE_TYPES = new Set([
  "generate-image", "upload-image", "edit-image", "image-to-image",
])

export function PromptHelperButton({
  nodeType,
  currentPrompt,
  provider,
  aspectRatio,
  duration,
  onAccept,
  size = "sm",
}: PromptHelperButtonProps) {
  const [open, setOpen] = useState(false)
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId)
  const allEdges = useWorkflowStore((s) => s.edges)
  const allNodes = useWorkflowStore((s) => s.nodes)

  // Collect node context from connected edges
  const nodeContext = useMemo(() => {
    if (!selectedNodeId) return undefined
    if (nodeType === "text-prompt") return undefined // text-prompt uses downstream targeting, not upstream context

    const incomingEdges = allEdges.filter((e) => e.target === selectedNodeId)
    const connectedInputTypes: string[] = []
    const referenceImageUrls: string[] = []
    let hasSourceVideo = false

    for (const edge of incomingEdges) {
      const sourceNode = allNodes.find((n) => n.id === edge.source)
      if (!sourceNode?.type) continue
      connectedInputTypes.push(sourceNode.type)
      if (IMAGE_SOURCE_TYPES.has(sourceNode.type)) {
        // Extract image URL from connected node's result data
        const d = sourceNode.data as Record<string, unknown>
        const results = d.generatedResults as Array<{ url: string }> | undefined
        const activeIdx = (d.activeResultIndex as number) ?? 0
        const imageUrl = results?.[activeIdx]?.url ?? (d.generatedImageUrl as string) ?? (d.url as string)
        if (imageUrl) referenceImageUrls.push(imageUrl)
      }
      if (sourceNode.type.includes("video") || sourceNode.type === "upload-video") hasSourceVideo = true
    }

    const referenceImageCount = referenceImageUrls.length
    if (!connectedInputTypes.length && !referenceImageCount && !hasSourceVideo) return undefined

    return { connectedInputTypes, referenceImageCount, referenceImageUrls, hasSourceVideo }
  }, [selectedNodeId, allEdges, allNodes, nodeType])

  // For text-prompt nodes: detect downstream wizard-supported nodes
  const downstreamTargets = useMemo(() => {
    if (nodeType !== "text-prompt" || !selectedNodeId) return undefined

    const outgoingEdges = allEdges.filter((e) => e.source === selectedNodeId)
    const targets: Array<{ id: string; type: string; label: string }> = []
    const seenTypes = new Set<string>()

    for (const edge of outgoingEdges) {
      const targetNode = allNodes.find((n) => n.id === edge.target)
      if (!targetNode?.type || seenTypes.has(targetNode.type)) continue
      if (isWizardSupported(targetNode.type) && targetNode.type !== "text-prompt") {
        seenTypes.add(targetNode.type)
        const label = (targetNode.data as Record<string, unknown>).label as string | undefined
        targets.push({
          id: targetNode.id,
          type: targetNode.type,
          label: label || targetNode.type,
        })
      }
    }

    return targets
  }, [nodeType, selectedNodeId, allEdges, allNodes])

  if (!hasCredits()) return null
  if (!isWizardSupported(nodeType)) return null

  // Read style from current node data
  const currentNode = allNodes.find((n) => n.id === selectedNodeId)
  const currentStyle = (currentNode?.data as Record<string, unknown>)?.style as string | undefined

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={
              "inline-flex items-center gap-1 justify-center rounded-md border border-[#ff0073]/30 bg-[#ff0073]/5 text-[#ff0073] hover:bg-[#ff0073]/15 hover:border-[#ff0073]/50 transition-colors font-medium whitespace-nowrap " +
              (size === "md"
                ? "px-2.5 py-1.5 text-xs"
                : "px-2 py-0.5 min-h-[32px] sm:min-h-0 text-[10px]")
            }
          >
            <Sparkles className={size === "md" ? "w-3.5 h-3.5" : "w-3 h-3"} />
            Generate with AI
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">AI Prompt Wizard</TooltipContent>
      </Tooltip>
      {open && (
        <PromptHelperDialog
          open={open}
          onClose={() => setOpen(false)}
          nodeType={nodeType}
          currentPrompt={currentPrompt}
          provider={provider}
          style={currentStyle}
          aspectRatio={aspectRatio}
          duration={duration}
          nodeContext={nodeContext}
          downstreamTargets={downstreamTargets}
          onAccept={onAccept}
        />
      )}
    </>
  )
}
