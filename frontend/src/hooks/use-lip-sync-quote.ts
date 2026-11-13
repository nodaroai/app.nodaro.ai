/**
 * A Lip Sync node's own pill on a model charged per second of its audio
 * (OmniHuman 2.0): the billed seconds it is quoted at and whether that is an
 * estimate (the audio's length not known yet) — read from the canvas, by the
 * rule the Run button, the confirm and the workflow badge read
 * (`lipSyncPricingUnits` / `lipSyncQuoteIsEstimate`).
 */
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { lipSyncPricingUnits, lipSyncQuoteIsEstimate, lipSyncQuotedAudioSec } from "@/lib/video-utility-estimate"
import type { WorkflowNode } from "@/types/nodes"

/** The seconds this Lip Sync is quoted at (1 for a model with one price). */
export function useLipSyncQuotedSeconds(nodeId: string): number {
  return useWorkflowStore((s) => {
    const node = s.nodes.find((n) => n.id === nodeId) as WorkflowNode | undefined
    return node ? lipSyncPricingUnits(node, s.nodes, s.edges) : 1
  })
}

/** Whether this Lip Sync's quote is an estimate (its audio's length is not known yet). */
export function useLipSyncQuoteIsEstimate(nodeId: string): boolean {
  return useWorkflowStore((s) => {
    const node = s.nodes.find((n) => n.id === nodeId) as WorkflowNode | undefined
    return node ? lipSyncQuoteIsEstimate(node, s.nodes, s.edges) : false
  })
}

/**
 * The length of this Lip Sync's audio as the editor knows it (the audio the
 * editor's Run plays, as the measured walk reads it — never the node's own
 * `audioDurationSec`), or undefined
 * while it is not known — what a model priced by a length bucket is quoted on
 * (`lipSyncQuotedAudioSec`, the rule the Run button reads).
 */
export function useLipSyncQuotedAudioSec(nodeId: string): number | undefined {
  return useWorkflowStore((s) => {
    const node = s.nodes.find((n) => n.id === nodeId) as WorkflowNode | undefined
    return node ? lipSyncQuotedAudioSec(node, s.nodes, s.edges) : undefined
  })
}
