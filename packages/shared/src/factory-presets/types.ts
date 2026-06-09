export interface FactoryPreset {
  /** Stable slug "<nodeType>/<kebab-name>" — used as a React key and in exports. */
  readonly id: string
  readonly name: string
  readonly description?: string
  /** Optional folder/section label this preset is grouped under in the picker.
   *  Presets sharing a `group` render together; "variants of one idea" (e.g. the
   *  character-sheet family) are simply siblings in the same group. */
  readonly group?: string
  /** How the group renders: a collapsible "folder" (default) or a flat "section"
   *  label. Taken from the first preset that opens the group. */
  readonly groupKind?: "folder" | "section"
  /** Capture-shaped config (no label / fieldMappings / runtime keys). */
  readonly data: Readonly<Record<string, unknown>>
}

/** A render-ready bucket of factory presets sharing one `group` (or the leading
 *  ungrouped bucket, `group: null`). Produced by {@link groupFactoryPresets}. */
export interface FactoryPresetGroup<T> {
  /** Stable key for React + collapse state ("__root__" for the ungrouped bucket). */
  readonly key: string
  /** Group label, or null for the ungrouped bucket. */
  readonly group: string | null
  readonly groupKind: "folder" | "section"
  readonly presets: T[]
}

/**
 * Bucket an ordered list of presets by their `group` field for rendering. Groups
 * appear in first-appearance order; presets keep their array order within a
 * group; ungrouped presets collect into a single leading `null` bucket. Pure and
 * UI-agnostic (operates on anything carrying `group`/`groupKind`) so the config
 * panel dropdown reuses it and it stays unit-testable.
 */
export function groupFactoryPresets<
  T extends { group?: string; groupKind?: "folder" | "section" },
>(presets: readonly T[]): FactoryPresetGroup<T>[] {
  const buckets: FactoryPresetGroup<T>[] = []
  const byKey = new Map<string, FactoryPresetGroup<T>>()
  for (const p of presets) {
    const key = p.group ?? "__root__"
    let bucket = byKey.get(key)
    if (!bucket) {
      bucket = { key, group: p.group ?? null, groupKind: p.groupKind ?? "folder", presets: [] }
      byKey.set(key, bucket)
      buckets.push(bucket)
    }
    bucket.presets.push(p)
  }
  return buckets
}
