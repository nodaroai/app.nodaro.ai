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
 * How many px the rail currently takes on the left.
 *
 * The editor's floating toolbar is `position: fixed` and offsets itself from
 * the app sidebar, so without this it renders ON TOP of the rail — the reported
 * bug. Anything else anchored to the left edge should offset by this too.
 * Returns 0 when there is no rail at all (community, or never opened).
 */
export function useCopilotRailWidth(): number {
  return useCopilotUiStore((s) => {
    if (!hasCredits()) return 0
    return s.open ? COPILOT_RAIL_WIDTH : COPILOT_TAB_WIDTH
  })
}
