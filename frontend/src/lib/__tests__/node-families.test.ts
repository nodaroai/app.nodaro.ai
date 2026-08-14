/**
 * Invariants for the node-picker family registry.
 *
 * These are the guards that make the picker's "every node has a home" promise
 * structural rather than a thing someone has to remember: adding a node to
 * NODE_OPTIONS without giving it a family fails here, long before anyone
 * notices a row rendering under no header.
 */
import { describe, it, expect } from "vitest"
import { NODE_OPTIONS, searchNodeOptions, searchNodeOptionsSectioned } from "@/components/editor/add-node-popup"
import {
  COMMON_SECTIONS,
  CREATIVE_CONTROL_FAMILY_IDS,
  NODE_FAMILIES,
  OWNER_FAMILY_BY_TYPE,
  POPULAR_TYPES,
  PICKER_TABS,
  TAB_SUPERSET,
  familyById,
  familyLabel,
} from "@/lib/node-families"
import {
  allTabSections,
  commonSections,
  creativeControlSections,
  popularSection,
  sectionsForTab,
  sidebarSections,
  tabSections,
} from "@/lib/node-picker-sections"

const ALL_TYPES = NODE_OPTIONS.map((o) => o.type)

describe("family registry", () => {
  it("gives every picker-creatable node exactly one family", () => {
    const unowned = ALL_TYPES.filter((t) => !OWNER_FAMILY_BY_TYPE.has(t))
    expect(unowned, `nodes with no family: ${unowned.join(", ")}`).toEqual([])
  })

  it("never lists the same node in two families", () => {
    const seen = new Map<string, string>()
    const dupes: string[] = []
    for (const family of NODE_FAMILIES)
      for (const type of family.types) {
        const prev = seen.get(type)
        if (prev) dupes.push(`${type}: ${prev} + ${family.id}`)
        else seen.set(type, family.id)
      }
    expect(dupes).toEqual([])
  })

  it("keeps every NodeOption.group in sync with its owning family", () => {
    const drift = NODE_OPTIONS
      .filter((o) => o.group !== OWNER_FAMILY_BY_TYPE.get(o.type))
      .map((o) => `${o.type}: group=${o.group} owner=${OWNER_FAMILY_BY_TYPE.get(o.type)}`)
    expect(drift).toEqual([])
  })

  it("only references node types that exist in the catalog", () => {
    const known = new Set<string>(ALL_TYPES)
    const ghosts = NODE_FAMILIES.flatMap((f) =>
      f.types.filter((t) => !known.has(t)).map((t) => `${f.id} → ${t}`),
    )
    expect(ghosts).toEqual([])
  })

  it("uses unique family ids and resolves each to a label", () => {
    const ids = NODE_FAMILIES.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(familyLabel(id)).toBe(familyById(id)?.label)
  })

  it("puts every Pickers-category node in a creative-control family", () => {
    for (const id of CREATIVE_CONTROL_FAMILY_IDS) expect(familyById(id)?.tab).toBe("controls")
    const controlTypes = new Set(
      NODE_FAMILIES.filter((f) => f.tab === "controls").flatMap((f) => f.types),
    )
    const stranded = NODE_OPTIONS
      .filter((o) => o.category === "Pickers" && !controlTypes.has(o.type))
      .map((o) => o.type)
    expect(stranded).toEqual([])
    // The reverse does not hold: `suno-voice` is an AI-category node that the
    // design places under MUSIC & VOICE, because to the user it is the same
    // kind of choice as picking a timbre.
    expect(controlTypes.has("suno-voice")).toBe(true)
  })

  it("routes every superset entry to a real family and a real node", () => {
    for (const [tab, families] of Object.entries(TAB_SUPERSET)) {
      expect(PICKER_TABS).toContain(tab)
      for (const [familyId, types] of Object.entries(families)) {
        expect(familyById(familyId), `unknown family ${familyId}`).toBeDefined()
        for (const type of types) expect(ALL_TYPES).toContain(type)
      }
    }
  })
})

describe("the repeat rule — nothing lives only in a shortcut", () => {
  it("also renders every POPULAR entry inside its own family", () => {
    for (const [tab, types] of Object.entries(POPULAR_TYPES)) {
      expect(types.length).toBeLessThanOrEqual(3)
      for (const type of types) {
        const owner = OWNER_FAMILY_BY_TYPE.get(type)
        expect(owner, `${tab} POPULAR "${type}" has no family`).toBeDefined()
      }
    }
  })

  it("also renders every Common entry inside its own family", () => {
    for (const section of COMMON_SECTIONS)
      for (const type of section.types)
        expect(
          OWNER_FAMILY_BY_TYPE.get(type),
          `Common "${type}" (${section.id}) has no family`,
        ).toBeDefined()
  })

  it("shows each media tab's POPULAR entries again lower down that same tab", () => {
    for (const tab of ["image", "video", "audio"] as const) {
      const popular = popularSection(NODE_OPTIONS, tab)?.options.map((o) => o.type) ?? []
      const below = new Set(tabSections(NODE_OPTIONS, tab).flatMap((s) => s.options.map((o) => o.type)))
      for (const type of popular)
        expect(below.has(type), `${tab} POPULAR "${type}" appears nowhere else on the tab`).toBe(true)
    }
  })
})

describe("section builders", () => {
  it("never emits a section with zero rows", () => {
    for (const tab of PICKER_TABS) {
      const { sections, controls } = sectionsForTab(NODE_OPTIONS, tab)
      for (const section of [...sections, ...controls])
        expect(section.options.length, `${tab} → ${section.id} is empty`).toBeGreaterThan(0)
    }
  })

  it("drops a family whose every node is filtered out (the Community case)", () => {
    // Video · ANALYZE is exactly this: both members are Cloud-only.
    const community = NODE_OPTIONS.filter(
      (o) => o.type !== "video-analysis" && o.type !== "video-audit",
    )
    const ids = tabSections(community, "video").map((s) => s.id)
    expect(ids).not.toContain("video-analyze")
    expect(tabSections(NODE_OPTIONS, "video").map((s) => s.id)).toContain("video-analyze")
  })

  it("lists every node exactly once on the All tab", () => {
    const rendered = allTabSections(NODE_OPTIONS).flatMap((s) => s.options.map((o) => o.type))
    expect(new Set(rendered).size).toBe(rendered.length)
    expect(new Set(rendered)).toEqual(new Set(ALL_TYPES))
  })

  it("prefixes All-tab headers with their owning tab", () => {
    for (const section of allTabSections(NODE_OPTIONS)) expect(section.label).toContain(" · ")
  })

  it("merges superset members into the family they are shown under", () => {
    for (const tab of ["image", "video", "audio"] as const) {
      const addYourOwn = tabSections(NODE_OPTIONS, tab).find((s) => s.id === `${tab}-add-your-own`)
      expect(addYourOwn?.options.map((o) => o.type)).toContain("text-prompt")
    }
    const video = tabSections(NODE_OPTIONS, "video").find((s) => s.id === "video-add-your-own")
    expect(video?.options.map((o) => o.type)).toEqual(["upload-video", "youtube-video", "text-prompt"])
  })

  it("shows the reference tools on the Assets tab without moving their family", () => {
    const assets = tabSections(NODE_OPTIONS, "assets")
    const refs = assets.find((s) => s.id === "image-references")
    expect(refs?.options.map((o) => o.type)).toEqual(["reference-sheet", "reference-board"])
    expect(OWNER_FAMILY_BY_TYPE.get("reference-sheet")).toBe("image-references")
  })

  it("adds MUSIC & VOICE to the Audio tab's controls only", () => {
    const ids = (tab: "image" | "video" | "audio") =>
      creativeControlSections(NODE_OPTIONS, tab).map((s) => s.id)
    expect(ids("audio")).toContain("cc-music-voice")
    expect(ids("image")).not.toContain("cc-music-voice")
    expect(ids("video")).not.toContain("cc-music-voice")
  })

  it("keeps Common curated and free of creative controls", () => {
    const types = commonSections(NODE_OPTIONS).flatMap((s) => s.options.map((o) => o.type))
    expect(types[0]).toBe("text-prompt")
    const controls = new Set(
      NODE_FAMILIES.filter((f) => f.tab === "controls").flatMap((f) => f.types),
    )
    expect(types.filter((t) => controls.has(t))).toEqual([])
  })
})

describe("family ids never reach the screen", () => {
  it("resolves every group value on a NodeOption to a human label", () => {
    const raw = NODE_OPTIONS
      .map((o) => o.group)
      .filter((g): g is string => Boolean(g))
      .filter((g) => familyLabel(g) === g) // fallback fired = unregistered id
    expect(raw).toEqual([])
  })

  it("gives every family a label that is not its id", () => {
    for (const family of NODE_FAMILIES) {
      expect(family.label).not.toBe(family.id)
      expect(family.label).not.toMatch(/^[a-z0-9]+(-[a-z0-9]+)+$/)
    }
  })
})

describe("search reaches a node by a space-broken prefix", () => {
  it("surfaces Remove Background for 'remove backg'", () => {
    const hits = searchNodeOptions(NODE_OPTIONS, "remove backg").map((o) => o.type)
    expect(hits).toContain("remove-background")
  })

  it("surfaces it from a tab that does not own it, under the cross-tab block", () => {
    const { own, other } = searchNodeOptionsSectioned(NODE_OPTIONS, "remove backg", "video")
    expect([...own, ...other].map((o) => o.type)).toContain("remove-background")
  })
})

describe("sidebar sections", () => {
  it("mirrors the picker tabs one for one", () => {
    const ids = sidebarSections(NODE_OPTIONS).map((s) => s.id)
    expect(ids).toEqual(["image", "video", "audio", "models", "assets", "automate", "publish", "controls"])
  })

  it("never shows the same header twice inside one section", () => {
    // This is the bug the sidebar had while it grouped by category: Image's
    // "Create" and Video's "Create" landed under one AI heading as two
    // identical rows, and a bare "Create" told the user nothing. Making the
    // tab the section fixes both — and this guard keeps it fixed.
    const clashes: string[] = []
    for (const section of sidebarSections(NODE_OPTIONS)) {
      const seen = new Set<string>()
      for (const family of section.families) {
        if (seen.has(family.label)) clashes.push(`${section.label} › ${family.label}`)
        seen.add(family.label)
      }
    }
    expect(clashes, "two identical headers in one section").toEqual([])
  })

  it("covers every node exactly once across all sections", () => {
    const seen = sidebarSections(NODE_OPTIONS).flatMap((s) =>
      s.families.flatMap((f) => f.options.map((o) => o.type)),
    )
    expect(new Set(seen).size).toBe(seen.length)
    expect(new Set(seen)).toEqual(new Set(ALL_TYPES))
  })

  it("counts what the section actually contains", () => {
    for (const section of sidebarSections(NODE_OPTIONS))
      expect(section.count).toBe(
        section.families.reduce((n, f) => n + f.options.length, 0),
      )
  })

  it("drops a section whose nodes are all gated out", () => {
    const noModels = NODE_OPTIONS.filter((o) => o.category !== "Parameter")
    expect(sidebarSections(noModels).map((s) => s.id)).not.toContain("models")
  })
})
