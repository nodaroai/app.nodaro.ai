import { useCallback } from "react"
import { create } from "zustand"

/**
 * What of each Video Overlay node is selected — one layer, or the base video,
 * never both (audit U4). The panel's timeline bars select a layer AND seek the
 * node's stage to its start — the stage draws only the layers live at that
 * time, so the bars are the one way to reach every layer — which crosses the
 * panel / node component trees. The base is selected only from the panel's
 * Base video card: an unselected base takes no pointer on the stage, so the
 * node's body drags the node and a click selects the node, as before the base
 * could move. A per-node UI entry both read; deliberately NOT node data (never
 * saved, never part of undo) and not persisted.
 */
interface VideoOverlaySelectionState {
  /** node id → selected 0-based layer index. */
  readonly selected: Readonly<Record<string, number>>
  /** node ids whose base video is selected. */
  readonly base: Readonly<Record<string, true>>
  /** Select a layer (the base is deselected), or nothing. */
  readonly select: (nodeId: string, index: number | null) => void
  /** Select the base (the layer is deselected), or deselect it. */
  readonly selectBase: (nodeId: string, on: boolean) => void
}

function without<T>(map: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  if (!(key in map)) return map
  const { [key]: _dropped, ...rest } = map
  return rest
}

export const useVideoOverlaySelectionStore = create<VideoOverlaySelectionState>((set) => ({
  selected: {},
  base: {},
  select: (nodeId, index) =>
    set((s) => {
      if (index === null) return nodeId in s.selected ? { selected: without(s.selected, nodeId) } : s
      if (s.selected[nodeId] === index && !(nodeId in s.base)) return s
      return { selected: { ...s.selected, [nodeId]: index }, base: without(s.base, nodeId) }
    }),
  selectBase: (nodeId, on) =>
    set((s) => {
      if (!on) return nodeId in s.base ? { base: without(s.base, nodeId) } : s
      if (nodeId in s.base && !(nodeId in s.selected)) return s
      return { base: { ...s.base, [nodeId]: true }, selected: without(s.selected, nodeId) }
    }),
}))

export function useVideoOverlaySelection(nodeId: string): readonly [number | null, (index: number | null) => void] {
  const selected = useVideoOverlaySelectionStore((s) => s.selected[nodeId])
  const select = useVideoOverlaySelectionStore((s) => s.select)
  const setSelected = useCallback((index: number | null) => select(nodeId, index), [nodeId, select])
  return [selected ?? null, setSelected] as const
}

/** Whether the node's base video is selected — chosen from the Base video card — and its setter. */
export function useVideoOverlayBaseSelection(nodeId: string): readonly [boolean, (on: boolean) => void] {
  const selected = useVideoOverlaySelectionStore((s) => nodeId in s.base)
  const selectBase = useVideoOverlaySelectionStore((s) => s.selectBase)
  const setSelected = useCallback((on: boolean) => selectBase(nodeId, on), [nodeId, selectBase])
  return [selected, setSelected] as const
}
