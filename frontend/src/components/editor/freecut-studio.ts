/**
 * The editor's studio layout, as the app asks for it and answers it.
 *
 * An editor that offers `studio-layout` draws one top bar (with the crew and
 * the app's own buttons) and keeps a slot in its work row for Edit with AI;
 * the app then shows no header of its own and lays the panel on that slot.
 * - NODARO_STUDIO (app → editor): whether the panel is open, how wide its
 *   slot is, and what its button says.
 * - FREECUT_STUDIO_SLOT (editor → app): where the slot is in the frame.
 * - FREECUT_STUDIO_ACTION (editor → app): a top bar button was pressed.
 */
export const STUDIO_LAYOUT = "studio-layout"
export const NODARO_STUDIO = "NODARO_STUDIO"
export const FREECUT_STUDIO_SLOT = "FREECUT_STUDIO_SLOT"
export const FREECUT_STUDIO_ACTION = "FREECUT_STUDIO_ACTION"

/** How wide the Edit with AI panel is, and so the slot the editor keeps for it. */
export const STUDIO_SIDE_WIDTH = 360

export type StudioAction = "toggle-side" | "close" | "new-project"

/** The slot's place in the editor frame, in CSS px. */
export interface StudioSlot {
  readonly open: boolean
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** The slot a FREECUT_STUDIO_SLOT payload names, or null when it is malformed. */
export function readStudioSlot(payload: unknown): StudioSlot | null {
  if (!payload || typeof payload !== "object") return null
  const p = payload as Record<string, unknown>
  const x = finite(p.x)
  const y = finite(p.y)
  const width = finite(p.width)
  const height = finite(p.height)
  if (x === null || y === null || width === null || height === null) return null
  return { open: p.open === true, x, y, width: Math.max(0, width), height: Math.max(0, height) }
}

const ACTIONS: readonly StudioAction[] = ["toggle-side", "close", "new-project"]

/** The button a FREECUT_STUDIO_ACTION payload names, or null for anything else. */
export function readStudioAction(payload: unknown): StudioAction | null {
  const action = (payload as { action?: unknown } | null)?.action
  return ACTIONS.find((known) => known === action) ?? null
}
