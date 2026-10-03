import type { TrackedCompetitor } from "@nodaro/shared"

/** What the page remembers of each brand between two reads of the list. */
export type ScanState = ReadonlyMap<string, { readonly scanning: boolean; readonly lastScanId: string | null }>

export function scanStateOf(competitors: readonly TrackedCompetitor[]): ScanState {
  return new Map(competitors.map((c) => [c.id, { scanning: c.scanning, lastScanId: c.lastScanId }]))
}

/**
 * True when a scan landed since `before`: a brand stopped scanning or shows a
 * new last scan. One brand is enough, whatever the others are still doing,
 * so its new cards appear without waiting for every scan to finish.
 */
export function scanLanded(before: ScanState, competitors: readonly TrackedCompetitor[]): boolean {
  return competitors.some((c) => {
    const was = before.get(c.id)
    return was !== undefined && ((was.scanning && !c.scanning) || was.lastScanId !== c.lastScanId)
  })
}
