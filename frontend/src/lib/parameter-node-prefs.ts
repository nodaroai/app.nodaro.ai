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
