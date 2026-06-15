/**
 * Connectors between a FOCUSED canvas node and another (result) node, for the
 * in-search connector strip. Reuses `enumerateConnectionOptionsCore` (the same
 * validator the Tab connect-dialog uses) so the offered connections always match
 * what a manual drag would allow, then resolves each option's concrete edge
 * tuple and looks it up in the live `edges` to mark it connected.
 */
import {
  enumerateConnectionOptionsCore,
  staticInputHandles,
  staticOutputHandles,
} from "./enumerate-connection-options"
import { getEdgeType } from "./edge-type-color"
import type { HandleColorType } from "./handle-colors"

export interface NodeConnector {
  /** Stable id for React keys + focus tracking. */
  readonly key: string
  /** Friendly handle label from the focused node's perspective (e.g. "Prompt"). */
  readonly label: string
  /** "source" = focused → result (focused's OUTPUT, a "To"); "target" = result
   *  → focused (focused's INPUT, a "From"). */
  readonly direction: "source" | "target"
  readonly source: string
  readonly sourceHandle: string
  readonly target: string
  readonly targetHandle: string
  readonly color: string | undefined
  /** Connection data-type of the producing handle — drives the type icon. */
  readonly type: HandleColorType | undefined
  readonly connected: boolean
  /** Edge id when connected — used to disconnect. */
  readonly edgeId: string | undefined
}

interface EdgeLike {
  readonly id: string
  readonly source: string
  readonly sourceHandle?: string | null
  readonly target: string
  readonly targetHandle?: string | null
}

interface NodeRef {
  readonly id: string
  readonly type: string | undefined
}

export interface FocusedHandles {
  readonly sourceHandles: readonly string[]
  readonly targetHandles: readonly string[]
}

/** The focused node's STATIC handle sets. Depends only on the type, so compute
 *  it ONCE and pass it into `getNodeConnectors` rather than re-deriving per row
 *  when scanning many result rows against one focused node. */
export function focusedNodeHandles(type: string | undefined): FocusedHandles {
  return type
    ? { sourceHandles: staticOutputHandles(type), targetHandles: staticInputHandles(type) }
    : { sourceHandles: [], targetHandles: [] }
}

/**
 * Up to `opts.max` (default 3) valid connectors between `focused` and `result`.
 * Empty for the focused node's own row or when no valid connection exists. Uses
 * the focused node's STATIC handles (matches the connect-dialog; dynamic
 * list-column handles are a follow-up). Pass `opts.focusedHandles` (from
 * `focusedNodeHandles`) when scanning many rows to avoid re-deriving them.
 */
export function getNodeConnectors(
  focused: NodeRef,
  result: NodeRef,
  edges: ReadonlyArray<EdgeLike>,
  opts: { max?: number; focusedHandles?: FocusedHandles } = {},
): NodeConnector[] {
  if (!focused.type || !result.type || focused.id === result.id) return []
  const max = opts.max ?? 3
  const fh = opts.focusedHandles ?? focusedNodeHandles(focused.type)

  const { handles } = enumerateConnectionOptionsCore({
    focusedType: focused.type,
    newType: result.type,
    focusedSourceHandles: fh.sourceHandles,
    focusedTargetHandles: fh.targetHandles,
    missingRefNames: [],
  })

  // "From" (target: result → focused) before "To" (source: focused → result),
  // so the flat list, the rendered groups, and keyboard Tab all read From → To.
  const ordered = [
    ...handles.filter((h) => h.direction === "target"),
    ...handles.filter((h) => h.direction === "source"),
  ]
  return ordered.slice(0, max).map((o) => {
    // direction "source" = focused → result; "target" = result → focused.
    const tuple =
      o.direction === "source"
        ? { source: focused.id, sourceHandle: o.fHandle, target: result.id, targetHandle: o.nHandle }
        : { source: result.id, sourceHandle: o.nHandle, target: focused.id, targetHandle: o.fHandle }
    // The producing handle's type drives the icon: a "To" (focused → result)
    // carries the FOCUSED node's output type; a "From" carries the RESULT's.
    const type =
      o.direction === "source"
        ? getEdgeType(focused.type, o.fHandle)
        : getEdgeType(result.type, o.nHandle)
    const edge = edges.find(
      (e) =>
        e.source === tuple.source &&
        (e.sourceHandle ?? "") === tuple.sourceHandle &&
        e.target === tuple.target &&
        (e.targetHandle ?? "") === tuple.targetHandle,
    )
    return {
      key: `${o.direction}:${o.fHandle}:${o.nHandle}`,
      label: o.label,
      direction: o.direction,
      ...tuple,
      color: o.color,
      type,
      connected: !!edge,
      edgeId: edge?.id,
    }
  })
}

/** Split connectors into the two direction buckets in a single pass, preserving
 *  order: `from` = result → focused (the focused node's inputs); `to` = focused
 *  → result (its outputs). The single source of the From/To partition. */
export function partitionConnectors(
  connectors: ReadonlyArray<NodeConnector>,
): { from: NodeConnector[]; to: NodeConnector[] } {
  const from: NodeConnector[] = []
  const to: NodeConnector[] = []
  for (const c of connectors) (c.direction === "target" ? from : to).push(c)
  return { from, to }
}
