/**
 * The group's summed estimate (D5, decided 2026-10-11): a canvas macro such as
 * Reframe is three real nodes that each charge their own price, and there is no
 * credit id for the group. What the editor shows for it is the SUM of those
 * nodes' own lines — a fold of `estimateRunCreditLines`, never a second
 * estimate, so the group's figure and the run's total cannot disagree.
 *
 * The server's estimators (a run's quote, the credit preflight, an app's
 * listing and quotes, `/v1/nodes`) already price every node of the graph and
 * treat a group as transparent, so their total IS this sum;
 * `reframe-macro-estimate.test.ts` (backend) pins that.
 */
import { isMacroGroup } from "@/lib/canvas-macros"
import type { WorkflowNode } from "@/types/nodes"
import type { RunCreditLine } from "./types"

export interface GroupCreditSubtotal {
  readonly groupId: string
  /** The group's stored label. */
  readonly label: string
  /** The group's nodes that have a line, in line order. */
  readonly nodeIds: readonly string[]
  /** The sum of those lines. */
  readonly credits: number
}

/** The macro group a node sits in, if any. */
export function macroGroupOf(node: Pick<WorkflowNode, "parentId"> | undefined, nodes: readonly WorkflowNode[]): WorkflowNode | undefined {
  if (!node?.parentId) return undefined
  const parent = nodes.find((n) => n.id === node.parentId)
  return isMacroGroup(parent) ? parent : undefined
}

/**
 * One subtotal per macro group that has at least one line, in the order its
 * first line appears. Lines of nodes outside any macro group are not counted.
 */
export function groupCreditSubtotals(lines: readonly RunCreditLine[], nodes: readonly WorkflowNode[]): GroupCreditSubtotal[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const out = new Map<string, { label: string; nodeIds: string[]; credits: number }>()
  for (const line of lines) {
    const group = macroGroupOf(byId.get(line.nodeId), nodes)
    if (!group) continue
    const entry = out.get(group.id) ?? { label: (group.data as { label?: string }).label ?? "", nodeIds: [], credits: 0 }
    entry.nodeIds.push(line.nodeId)
    entry.credits += line.credits
    out.set(group.id, entry)
  }
  return [...out].map(([groupId, e]) => ({ groupId, ...e }))
}
