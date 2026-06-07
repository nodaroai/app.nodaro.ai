import type { SceneNodeType } from "@/types/nodes"

/**
 * Where a node type stores the "name" prompt references resolve against.
 * Phase 1: every prompt-handle-valid producer resolves `{Label}` by its
 * `data.label`, so the map is empty and the default applies. Phase 2 adds
 * identity types whose mention slug derives from a dedicated field, e.g.
 * `character: "characterName"`, `location: "locationName"`.
 */
const NODE_NAME_FIELD: Partial<Record<SceneNodeType, string>> = {}

export function getNodeNameField(type: SceneNodeType): string {
  return NODE_NAME_FIELD[type] ?? "label"
}

/**
 * `initialData` for a node created to satisfy a missing reference: writes the
 * ref name into the node type's name field (plus `label` for canvas display when
 * they differ). Returns undefined when there is no name to prefill.
 */
export function buildPrefillInitialData(
  type: SceneNodeType,
  prefillName: string | undefined,
): Record<string, unknown> | undefined {
  if (!prefillName) return undefined
  const field = getNodeNameField(type)
  if (field === "label") return { label: prefillName }
  return { [field]: prefillName, label: prefillName }
}
