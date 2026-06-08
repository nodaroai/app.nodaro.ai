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
 *  Pref key: `nodaro:person-picker-mode` (per-device). Default: compact.
 */

export type PersonPickerMode = "compact" | "detailed"

const PERSON_PICKER_MODE_KEY = "nodaro:person-picker-mode"

export function getStickyPersonPickerMode(): PersonPickerMode {
  if (typeof window === "undefined") return "compact"
  try {
    return window.localStorage.getItem(PERSON_PICKER_MODE_KEY) === "detailed" ? "detailed" : "compact"
  } catch {
    // localStorage may throw in private mode / cross-origin iframe — fall through.
    return "compact"
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
