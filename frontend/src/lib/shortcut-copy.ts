import type { MessageKey } from "@/lib/i18n"
import type { ShortcutCategory, SHORTCUTS } from "@/lib/shortcuts"

/** A `SHORTCUTS` key. Every def's `id` equals its key (pinned by shortcuts.test.ts). */
export type ShortcutId = keyof typeof SHORTCUTS

/**
 * The help modal's text for each shortcut and category, in the interface
 * language. Typed by the registry, so a new shortcut or category without a
 * caption fails the build instead of showing English.
 */
export const SHORTCUT_DESCRIPTION_KEYS: Record<ShortcutId, MessageKey> = {
  help: "shortcut.help",
  save: "shortcut.save",
  search: "shortcut.search",
  findNode: "shortcut.findNode",
  duplicate: "shortcut.duplicate",
  copy: "shortcut.copy",
  cut: "shortcut.cut",
  paste: "shortcut.paste",
  undo: "shortcut.undo",
  redo: "shortcut.redo",
  delete: "shortcut.delete",
  toggleConfigPanel: "shortcut.toggleConfigPanel",
  fullscreenSettings: "shortcut.fullscreenSettings",
  promptEditor: "shortcut.promptEditor",
  escape: "shortcut.escape",
  zoomIn: "shortcut.zoomIn",
  zoomOut: "shortcut.zoomOut",
  pan: "shortcut.pan",
  sidebar: "shortcut.sidebar",
  configPanelOpen: "shortcut.configPanelOpen",
  configPanelClose: "shortcut.configPanelClose",
  previousFocus: "shortcut.previousFocus",
  tidyUp: "shortcut.tidyUp",
  gridSnap: "shortcut.gridSnap",
  alignmentGuides: "shortcut.alignmentGuides",
  copilot: "shortcut.copilot",
  mediaLibrary: "shortcut.mediaLibrary",
  myLibrary: "shortcut.myLibrary",
  resultPreview: "shortcut.resultPreview",
  addNode: "shortcut.addNode",
  selectAll: "shortcut.selectAll",
  stickyNote: "shortcut.stickyNote",
  arrowNav: "shortcut.arrowNav",
  altArrowNav: "shortcut.altArrowNav",
  pickerMove: "shortcut.pickerMove",
  pickerSelect: "shortcut.pickerSelect",
  pickerMultiAdd: "shortcut.pickerMultiAdd",
}

export const SHORTCUT_CATEGORY_KEYS: Record<ShortcutCategory, MessageKey> = {
  "General": "shortcut.cat.general",
  "Editing": "shortcut.cat.editing",
  "View": "shortcut.cat.view",
  "Selection & Canvas": "shortcut.cat.selection",
  "Picker (fullscreen config)": "shortcut.cat.picker",
}
