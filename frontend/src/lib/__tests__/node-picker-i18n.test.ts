import { describe, it, expect } from "vitest"
import { PICKER_TAB_LABEL_KEY, pickerSectionLabel, pickerTabLabel } from "@/lib/node-picker-i18n"
import { PICKER_TABS } from "@/lib/node-families"
import { en } from "@/lib/i18n/en"
import { he } from "@/lib/i18n/he"

describe("picker tab labels", () => {
  it("every picker tab (and the Creative Controls pseudo-tab) has an English AND a Hebrew chrome string", () => {
    for (const tab of [...PICKER_TABS, "controls"] as const) {
      const key = PICKER_TAB_LABEL_KEY[tab]
      expect(key, `no label key for tab ${tab}`).toBeTruthy()
      expect(typeof en[key], `en missing ${key}`).toBe("string")
      expect(typeof he[key], `he missing ${key}`).toBe("string")
      // A Hebrew value equal to the English one is an untranslated copy-paste.
      expect(he[key], `he[${key}] is not translated`).not.toBe(en[key])
    }
  })

  it("resolves a tab label in the given locale", () => {
    expect(pickerTabLabel("all", "en")).toBe("All")
    expect(pickerTabLabel("all", "he")).toBe("הכל")
  })
})

// Chrome strings the picker surface mints outside the tab table. i18n.test.ts
// only checks he ⊆ en, so an untranslated key would silently fall back to
// English — the exact regression this file guards against.
const PICKER_CHROME_KEYS = [
  "addnode.noModelsFound",
  "addnode.modelCount",
  "addnode.createsNode",
  "node.runsOnNodaro",
  "toolbar.myLibrary",
  // Connect dialog (the picker's auto-connect handoff)
  "connect.dialogAria", "connect.title", "connect.name", "connect.nameAria", "connect.handles",
  "connect.after", "connect.before", "connect.wiresInto", "connect.roleNew", "connect.roleCurrent",
  "connect.optionAriaAfter", "connect.optionAriaBefore", "connect.missingVariables",
  "connect.variableHint", "connect.dontConnect", "connect.autoConnect", "connect.navigate",
  "connect.confirm", "connect.cancel",
  // Canvas toolbar rail
  "ctb.searchWorkflows", "ctb.findInWorkflow", "ctb.previousFocus", "ctb.addStickyNote",
  "ctb.tidyUp", "ctb.undo", "ctb.redo", "ctb.toggleSidebar", "ctb.keyboardShortcuts",
  "ctb.dragAria", "ctb.dragTitle",
  // My Library modal
  "assetlib.searchPlaceholder", "assetlib.projectLabel", "assetlib.allProjects",
  "assetlib.filterByProject", "assetlib.clear", "assetlib.tabAll", "assetlib.tabCharacters",
  "assetlib.tabObjects", "assetlib.tabCreatures", "assetlib.tabLocations", "assetlib.tabFaces",
  "assetlib.tabImages", "assetlib.tabVideos", "assetlib.tabAudio", "assetlib.loading",
  "assetlib.loadFailed", "assetlib.noMatching", "assetlib.noSaved", "assetlib.tryFilters",
  "assetlib.generateHint", "assetlib.onCanvas", "assetlib.viewAsset", "assetlib.addToCanvas",
  "assetlib.typeCharacter", "assetlib.typeObject", "assetlib.typeCreature", "assetlib.typeLocation", "assetlib.typeFace",
] as const

describe("picker chrome keys", () => {
  it("every picker chrome key has an English AND a Hebrew string", () => {
    for (const key of PICKER_CHROME_KEYS) {
      expect(typeof en[key], `en missing ${key}`).toBe("string")
      expect(typeof he[key], `he missing ${key}`).toBe("string")
      expect(he[key], `he[${key}] is not translated`).not.toBe(en[key])
    }
  })
})

describe("pickerSectionLabel", () => {
  const prefixed = { id: "image-add-your-own", label: "Image · Add Your Own", family: "Add Your Own", tab: "image" as const, options: [] }
  const bare = { id: "common-add-your-own", label: "Add Your Own", family: "Add Your Own", options: [] }

  it("keeps the English header byte-identical in English", () => {
    expect(pickerSectionLabel(prefixed, "en")).toBe("Image · Add Your Own")
    expect(pickerSectionLabel(bare, "en")).toBe("Add Your Own")
  })

  it("composes TAB · FAMILY from the chrome tab name and the node-group table in Hebrew", () => {
    expect(pickerSectionLabel(prefixed, "he")).toBe("תמונה · העלאה משלכם")
    expect(pickerSectionLabel(bare, "he")).toBe("העלאה משלכם")
  })

  it("prefixes Creative Controls families on the All tab", () => {
    const cc = { id: "cc-camera", label: "Creative Controls · Camera", family: "Camera", tab: "controls" as const, options: [], control: true }
    expect(pickerSectionLabel(cc, "en")).toBe("Creative Controls · Camera")
    expect(pickerSectionLabel(cc, "he")).toBe(`${he["addnode.creativeControls"]} · מצלמה`)
  })

  it("passes an unknown family through untranslated rather than blank", () => {
    const odd = { id: "x", label: "Some New Family", family: "Some New Family", options: [] }
    expect(pickerSectionLabel(odd, "he")).toBe("Some New Family")
  })
})
