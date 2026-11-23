// frontend/src/components/nodes/inline-node-prompt/use-inline-prompt-active.ts
import { useStore } from "@xyflow/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { nodeHasInlinePrompt } from "@/lib/prompt-fields"
import { useCanvasMode } from "../read-only-canvas-context"

/**
 * Whether a node should show its inline on-node prompt editor right now.
 *
 * Pure derivation of three signals:
 *  - the global "Inline Prompts" canvas toggle (`inlinePromptMode`);
 *  - React Flow interactivity (`elementsSelectable` — false in the read-only
 *    viewer / template-preview modal, where the inline editor must NOT show);
 *  - the per-node-type `inline` capability in `NODE_PROMPT_FIELDS`.
 *
 * Because it's a pure function of those three, `BaseNode` (which centrally
 * renders `InlineNodePrompt`) and the two gold nodes (generate-image / -video,
 * which still need `showInline` for preview rounding, the video card-chrome
 * strip, and handle offsets) can each call it independently with zero drift —
 * there is exactly one definition of "inline is on for this node".
 *
 * The view link's canvas (`view` mode) is the exception: a prompt is part of
 * what is shared, so every prompt-capable node shows it there whatever this
 * browser chose, and the read-only store refuses any edit. The sub-workflow
 * viewer (`view-detached`) keeps it off: the store it would read is the
 * editor's, not the viewed workflow's.
 */
export function useInlinePromptActive(nodeType: string | undefined): boolean {
  const inlinePromptMode = useWorkflowStore((s) => s.inlinePromptMode)
  const elementsSelectable = useStore((s) => s.elementsSelectable)
  const canvasMode = useCanvasMode()
  if (canvasMode === "view") return nodeHasInlinePrompt(nodeType)
  return inlinePromptMode && elementsSelectable && nodeHasInlinePrompt(nodeType)
}
