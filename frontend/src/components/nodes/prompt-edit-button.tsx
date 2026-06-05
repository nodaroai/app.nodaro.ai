"use client"

import { useState } from "react"
import { Pencil, Paintbrush, type LucideIcon } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { getPromptFields, nodeHasPromptField } from "@/lib/prompt-fields"
import { AiAvatarScriptModal } from "@/components/nodes/ai-avatar-script-modal"
import type { AiAvatarData } from "@/types/nodes"

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
 *  - `ai-avatar` in text mode → opens the focused AiAvatarScriptModal
 *    (verbatim script field — NOT the TipTap PromptEditor with @-mentions);
 *  - transform/utility nodes with NO text input → opens the node's full
 *    settings, so the button stays functional and the left slot is consistent.
 */
export function PromptEditButton({ nodeId, compact }: PromptEditButtonProps) {
  const nodeType = useWorkflowStore((s) => s.nodes.find((n) => n.id === nodeId)?.type)
  const speechMode = useWorkflowStore((s) => {
    const node = s.nodes.find((n) => n.id === nodeId)
    return (node?.data as AiAvatarData | undefined)?.speechMode
  })
  const openPromptEditor = useWorkflowStore((s) => s.openPromptEditor)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const setConfigPanelFullscreen = useWorkflowStore((s) => s.setConfigPanelFullscreen)
  const hasPrompt = nodeHasPromptField(nodeType)
  const Icon = getPromptIcon(nodeType)

  // FIX 3 — focused script modal for ai-avatar (text mode only).
  const [scriptModalOpen, setScriptModalOpen] = useState(false)
  const isAiAvatarText = nodeType === "ai-avatar" && (speechMode ?? "text") === "text"

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (isAiAvatarText) {
      setScriptModalOpen(true)
    } else if (hasPrompt) {
      openPromptEditor(nodeId)
    } else {
      selectNode(nodeId)
      setConfigPanelFullscreen(true)
    }
  }

  return (
    <>
      <button
        type="button"
        title={isAiAvatarText ? "Edit script (⌘E)" : hasPrompt ? "Edit prompt (⌘E)" : "Edit settings"}
        aria-label={isAiAvatarText ? "Edit script" : "Edit prompt"}
        onClick={handleClick}
        className="flex items-center gap-1 h-6 px-1.5 rounded-md text-[10px] font-medium whitespace-nowrap text-primary hover:bg-primary/10"
      >
        <Icon className="w-3 h-3" />
        {!compact && <span>{isAiAvatarText ? "Script" : "Prompt"}</span>}
      </button>

      {/* Focused script editor — mounted for ai-avatar nodes while open
          (keep mounted even if speechMode is toggled mid-edit so the draft
          is not silently discarded; the modal closes via its own controls) */}
      {(isAiAvatarText || scriptModalOpen) && (
        <AiAvatarScriptModal
          key={scriptModalOpen ? "open" : "closed"}
          nodeId={nodeId}
          open={scriptModalOpen}
          onClose={() => setScriptModalOpen(false)}
        />
      )}
    </>
  )
}
