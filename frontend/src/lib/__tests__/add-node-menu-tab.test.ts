import { describe, it, expect, beforeEach } from "vitest"
import {
  readAddNodeMenuTab,
  persistAddNodeMenuTab,
  nextAddNodeMenuTab,
  ADD_NODE_MENU_TABS,
  ADD_NODE_MENU_TAB_KEY,
} from "../add-node-menu-tab"

describe("add-node-menu-tab preference", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("defines the five tabs in display order", () => {
    expect(ADD_NODE_MENU_TABS).toEqual(["common", "image", "video", "audio", "all"])
  })

  it("defaults to 'common' when nothing is stored", () => {
    expect(readAddNodeMenuTab()).toBe("common")
  })

  it("persists each tab and reads it back", () => {
    for (const tab of ADD_NODE_MENU_TABS) {
      persistAddNodeMenuTab(tab)
      expect(readAddNodeMenuTab()).toBe(tab)
    }
  })

  it("falls back to 'common' on an invalid stored value", () => {
    localStorage.setItem(ADD_NODE_MENU_TAB_KEY, "garbage")
    expect(readAddNodeMenuTab()).toBe("common")
  })

  it("nextAddNodeMenuTab cycles forward through all tabs and wraps", () => {
    expect(nextAddNodeMenuTab("common")).toBe("image")
    expect(nextAddNodeMenuTab("image")).toBe("video")
    expect(nextAddNodeMenuTab("video")).toBe("audio")
    expect(nextAddNodeMenuTab("audio")).toBe("all")
    expect(nextAddNodeMenuTab("all")).toBe("common")
  })

  it("nextAddNodeMenuTab cycles backward with dir=-1 and wraps", () => {
    expect(nextAddNodeMenuTab("common", -1)).toBe("all")
    expect(nextAddNodeMenuTab("all", -1)).toBe("audio")
    expect(nextAddNodeMenuTab("video", -1)).toBe("image")
  })
})
