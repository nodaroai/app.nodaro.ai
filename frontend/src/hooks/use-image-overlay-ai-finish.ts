import { useCallback } from "react"
import { toast } from "sonner"
import { useT } from "@/lib/i18n"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { ImageOverlayData } from "@/types/nodes"

/**
 * "Make it look part of the picture": one click adds a Modify Image node
 * after the overlay, wired to BOTH its outputs — the composite as the image
 * to edit and the node's mask as the region the model may touch. With the
 * mask in "around" mode that region is a ring AROUND the placed elements, so
 * the AI paints contact shadows, reflections and matching light where the
 * elements meet the scene while the elements themselves stay pixel-exact
 * (the server keeps every masked-out pixel from the composite). A
 * Composition Effects picker can then be wired into the same Modify Image
 * node's prompt like any other.
 */
export const AI_FINISH_PROMPT =
  "Blend the newly placed elements into the scene so they look photographed in place: match their lighting direction and colour temperature to the surroundings, add a soft, physically plausible contact shadow and faint reflections where they meet surfaces, and keep the surrounding pixels otherwise unchanged. Do not alter, redraw or move the elements themselves."

const AI_FINISH_PROVIDER = "flux-fill"

export function useImageOverlayAiFinish(nodeId: string): { addAiFinish: () => string | null } {
  const t = useT()
  const addAiFinish = useCallback((): string | null => {
    const store = useWorkflowStore.getState()
    const source = store.nodes.find((n) => n.id === nodeId)
    if (!source) return null
    const data = source.data as ImageOverlayData
    // The ring around the layers is the only region the model may repaint.
    if (data.maskMode !== "around") store.updateNodeData(nodeId, { maskMode: "around" })

    const width = (source.measured?.width ?? source.width ?? 654) as number
    const targetId = store.addNode(
      "modify-image",
      { x: source.position.x + width + 120, y: source.position.y },
      { label: t("overlayAi.finishLabel"), prompt: AI_FINISH_PROMPT, provider: AI_FINISH_PROVIDER },
    )
    if (!targetId) {
      toast.error(t("overlayAi.finishFailed"))
      return null
    }
    store.onConnect({ source: nodeId, sourceHandle: "image", target: targetId, targetHandle: "image" })
    store.onConnect({ source: nodeId, sourceHandle: "mask", target: targetId, targetHandle: "mask" })
    return targetId
  }, [nodeId, t])

  return { addAiFinish }
}
