import { create } from "zustand"

/**
 * Each picture's natural aspect (width ÷ height) by its URL, as a Video
 * Overlay stage read it (an image's `load`, a video's `loadedmetadata`, the
 * base's display size). The stage places a stack by these shapes; the panel
 * shows a stacked layer's box and the layers writer keeps a stack's rects
 * when its layout turns Custom by the SAME shapes, so neither can store a
 * place the stage did not draw. A URL is one file, whichever node draws it.
 * Deliberately not node data (never saved, never part of undo) and not
 * persisted: it is read back from the files on the next load.
 */
interface VideoOverlayAspectState {
  readonly aspects: Readonly<Record<string, number>>
  /** URLs whose shape the browser could not read (a load error, or no metadata in time): the canvas stops waiting for them. */
  readonly unreadable: Readonly<Record<string, true>>
  readonly setAspect: (url: string, aspect: number) => void
  readonly markUnreadable: (url: string) => void
  /** Forget an unreadable mark, so the shape is read again (the panel re-arms its read when it opens). */
  readonly clearUnreadable: (url: string) => void
}

function withoutUrl(map: Readonly<Record<string, true>>, url: string): Readonly<Record<string, true>> {
  const { [url]: _gone, ...rest } = map
  return rest
}

export const useVideoOverlayAspectStore = create<VideoOverlayAspectState>((set) => ({
  aspects: {},
  unreadable: {},
  // A shape read by ANY reader (the stage's picture, a probe) clears an unreadable mark: it was read after all.
  setAspect: (url, aspect) =>
    set((s) => {
      if (!(Number.isFinite(aspect) && aspect > 0)) return s
      const unreadable = s.unreadable[url] ? withoutUrl(s.unreadable, url) : s.unreadable
      if (s.aspects[url] === aspect && unreadable === s.unreadable) return s
      return { aspects: { ...s.aspects, [url]: aspect }, unreadable }
    }),
  markUnreadable: (url) => set((s) => (s.unreadable[url] || s.aspects[url] !== undefined ? s : { unreadable: { ...s.unreadable, [url]: true } })),
  clearUnreadable: (url) => set((s) => (s.unreadable[url] ? { unreadable: withoutUrl(s.unreadable, url) } : s)),
}))
