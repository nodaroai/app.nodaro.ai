/**
 * The input length a Pitch & Tempo node is quoted at (null = unknown, the
 * one-minute price): the reading the confirm dialog and the workflow badge
 * price it by (`pitchTempoQuotedSec`), so the node's own Run button never
 * disagrees with them. The selector returns a number, so it re-renders only
 * when the length moves.
 */
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { pitchTempoQuotedSec } from "@/lib/video-utility-estimate"

export function usePitchTempoInputSec(nodeId: string): number | null {
  return useWorkflowStore((s) => pitchTempoQuotedSec({ id: nodeId }, s.nodes, s.edges))
}
