/**
 * Which sidebar tab sections are expanded, remembered across sessions.
 *
 * First run opens Image only: the sidebar is always on screen, so opening
 * everything buries the list and opening nothing costs a click before any node
 * is reachable. Creative Controls holds 39 pickers and stays closed until
 * asked for.
 */
const KEY = "nodaro:sidebarOpenSections"

export const SIDEBAR_DEFAULT_OPEN: readonly string[] = ["image"]

export function readOpenSections(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return new Set(SIDEBAR_DEFAULT_OPEN)
    const parsed: unknown = JSON.parse(raw)
    // An empty array is a real state — the user collapsed everything — so it
    // must survive a reload rather than snapping back to the default.
    return Array.isArray(parsed)
      ? new Set(parsed.filter((v): v is string => typeof v === "string"))
      : new Set(SIDEBAR_DEFAULT_OPEN)
  } catch {
    return new Set(SIDEBAR_DEFAULT_OPEN)
  }
}

export function persistOpenSections(open: ReadonlySet<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...open]))
  } catch {
    /* ignore */
  }
}
