/**
 * Display order for node-browser root categories, shared by the sidebar
 * (`node-toolbar.tsx`) and the add-node popup (`add-node-popup.tsx`) so the two
 * surfaces can't drift. Follows a creative-pipeline flow (gather inputs → set up
 * assets → pick look/style → generate → process → publish) with the
 * automation/structural categories trailing. Categories not listed sort to the end.
 *
 * Note: the popup groups all entities under "Assets"; the sidebar still uses the
 * per-entity categories Character/Face/Object/Location — both are slotted here.
 */
export const CATEGORY_ORDER: readonly string[] = [
  // Popup-only virtual/quick-access categories (Recent/Most Used/Common, #2698)
  // stay at the top. Keep these strings in sync with VIRTUAL_CATEGORY_IDS in
  // add-node-popup.tsx. The sidebar has no such categories, so these are no-ops there.
  "Recent",
  "Most Used",
  "Common",
  "Input",
  "Assets",
  "Character",
  "Face",
  "Object",
  "Location",
  "Pickers",
  "AI",
  "Processing",
  "Output",
  "Data",
  "Triggers",
  "Workflow",
  "Component",
]

export function categoryRank(id: string): number {
  const index = CATEGORY_ORDER.indexOf(id)
  return index === -1 ? CATEGORY_ORDER.length : index
}
