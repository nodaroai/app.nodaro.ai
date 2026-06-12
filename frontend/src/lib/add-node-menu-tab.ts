/**
 * Add Node menu mode (the tabs above the popup's search box):
 *  - "common"             — the curated COMMON view (lead nodes, titled sections, Common Pickers)
 *  - "image"/"video"/"audio" — nodes whose primary output is that medium (common members first)
 *  - "all"                — the root category list
 * The last explicit user choice is remembered across sessions.
 */
export const ADD_NODE_MENU_TABS = ["common", "image", "video", "audio", "all"] as const
export type AddNodeMenuTab = (typeof ADD_NODE_MENU_TABS)[number]

export const ADD_NODE_MENU_TAB_KEY = "nodaro:addNodeMenuTab"

export function readAddNodeMenuTab(): AddNodeMenuTab {
  try {
    const stored = localStorage.getItem(ADD_NODE_MENU_TAB_KEY)
    return (ADD_NODE_MENU_TABS as readonly string[]).includes(stored ?? "")
      ? (stored as AddNodeMenuTab)
      : "common"
  } catch {
    return "common"
  }
}

export function persistAddNodeMenuTab(tab: AddNodeMenuTab): void {
  try {
    localStorage.setItem(ADD_NODE_MENU_TAB_KEY, tab)
  } catch {
    /* ignore */
  }
}

/** The neighbouring tab in display order — `dir` 1 cycles forward (Tab), -1 backward (Shift+Tab). */
export function nextAddNodeMenuTab(tab: AddNodeMenuTab, dir: 1 | -1 = 1): AddNodeMenuTab {
  const n = ADD_NODE_MENU_TABS.length
  const i = ADD_NODE_MENU_TABS.indexOf(tab)
  return ADD_NODE_MENU_TABS[(i + dir + n) % n]
}
