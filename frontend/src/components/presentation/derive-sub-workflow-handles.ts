import { HANDLE_PORT_SEPARATOR } from "@nodaro/shared"
import type { WorkflowNode } from "@/types/nodes"

type PortMediaType = "text" | "image" | "video" | "audio" | "any"
type RawPort = { id: string; name: string; mediaType: PortMediaType }
type HandleMediaType = "text" | "image" | "video" | "audio"

type InputHandle = { id: string; name: string; type: HandleMediaType; required: boolean; fieldKey: string }
type OutputHandle = { id: string; name: string; type: HandleMediaType; required: boolean; mediaPreview: boolean; fieldKey: string }

function toHandleType(mediaType: PortMediaType): HandleMediaType {
  return mediaType === "any" ? "text" : mediaType
}

/**
 * If the workflow has any sub-workflow-input / sub-workflow-output nodes,
 * derive component handles directly from their ports (one handle per port)
 * and return them.  Returns null when neither node type is present —
 * callers should fall through to their normal presentation-flag-based path.
 *
 * Used by the publish dialog so publishing a sub-workflow as a component
 * works without flagging anything in Present mode.
 */
export function deriveSubWorkflowHandles(
  nodes: readonly WorkflowNode[],
): { inputs: InputHandle[]; outputs: OutputHandle[] } | null {
  const subInputNodes = nodes.filter((n) => n.type === "sub-workflow-input")
  const subOutputNodes = nodes.filter((n) => n.type === "sub-workflow-output")
  if (subInputNodes.length === 0 && subOutputNodes.length === 0) return null

  const inputs: InputHandle[] = subInputNodes.flatMap((n) => {
    const ports = ((n.data as Record<string, unknown> | undefined)?.ports as RawPort[] | undefined) ?? []
    return ports.map((port) => ({
      id: `${n.id}${HANDLE_PORT_SEPARATOR}${port.id}`,
      name: port.name || "Input",
      type: toHandleType(port.mediaType),
      required: true,
      fieldKey: port.id,
    }))
  })

  // First output gets mediaPreview: true so the route's
  // "exactly one mediaPreview" invariant holds out of the box.
  const flatOutputPorts = subOutputNodes.flatMap((n) => {
    const ports = ((n.data as Record<string, unknown> | undefined)?.ports as RawPort[] | undefined) ?? []
    return ports.map((port) => ({ nodeId: n.id, port }))
  })
  const outputs: OutputHandle[] = flatOutputPorts.map(({ nodeId, port }, idx) => ({
    id: `${nodeId}${HANDLE_PORT_SEPARATOR}${port.id}`,
    name: port.name || "Output",
    type: toHandleType(port.mediaType),
    required: true,
    mediaPreview: idx === 0,
    fieldKey: port.id,
  }))

  return { inputs, outputs }
}
