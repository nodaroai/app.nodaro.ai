import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"
import { NODE_DEFINITIONS } from "@/types/nodes"

export interface ValidationMessage {
  readonly nodeId: string
  readonly type: "error" | "warning"
  readonly message: string
  readonly suggestion?: string
}

export interface ValidationResult {
  readonly valid: boolean
  readonly errors: ReadonlyArray<ValidationMessage>
  readonly warnings: ReadonlyArray<ValidationMessage>
  readonly estimatedCredits: number
}

export function validateWorkflow(
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): ValidationResult {
  const errors: ValidationMessage[] = []
  const warnings: ValidationMessage[] = []

  if (nodes.length === 0) {
    errors.push({
      nodeId: "workflow",
      type: "error",
      message: "Workflow is empty. Add at least one node.",
    })
    return { valid: false, errors, warnings, estimatedCredits: 0 }
  }

  // Check for disconnected nodes
  const connectedNodeIds = new Set<string>()
  for (const edge of edges) {
    connectedNodeIds.add(edge.source)
    connectedNodeIds.add(edge.target)
  }

  if (nodes.length > 1) {
    for (const node of nodes) {
      if (!connectedNodeIds.has(node.id)) {
        warnings.push({
          nodeId: node.id,
          type: "warning",
          message: `Node "${(node.data as { label: string }).label}" is not connected to the workflow.`,
          suggestion: "Connect it to other nodes or remove it.",
        })
      }
    }
  }

  // Check required inputs per node
  for (const node of nodes) {
    const definition = NODE_DEFINITIONS.find((d) => d.type === node.type)
    if (!definition) continue

    const incomingEdges = edges.filter((e) => e.target === node.id)
    const requiredInputs = definition.inputs.filter((i) => !i.endsWith("?"))

    for (const input of requiredInputs) {
      const hasConnection = incomingEdges.some(
        (e) => e.targetHandle === input || (input === definition.inputs[0] && !e.targetHandle),
      )
      if (!hasConnection && definition.inputs.length > 0) {
        errors.push({
          nodeId: node.id,
          type: "error",
          message: `Node "${(node.data as { label: string }).label}" is missing required input "${input}".`,
        })
      }
    }

    // Node-specific validation
    if (node.type === "text-prompt") {
      const data = node.data as { text?: string }
      if (!data.text || data.text.trim().length === 0) {
        errors.push({
          nodeId: node.id,
          type: "error",
          message: `Text Prompt "${(node.data as { label: string }).label}" has no text.`,
        })
      }
    }
  }

  // Check for cycles (simple DFS)
  const hasCycle = detectCycle(nodes, edges)
  if (hasCycle) {
    errors.push({
      nodeId: "workflow",
      type: "error",
      message: "Circular dependency detected in workflow.",
    })
  }

  // Estimate credits
  const estimatedCredits = nodes.reduce((total, node) => {
    const def = NODE_DEFINITIONS.find((d) => d.type === node.type)
    return total + (def?.creditCost ?? 0)
  }, 0)

  if (estimatedCredits > 500) {
    warnings.push({
      nodeId: "workflow",
      type: "warning",
      message: `This workflow costs ~${estimatedCredits} credits.`,
      suggestion: "Confirm before running.",
    })
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    estimatedCredits,
  }
}

function detectCycle(
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): boolean {
  const adjacency = new Map<string, string[]>()
  for (const node of nodes) {
    adjacency.set(node.id, [])
  }
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target)
  }

  const visited = new Set<string>()
  const inStack = new Set<string>()

  function dfs(nodeId: string): boolean {
    visited.add(nodeId)
    inStack.add(nodeId)

    for (const neighbor of adjacency.get(nodeId) ?? []) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true
      } else if (inStack.has(neighbor)) {
        return true
      }
    }

    inStack.delete(nodeId)
    return false
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      if (dfs(node.id)) return true
    }
  }

  return false
}
