/**
 * Open/closed state for the Copilot rail.
 *
 * CORE on purpose, even though the panel itself is enterprise: the editor
 * toolbar button, the collapsed tab and the panel slot all need to read it, and
 * core code may not import from `ee/`. It holds no copilot logic — just three
 * booleans — so a community build carries a few bytes and renders nothing.
 */
import { create } from "zustand"

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
