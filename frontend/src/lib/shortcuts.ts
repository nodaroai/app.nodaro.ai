/**
 * Single source of truth for workflow-editor keyboard shortcuts.
 *
 * Pure data + pure helpers (no React, no editor imports) so it is unit-testable
 * and importable by the canvas handler, the toolbar, the context menus, the
 * prompt button, and the help modal alike.
 *
 * Layout independence: a letter shortcut matches the produced `e.key` (the Latin
 * char), and falls back to the physical `e.code` ONLY when `e.key` is not a
 * Latin a–z letter (a non-Latin / dead / compose layout such as Hebrew, Arabic
 * or Cyrillic). Latin layouts — including physically-swapped QWERTZ/AZERTY and
 * remapped Dvorak — therefore resolve by the letter the user sees, while
 * non-Latin layouts fall back to the physical key. The fix is independent of
 * which specific non-Latin glyph a layout produces.
 *
 ***REDACTED-OSS-SCRUB***
 */

export type Mod = "mod" | "ctrl" | "meta" | "shift" | "alt"
// "mod"  = ⌘ on macOS, Ctrl elsewhere (the e.metaKey || e.ctrlKey idiom)
// "ctrl" = literally Control     "meta" = literally Command
// "shift"/"alt" = ⇧ / ⌥

export interface Binding {
  readonly code?: string | readonly string[]
  readonly key?: string | readonly string[]
  readonly mods?: readonly Mod[]
}

// Single source of truth for the category set + the modal's display order.
// `ShortcutCategory` is derived from it, so adding a category can't silently
// drift between the type and the help modal.
export const SHORTCUT_CATEGORIES = [
  "General",
  "Editing",
  "View",
  "Selection & Canvas",
  "Picker (fullscreen config)",
] as const

export type ShortcutCategory = (typeof SHORTCUT_CATEGORIES)[number]

export interface ShortcutDef {
  readonly id: string
  readonly category: ShortcutCategory
  readonly description: string
  readonly bindings: readonly Binding[]
  readonly contextual?: boolean // mode-gated; handler implements inline; display-only here
  readonly hidden?: boolean
}

const toArr = <T,>(v?: T | readonly T[]): readonly T[] =>
  v === undefined ? [] : Array.isArray(v) ? (v as readonly T[]) : [v as T]

const LETTER = /^[a-z]$/i
const LETTER_CODE = /^Key[A-Z]$/
const ARROWS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const

type KeyKind = "letter" | "named" | "symbol"
function classify(k: string): KeyKind {
  if (LETTER.test(k)) return "letter"
  if (k.length > 1 || k === " ") return "named"
  return "symbol"
}

// ---------------------------------------------------------------- matching ---

export function bindingMatches(e: KeyboardEvent, b: Binding): boolean {
  const want = new Set(b.mods ?? [])

  // Alt is always exact.
  if (want.has("alt") !== e.altKey) return false
  // Ctrl/Meta dimension.
  if (want.has("ctrl")) {
    if (!(e.ctrlKey && !e.metaKey)) return false
  } else if (want.has("meta")) {
    if (!(e.metaKey && !e.ctrlKey)) return false
  } else if (want.has("mod")) {
    if (!(e.ctrlKey || e.metaKey)) return false
  } else if (e.ctrlKey || e.metaKey) {
    return false
  }

  const keys = toArr(b.key)
  const codes = toArr(b.code)

  // Symbol-key path ignores Shift (the symbol already encodes it, e.g. US "?" = Shift+/).
  for (const k of keys) {
    if (classify(k) === "symbol" && e.key === k) return true
  }

  // Every remaining path enforces Shift exactly.
  if (want.has("shift") !== e.shiftKey) return false

  // Letter/named key path (Latin char or named key — never localized for named).
  for (const k of keys) {
    const kind = classify(k)
    if (kind === "letter" && e.key.toLowerCase() === k.toLowerCase()) return true
    if (kind === "named" && e.key === k) return true
  }

  // Physical code path: for LETTER codes only when e.key is NOT a Latin letter
  // (so Latin layouts resolve by the visible letter and QWERTZ/AZERTY don't
  // double-match). Non-letter codes (Equal/Minus/Numpad*/Arrow*/Slash) always apply.
  const eKeyIsLatin = LETTER.test(e.key)
  for (const c of codes) {
    if (LETTER_CODE.test(c)) {
      if (!eKeyIsLatin && e.code === c) return true
    } else if (e.code === c) {
      return true
    }
  }
  return false
}

export function matchShortcut(e: KeyboardEvent, def: ShortcutDef): boolean {
  return def.bindings.some((b) => bindingMatches(e, b))
}

// --------------------------------------------------------------- platform ----

export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
}

// -------------------------------------------------------------- formatting ---

const MAC_MOD: Record<Mod, string> = { mod: "⌘", ctrl: "⌃", meta: "⌘", shift: "⇧", alt: "⌥" }
const WIN_MOD: Record<Mod, string> = { mod: "Ctrl", ctrl: "Ctrl", meta: "Win", shift: "Shift", alt: "Alt" }
// Render order for modifier glyphs: Command/Ctrl first, then literal Ctrl, Alt,
// Shift — matches the editor's existing display convention (Redo "⌘⇧Z", Pan
// "⌃⌥"). The platform difference lives in the glyph table (MAC_MOD/WIN_MOD), not
// the order, so a single order serves both.
const MOD_ORDER: Mod[] = ["meta", "mod", "ctrl", "alt", "shift"]

const KEY_LABEL: Record<string, string> = {
  Escape: "Esc", Enter: "↵", Tab: "⇥", Delete: "⌫", Backspace: "⌫", " ": "Space",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
}
const CODE_LABEL: Record<string, string> = {
  Equal: "=", Minus: "−", NumpadAdd: "+", NumpadSubtract: "−", Slash: "/",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
}

function keyCap(b: Binding): string {
  const keys = toArr(b.key)
  const codes = toArr(b.code)
  const allArrows = ARROWS.every((a) => keys.includes(a)) || ARROWS.every((a) => codes.includes(a))
  if (allArrows) return "↑↓←→"
  const k = keys[0]
  if (k !== undefined) return KEY_LABEL[k] ?? (k.length === 1 ? k.toUpperCase() : k)
  const c = codes[0]
  if (c !== undefined) return CODE_LABEL[c] ?? c.replace(/^Key/, "")
  return "?"
}

export function formatBindingCaps(b: Binding, isMac: boolean): string[] {
  const want = new Set(b.mods ?? [])
  const table = isMac ? MAC_MOD : WIN_MOD
  const caps = MOD_ORDER.filter((m) => want.has(m)).map((m) => table[m])
  caps.push(keyCap(b))
  return caps
}

export function formatBinding(b: Binding, isMac: boolean): string {
  const caps = formatBindingCaps(b, isMac)
  return isMac ? caps.join("") : caps.join("+")
}

// --------------------------------------------------------------- registry ----

export const SHORTCUTS = {
  // General
  help: { id: "help", category: "General", description: "Show keyboard shortcuts",
    bindings: [{ key: "?" }, { code: "Slash", mods: ["shift"] }] },
  save: { id: "save", category: "General", description: "Save the workflow",
    bindings: [{ code: "KeyS", key: "s", mods: ["mod"] }] },
  search: { id: "search", category: "General", description: "Search projects & workflows",
    bindings: [{ code: "KeyK", key: "k", mods: ["mod"] }] },
  findNode: { id: "findNode", category: "General", description: "Find a node in this workflow",
    bindings: [{ code: "KeyF", key: "f", mods: ["mod"] }] },

  // Editing
  duplicate: { id: "duplicate", category: "Editing", description: "Duplicate selected node(s)",
    bindings: [{ code: "KeyD", key: "d", mods: ["mod"] }] },
  copy: { id: "copy", category: "Editing", description: "Copy selection",
    bindings: [{ code: "KeyC", key: "c", mods: ["mod"] }] },
  cut: { id: "cut", category: "Editing", description: "Cut selection",
    bindings: [{ code: "KeyX", key: "x", mods: ["mod"] }] },
  paste: { id: "paste", category: "Editing", description: "Paste",
    bindings: [{ code: "KeyV", key: "v", mods: ["mod"] }] },
  undo: { id: "undo", category: "Editing", description: "Undo",
    bindings: [{ code: "KeyZ", key: "z", mods: ["mod"] }] },
  redo: { id: "redo", category: "Editing", description: "Redo",
    bindings: [{ code: "KeyZ", key: "z", mods: ["mod", "shift"] }, { code: "KeyY", key: "y", mods: ["mod"] }] },
  delete: { id: "delete", category: "Editing", description: "Delete selection",
    bindings: [{ key: ["Delete", "Backspace"] }] },
  toggleConfigPanel: { id: "toggleConfigPanel", category: "Editing", description: "Open / close the config panel",
    bindings: [{ key: "Enter" }] },
  fullscreenSettings: { id: "fullscreenSettings", category: "Editing", description: "Expand / collapse config panel",
    bindings: [{ code: "KeyI", key: "i", mods: ["mod"] }] },
  promptEditor: { id: "promptEditor", category: "Editing", description: "Open / close the prompt editor",
    bindings: [{ code: "KeyE", key: "e", mods: ["mod"] }, { code: "KeyE", key: "e", mods: ["alt"] }] },
  escape: { id: "escape", category: "Editing", description: "Close overlay / deselect",
    bindings: [{ key: "Escape" }] },

  // View
  zoomIn: { id: "zoomIn", category: "View", description: "Zoom in",
    bindings: [{ code: ["Equal", "NumpadAdd"], mods: ["alt"] }] },
  zoomOut: { id: "zoomOut", category: "View", description: "Zoom out",
    bindings: [{ code: ["Minus", "NumpadSubtract"], mods: ["alt"] }] },
  pan: { id: "pan", category: "View", description: "Pan the canvas",
    bindings: [{ code: ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"], mods: ["ctrl", "alt"] }] },
  sidebar: { id: "sidebar", category: "View", description: "Toggle the sidebar",
    bindings: [{ code: "KeyB", key: "b", mods: ["mod"] }] },
  tidyUp: { id: "tidyUp", category: "View", description: "Tidy up (auto-layout)",
    bindings: [{ code: "KeyT", key: "t", mods: ["alt"] }] },
  gridSnap: { id: "gridSnap", category: "View", description: "Toggle grid snap",
    bindings: [{ code: "KeyG", key: "g", mods: ["mod", "shift"] }] },
  alignmentGuides: { id: "alignmentGuides", category: "View", description: "Toggle alignment guides",
    bindings: [{ code: "KeyA", key: "a", mods: ["mod", "shift"] }] },
  mediaLibrary: { id: "mediaLibrary", category: "View", description: "Toggle the Media Library",
    bindings: [{ code: "KeyM", key: "m", mods: ["mod"] }] },
  myLibrary: { id: "myLibrary", category: "View", description: "Open My Library",
    bindings: [{ code: "KeyL", key: "l", mods: ["mod"] }] },
  resultPreview: { id: "resultPreview", category: "View", description: "Toggle fullscreen result preview",
    bindings: [{ code: "KeyF", key: "f", mods: ["alt"] }] },

  // Selection & Canvas
  addNode: { id: "addNode", category: "Selection & Canvas", description: "Add a node at the cursor",
    bindings: [{ key: "Tab" }] },
  selectAll: { id: "selectAll", category: "Selection & Canvas", description: "Select all nodes",
    bindings: [{ code: "KeyA", key: "a", mods: ["mod"] }] },
  stickyNote: { id: "stickyNote", category: "Selection & Canvas", description: "Add a sticky note",
    bindings: [{ code: "KeyS", key: "s", mods: ["shift"] }] },
  arrowNav: { id: "arrowNav", category: "Selection & Canvas", description: "Navigate to nearest node",
    bindings: [{ key: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] }] },

  // Picker (fullscreen config) — contextual, display-only
  pickerMove: { id: "pickerMove", category: "Picker (fullscreen config)", description: "Move between options",
    contextual: true, bindings: [{ key: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] }] },
  pickerSelect: { id: "pickerSelect", category: "Picker (fullscreen config)", description: "Select / confirm option",
    contextual: true, bindings: [{ key: "Enter" }] },
  pickerMultiAdd: { id: "pickerMultiAdd", category: "Picker (fullscreen config)", description: "Add to multi-select",
    contextual: true, bindings: [{ key: [" ", "+"] }] },
} satisfies Record<string, ShortcutDef>
