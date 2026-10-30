/**
 * Which of a version's videos get a web copy, and which web copy is served
 * (pure; types.ts `TrendWebCopy`).
 *
 * Exactly the videos the public catalog shows (`shownOriginal`,
 * `listedExamples`): the source's display copy, unless the version hides its
 * original (it is then never served, so never copied), and every example
 * (on a version that hides its original, Example 1 is shown AS the
 * original). A web copy is served only while it was made from the video its
 * entry shows now (`madeFrom`), so a replaced video never plays an old copy.
 */
import { hidesOriginal } from "./public-examples.js"
import type { TrendVersionData, TrendWebCopy } from "./types.js"

type WithWebCopy = { videoUrl: string; web?: TrendWebCopy }

/** Whether `entry` (a display copy or an example) has a web copy made from the video it shows now. */
export function hasCurrentWebCopy(entry: WithWebCopy): boolean {
  return entry.web !== undefined && entry.web.madeFrom === entry.videoUrl
}

/** The web copy to serve beside `entry`: its own, when current; else none. */
export function currentWebCopy(entry: WithWebCopy): TrendWebCopy | undefined {
  return hasCurrentWebCopy(entry) ? entry.web : undefined
}

/**
 * The public fields of `entry`'s web copy, to spread into its public shape:
 * `webUrl` and `webSizeBytes`, or nothing when it has no current one.
 */
export function publicWebCopy(entry: WithWebCopy): { webUrl?: string; webSizeBytes?: number } {
  const web = currentWebCopy(entry)
  return web ? { webUrl: web.videoUrl, webSizeBytes: web.sizeBytes } : {}
}

/** One video a version shows that has no current web copy. */
export interface WebCopyTarget {
  /** For logs: `original`, or `example <n>` (the stored numbering, as the admin screens count). */
  label: string
  /** The shown video it stands for (its entry's `videoUrl`): what the copy is pinned to. */
  madeFrom: string
  /**
   * What it is encoded from: the uploaded source clip for the original's
   * display copy (its sound is the uploaded one, not the display copy's
   * already re-encoded AAC), the example's own video for an example.
   */
  encodeFrom: string
}

/** Every video `data` shows that has no current web copy, each address once, the original first. */
export function webCopyTargets(data: TrendVersionData): WebCopyTarget[] {
  const out: WebCopyTarget[] = []
  const seen = new Set<string>()
  const add = (t: WebCopyTarget) => {
    if (seen.has(t.madeFrom)) return
    seen.add(t.madeFrom)
    out.push(t)
  }
  const display = data.source?.display
  if (data.source && display && !hidesOriginal(data) && !hasCurrentWebCopy(display)) {
    add({ label: "original", madeFrom: display.videoUrl, encodeFrom: data.source.videoUrl })
  }
  data.examples.forEach((ex, i) => {
    if (!hasCurrentWebCopy(ex)) add({ label: `example ${i + 1}`, madeFrom: ex.videoUrl, encodeFrom: ex.videoUrl })
  })
  return out
}
