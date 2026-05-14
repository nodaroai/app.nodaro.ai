/**
 * Watches the React Flow nodes array and pans the viewport to newly-added
 * nodes. Suppresses panning if the user has manually interacted with the
 * viewport in the last 2 seconds (don't fight the user).
 *
 * Designed for the Film Director skill's live canvas construction (spec §5.4
 * Pattern A-prime). Pairs with useNodeInsertAnimation (D1) and
 * useEdgeInsertAnimation (D2): each per-stage update_workflow_json call adds
 * new nodes to the React Flow graph; this hook makes the camera follow them.
 *
 * Usage (inside a ReactFlowProvider context):
 *   const { onMove } = useCameraAutoPan(nodes)
 *   // ...
 *   <ReactFlow onMoveStart={onMove} onMoveEnd={...}>...</ReactFlow>
 *
 * If the caller already has an onMoveStart handler, compose them:
 *   const handleMoveStart = useCallback(() => {
 *     cameraPanControl.onMove()
 *     existingHandler()
 *   }, [cameraPanControl, existingHandler])
 *
 * Tracks seen node IDs in a ref (NOT module-level — different from D1/D2),
 * so the behavior resets when remounting in a different workflow.
 *
 * Mount-time gate: nodes that appear within 500ms of the hook mounting
 * are treated as part of the initial workflow load and do NOT trigger
 * auto-pan. This avoids regressing UX for users opening existing workflows
 * (where 8-10 nodes mount near-simultaneously and would otherwise yank the
 * camera to the centroid). Only nodes added more than 500ms after mount
 * trigger the camera pan — those are real "new node" events (user dropped
 * one, or the skill batch-attached new ones via update_workflow_json).
 */
import { useEffect, useRef } from "react"
import { useReactFlow, type Node } from "@xyflow/react"

/**
 * After a user-initiated pan/zoom, suppress auto-pans for this long so the
 * camera does not yank away from where the user just placed it.
 */
const USER_INTERACTION_DEBOUNCE_MS = 2000

/**
 * Smooth transition duration for the auto-pan. Long enough to feel gentle,
 * short enough to keep up with rapid node insertions during a Film Director
 * canvas build (~one node every 1-2 seconds).
 */
const AUTO_PAN_DURATION_MS = 600

/**
 * Grace period after the hook mounts during which newly-seen nodes are
 * silently added to the seen-set WITHOUT panning. Initial workflow loads
 * (loading a saved workflow with 8-10 nodes) drop all those nodes into the
 * React Flow graph within milliseconds of mount — that should NOT pan the
 * camera. Real skill/user-driven additions happen seconds later and DO pan.
 */
const INITIAL_LOAD_GRACE_MS = 500

/**
 * Default node dimensions used when `node.measured` is not yet populated
 * (React Flow measures on first paint, so a brand-new node may not have
 * measured dims on the same render where we want to pan to it). Matches
 * the fallbacks used elsewhere in workflow-canvas.tsx.
 */
const DEFAULT_NODE_WIDTH = 200
const DEFAULT_NODE_HEIGHT = 100

export interface CameraAutoPanControl {
  /**
   * Wire this onto `<ReactFlow onMoveStart={onMove}>`. Records that the user
   * just interacted with the viewport, which suppresses any auto-pans for
   * USER_INTERACTION_DEBOUNCE_MS.
   *
   * Safe to compose: it does no work other than updating an internal ref.
   */
  onMove: () => void
}

interface NodeCenter {
  cx: number
  cy: number
}

function getNodeCenter(node: Node): NodeCenter {
  const w = node.measured?.width ?? DEFAULT_NODE_WIDTH
  const h = node.measured?.height ?? DEFAULT_NODE_HEIGHT
  return {
    cx: node.position.x + w / 2,
    cy: node.position.y + h / 2,
  }
}

export function useCameraAutoPan(nodes: readonly Node[]): CameraAutoPanControl {
  const { setCenter, getViewport } = useReactFlow()

  // Per-instance seen-set (NOT module-level). Resets when the hook
  // remounts — e.g. navigating between workflows — so the camera will
  // pan to "old" nodes the first time it sees them in a fresh workflow.
  const seenRef = useRef<Set<string>>(new Set())

  // Timestamp (ms) of the user's most recent pan/zoom. Initialized to
  // 0 (epoch) so the very first auto-pan after mount is allowed.
  const lastUserInteractionRef = useRef<number>(0)

  // Timestamp (ms) of when this hook instance mounted. Used to gate
  // auto-pan during the initial-load grace period — see INITIAL_LOAD_GRACE_MS.
  // Per-instance (not module-level) so navigating between workflows resets
  // the gate. Uses Date.now() to match lastUserInteractionRef.
  const mountedAtRef = useRef<number>(Date.now())

  // Latest `nodes` snapshot for the effect — kept in a ref so the
  // effect's closure always sees the current array without re-running
  // unnecessarily.
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  useEffect(() => {
    const seen = seenRef.current
    const newNodes: Node[] = []

    for (const node of nodes) {
      if (!seen.has(node.id)) {
        newNodes.push(node)
      }
    }

    if (newNodes.length === 0) return

    // Mark every new node as seen FIRST — even if we ultimately skip the
    // pan (initial-load grace period or user-interaction debounce), we
    // don't want to re-consider these nodes on the next render.
    for (const node of newNodes) {
      seen.add(node.id)
    }

    // Initial-load grace period: nodes appearing within the first
    // INITIAL_LOAD_GRACE_MS of mount are part of the initial workflow
    // load (loading a saved workflow with 8-10 nodes drops them all in
    // within milliseconds of mount). Skip the pan so the camera does
    // not yank away from (0, 0) for users opening existing workflows.
    // The nodes are already in the seen-set above, so they won't be
    // re-considered once the grace period ends.
    const sinceMount = Date.now() - mountedAtRef.current
    if (sinceMount < INITIAL_LOAD_GRACE_MS) {
      return
    }

    // Don't fight the user: if they just panned/zoomed, skip the
    // camera move entirely. The nodes are still in the seen-set, so
    // the next batch of new nodes (after the user goes idle) is what
    // we'll pan to.
    const sinceLastInteraction = Date.now() - lastUserInteractionRef.current
    if (sinceLastInteraction < USER_INTERACTION_DEBOUNCE_MS) {
      return
    }

    // Compute the centroid of all new nodes. For a single new node
    // this is just that node's center; for multiple (e.g. an initial
    // workflow load that lands 6 nodes at once, or a stage that lands
    // a script + scene + character together) the camera moves to the
    // midpoint so the cluster ends up centered.
    let sumX = 0
    let sumY = 0
    for (const node of newNodes) {
      const center = getNodeCenter(node)
      sumX += center.cx
      sumY += center.cy
    }
    const targetX = sumX / newNodes.length
    const targetY = sumY / newNodes.length

    // Preserve current zoom — the auto-pan should pan, not zoom. The
    // user's zoom level is theirs to choose.
    const { zoom } = getViewport()

    setCenter(targetX, targetY, {
      duration: AUTO_PAN_DURATION_MS,
      zoom,
    })
  }, [nodes, setCenter, getViewport])

  // Stable onMove callback — never changes identity, so wiring it into
  // <ReactFlow onMoveStart={onMove}> does not cause ReactFlow prop churn.
  const onMoveRef = useRef<() => void>(() => {
    lastUserInteractionRef.current = Date.now()
  })

  return {
    onMove: onMoveRef.current,
  }
}

/**
 * Test-only escape hatch. Production code does not need this — the seen-set
 * is per-instance and resets naturally when the hook unmounts.
 *
 * @internal
 */
export function __getSeenForTests(_unused?: never): never {
  throw new Error(
    "use-camera-auto-pan does not expose a global seen-set; the seen-set is per-instance (ref).",
  )
}
