/**
 * What a node hands on to the node wired after it, for the readers in `src/lib`
 * that must not import the editor's execution graph (it sits in the editor's
 * import cycle). `execution-graph.ts` registers its `extractNodeOutput` here
 * when it loads; until then (a module loaded on its own) the output is unknown.
 */
import type { WorkflowNode } from "@/types/nodes"

type NodeOutputReader = (node: WorkflowNode, sourceHandle?: string) => unknown

let reader: NodeOutputReader | undefined

export function registerNodeOutputReader(read: NodeOutputReader): void {
  reader = read
}

/** The node's output on `sourceHandle`, or undefined while no reader is registered. */
export function readNodeOutput(node: WorkflowNode, sourceHandle?: string): unknown {
  return reader?.(node, sourceHandle)
}
