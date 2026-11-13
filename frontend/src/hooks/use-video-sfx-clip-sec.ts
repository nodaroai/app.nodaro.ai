/**
 * The clip length a Video SFX node is quoted at (null = unknown, the
 * 300-second row): the length the measured walk gives its video (a node that
 * runs at the length it will produce plus the container slack, a node outside
 * the run at its take, an upload at its recorded length, a render's output).
 * The same reading the confirm dialog and the workflow
 * badge price it by (`videoSfxQuotedSec`), so the node's own Run button never
 * disagrees with them. The selector returns a number, so it re-renders only
 * when the length moves.
 */
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { videoSfxQuotedSec } from "@/lib/video-utility-estimate"

export function useVideoSfxClipSec(nodeId: string): number | null {
  return useWorkflowStore((s) => videoSfxQuotedSec({ id: nodeId }, s.nodes, s.edges))
}
