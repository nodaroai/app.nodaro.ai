import type { EntityKind, PanelRequest, SheetFlavour, SheetSection } from "./types.js"
import { MAX_PANELS_PER_SHEET, MAX_CUSTOM_ENTRIES_PER_BOARD } from "./types.js"
import { BOARD_VARIANTS, SECTION_BOARD, STRUCTURAL_SECTIONS, DEFAULT_PANEL_COUNT } from "./catalog.js"

/** Resolve the logical board for a section, or null for structural sections.
 *  A non-structural board section that can't resolve a board (e.g.
 *  `environment-board` with no explicit `section.board`, or a board not valid
 *  for this entity) throws — turning misconfiguration into a free rejection
 *  instead of silently emitting zero panels. */
function resolveBoard(entityKind: EntityKind, section: SheetSection): string | null {
  if (STRUCTURAL_SECTIONS.has(section.kind)) return null
  const board = section.board ?? SECTION_BOARD[section.kind]
  if (!board || !BOARD_VARIANTS[entityKind][board]) {
    throw new Error(
      `Section "${section.kind}" has no resolvable board for ${entityKind} (board=${board ?? "?"}) — ` +
        `board sections like environment-board require an explicit section.board valid for the entity`,
    )
  }
  return board
}

/**
 * Pure: given an entity kind, an ordered section list, and the flavour, return the
 * ordered panels the sheet needs. Reuse-vs-generate and pricing happen later
 * (Plan 04) — this only says WHAT panels must exist. Throws on bad config so the
 * route can 400 before any paid work.
 */
export function planSheetPanels(
  entityKind: EntityKind,
  sections: readonly SheetSection[],
  _flavour: SheetFlavour,
): PanelRequest[] {
  const panels: PanelRequest[] = []
  for (const section of sections) {
    const board = resolveBoard(entityKind, section)
    if (board === null) continue // structural section, no panels

    const customs = (section.entries ?? []).filter((e) => e.kind === "custom")
    if (customs.length > MAX_CUSTOM_ENTRIES_PER_BOARD) {
      throw new Error(`Too many custom entries on ${section.kind} (${customs.length} > ${MAX_CUSTOM_ENTRIES_PER_BOARD})`)
    }

    if (section.entries && section.entries.length > 0) {
      for (const e of section.entries) {
        if (e.kind === "custom") {
          panels.push({ section: section.kind, board, variant: e.label, label: e.label, custom: true, prompt: e.prompt })
        } else {
          panels.push({ section: section.kind, board, variant: e.variant, label: e.variant, custom: false })
        }
      }
    } else {
      const available = BOARD_VARIANTS[entityKind][board]
      // Clamp both ends: a negative panelCount must not become a negative slice
      // bound (which would silently drop panels from the end of the board).
      const count = Math.max(0, Math.min(section.panelCount ?? DEFAULT_PANEL_COUNT, available.length))
      for (const variant of available.slice(0, count)) {
        panels.push({ section: section.kind, board, variant, label: variant, custom: false })
      }
    }
  }
  if (panels.length > MAX_PANELS_PER_SHEET) {
    throw new Error(`Sheet plan has too many panels (${panels.length} > MAX_PANELS_PER_SHEET=${MAX_PANELS_PER_SHEET})`)
  }
  return panels
}
