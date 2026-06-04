// frontend/src/components/audio-player/peak-cache.ts
//
// Module-level cache of decoded waveform peaks, keyed by audio URL. Lets the
// player skip re-decoding when the same clip is shown again (e.g. switching the
// active result on a node, or re-mounting after scrolling out and back in).
// Bounded with simple FIFO eviction so a long session can't grow it unbounded.

type Peaks = (Float32Array | number[])[]

const cache = new Map<string, Peaks>()
const MAX_ENTRIES = 80

export const peakCache = {
  get(url: string): Peaks | undefined {
    return cache.get(url)
  },
  set(url: string, peaks: Peaks): void {
    if (cache.has(url)) return
    if (cache.size >= MAX_ENTRIES) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    cache.set(url, peaks)
  },
}
