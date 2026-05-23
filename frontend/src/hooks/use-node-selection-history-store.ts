import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type { SceneNodeType } from "@/types/nodes"

export interface HistoryEntry {
  readonly nodeType: SceneNodeType
  readonly lastUsedAt: number
  readonly count: number
}

interface NodeSelectionHistoryState {
  readonly history: ReadonlyArray<HistoryEntry>
  readonly recordSelection: (nodeType: SceneNodeType) => void
}

const MAX_HISTORY = 50

export const useNodeSelectionHistoryStore = create<NodeSelectionHistoryState>()(
  persist(
    (set) => ({
      history: [],
      recordSelection: (nodeType) =>
        set((state) => {
          const now = Date.now()
          const existing = state.history.find((h) => h.nodeType === nodeType)
          if (existing) {
            return {
              history: state.history.map((h) =>
                h.nodeType === nodeType
                  ? { ...h, count: h.count + 1, lastUsedAt: now }
                  : h,
              ),
            }
          }
          const next = [...state.history, { nodeType, lastUsedAt: now, count: 1 }]
          if (next.length > MAX_HISTORY) {
            next.sort((a, b) => b.lastUsedAt - a.lastUsedAt)
            next.length = MAX_HISTORY
          }
          return { history: next }
        }),
    }),
    {
      name: "nodaro:node-selection-history",
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
)
