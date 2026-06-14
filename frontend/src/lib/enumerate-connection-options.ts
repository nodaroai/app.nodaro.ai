/**
 * Pure enumerator for Tab-auto-connect: given a FOCUSED node and a candidate
 * NEW node type, list the valid connection options (both directions) plus any
 * text-`{variable}` shortcuts.
 *
 * Correctness model (why we enumerate the CONSUMER's input handles):
 * a connection is `producer → consumer.handle`. The authoritative check is the
 * canonical `isValidWorkflowConnection`, which dispatches on the CONSUMER type +
 * handle (e.g. generate-image's `elements` accepts pickers, `prompt` accepts
 * text/pickers). So for each direction we iterate the consumer's input handles
 * and gate every candidate through that validator — this is exactly what a manual
 * drag would allow.
 *
 * Untyped consumers (e.g. a picker's freeform text `in`) have no validator and
 * fall through to `isValidWorkflowConnection`'s permissive `return true`, which
 * would offer nonsense like `image → person.in`. We exclude those with a
 * DISCRIMINATION test: a handle is only offered if it REJECTS an impossible
 * sentinel producer. Typed handles reject the sentinel (they check real type
 * sets); permissive handles accept it and are skipped. No maintained type list.
 *
 * The focused node's handle ids come from the caller (React Flow `handleBounds`
 * ground truth). The new node's input handles come from `staticInputHandles`
 * (it isn't rendered yet).
 */
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
const SENTINEL = "__autoconnect_sentinel__"
/** A node type no validator's accept-set contains → typed handles reject it. */
const SENTINEL_TYPE = "__autoconnect_sentinel_type__"
const TEXT_HANDLE_PRIORITY = ["prompt", "in", "text", "userInput"]

function prettify(id: string): string {
  return id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

function handleLabel(consumerType: string, handleId: string): string {
  return TARGET_HANDLE_ACCEPTS[consumerType]?.find((e) => e.handleId === handleId)?.label ?? prettify(handleId)
}

export function enumerateConnectionOptionsCore(args: {
  focusedType: string
  newType: string
  focusedSourceHandles: readonly string[]
  focusedTargetHandles: readonly string[]
  missingRefNames: readonly string[]
}): ConnectionOptions {
  const { focusedType, newType } = args
  const typeOf = (id: string): string | undefined =>
    id === FOCUSED ? focusedType : id === NEW ? newType : id === SENTINEL ? SENTINEL_TYPE : undefined

  const handles: ConnectionOption[] = []
  const seen = new Set<string>()
  const push = (o: ConnectionOption) => {
    const key = `${o.direction}|${o.fHandle}|${o.nHandle}`
    if (seen.has(key)) return
    seen.add(key)
    handles.push(o)
  }

  /** A consumer handle is meaningful only if it rejects an impossible producer;
   *  permissive (untyped) handles accept the sentinel and are skipped. */
  const discriminates = (consumerId: string, handle: string): boolean =>
    !isValidWorkflowConnection({ source: SENTINEL, target: consumerId, targetHandle: handle }, typeOf)

  // Focused PRODUCES → new node CONSUMES (iterate the new node's input handles).
  const fOut = args.focusedSourceHandles[0]
  if (fOut !== undefined) {
    for (const h of staticInputHandles(newType)) {
      if (!discriminates(NEW, h)) continue
      if (!isValidWorkflowConnection({ source: FOCUSED, sourceHandle: fOut, target: NEW, targetHandle: h }, typeOf)) continue
      push({ kind: "handle", direction: "source", fHandle: fOut, nHandle: h, tier: "direct", label: handleLabel(newType, h), color: getEdgeTypeColor(focusedType, fOut) })
    }
  }

  // New node PRODUCES → focused CONSUMES (iterate the focused node's input handles).
  const nOut = staticOutputHandles(newType)[0]
  if (nOut !== undefined) {
    for (const h of args.focusedTargetHandles) {
      if (!discriminates(FOCUSED, h)) continue
      if (!isValidWorkflowConnection({ source: NEW, sourceHandle: nOut, target: FOCUSED, targetHandle: h }, typeOf)) continue
      push({ kind: "handle", direction: "target", fHandle: h, nHandle: nOut, tier: "direct", label: handleLabel(focusedType, h), color: getEdgeTypeColor(newType, nOut) })
    }
  }

  // Variable rows: ONLY when the new node feeds a TEXT input of the focused node
  // (so `{Label}` resolves to text, not a URL).
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

/** A node's input handle ids for enumeration. The focused (rendered) node uses
 *  React Flow handleBounds; the NEW node isn't rendered, so we union its declared
 *  inputs with the typed-handle registry. */
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
 *  node isn't measured. Shared by the Tab guard and the Connect dialog. */
export function handleIdsFromBounds(
  handleBounds: HandleBoundsLike | undefined,
  nodeType: string,
): { sourceHandles: string[]; targetHandles: string[] } {
  return {
    sourceHandles: handleBounds?.source?.map((h) => h.id).filter((x): x is string => !!x) ?? staticOutputHandles(nodeType),
    targetHandles: handleBounds?.target?.map((h) => h.id).filter((x): x is string => !!x) ?? staticInputHandles(nodeType),
  }
}
