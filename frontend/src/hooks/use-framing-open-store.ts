/**
 * Which Speaker View node's region editor is open (C3.5, U4), and whether this
 * editor can show it. Like the review inspector's store: the entry point (the
 * panel's "Edit framing…") calls `openFraming` and never touches the URL; the
 * ONE host (`FramingEditorHost`, mounted by the canvas) shows the dialog and
 * keeps `?framing=<nodeId>` in step (`use-framing-route.ts`).
 */
import { create } from "zustand"

interface FramingOpenState {
  /** The Speaker View node whose framing is open; null when none is. */
  readonly nodeId: string | null
  readonly hostMounted: boolean
  readonly open: (nodeId: string) => void
  readonly close: () => void
  readonly setHostMounted: (mounted: boolean) => void
}

export const useFramingOpenStore = create<FramingOpenState>((set) => ({
  nodeId: null,
  hostMounted: false,
  open: (nodeId) => set({ nodeId }),
  close: () => set({ nodeId: null }),
  setHostMounted: (hostMounted) => set(hostMounted ? { hostMounted } : { hostMounted, nodeId: null }),
}))

/** Open a node's region editor; a no-op where no host is mounted. */
export function openFraming(nodeId: string): void {
  const { hostMounted, open } = useFramingOpenStore.getState()
  if (hostMounted) open(nodeId)
}

/** Can the region editor be shown here? */
export function useFramingHostMounted(): boolean {
  return useFramingOpenStore((s) => s.hostMounted)
}
