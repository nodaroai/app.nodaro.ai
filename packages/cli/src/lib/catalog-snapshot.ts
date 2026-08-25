export interface CatalogSnapshotEntry {
  id: string
  label: string
  description?: string
  category?: string
  promptHint?: string
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
  if (projected.kind === "single") push(projected.options)
  else for (const d of projected.dimensions ?? []) push(d.options)
  const entries = [...seen.values()].sort((a, b) => a.id.localeCompare(b.id))
  return { catalogId: projected.catalogId, kind: projected.kind, entries, sidecars }
}
