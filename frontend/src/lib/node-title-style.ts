/**
 * Typography for a node's title — the weight/case/letter-spacing shared by the inline header
 * (`base-node.tsx`), the floating label (`EditableNodeLabel`), and the node-toolbar preset pill
 * (`node-preset-dropdown.tsx`), so they render identically and can't drift apart. Font SIZE is
 * intentionally NOT included: it's `text-[11px]` on the labels but set via an inline (zoom-scaled)
 * `fontSize` on the preset pill.
 */
export const NODE_TITLE_TYPOGRAPHY = "font-semibold uppercase tracking-[0.05em]"
