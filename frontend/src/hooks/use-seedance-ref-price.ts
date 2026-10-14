import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useSeedanceRefQuote } from "@/hooks/use-model-credit-cost"
import { seedanceRefQuoteKeyFor } from "@/lib/seedance-ref-quote"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/** What a video node shows for its price. */
export interface NodeVideoPrice {
  /** The figure on the node, when there is one exact figure. */
  readonly credits: number | undefined
  /** "min–max" on the node while a reference clip's length is not known yet. */
  readonly creditsRange: { readonly min: number; readonly max: number } | undefined
  /** The figure on the Run button: never below what the run reserves (0 = none shown). */
  readonly runCredits: number
  /** The price comes from the server's reference-video quote (not a row). */
  readonly quoted: boolean
}

/**
 * The credit override for a Run button that otherwise prices a model id (the
 * settings panel's GenerateButton): a quoted node's Run figure — the quote, or
 * 0 (no figure) while it loads — else the override it already had.
 */
export function runButtonCreditOverride(
  price: Pick<NodeVideoPrice, "quoted" | "runCredits">,
  otherwise: number | undefined,
): number | undefined {
  return price.quoted ? price.runCredits : otherwise
}

/**
 * The price a Generate Video / Video to Video node shows. A Seedance run with
 * reference video(s) is billed input + output seconds, so it is priced by the
 * server from the probed clips (`useSeedanceRefQuote`) — exactly what a run of
 * this node reserves:
 *
 * - quote exact → that figure, on the node and the Run button;
 * - a clip not produced yet → the range "shortest clip – worst case" on the
 *   node (priced by the video's length) and the worst case on the Run button;
 * - quote loading or refused → no figure at all, rather than a row price below
 *   what the run reserves.
 *
 * Any other node keeps `rowCredits`, its credit id's row price.
 */
export function useNodeVideoPrice(nodeId: string, rowCredits: number): NodeVideoPrice {
  const quoteKey = useWorkflowStore((s) => {
    const node = s.nodes.find((n) => n.id === nodeId)
    return node ? seedanceRefQuoteKeyFor(node as WorkflowNode, s.nodes as WorkflowNode[], s.edges as WorkflowEdge[]) : undefined
  })
  const quote = useSeedanceRefQuote(quoteKey)
  if (quoteKey === undefined) return { credits: rowCredits, creditsRange: undefined, runCredits: rowCredits, quoted: false }
  if (!quote) return { credits: undefined, creditsRange: undefined, runCredits: 0, quoted: true }
  if (quote.exact) return { credits: quote.credits, creditsRange: undefined, runCredits: quote.credits, quoted: true }
  return { credits: undefined, creditsRange: { min: quote.min, max: quote.credits }, runCredits: quote.credits, quoted: true }
}
