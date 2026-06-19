import { useNodeFinalPrompt } from "@/components/editor/config-panels/use-node-final-prompt"
import { PromptFieldFinalView } from "@/components/editor/config-panels/prompt-field-final-view"

/**
 * Read-only render of a node's assembled FINAL prompt on the canvas, using the
 * SAME machinery as the config panel's final view ({@link useNodeFinalPrompt}),
 * so node-Final == panel-Final == run. Kept as its own component so the
 * assembly hook only mounts when the node's view mode is Final or Both — nodes
 * in plain Edit mode never pay the cost.
 */
export function InlineFinalPrompt({ nodeId }: { readonly nodeId: string }) {
  const finalPrompt = useNodeFinalPrompt(nodeId)
  return (
    <PromptFieldFinalView
      segments={finalPrompt.promptSegments}
      plainText={finalPrompt.promptText}
      placeholder="Final prompt preview — nothing to assemble yet"
      minHeightRem={2 * 1.5}
    />
  )
}
