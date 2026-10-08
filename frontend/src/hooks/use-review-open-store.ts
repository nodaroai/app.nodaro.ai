/**
 * Which render's review is open, and whether anything in this editor can show
 * it (A3-5). The entry points — a render's Review cut, the context menu, the
 * Edit Plan's Expand — sit in node components, which render with and without a
 * router, so they call `openReview` here and never touch the URL. The ONE host
 * (`ReviewInspectorHost`, mounted by the canvas) shows the inspector and keeps
 * `?review=` in step (`use-review-route.ts`).
 *
 * `hostMounted` is how an entry point knows there is something to open the
 * review: a canvas without the host (an embed, a test of a lone node) shows no
 * entry rather than one that does nothing.
 */
import { create } from "zustand"

interface ReviewOpenState {
  /** The render the open review is anchored at; null when none is open. */
  readonly renderId: string | null
  readonly hostMounted: boolean
  readonly open: (renderId: string) => void
  readonly close: () => void
  readonly setHostMounted: (mounted: boolean) => void
}

export const useReviewOpenStore = create<ReviewOpenState>((set) => ({
  renderId: null,
  hostMounted: false,
  open: (renderId) => set({ renderId }),
  close: () => set({ renderId: null }),
  setHostMounted: (hostMounted) => set(hostMounted ? { hostMounted } : { hostMounted, renderId: null }),
}))

/** Open the review of a render; a no-op where no host is mounted. */
export function openReview(renderId: string): void {
  const { hostMounted, open } = useReviewOpenStore.getState()
  if (hostMounted) open(renderId)
}

/** Can a review be shown here? */
export function useReviewHostMounted(): boolean {
  return useReviewOpenStore((s) => s.hostMounted)
}
