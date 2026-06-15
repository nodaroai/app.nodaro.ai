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
  // Popup-only virtual/quick-access categories (Recent/Most Used, #2698) stay
  // at the top. Keep these strings in sync with VIRTUAL_CATEGORY_IDS in
  // add-node-popup.tsx. The sidebar has no such categories, so these are no-ops
  // there. ("Common" is no longer a category — it's the popup's Common tab.)
  "Recent",
  "Most Used",
  // The All-tab root order (user-specified; pinned by
  // lib/__tests__/node-category-order.test.ts):
  "Input",
  "Assets",
  "Character",
  "Face",
  "Object",
  "Location",
  "AI",
  "Pickers",
  "Processing",
  "Data",
  "Component",
  "Workflow",
  "Triggers",
  "Output",
  // Models is a popup-only virtual root (the All tab's last category, opening the
  // model browser). No node carries category "Models", so the sidebar — which
  // derives its categories from NODE_OPTIONS — never shows it.
  "Models",
]

export function categoryRank(id: string): number {
  const index = CATEGORY_ORDER.indexOf(id)
  return index === -1 ? CATEGORY_ORDER.length : index
}
