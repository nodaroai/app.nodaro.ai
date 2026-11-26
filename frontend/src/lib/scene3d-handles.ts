/**
 * Typed-handle rules for the two 3D-scene nodes.
 *
 * `references` carries the image/video the authoring LLM looks at (appearance,
 * layout or motion). `prompt` (Generate 3D Scene) carries text that becomes
 * the scene's brief at run time — a Video Analysis's `json` or `text` among
 * it, the scene breakdown as text. `scene` (Edit 3D Scene only) carries an upstream scene
 * plan — that one is gated by the `composition` source rule in
 * `connection-validation.ts`, because a plan travels on a composition pip.
 *
 * One module so drag-to-connect validation, the handle popover's candidate
 * enumeration and the drag glow all read the SAME predicate.
 */
import { VIDEO_PRODUCER_TYPES, DYNAMIC_PRODUCER_TYPES } from "@nodaro/shared/nodes"
import { IMAGE_PRODUCER_TYPES, JSON_PRODUCER_TYPES, TEXT_PRODUCER_TYPES } from "./generate-image-handles"

/** The 3D-scene authoring nodes. Both emit a `3d-scene` plan on `composition`. */
export const SCENE3D_NODE_TYPES: ReadonlySet<string> = new Set([
  "pro-3d-render",
  "generate-3d-scene",
  "edit-3d-scene",
])

/** `references` accepts any image or video producer (and runtime-typed producers). */
export const ACCEPTS_SCENE3D_REFERENCE = (sourceType: string): boolean =>
  IMAGE_PRODUCER_TYPES.has(sourceType) ||
  VIDEO_PRODUCER_TYPES.has(sourceType) ||
  DYNAMIC_PRODUCER_TYPES.has(sourceType)

/**
 * `prompt` accepts what both engines route into a prompt as text: text
 * producers (Video Analysis and Video Audit included), structured JSON that
 * arrives stringified, and runtime-typed producers. Not the parameter
 * pickers: their hint is appended by nodes that read it, and this one does
 * not, so a wired picker would silently do nothing.
 */
export const ACCEPTS_SCENE3D_PROMPT = (sourceType: string): boolean =>
  TEXT_PRODUCER_TYPES.has(sourceType) ||
  JSON_PRODUCER_TYPES.has(sourceType) ||
  DYNAMIC_PRODUCER_TYPES.has(sourceType)

/** `scene` accepts only a node that produces a 3D scene plan. */
export const ACCEPTS_SCENE3D_PLAN = (sourceType: string): boolean =>
  SCENE3D_NODE_TYPES.has(sourceType)

export const SCENE3D_HANDLE_LABELS: Record<string, string> = {
  prompt: "Prompt",
  references: "References",
  scene: "Scene",
  composition: "Composition",
  stills: "Shot stills",
}

/**
 * Drop rule for a wire landing on a 3D-scene node. Unknown handles fall
 * through to `true` so a future handle is not silently un-connectable.
 */
export function isValidScene3DConnection(targetHandle: string, sourceType: string): boolean {
  if (targetHandle === "references") return ACCEPTS_SCENE3D_REFERENCE(sourceType)
  if (targetHandle === "prompt") return ACCEPTS_SCENE3D_PROMPT(sourceType)
  if (targetHandle === "scene") return ACCEPTS_SCENE3D_PLAN(sourceType)
  return true
}
