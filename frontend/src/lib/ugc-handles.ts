/**
 * The UGC video nodes' input pips: one row per pip, read by each node's own
 * `HandleWithPopover` (its label, colour and `accepts`), the drag-to-connect
 * validator (`connection-validation.ts` → `isValidUgcConnection`) and the
 * source-direction popover registry (`target-handle-registry.ts`), so the
 * three can never disagree.
 *
 * The UGC wires carry the nodes' own versioned JSON (a creator record, a
 * script, a clip ticket, the clips' notes) or one UGC node's own text (the
 * script's product category, the clips' transcript), so each of those inputs
 * takes exactly the one UGC output that makes it, never any other JSON or
 * text. The media and text inputs take the ordinary producers. A row's
 * `accepts` sees only a source type (all a pip or a popover knows): the type
 * the dragged pip passes for, which for a UGC text pip is a plain text. The
 * validator judges the source node itself and its handle, so a wire from the
 * wrong output of the right node, or from a text that only passes for that
 * pip, is refused.
 */
import { UGC_CREATOR_PICKER_TYPES, UGC_PRIMARY_HANDLE, UGC_SCREENSHOT_HANDLES, resolveEffectiveSourceType } from "@nodaro/shared"
import { DATA_TEXT_PRODUCER_TYPES } from "./data-handles"
import { ACCEPTS_VIDEO } from "./ffmpeg-handles"
import { ACCEPTS_IMAGE_OR_DYN } from "./image-producer-handles"
import { UGC_PLAN_INPUTS, ugcPlanInputMaker } from "./ugc-plan-inputs"

/** What a UGC input carries: picks the pip's colour and icon on the node. */
export type UgcPipKind = "image" | "text" | "video" | "json" | "picker"

export interface UgcTargetHandle {
  readonly handleId: string
  readonly label: string
  readonly kind: UgcPipKind
  readonly accepts: (sourceType: string) => boolean
  /** A UGC wire: the one node type and output this input reads. */
  readonly wire?: { readonly type: string; readonly handle: string }
}

const ACCEPTS_TEXT = (s: string): boolean => DATA_TEXT_PRODUCER_TYPES.has(s)

const media = (handleId: string, label: string, kind: UgcPipKind, accepts: (s: string) => boolean): UgcTargetHandle =>
  ({ handleId, label, kind, accepts })
/** A UGC wire. Its `accepts` takes the node, or what the node's pip passes for during a drag (a text pip is a plain text); the validator then requires the node and the pip. */
const wire = (handleId: string, label: string, kind: UgcPipKind, type: string, handle: string): UgcTargetHandle => {
  const passesFor = resolveEffectiveSourceType(type, handle)
  return { handleId, label, kind, accepts: (s) => s === type || s === passesFor, wire: { type, handle } }
}

/** Per UGC node type, its input pips in the order the node draws them. */
export const UGC_TARGET_HANDLES: Readonly<Record<string, readonly UgcTargetHandle[]>> = {
  "ugc-creator": [
    media("photo", "Your photo", "image", ACCEPTS_IMAGE_OR_DYN),
    wire("category", "Product category", "text", "ugc-script", "category"),
    media("pickers", "Creator look", "picker", (s) => UGC_CREATOR_PICKER_TYPES.has(s)),
  ],
  "ugc-script": [
    media("site", "Product name or website", "text", ACCEPTS_TEXT),
    ...UGC_SCREENSHOT_HANDLES.map((handleId, i) => media(handleId, `Screenshot ${i + 1}`, "image", ACCEPTS_IMAGE_OR_DYN)),
    media("product", "Product photo", "image", ACCEPTS_IMAGE_OR_DYN),
  ],
  "ugc-clips": [
    wire("plan", "Script", "json", "ugc-script", "plan"),
    wire("creator", "Creator", "json", "ugc-creator", "creator"),
  ],
  "ugc-clip": [
    wire("clip", "Clip", "json", "ugc-clips", "clips"),
  ],
  "ugc-cards": [
    wire("plan", "Script", "json", "ugc-clips", "plan-out"),
    media("video", "Video", "video", ACCEPTS_VIDEO),
    wire("transcript", "Transcript", "text", "ugc-clips", "transcript"),
    wire("notes", "Clip notes", "json", "ugc-clip", "video-out"),
  ],
}

/** One pip of a UGC node, or undefined for a type or handle it does not have. */
export function ugcTargetHandle(targetType: string, targetHandle: string): UgcTargetHandle | undefined {
  if (!Object.hasOwn(UGC_TARGET_HANDLES, targetType)) return undefined
  return UGC_TARGET_HANDLES[targetType]!.find((row) => row.handleId === targetHandle)
}

/**
 * The drag-to-connect rule for every UGC input, given the source node's own
 * (raw) type and the pip the wire leaves. A UGC wire reads one output of one
 * node: that node, and that pip — an edge with no source handle reads its
 * source's primary output (the one an agent-written edge without `sourceHandle`
 * gets on both engines) — never what the pip passes for elsewhere, so a text
 * pip keeps feeding the UGC input made for it and no other text does. A media
 * or text input judges what the pip emits (an output pip that is a plain medium
 * counts as that medium).
 */
export function isValidUgcConnection(targetType: string, targetHandle: string, sourceType: string, sourceHandle?: string | null): boolean {
  const row = ugcTargetHandle(targetType, targetHandle)
  if (!row) return false
  if (!row.wire) return row.accepts(resolveEffectiveSourceType(sourceType, sourceHandle))
  const read = sourceHandle ?? (Object.hasOwn(UGC_PRIMARY_HANDLE, sourceType) ? UGC_PRIMARY_HANDLE[sourceType] : undefined)
  return sourceType === row.wire.type && read === row.wire.handle
}

/**
 * The UGC output an input is made to read: a UGC wire's, or the one a public
 * input is made for (ugc-plan-inputs.ts). The add-node popup wires a pair on
 * these pips, so an input reading one output of one node is never guessed.
 */
export function ugcOutputReadBy(targetType: string, targetHandle: string): { readonly type: string; readonly handle: string } | undefined {
  return ugcTargetHandle(targetType, targetHandle)?.wire ?? ugcPlanInputMaker(targetType, targetHandle)
}

/** The input of `targetType` made to read `sourceType`'s output `sourceHandle`, if it has one. */
export function ugcInputReading(targetType: string, sourceType: string, sourceHandle: string): string | undefined {
  const inputs = [
    ...(Object.hasOwn(UGC_TARGET_HANDLES, targetType) ? UGC_TARGET_HANDLES[targetType]!.map((row) => row.handleId) : []),
    ...(Object.hasOwn(UGC_PLAN_INPUTS, targetType) ? Object.keys(UGC_PLAN_INPUTS[targetType]!) : []),
  ]
  return inputs.find((handle) => {
    const made = ugcOutputReadBy(targetType, handle)
    return made?.type === sourceType && made.handle === sourceHandle
  })
}
