/**
 * Audio Sync — the editor's one copy of the node's price shape and wiring rules.
 *
 * Priced per source ALIGNED to the reference (decided 2026-09-25):
 * `audio-sync:<n>src` = 10 × (n − 1) credits for n = 2..6 sources. The price is
 * a GRAPH fact — how many recordings are wired into the `sources` handle — so
 * every surface that quotes it (the node's Run pill, the config panel's
 * generate button, the canvas total, the run-confirm dialog, the cold-cache
 * fallback) counts the SAME edges through `audioSyncWiredSourceCount` and names
 * the row through `audioSyncCreditId`. The backend's builder
 * (`backend/src/lib/audio-sync-credit-id.ts`) is the mirror the route and the
 * workflow reservation use; both clamp into 2..6 and read an unknown count as
 * the 6-source ceiling (an estimate may over-quote, never under-quote).
 */

export const AUDIO_SYNC_MIN_SOURCES = 2
export const AUDIO_SYNC_MAX_SOURCES = 6

/** The handle the recordings wire into. */
export const AUDIO_SYNC_SOURCES_HANDLE = "sources"

/** `audio-sync:<n>src` for `sourceCount` wired recordings, clamped into 2..6;
 *  an unknown count (no graph context) reads as the 6-source ceiling. */
export function audioSyncCreditId(sourceCount: number | undefined): string {
  const n = sourceCount === undefined || !Number.isFinite(sourceCount)
    ? AUDIO_SYNC_MAX_SOURCES
    : Math.min(AUDIO_SYNC_MAX_SOURCES, Math.max(AUDIO_SYNC_MIN_SOURCES, Math.floor(sourceCount)))
  return `audio-sync:${n}src`
}

/**
 * How many distinct upstream nodes feed this audio-sync node's `sources`
 * handle. Distinct by source NODE, because the node id IS the recording's id
 * (the run keeps one row per upstream node). `undefined` without graph
 * context — which `audioSyncCreditId` prices at the ceiling.
 */
export function audioSyncWiredSourceCount(
  nodeId: string | undefined,
  edges: ReadonlyArray<{ source?: string; target: string; targetHandle?: string | null }> | undefined,
): number | undefined {
  if (!nodeId || !edges) return undefined
  const sources = new Set<string>()
  let anonymous = 0
  for (const e of edges) {
    if (e.target !== nodeId || e.targetHandle !== AUDIO_SYNC_SOURCES_HANDLE) continue
    if (e.source) sources.add(e.source)
    else anonymous++
  }
  return sources.size + anonymous
}

/** Order wired rows by the node's `sourceOrder` (listed first, then the rest in
 *  wire order), one row per upstream node — the SAME order the backend payload
 *  builder applies, so a single-node Run and a workflow run send one list. */
export function orderAudioSyncSources<T extends { readonly nodeId: string }>(
  wired: ReadonlyArray<T>,
  sourceOrder: ReadonlyArray<string> | undefined,
): T[] {
  const order = sourceOrder ?? []
  const ordered = order.length
    ? [...order.flatMap((nid) => wired.filter((w) => w.nodeId === nid)), ...wired.filter((w) => !order.includes(w.nodeId))]
    : [...wired]
  const seen = new Set<string>()
  return ordered.filter((row) => (seen.has(row.nodeId) ? false : (seen.add(row.nodeId), true)))
}

/** The reference a run sends: the chosen one while it is still wired, else
 *  none (the worker then measures against the first source). */
export function effectiveAudioSyncReference(
  reference: string | undefined,
  sourceIds: ReadonlyArray<string>,
): string | undefined {
  return reference && sourceIds.includes(reference) ? reference : undefined
}
