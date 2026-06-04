"use client"

import { Pencil, Paintbrush, type LucideIcon } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { getPromptFields, nodeHasPromptField } from "@/lib/prompt-fields"

/**
 * Map a node's string icon kind (from the pure-data `prompt-fields` registry)
 * to a concrete lucide component. Lives here, the only place icons render, so
 * `prompt-fields.ts` stays icon-library-free (importable into the app bundle
 * and tests without dragging in lucide). Image-edit nodes get a paintbrush;
 * everything else defaults to a pencil.
 */
export function getPromptIcon(nodeType: string | undefined): LucideIcon {
  return getPromptFields(nodeType)?.icon === "paintbrush" ? Paintbrush : Pencil
}

interface PromptEditButtonProps {
  readonly nodeId: string
  /** Icon-only rendering for the compact toolbar pill row. */
  readonly compact?: boolean
}

/**
 * Left-most button of a node's bottom config strip (the goal layout: Prompt →
 * configs → Run). Always rendered on a strip so every AI node has it:
 *  - nodes WITH a prompt field → opens the quick-edit Prompt modal;
 *  - transform/utility nodes with NO text input → opens the node's full
 *    settings, so the button stays functional and the left slot is consistent.
 */
export function PromptEditButton({ nodeId, compact }: PromptEditButtonProps) {
  const nodeType = useWorkflowStore((s) => s.nodes.find((n) => n.id === nodeId)?.type)
  const openPromptEditor = useWorkflowStore((s) => s.openPromptEditor)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const setConfigPanelFullscreen = useWorkflowStore((s) => s.setConfigPanelFullscreen)
  const hasPrompt = nodeHasPromptField(nodeType)
  const Icon = getPromptIcon(nodeType)
  return (
    <button
      type="button"
      title={hasPrompt ? "Edit prompt (⌘E)" : "Edit settings"}
      aria-label="Edit prompt"
      onClick={(e) => {
        e.stopPropagation()
        if (hasPrompt) {
          openPromptEditor(nodeId)
        } else {
          selectNode(nodeId)
          setConfigPanelFullscreen(true)
        }
      }}
      className="flex items-center gap-1 h-6 px-1.5 rounded-md text-[10px] font-medium whitespace-nowrap text-primary hover:bg-primary/10"
    >
      <Icon className="w-3 h-3" />
      {!compact && <span>Prompt</span>}
    </button>
  )
}
