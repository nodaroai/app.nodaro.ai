export interface CatalogSnapshotEntry {
  id: string
  label: string
  description?: string
  category?: string
  promptHint?: string
  /**
   * The short professional term the entry injects in compact hint mode
   * (`label` is display-only). Rides at both `/v1/catalogs` detail levels, so
   * a snapshot built from a compact projection still carries it — and
   * `diff-upstream` treats a term-only upstream edit as a real change.
   */
  term?: string
}
export interface CatalogSnapshot {
  catalogId: string
  kind: "single" | "multi"
  entries: CatalogSnapshotEntry[]
  sidecars: Record<string, Record<string, { label?: string; description?: string }>>
}
interface ProjectedLike {
  catalogId: string
  kind: "single" | "multi"
  options?: CatalogSnapshotEntry[]
  dimensions?: Array<{ options: CatalogSnapshotEntry[] }>
}
export function buildCatalogSnapshot(
  projected: ProjectedLike,
  sidecars: Record<string, Record<string, { label?: string; description?: string }>>,
): CatalogSnapshot {
  const seen = new Map<string, CatalogSnapshotEntry>()
  const push = (opts: CatalogSnapshotEntry[] | undefined) => {
    for (const o of opts ?? []) if (!seen.has(o.id)) seen.set(o.id, o)
  }
  // Not either/or: a single-dim catalog can also carry secondary dimensions
  // (transition position/duration/intensity). Skipping them would make
  // `diff-upstream` blind to a label or hint changing on those rows.
  push(projected.options)
  for (const d of projected.dimensions ?? []) push(d.options)
  const entries = [...seen.values()].sort((a, b) => a.id.localeCompare(b.id))
  return { catalogId: projected.catalogId, kind: projected.kind, entries, sidecars }
}
