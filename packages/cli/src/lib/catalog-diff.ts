import type { CatalogSnapshot, CatalogSnapshotEntry } from "./catalog-snapshot.js"

export interface CatalogMergePlan {
  carried: CatalogSnapshotEntry[]
  conflicts: Array<{ id: string; upstream: CatalogSnapshotEntry; pack: CatalogSnapshotEntry }>
  newUpstream: CatalogSnapshotEntry[]
  removedUpstream: string[]
  sidecarsCarried: Record<string, string[]>
  nextBaseline: CatalogSnapshot
}
// Everything a vendored pack can meaningfully diverge on. `term` is part of the
// identity: it is what compact hint mode injects, so a term-only upstream edit
// is a real content change, not a cosmetic one.
const key = (e: CatalogSnapshotEntry) =>
  JSON.stringify({ l: e.label, d: e.description, c: e.category, p: e.promptHint, t: e.term })
const index = (s: CatalogSnapshot) => new Map(s.entries.map((e) => [e.id, e]))

export function threeWayMergeCatalog(
  baseline: CatalogSnapshot,
  upstreamNow: CatalogSnapshot,
  pack: CatalogSnapshot,
): CatalogMergePlan {
  const B = index(baseline),
    U = index(upstreamNow),
    P = index(pack)
  const carried: CatalogSnapshotEntry[] = []
  const conflicts: CatalogMergePlan["conflicts"] = []
  const newUpstream: CatalogSnapshotEntry[] = []
  const removedUpstream: string[] = []
  const sidecarsCarried: Record<string, string[]> = {}

  for (const [id, u] of U) {
    const b = B.get(id),
      p = P.get(id)
    if (!b) {
      newUpstream.push(u) // upstream-new since vendoring — report only
      continue
    }
    if (!p) continue // SAI deliberately denied it — leave denied
    const saiModified = key(p) !== key(b)
    const upstreamChanged = key(u) !== key(b)
    if (!upstreamChanged) continue
    if (saiModified) {
      conflicts.push({ id, upstream: u, pack: p })
      continue
    }
    carried.push(u)
    for (const [locale, map] of Object.entries(upstreamNow.sidecars)) {
      if (map[id]) (sidecarsCarried[locale] ??= []).push(id)
    }
  }
  for (const [id] of B) if (!U.has(id) && P.has(id)) removedUpstream.push(id)
  return { carried, conflicts, newUpstream, removedUpstream, sidecarsCarried, nextBaseline: upstreamNow }
}
