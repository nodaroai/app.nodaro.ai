import { extractPresetData, PRESET_APPLY_CLEAR_KEYS } from "@nodaro/shared"
import type { NodePreset, NodePresetGroup } from "@/lib/api"

/** A root-level node in the organized preset tree: a group (folder/section) with its presets, or a
 *  loose root preset. */
export type PresetTreeNode =
  | { kind: "group"; group: NodePresetGroup; presets: NodePreset[] }
  | { kind: "preset"; preset: NodePreset }

const byOrderThenName = (a: { sortOrder: number; name: string }, b: { sortOrder: number; name: string }) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)

/**
 * Build the ordered root list: groups (folders/sections) and ungrouped presets interleaved by
 * `sortOrder`; each group carries its presets (also ordered). A preset whose `groupId` references
 * no existing group falls back to root (robust against a just-deleted group).
 */
export function buildPresetTree(
  presets: readonly NodePreset[],
  groups: readonly NodePresetGroup[],
): PresetTreeNode[] {
  const groupIds = new Set(groups.map((g) => g.id))
  const byGroup = new Map<string, NodePreset[]>()
  const root: NodePreset[] = []
  for (const p of presets) {
    if (p.groupId && groupIds.has(p.groupId)) {
      const arr = byGroup.get(p.groupId) ?? []
      arr.push(p)
      byGroup.set(p.groupId, arr)
    } else {
      root.push(p)
    }
  }
  for (const arr of byGroup.values()) arr.sort(byOrderThenName)

  const entries: { sortOrder: number; name: string; node: PresetTreeNode }[] = [
    ...groups.map((g) => ({
      sortOrder: g.sortOrder,
      name: g.name,
      node: { kind: "group" as const, group: g, presets: byGroup.get(g.id) ?? [] },
    })),
    ...root.map((p) => ({
      sortOrder: p.sortOrder,
      name: p.name,
      node: { kind: "preset" as const, preset: p },
    })),
  ]
  entries.sort(byOrderThenName)
  return entries.map((e) => e.node)
}

/** Case-insensitive match of a preset against a query over its name, description and tags. */
export function presetMatchesQuery(preset: NodePreset, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (preset.name.toLowerCase().includes(q)) return true
  if ((preset.description ?? "").toLowerCase().includes(q)) return true
  return preset.tags.some((t) => t.toLowerCase().includes(q))
}

/**
 * Build the `updateNodeData` payload that resets a node to its DEFAULT config and clears the active
 * preset ("go back to no preset"). It:
 *  - sets every config field the node default defines back to that default value,
 *  - clears (→ `undefined`) any extra config field the node currently has but the default doesn't,
 *  - clears `__activePresetId`.
 *
 * It does NOT touch identity/wiring/results (`label`, `fieldMappings`, generated outputs) — those
 * keys are absent from the payload, so the store's merge preserves them. `defaultData` is the node
 * type's `NODE_DEFINITIONS.defaultData`.
 */
export function buildResetToDefaultData(
  currentData: Readonly<Record<string, unknown>>,
  defaultData: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  const defConfig = defaultData ? extractPresetData(defaultData) : {}
  const payload: Record<string, unknown> = {}
  // Clear every config field the node currently carries (so extras not in the default reset too).
  for (const key of Object.keys(extractPresetData(currentData))) payload[key] = undefined
  // Also clear generated composer-plan state (motionPlan/lottieUrl/etc). These are
  // capture-EXCLUDED, so the loop above no longer enumerates them — without this a
  // reset node keeps showing (and emitting) the old animation under default config.
  // Same hygiene as buildPresetApplyPatch on apply.
  for (const key of PRESET_APPLY_CLEAR_KEYS) payload[key] = undefined
  // Apply the default config values.
  Object.assign(payload, defConfig)
  // Back to "no preset".
  payload.__activePresetId = undefined
  return payload
}
