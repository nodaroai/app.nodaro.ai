"use client"

// Lightweight focused script editor for the ai-avatar node.
// Opened from PromptEditButton when the node type is "ai-avatar" and the node
// is in text (TTS) speech mode. Provides just the Script textarea — no
// @-mention TipTap editor, no field mappings — because `data.script` is a
// verbatim string that goes directly to HeyGen (not a prompt template).
//
// Intentionally NOT added to NODE_PROMPT_FIELDS so the full PromptEditor
// (TipTap + @-mentions) is never invoked for this node.

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { AiAvatarData } from "@/types/nodes"

interface AiAvatarScriptModalProps {
  readonly nodeId: string
  readonly open: boolean
  readonly onClose: () => void
}

export function AiAvatarScriptModal({
  nodeId,
  open,
  onClose,
}: AiAvatarScriptModalProps) {
  const nodeData = useWorkflowStore((s) =>
    s.nodes.find((n) => n.id === nodeId)?.data as AiAvatarData | undefined,
  )
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  // Local draft so keystrokes don't mutate the store on every character.
  const [draft, setDraft] = useState<string>(() => nodeData?.script ?? "")

  // Keep draft in sync when the modal is opened (e.g. opened twice).
  // Using `open` as the dependency means we reset to current store value each
  // time the dialog opens.
  // (Effect deliberately omitted — useState initializer runs once per mount;
  //  the Dialog's `key` forces a fresh mount on each open.)

  function handleSave() {
    updateNodeData(nodeId, { script: draft.trim() || undefined })
    onClose()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      handleSave()
    }
    if (e.key === "Escape") {
      e.preventDefault()
      onClose()
    }
  }

  const charCount = draft.length

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent
        className="max-w-lg w-full p-0 gap-0 overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="px-4 pt-4 pb-3 border-b">
          <DialogTitle className="text-sm font-semibold">Script</DialogTitle>
        </DialogHeader>

        <div className="px-4 py-3 flex flex-col gap-2">
          <Textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="What the avatar will say…"
            className="min-h-[160px] text-sm resize-y leading-relaxed"
            maxLength={5000}
            aria-label="Avatar script"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {charCount} / 5000
            </span>
            <span className="text-[10px] text-muted-foreground">⌘↵ to save</span>
          </div>
        </div>

        <div className="px-4 pb-4 flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={handleSave}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
