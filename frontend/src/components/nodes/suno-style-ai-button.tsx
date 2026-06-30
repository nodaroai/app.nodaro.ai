"use client"

import { PromptHelperButton } from "@/components/editor/config-panels/prompt-helper-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { SunoGenerateData, FieldMappings } from "@/types/nodes"

/** ✨ AI for the Suno Style field — runs the wizard with the `suno-generate:style`
 *  target (style TAGS, not prose) and writes `data.style`. Hidden when the field
 *  is wired (read-only). `nodeId` is explicit so it works from the field-edit
 *  modal, not just the globally-selected node. */
export function SunoStyleAiButton({ nodeId }: { readonly nodeId: string }) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const data = useWorkflowStore((s) => s.nodes.find((n) => n.id === nodeId)?.data) as
    | SunoGenerateData
    | undefined
  if ((data?.fieldMappings as FieldMappings | undefined)?.style) return null
  return (
    <PromptHelperButton
      nodeType="suno-generate:style"
      nodeId={nodeId}
      currentPrompt={data?.style ?? ""}
      size="sm"
      onAccept={(tags, modelChange) =>
        updateNodeData(nodeId, {
          style: tags,
          ...(modelChange && { [modelChange.field]: modelChange.value }),
        })
      }
    />
  )
}
