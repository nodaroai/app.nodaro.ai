/**
 * An AI Avatar node's own pill in audio mode: the length of the audio it is
 * quoted on, read from the canvas by the rule the Run button, the confirm and
 * the workflow badge read (`aiAvatarQuotedAudioSec`).
 */
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { aiAvatarQuotedAudioSec } from "@/lib/video-utility-estimate"
import type { WorkflowNode } from "@/types/nodes"

/** The length of this AI Avatar's audio as the editor knows it, or undefined while it is not known (the 120-second default). */
export function useAiAvatarQuotedAudioSec(nodeId: string): number | undefined {
  return useWorkflowStore((s) => {
    const node = s.nodes.find((n) => n.id === nodeId) as WorkflowNode | undefined
    return node ? aiAvatarQuotedAudioSec(node, s.nodes, s.edges) : undefined
  })
}
