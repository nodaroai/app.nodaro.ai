/**
 * The clip length a Video SFX node is quoted at (null = unmeasured, the
 * 8-second row): the length the graph gives its video (a render's output, a
 * chain of Trim / Loop / Combine Videos / Video SFX), else the upstream node's
 * own reported length. The same reading the confirm dialog and the workflow
 * badge price it by (`videoSfxQuotedSec`), so the node's own Run button never
 * disagrees with them. The selector returns a number, so it re-renders only
 * when the length moves.
 */
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { videoSfxQuotedSec } from "@/lib/video-utility-estimate"

export function useVideoSfxClipSec(nodeId: string): number | null {
  return useWorkflowStore((s) => videoSfxQuotedSec({ id: nodeId }, s.nodes, s.edges))
}
