/**
 * The file length a Transcribe node on Nemotron 3.5 Transcribe is quoted at
 * (null = unknown, the 60-minute price): the reading the confirm dialog and the
 * workflow badge price it by (`transcribeQuotedSec`), so the node's own price
 * never disagrees with them. The selector returns a number, so it re-renders
 * only when the length moves.
 */
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { transcribeQuotedSec } from "@/lib/video-utility-estimate"

export function useTranscribeInputSec(nodeId: string): number | null {
  return useWorkflowStore((s) => transcribeQuotedSec({ id: nodeId }, s.nodes, s.edges))
}
