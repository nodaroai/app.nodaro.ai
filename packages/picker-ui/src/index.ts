/**
 * @nodaro/picker-ui — first-party picker UI, an in-repo workspace package
 * (one implementation for every edition — #748 collapsed the old two-lane
 * seam; only the backend's @nodaroai/cloud-plugins remains closed).
 *
 * Contents: animated preview components + CSS + icon maps, picker
 * components (single + multi-dim) + shared primitives, and the @-mention
 * prompt editor (TipTap/ProseMirror).
 *
 * Data (catalogs, labels, promptHints, i18n) always flows in from
 * @nodaro/prompts + @nodaro/shared — nothing here owns data.
 */
export { cn } from "./lib/cn.js"
export * from "./previews/index.js"
export * from "./icons/index.js"
export * from "./i18n.js"
export * from "./types.js"
export * from "./pickers/index.js"
export * from "./registry.js"
export * from "./lib/parameter-node-prefs.js"
// The @-mention prompt editor (M4) — component + its public helpers
export * from "./prompt-editor/index.js"
export * from "./prompt-editor/editor-types.js"
export * from "./prompt-editor/use-reference-picker.js"
export * from "./prompt-editor/reference-picker-menu.js"
export * from "./prompt-editor/flip-position.js"
export * from "./prompt-editor/body-menu-class.js"
export * from "./prompt-editor/prompt-editor-portal.js"
export * from "./prompt-editor/lib/image-reference-format.js"
export * from "./prompt-editor/lib/snippet-pool.js"

/** Package marker (kept for diagnostics; the stub lane is gone since #748). */
export const PICKER_UI_PACKAGE = "@nodaro/picker-ui" as const

/** Lane marker — always "rich" now; kept so lane-conditional tests need no edits. */
export const PICKER_UI_MODE = "rich" as const
