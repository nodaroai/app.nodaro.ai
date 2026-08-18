/**
 * Keyboard navigation for config-panel pickers — pure helpers + one delegated
 * keydown handler.
 *
 * Design: components don't register themselves anywhere. The config panel body
 * attaches `handleConfigPanelNavKeyDown` once (React onKeyDown, bubble phase),
 * and ANY picker that uses the standard ARIA markup the panels already share —
 * `role="tablist"`/`role="tab"`, `role="radiogroup"|"group"` with
 * `role="radio"|"checkbox"` tile buttons — gets arrow-key navigation for free.
 * A new picker written with correct ARIA roles can't forget to "wire up"
 * keyboard support; there is nothing to wire.
 *
 * DimensionTileGrid (data-picker-grid) handles its own keys locally (it owns
 * multi-pick + commit semantics) and stops propagation, so this delegate never
 * double-handles grid tiles. The [data-picker-grid] exclusion below is
 * defense-in-depth for that contract.
 *
 * Activation semantics:
 * - Tabs: activation follows focus (arrow moves AND switches the tab) — the
 *   standard "automatic" tablist pattern, matching what mouse users see.
 * - Tiles (radio/checkbox buttons): arrows move focus only; Enter/Space
 *   activate via the browser's native button behavior. Deliberate picks only.
 */

const ARROW_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const
type ArrowKey = (typeof ARROW_KEYS)[number]

export function isArrowKey(key: string): key is ArrowKey {
  return (ARROW_KEYS as readonly string[]).includes(key)
}

/** Estimate how many items fit in the first visual row by comparing Y coords.
 *  Layout-agnostic: works for CSS grid, flex-wrap, and single-row strips. */
export function estimateGridCols(items: readonly HTMLElement[]): number {
  if (items.length < 2) return 1
  const firstY = items[0].getBoundingClientRect().top
  let cols = 1
  for (let i = 1; i < items.length; i++) {
    if (Math.abs(items[i].getBoundingClientRect().top - firstY) < 5) cols++
    else break
  }
  return cols
}

/** Pure roving-focus math shared by tile grids, tablists and radiogroups.
 *  Left/Right wrap; Up/Down clamp by one row; Home/End jump. Returns the next
 *  index, or null when the key isn't a navigation key. */
export function nextNavIndex(key: string, idx: number, len: number, cols: number): number | null {
  if (len === 0) return null
  const i = Math.max(idx, 0)
  switch (key) {
    case "ArrowRight": return (i + 1) % len
    case "ArrowLeft": return (idx <= 0 ? len : idx) - 1
    case "ArrowDown": return Math.min(len - 1, i + cols)
    case "ArrowUp": return Math.max(0, i - cols)
    case "Home": return 0
    case "End": return len - 1
    default: return null
  }
}

function focusableIn(container: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-disabled") !== "true",
  )
}

// ------------------------------------------------------- roving tabindex ----

/** Composite widgets inside the panel that should be a SINGLE Tab stop each:
 *  Tab jumps between sections, arrows move within one. */
const COMPOSITE_SELECTOR = '[role="tablist"], [role="radiogroup"], [role="group"], [data-picker-grid]'
const MEMBER_SELECTOR = '[role="tab"], [role="radio"], [role="checkbox"]'

function compositeMembers(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(MEMBER_SELECTOR)).filter(
    (m) => m.closest(COMPOSITE_SELECTOR) === container && !m.hasAttribute("disabled"),
  )
}

/** Make each composite widget under `root` one Tab stop: the focused member —
 *  else the selected/checked one, else the first — gets tabIndex 0, the rest -1. */
export function applyRovingTabIndex(root: HTMLElement): void {
  for (const container of Array.from(root.querySelectorAll<HTMLElement>(COMPOSITE_SELECTOR))) {
    const members = compositeMembers(container)
    if (members.length === 0) continue
    const active =
      members.find((m) => m === document.activeElement) ??
      members.find(
        (m) => m.getAttribute("aria-selected") === "true" || m.getAttribute("aria-checked") === "true",
      ) ??
      members[0]
    for (const m of members) m.tabIndex = m === active ? 0 : -1
  }
}

/**
 * Callback ref for the config-panel body: keeps roving tabindex applied across
 * re-renders/content changes (MutationObserver on aria state + child lists) and
 * lets the tab stop follow keyboard focus (focusin). Generic by construction —
 * any picker rendered inside the panel with standard ARIA roles becomes a
 * single Tab stop with zero per-picker wiring. Radix Tabs already manage the
 * same pattern; re-applying identical values is a no-op for them.
 */
export function createRovingTabIndexRef(): (el: HTMLElement | null) => void {
  let observer: MutationObserver | null = null
  let attached: HTMLElement | null = null
  const onFocusIn = (ev: Event) => {
    const target = (ev.target as HTMLElement | null)?.closest?.<HTMLElement>(MEMBER_SELECTOR)
    const container = target?.closest<HTMLElement>(COMPOSITE_SELECTOR)
    if (!target || !container) return
    for (const m of compositeMembers(container)) m.tabIndex = m === target ? 0 : -1
  }
  return (el) => {
    if (attached) {
      observer?.disconnect()
      observer = null
      attached.removeEventListener("focusin", onFocusIn)
      attached = null
    }
    if (!el) return
    attached = el
    el.addEventListener("focusin", onFocusIn)
    applyRovingTabIndex(el)
    observer = new MutationObserver(() => applyRovingTabIndex(el))
    observer.observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-checked", "aria-selected"],
    })
  }
}

/**
 * Delegated keydown handler for the config panel body. Returns true when the
 * event was handled (caller needn't do anything else — preventDefault and
 * stopPropagation have been called).
 */
export function handleConfigPanelNavKeyDown(e: React.KeyboardEvent<HTMLElement>): boolean {
  if (!isArrowKey(e.key) && e.key !== "Home" && e.key !== "End") return false
  // Never steal modified keys (Alt+Arrow = canvas node navigation, etc.)
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false
  const target = e.target as HTMLElement | null
  if (!target) return false

  // DimensionTileGrid handles its own keys (and stops propagation); skip just in case.
  if (target.closest("[data-picker-grid]")) return false

  // ── Tabs: arrows move focus AND activate (automatic tablist pattern) ──
  const tab = target.closest<HTMLElement>('[role="tab"]')
  const tablist = tab?.closest<HTMLElement>('[role="tablist"]')
  if (tab && tablist) {
    const tabs = focusableIn(tablist, '[role="tab"]')
    const next = nextNavIndex(e.key, tabs.indexOf(tab), tabs.length, estimateGridCols(tabs))
    if (next === null) return false
    e.preventDefault()
    e.stopPropagation()
    const el = tabs[next]
    el?.focus()
    el?.click()
    return true
  }

  // ── Tile buttons in radiogroups / multi-pick groups: arrows move focus only ──
  const tile = target.closest<HTMLElement>('button[role="radio"], button[role="checkbox"]')
  const group = tile?.closest<HTMLElement>('[role="radiogroup"], [role="group"]')
  if (tile && group) {
    const tiles = focusableIn(group, 'button[role="radio"], button[role="checkbox"]')
    const next = nextNavIndex(e.key, tiles.indexOf(tile), tiles.length, estimateGridCols(tiles))
    if (next === null) return false
    e.preventDefault()
    e.stopPropagation()
    tiles[next]?.focus()
    return true
  }

  return false
}
