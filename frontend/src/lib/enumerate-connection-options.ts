/**
 * Pure enumerator for Tab-auto-connect: given a FOCUSED node and a candidate
 * NEW node type, list the valid connection options (both directions) plus any
 * text-`{variable}` shortcuts.
 *
 * It REUSES the exact primitives edge-drop uses so it can never diverge:
 *   - `getCompatibleNodes` — is the new type a valid producer/consumer for a
 *     given handle (typed predicates + HANDLE_COMPATIBILITY fallback)?
 *   - `resolveTargetHandle` — which handle on the NEW node carries the wire.
 *   - `isValidWorkflowConnection` — final canonical gate (parity with a manual
 *     drag). The new node isn't in the graph yet, so no cycle can form; we pass
 *     no adjacency and the gate reduces to its type/handle rules.
 *   - `getEdgeTypeColor` — canonical dot color for the option (a hex).
 *
 * The FOCUSED node's handle ids are passed in by the caller (sourced from React
 * Flow `handleBounds` ground truth — `NODE_DEF_MAP` is drifted). `staticInput/
 * OutputHandles` are a fallback union for when handleBounds is unavailable.
 */
import { getCompatibleNodes, resolveTargetHandle, type NodeOption } from "./node-compatibility"
import { isValidWorkflowConnection } from "./connection-validation"
import { getEdgeTypeColor } from "./edge-type-color"
import { HANDLE_COLORS } from "./handle-colors"
import { TARGET_HANDLE_ACCEPTS } from "./target-handle-registry"
import { HANDLE_OUTPUT_TYPES } from "./handle-output-types"
import { NODE_DEF_MAP, type SceneNodeType } from "../types/nodes"

export interface ConnectionOption {
  readonly kind: "handle" | "variable"
  /** Focused node's perspective: "source" = focused → new; "target" = new → focused. */
  readonly direction: "source" | "target"
  readonly fHandle: string
  readonly nHandle: string
  readonly tier: "direct" | "compatible"
  readonly label: string
  readonly color: string | undefined
  readonly variableName?: string
}

export interface ConnectionOptions {
  readonly handles: ConnectionOption[]
  readonly variables: ConnectionOption[]
}

const FOCUSED = "__autoconnect_focused__"
const NEW = "__autoconnect_new__"
const TEXT_HANDLE_PRIORITY = ["prompt", "in", "text", "userInput"]

/** getCompatibleNodes/resolveTargetHandle only read `.type`; a minimal option
 *  avoids importing NODE_OPTIONS (which would create an import cycle with
 *  add-node-popup). */
function optionOf(type: string): NodeOption {
  return { type: type as SceneNodeType, label: type, icon: null, category: "" } as unknown as NodeOption
}

function prettify(id: string): string {
  return id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function handleLabel(consumerType: string, handleId: string): string {
  return TARGET_HANDLE_ACCEPTS[consumerType]?.find((e) => e.handleId === handleId)?.label ?? prettify(handleId)
}

function matchTier(
  res: { directTypes: ReadonlySet<string>; compatible: ReadonlyArray<NodeOption> },
  type: string,
): "direct" | "compatible" | null {
  if (res.directTypes.has(type as SceneNodeType)) return "direct"
  if (res.compatible.some((o) => o.type === type)) return "compatible"
  return null
}

export function enumerateConnectionOptionsCore(args: {
  focusedType: string
  newType: string
  focusedSourceHandles: readonly string[]
  focusedTargetHandles: readonly string[]
  missingRefNames: readonly string[]
}): ConnectionOptions {
  const { focusedType, newType } = args
  const optN = optionOf(newType)
  const idToType = (id: string): string | undefined =>
    id === FOCUSED ? focusedType : id === NEW ? newType : undefined
  const seen = new Set<string>()
  const handles: ConnectionOption[] = []

  // Focused PRODUCES → new node CONSUMES.
  for (const h of args.focusedSourceHandles) {
    const tier = matchTier(getCompatibleNodes(h, "source", [optN], focusedType), newType)
    if (!tier) continue
    const nHandle = resolveTargetHandle(newType as SceneNodeType, h, "source")
    if (!isValidWorkflowConnection({ source: FOCUSED, sourceHandle: h, target: NEW, targetHandle: nHandle }, idToType)) continue
    const key = `source|${h}|${nHandle}`
    if (seen.has(key)) continue
    seen.add(key)
    handles.push({ kind: "handle", direction: "source", fHandle: h, nHandle, tier, label: handleLabel(newType, nHandle), color: getEdgeTypeColor(focusedType, h) })
  }

  // New node PRODUCES → focused CONSUMES.
  for (const h of args.focusedTargetHandles) {
    const tier = matchTier(getCompatibleNodes(h, "target", [optN], focusedType), newType)
    if (!tier) continue
    const nHandle = resolveTargetHandle(newType as SceneNodeType, h, "target")
    if (!isValidWorkflowConnection({ source: NEW, sourceHandle: nHandle, target: FOCUSED, targetHandle: h }, idToType)) continue
    const key = `target|${h}|${nHandle}`
    if (seen.has(key)) continue
    seen.add(key)
    handles.push({ kind: "handle", direction: "target", fHandle: h, nHandle, tier, label: handleLabel(focusedType, h), color: getEdgeTypeColor(newType, nHandle) })
  }

  handles.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "direct" ? -1 : 1))

  // Variable rows: ONLY when the new node feeds a TEXT input of the focused node
  // (so `{Label}` resolves to text, not a URL). The handle's accept rules already
  // gate this; we additionally require the producer's output color to be text.
  const textOpts = handles.filter(
    (o) => o.direction === "target" && getEdgeTypeColor(newType, o.nHandle) === HANDLE_COLORS.text,
  )
  const best =
    [...textOpts]
      .filter((o) => TEXT_HANDLE_PRIORITY.includes(o.fHandle))
      .sort((a, b) => TEXT_HANDLE_PRIORITY.indexOf(a.fHandle) - TEXT_HANDLE_PRIORITY.indexOf(b.fHandle))[0] ?? textOpts[0]

  const variables: ConnectionOption[] = best
    ? args.missingRefNames.map((name) => ({ ...best, kind: "variable", variableName: name, label: name }))
    : []

  return { handles, variables }
}

/** Fallback ONLY — handleBounds (ground truth) is the primary source for the
 *  focused node's handles. Union of the (drifted) def list with the typed
 *  registries so coverage is as wide as possible when handleBounds is absent. */
export function staticInputHandles(type: string): string[] {
  const s = new Set<string>(NODE_DEF_MAP.get(type as SceneNodeType)?.inputs ?? [])
  for (const e of TARGET_HANDLE_ACCEPTS[type] ?? []) s.add(e.handleId)
  return [...s]
}

export function staticOutputHandles(type: string): string[] {
  const s = new Set<string>(NODE_DEF_MAP.get(type as SceneNodeType)?.outputs ?? [])
  for (const k of Object.keys(HANDLE_OUTPUT_TYPES[type] ?? {})) s.add(k)
  return [...s]
}

/** Structural shape of React Flow's `internals.handleBounds`. */
type HandleBoundsLike = {
  readonly source?: ReadonlyArray<{ id?: string | null }> | null
  readonly target?: ReadonlyArray<{ id?: string | null }> | null
}

/** Resolve a focused node's connectable handle ids from React Flow's live
 *  `handleBounds` (ground truth), falling back to the static union when the
 *  node isn't measured. Shared by the Tab guard and the Connect dialog so the
 *  two can't read handles differently. */
export function handleIdsFromBounds(
  handleBounds: HandleBoundsLike | undefined,
  nodeType: string,
): { sourceHandles: string[]; targetHandles: string[] } {
  return {
    sourceHandles: handleBounds?.source?.map((h) => h.id).filter((x): x is string => !!x) ?? staticOutputHandles(nodeType),
    targetHandles: handleBounds?.target?.map((h) => h.id).filter((x): x is string => !!x) ?? staticInputHandles(nodeType),
  }
}
