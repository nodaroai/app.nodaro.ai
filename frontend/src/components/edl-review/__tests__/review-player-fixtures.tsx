import { afterEach, beforeEach, vi } from "vitest"
import { cleanup, fireEvent, screen, within } from "@testing-library/react"
import { effectiveRenderBasis, buildEffectiveEdl } from "@nodaro/render-rules"
import { normalizeEdl, renderReadBasis } from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { resetUndoStacks } from "@/lib/edl-review/undo-stack"
import { PLAN, layOut, loadCanvas } from "./review-test-canvas"

/**
 * What the review player's tests share: the jsdom stand-in for a media
 * element's play and pause, a take stamped fresh for the plan, and the player's
 * queries. `useHarness()` registers the per-test setup; `h` is what it made.
 */
export const h: { page: ReturnType<typeof layOut>; played: HTMLMediaElement[]; paused: HTMLMediaElement[] } = {
  page: undefined as unknown as ReturnType<typeof layOut>,
  played: [],
  paused: [],
}

export function useHarness(): void {
  beforeEach(() => {
    resetUndoStacks()
    h.page = layOut()
    loadCanvas()
    h.played = []
    h.paused = []
    // jsdom plays nothing: a play or a pause is recorded and reported as a
    // browser would — a pause of an element already paused fires no event.
    const setPaused = (el: HTMLMediaElement, value: boolean) => Object.defineProperty(el, "paused", { configurable: true, value })
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
      h.played.push(this)
      setPaused(this, false)
      this.dispatchEvent(new Event("play"))
      return Promise.resolve()
    })
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) {
      h.paused.push(this)
      if (this.paused) return
      setPaused(this, true)
      this.dispatchEvent(new Event("pause"))
    })
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined)
  })
  afterEach(() => {
    cleanup()
    h.page.restore()
    vi.restoreAllMocks()
    delete (window as { __NODARO_RUNTIME__?: unknown }).__NODARO_RUNTIME__
    useWorkflowStore.setState({ renderFinal: null, renderCheck: null })
  })
}

/** A take stamped as a render of the plan as it stands (fresh), at the node's defaults. */
export function freshTake() {
  const effective = buildEffectiveEdl(normalizeEdl(PLAN), { crossfadeMs: 0, sourceOverrides: [] })
  return {
    url: "https://cdn.test/preview.mp4",
    quality: "proxy",
    planBasis: renderReadBasis(PLAN),
    renderBasis: effectiveRenderBasis(effective, { output: "video", crossfadeMs: 0 }),
  }
}
export const withTake = (take: Record<string, unknown>) => loadCanvas({ cut: { generatedResults: [take], activeResultIndex: 0 } })

export const player = () => screen.getByTestId("review-player")
export const tab = (name: RegExp) => within(player()).getByRole("radio", { name })
export const media = (which: "take" | "original") => player().querySelector<HTMLMediaElement>(`[data-testid="review-${which}-media"]`)
/** The element has its metadata: what a browser reports before a seek lands. */
export const loaded = (el: HTMLMediaElement) => {
  Object.defineProperty(el, "readyState", { configurable: true, value: 1 })
  fireEvent.loadedMetadata(el)
}
export const at = (el: HTMLMediaElement, seconds: number) => {
  el.currentTime = seconds
  fireEvent.timeUpdate(el)
}
