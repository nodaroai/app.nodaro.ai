/**
 * Where UGC outputs may go, outside the UGC nodes' own inputs (ugc-handles.ts).
 *
 * Public inputs a UGC output is made for: UGC Cards' layer plan feeds Video
 * Overlay's `layerPlan`, its caption plan Add Captions' `captionPlan`. Both
 * inputs take any JSON producer, and every UGC node with a JSON pip is one, so
 * from a UGC node these inputs take only the output made for them; every other
 * source keeps the input's own rule.
 *
 * Private outputs: the outputs that carry the UGC nodes' own data — a creator
 * record, a script, the clip tickets, the sized script — and UGC Cards' two
 * plans: every JSON pip a UGC node declares (`declaredJsonOutputRows`), so a
 * UGC JSON pip added later is private the day it is declared. Any other input
 * would accept them as "JSON" and fail at run time, so they go only to a UGC
 * input, to the public input made for them, and to the sinks that take any
 * wire as it is. The plain-text pips (the category, the transcript, the Notes)
 * declare no JSON and are not private: each is a plain text.
 *
 * Imports nothing but @nodaro/shared: the handle modules that hold the public
 * inputs' rules read it, and ugc-handles.ts reads those modules, so a wider
 * import here would be a cycle.
 */
import { UGC_NODE_TYPES, UGC_PRIMARY_HANDLE, declaredJsonOutputRows } from "@nodaro/shared"

interface UgcOutput { readonly type: string; readonly handle: string }

/** Per consumer node type and input: the UGC node and output made for it. */
export const UGC_PLAN_INPUTS: Readonly<Record<string, Readonly<Record<string, UgcOutput>>>> = {
  "video-overlay": { layerPlan: { type: "ugc-cards", handle: "layerPlan" } },
  "add-captions": { captionPlan: { type: "ugc-cards", handle: "captionPlan" } },
}

/** Per UGC node type, its private outputs: the JSON pips it declares (json-kinds). */
export const UGC_PRIVATE_OUTPUTS: Readonly<Record<string, readonly string[]>> = Object.freeze(
  declaredJsonOutputRows()
    .filter(([type]) => UGC_NODE_TYPES.has(type))
    .reduce<Readonly<Record<string, readonly string[]>>>((byType, [type, pip]) => ({ ...byType, [type]: [...(byType[type] ?? []), pip] }), {}),
)

/** Sinks that take any wire as it is: an inspector and a store. */
export const UGC_PRIVATE_OUTPUT_SINKS: ReadonlySet<string> = new Set(["preview", "collection-write"])

/** The output an edge reads: its source handle, else the node's primary output. */
const pipOf = (sourceType: string, sourceHandle: string | null | undefined): string | undefined =>
  sourceHandle ?? (Object.hasOwn(UGC_PRIMARY_HANDLE, sourceType) ? UGC_PRIMARY_HANDLE[sourceType] : undefined)

/** The UGC output a public input is made for, or undefined. */
export function ugcPlanInputMaker(targetType: string, targetHandle: string): UgcOutput | undefined {
  const inputs = Object.hasOwn(UGC_PLAN_INPUTS, targetType) ? UGC_PLAN_INPUTS[targetType] : undefined
  return inputs && Object.hasOwn(inputs, targetHandle) ? inputs[targetHandle] : undefined
}
const madeFor = ugcPlanInputMaker

/**
 * The type-level half (a pip's glow, the source-direction popover): a UGC node
 * other than the one an input is made for never fits it. Any other source type
 * is the input's own rule's business, so this only ever narrows.
 */
export function ugcMayFeedPlanInput(targetType: string, targetHandle: string, sourceType: string): boolean {
  const made = madeFor(targetType, targetHandle)
  return !made || !UGC_NODE_TYPES.has(sourceType) || sourceType === made.type
}

/**
 * The drop: from a UGC node, exactly the output an input is made for (an edge
 * with no source handle reads the node's primary output). `undefined` where
 * the rule does not apply — another input, or a source that is no UGC node.
 */
export function ugcPlanInputVerdict(targetType: string, targetHandle: string, sourceType: string, sourceHandle?: string | null): boolean | undefined {
  const made = madeFor(targetType, targetHandle)
  if (!made || !UGC_NODE_TYPES.has(sourceType)) return undefined
  if (sourceType !== made.type) return false
  return pipOf(sourceType, sourceHandle) === made.handle
}

/**
 * The drop for a private output: `false` where it may not go; `undefined` where
 * this rule has no say — a pip that is not private, a UGC input (whose own row
 * decides), a sink, or the public input made for it.
 */
export function ugcPrivateOutputVerdict(sourceType: string, sourceHandle: string | null | undefined, targetType: string, targetHandle: string): false | undefined {
  const pip = pipOf(sourceType, sourceHandle)
  const pips = Object.hasOwn(UGC_PRIVATE_OUTPUTS, sourceType) ? UGC_PRIVATE_OUTPUTS[sourceType]! : []
  if (pip === undefined || !pips.includes(pip)) return undefined
  if (UGC_NODE_TYPES.has(targetType) || UGC_PRIVATE_OUTPUT_SINKS.has(targetType)) return undefined
  const made = madeFor(targetType, targetHandle)
  return made?.type === sourceType && made.handle === pip ? undefined : false
}
