/**
 * Per-node typed-handle predicates for the 4 identity-reference nodes:
 * character, face, object, location.
 *
 * Each `isValid<Node>Connection(targetHandleId, sourceType, isPickerType)`
 * returns true iff a source node type is allowed on the given target
 * handle. The same predicates are called from `connection-validation.ts`
 * (drag-to-connect) AND `HandlePopover` (one-click Connect button), so
 * routing and visual-candidate highlight always agree.
 *
 * Source handle IDs (`characterRef`/`faceRef`/`objectRef`/`locationRef`)
 * are intentionally NOT renamed in this migration — they're referenced
 * by `HANDLE_COMPATIBILITY` in `node-compatibility.ts` for legacy popup
 * compat, and the orchestrator routes identity sources by node TYPE
 * (IDENTITY_TYPES set), not by source handle id.
 *
 * Convention mirrors image/video/audio-producer handles: every text /
 * picker target OR's in DYNAMIC_PRODUCER_TYPES so the canvas validator
 * doesn't hard-reject edges the orchestrator would happily route at
 * runtime (drift fix from #2823 / #2827 / #2835).
 */
import { DYNAMIC_PRODUCER_TYPES } from "@nodaro/shared"
import { TEXT_PRODUCER_TYPES } from "./generate-image-handles"

const ACCEPTS_TEXT_OR_DYN = (s: string): boolean =>
  TEXT_PRODUCER_TYPES.has(s) || DYNAMIC_PRODUCER_TYPES.has(s)

/** Text producers + visual pickers + dynamic producers — every `in` /
 *  `prompt` slot accepts this exact union. Same shape as
 *  audio-text-handles.ts:ACCEPTS_PROMPT and video-producer-handles.ts. */
const ACCEPTS_PROMPT = (
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean =>
  ACCEPTS_TEXT_OR_DYN(sourceType) || isVisualPicker(sourceType)

/** Object's `type` target accepts identity-type pickers — the 5 picker
 *  families that describe an object's identity: animal, vehicle,
 *  furniture, weapon, material, held-prop. Wired upstream → auto-clears
 *  the `legacyPickerSelection` breadcrumb on the object node. */
const OBJECT_TYPE_PICKERS: ReadonlySet<string> = new Set([
  "animal", "vehicle", "furniture", "weapon", "material", "held-prop",
])

/** Location's `cinematography` target accepts ANY visual picker —
 *  matches the existing legacy `cinematography` handling in
 *  getCompatibleNodes (the v2.1 split into look/elements doesn't apply
 *  here; identity nodes still use the single combined handle). */
const ACCEPTS_CINEMATOGRAPHY = (
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean => isVisualPicker(sourceType)

// ─── character ─────────────────────────────────────────────────────────
// Single text-prompt input + characterRef source. The `in` handle accepts
// text producers + pickers — the prompt drives generate-character at
// execution time.
export function isValidCharacterConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "in":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker)
    default:
      return false
  }
}

// ─── face ──────────────────────────────────────────────────────────────
// Single text-prompt input + faceRef source.
export function isValidFaceConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "in":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker)
    default:
      return false
  }
}

// ─── object ────────────────────────────────────────────────────────────
// Two inputs: `in` (text-prompt) + `type` (identity-type picker —
// animal/vehicle/furniture/weapon/material/held-prop). Source: objectRef.
export function isValidObjectConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "in":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker)
    case "type":
      return OBJECT_TYPE_PICKERS.has(sourceType)
    default:
      return false
  }
}

// ─── location ──────────────────────────────────────────────────────────
// Two inputs: `in` (text-prompt) + `cinematography` (visual pickers).
// Source: locationRef.
export function isValidLocationConnection(
  targetHandleId: string,
  sourceType: string,
  isVisualPicker: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "in":
      return ACCEPTS_PROMPT(sourceType, isVisualPicker)
    case "cinematography":
      return ACCEPTS_CINEMATOGRAPHY(sourceType, isVisualPicker)
    default:
      return false
  }
}

// ─── Friendly labels for source-direction popover candidate rows ──────

export const IDENTITY_HANDLE_LABELS: Record<string, Record<string, string>> = {
  "character": { in: "Prompt" },
  "face":      { in: "Prompt" },
  "object":    { in: "Prompt", type: "Object type" },
  "location":  { in: "Prompt", cinematography: "Cinematography" },
}
