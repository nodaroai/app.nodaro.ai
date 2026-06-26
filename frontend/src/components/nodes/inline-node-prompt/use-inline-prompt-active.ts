// frontend/src/components/nodes/inline-node-prompt/use-inline-prompt-active.ts
import { useStore } from "@xyflow/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { nodeHasInlinePrompt } from "@/lib/prompt-fields"

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
 */
export function useInlinePromptActive(nodeType: string | undefined): boolean {
  const inlinePromptMode = useWorkflowStore((s) => s.inlinePromptMode)
  const elementsSelectable = useStore((s) => s.elementsSelectable)
  return inlinePromptMode && elementsSelectable && nodeHasInlinePrompt(nodeType)
}
