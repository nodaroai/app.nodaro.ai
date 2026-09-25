import { useCallback } from "react"
import { create } from "zustand"

/**
 * Which layer of each Video Overlay node is selected (audit U4). The panel's
 * timeline bars select a layer AND seek the node's stage to its start — the
 * stage draws only the layers live at that time, so the bars are the one way
 * to reach every layer — which crosses the panel / node component trees. A
 * per-node UI entry both read; deliberately NOT node data (never saved, never
 * part of undo) and not persisted.
 */
interface VideoOverlaySelectionState {
  /** node id → selected 0-based layer index. */
  readonly selected: Readonly<Record<string, number>>
  readonly select: (nodeId: string, index: number | null) => void
}

export const useVideoOverlaySelectionStore = create<VideoOverlaySelectionState>((set) => ({
  selected: {},
  select: (nodeId, index) =>
    set((s) => {
      if (index === null) {
        if (!(nodeId in s.selected)) return s
        const { [nodeId]: _dropped, ...rest } = s.selected
        return { selected: rest }
      }
      return s.selected[nodeId] === index ? s : { selected: { ...s.selected, [nodeId]: index } }
    }),
}))

export function useVideoOverlaySelection(nodeId: string): readonly [number | null, (index: number | null) => void] {
  const selected = useVideoOverlaySelectionStore((s) => s.selected[nodeId])
  const select = useVideoOverlaySelectionStore((s) => s.select)
  const setSelected = useCallback((index: number | null) => select(nodeId, index), [nodeId, select])
  return [selected ?? null, setSelected] as const
}
