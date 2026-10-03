/** Parameter node display mode (picks / prompt / both) — shared util.
 *
 *  Persistence rule: localStorage stores the LAST mode the user picked. New
 *  parameter nodes are SEEDED with that value at creation time (in
 *  `addNode`). Existing nodes keep whatever mode they were saved with —
 *  toggling on one node never changes the rendering of another.
 *
 *  Pref key: `nodaro:parameter-node-display-mode` (per-device).
 */

export type ParameterDisplayMode = "picks" | "prompt" | "both"

const STORAGE_KEY = "nodaro:parameter-node-display-mode"

export function getStickyParameterDisplayMode(): ParameterDisplayMode {
  if (typeof window === "undefined") return "picks"
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    if (v === "picks" || v === "prompt" || v === "both") return v
  } catch {
    // localStorage may throw in private mode / when disabled — fall through.
  }
  return "picks"
}

export function setStickyParameterDisplayMode(mode: ParameterDisplayMode): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // Ignore storage failures (private mode, quota, etc.).
  }
}

/** Person picker layout mode (compact / detailed) — persisted per-device.
 *
 *  Same persistence + guard convention as the display-mode pref above: a
 *  cross-origin iframe (embeddable published apps) or private mode can make
 *  `localStorage` THROW on access, so every read/write is guarded.
 *
 *  Pref key: `nodaro:person-picker-view` (per-device). Default: detailed —
 *  the open, by-topic view. (The key replaced `nodaro:person-picker-mode`,
 *  whose default was compact, so every device starts on the open view once.)
 */

export type PersonPickerMode = "compact" | "detailed"

const PERSON_PICKER_MODE_KEY = "nodaro:person-picker-view"

export function getStickyPersonPickerMode(): PersonPickerMode {
  if (typeof window === "undefined") return "detailed"
  try {
    return window.localStorage.getItem(PERSON_PICKER_MODE_KEY) === "compact" ? "compact" : "detailed"
  } catch {
    // localStorage may throw in private mode / cross-origin iframe — fall through.
    return "detailed"
  }
}

export function setStickyPersonPickerMode(mode: PersonPickerMode): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(PERSON_PICKER_MODE_KEY, mode)
  } catch {
    // Ignore storage failures (iframe / private mode, quota, etc.).
  }
}

/** Look-picker preview style (real render / drawn illustration) — sticky PER
 *  PICKER TYPE, per-device.
 *
 *  Same rule as the display mode above: the switch on a node (or in its
 *  picker grid) saves the choice on THAT node and remembers it here; a NEW
 *  node of the same type is seeded with it in `addNode`. Camera Motion and
 *  Color / Look remember independently. Types never switched have no entry,
 *  so their new nodes carry no `previewStyle` at all (= real).
 *
 *  Pref key: `nodaro:look-preview-style` → `{ [nodeType]: style }`.
 */

export type StickyLookPreviewStyle = "real" | "illustration"

const LOOK_PREVIEW_STYLE_KEY = "nodaro:look-preview-style"

function readLookPreviewStyleMap(): Record<string, unknown> {
  if (typeof window === "undefined") return {}
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(LOOK_PREVIEW_STYLE_KEY) ?? "{}")
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    // Unreadable storage (private mode, iframe) or a corrupt value — no preference.
    return {}
  }
}

export function getStickyLookPreviewStyle(nodeType: string): StickyLookPreviewStyle | undefined {
  const v = readLookPreviewStyleMap()[nodeType]
  return v === "real" || v === "illustration" ? v : undefined
}

export function setStickyLookPreviewStyle(nodeType: string, style: StickyLookPreviewStyle): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(LOOK_PREVIEW_STYLE_KEY, JSON.stringify({ ...readLookPreviewStyleMap(), [nodeType]: style }))
  } catch {
    // Ignore storage failures (iframe / private mode, quota, etc.).
  }
}
