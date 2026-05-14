export interface SubWorkflowPort {
  readonly id: string
  readonly name: string
  readonly mediaType: "text" | "image" | "video" | "audio" | "any"
}

interface BoundaryNode {
  readonly id: string
  readonly type: string
  readonly data: { readonly routeId?: string; readonly ports?: readonly SubWorkflowPort[] }
}

export type ValidationError =
  | { code: "missing_output_for_route"; routeId: string; inputNodeId: string }
  | { code: "missing_input_for_route";  routeId: string; outputNodeId: string }
  | { code: "route_has_no_output_ports"; routeId: string; outputNodeId: string }
  | { code: "duplicate_route_id";       routeId: string; nodeIds: readonly string[] }

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: readonly ValidationError[] }

export function validateSubWorkflowRoutes(
  nodes: readonly BoundaryNode[],
): ValidationResult {
  const inputs  = nodes.filter((n) => n.type === "sub-workflow-input")
  const outputs = nodes.filter((n) => n.type === "sub-workflow-output")

  if (inputs.length === 0 && outputs.length === 0) return { ok: true }

  const errors: ValidationError[] = []

  // 1. Duplicate routeIds within input or output lists
  const groupByRoute = (list: readonly BoundaryNode[]) => {
    const map = new Map<string, BoundaryNode[]>()
    for (const n of list) {
      const r = n.data.routeId
      if (!r) continue
      const bucket = map.get(r) ?? []
      bucket.push(n)
      map.set(r, bucket)
    }
    return map
  }
  for (const [routeId, group] of groupByRoute(inputs)) {
    if (group.length > 1) errors.push({ code: "duplicate_route_id", routeId, nodeIds: group.map((g) => g.id) })
  }
  for (const [routeId, group] of groupByRoute(outputs)) {
    if (group.length > 1) errors.push({ code: "duplicate_route_id", routeId, nodeIds: group.map((g) => g.id) })
  }

  // 2. Every input routeId must have a matching output
  const outputByRoute = new Map(outputs.map((o) => [o.data.routeId, o] as const))
  for (const inputNode of inputs) {
    const routeId = inputNode.data.routeId
    if (!routeId) continue
    const matchingOutput = outputByRoute.get(routeId)
    if (!matchingOutput) {
      errors.push({ code: "missing_output_for_route", routeId, inputNodeId: inputNode.id })
      continue
    }
    if (!matchingOutput.data.ports || matchingOutput.data.ports.length === 0) {
      errors.push({ code: "route_has_no_output_ports", routeId, outputNodeId: matchingOutput.id })
    }
  }

  // 3. Every output routeId must have a matching input
  const inputByRoute = new Map(inputs.map((i) => [i.data.routeId, i] as const))
  for (const outputNode of outputs) {
    const routeId = outputNode.data.routeId
    if (!routeId) continue
    if (!inputByRoute.has(routeId)) {
      errors.push({ code: "missing_input_for_route", routeId, outputNodeId: outputNode.id })
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}
