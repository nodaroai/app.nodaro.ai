/**
 * Open/closed state for the Copilot rail.
 *
 * CORE on purpose, even though the panel itself is enterprise: the editor
 * toolbar button, the collapsed tab and the panel slot all need to read it, and
 * core code may not import from `ee/`. It holds no copilot logic — just three
 * booleans — so a community build carries a few bytes and renders nothing.
 */
import { create } from "zustand"
import { hasCredits } from "@/lib/edition"
import { surfaceFeatureHidden } from "@/lib/surface-selectors"

/** Open rail width in px. The panel's own class and every layout offset read this. */
export const COPILOT_RAIL_WIDTH = 380

/** Collapsed tab width in px. */
export const COPILOT_TAB_WIDTH = 40

interface CopilotUiState {
  open: boolean
  /** True once the panel has been opened in this session — gates the lazy ee chunk. */
  everOpened: boolean
  /** Set by the panel while a turn streams, so the editor can keep out of the way. */
  turnActive: boolean
  openPanel: () => void
  closePanel: () => void
  togglePanel: () => void
  setTurnActive: (active: boolean) => void
}

export const useCopilotUiStore = create<CopilotUiState>((set) => ({
  open: false,
  everOpened: false,
  turnActive: false,
  openPanel: () => set({ open: true, everOpened: true }),
  closePanel: () => set({ open: false }),
  togglePanel: () => set((s) => (s.open ? { open: false } : { open: true, everOpened: true })),
  setTurnActive: (turnActive) => set({ turnActive }),
}))

/**
 * Is the Copilot surfaced at all here? Two independent questions, answered
 * once: the EDITION must have credits (the copilot spends them), and the
 * DEPLOYMENT must not have switched the feature off. Every render path and
 * every layout offset asks this — a site that asked only `hasCredits()` would
 * keep rendering a button whose backend answers 503, or keep reserving room
 * for a rail that is not there.
 */
export function copilotSurfaced(): boolean {
  return hasCredits() && !surfaceFeatureHidden("copilot")
}

/**
 * How many px the rail currently takes at the inline start.
 *
 * The editor's floating toolbar is `position: fixed` and offsets itself from
 * the app sidebar, so without this it renders ON TOP of the rail — the reported
 * bug. Anything else anchored to the inline-start edge should offset by this
 * too. Returns 0 when the Copilot is not surfaced at all — a community
 * edition, or a deployment that hides the feature. A never-opened rail still
 * renders its collapsed tab, so that is COPILOT_TAB_WIDTH, not 0.
 *
 * Known gap: the slot's mobile gate is `(max-width: 899px) and (pointer:
 * coarse)` (use-is-mobile.ts), wider than Tailwind's `md` (768px). On a touch
 * device between 768 and 899px the slot renders no tab while the desktop rail
 * is visible, so this over-reports by COPILOT_TAB_WIDTH — symmetric in both
 * directions, and left as is until the two gates share one breakpoint.
 */
export function useCopilotRailWidth(): number {
  return useCopilotUiStore((s) => {
    if (!copilotSurfaced()) return 0
    return s.open ? COPILOT_RAIL_WIDTH : COPILOT_TAB_WIDTH
  })
}
