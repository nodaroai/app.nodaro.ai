import { describe, it, expect } from "vitest"
import { BLUEPRINT_IDS, BLUEPRINT_PARAM_SCHEMAS, BLUEPRINT_META, validateBlueprintParams } from "../blueprint-params.js"

describe("blueprint-params", () => {
  it("every id has a param schema AND a meta entry", () => {
    for (const id of BLUEPRINT_IDS) {
      expect(BLUEPRINT_PARAM_SCHEMAS[id]).toBeDefined()
      expect(BLUEPRINT_META[id]).toBeDefined()
      expect(BLUEPRINT_META[id].defaultDurationFrames).toBeGreaterThan(0)
      expect(BLUEPRINT_META[id].roles.length).toBeGreaterThan(0)
    }
  })
  it("has all 15 blueprint ids, alphabetical (adds cursor-ui-demo)", () => {
    expect(BLUEPRINT_IDS).toEqual([
      "comparison-split",
      "constellation-hub",
      "cta-morph-press",
      "cursor-ui-demo",
      "dataviz-countup",
      "device-surface-showcase",
      "grid-card-assemble",
      "kinetic-type-beats",
      "logo-assemble-lockup",
      "overwhelm-surround",
      "spatial-pan-stations",
      "ticker-takeover",
      "titlecard-reveal",
      "typewriter-reveal",
      "waterfall-reveal",
    ])
  })
  it("validates good kinetic-type-beats params", () => {
    const r = validateBlueprintParams("kinetic-type-beats", { lines: ["A", "B"], accentColor: "#FF5733" })
    expect(r.ok).toBe(true)
  })
  it("rejects kinetic-type-beats with >4 lines", () => {
    const r = validateBlueprintParams("kinetic-type-beats", { lines: ["a","b","c","d","e"], accentColor: "#fff" })
    expect(r.ok).toBe(false)
  })
  it("rejects an unknown blueprint id", () => {
    const r = validateBlueprintParams("nope", {})
    expect(r.ok).toBe(false)
  })
  it("rejects a non-hex accentColor", () => {
    const r = validateBlueprintParams("cta-morph-press", { label: "Go", accentColor: "red" })
    expect(r.ok).toBe(false)
  })

  describe("constellation-hub (Phase 2.y)", () => {
    it("validates a good params object", () => {
      const r = validateBlueprintParams("constellation-hub", {
        hubLabel: "Acme",
        nodes: [{ label: "Slack" }, { label: "Notion" }, { label: "Figma" }, { label: "Linear" }],
        finisher: "orbit",
        accentColor: "#FF5733",
      })
      expect(r.ok).toBe(true)
    })
    it("rejects an object missing the required hubLabel field", () => {
      const r = validateBlueprintParams("constellation-hub", {
        nodes: [{ label: "Slack" }, { label: "Notion" }, { label: "Figma" }],
      })
      expect(r.ok).toBe(false)
    })
  })

  describe("overwhelm-surround (Phase 2.y)", () => {
    it("validates a good params object", () => {
      const r = validateBlueprintParams("overwhelm-surround", {
        surfaces: [{ label: "Spreadsheet" }, { label: "Inbox" }],
        markers: ["ping", "ping", "ping", "ping"],
        subjectLabel: "You",
        demands: ["Approve", "Review", "Sign off", "Reply", "Escalate"],
        accentColor: "#FF5733",
      })
      expect(r.ok).toBe(true)
    })
    it("rejects an object missing the required subjectLabel field", () => {
      const r = validateBlueprintParams("overwhelm-surround", {
        surfaces: [{ label: "Spreadsheet" }, { label: "Inbox" }],
        markers: ["ping", "ping", "ping", "ping"],
        demands: ["Approve", "Review", "Sign off", "Reply", "Escalate"],
      })
      expect(r.ok).toBe(false)
    })
  })

  describe("spatial-pan-stations (Phase 2.y)", () => {
    it("validates a good params object", () => {
      const r = validateBlueprintParams("spatial-pan-stations", {
        stations: [
          { label: "Sign up", sublabel: "Day 1" },
          { label: "Onboard" },
          { label: "Launch", sublabel: "Day 30" },
        ],
        variant: "timeline",
        accentColor: "#FF5733",
      })
      expect(r.ok).toBe(true)
    })
    it("rejects an object missing the required stations field", () => {
      const r = validateBlueprintParams("spatial-pan-stations", {
        variant: "timeline",
      })
      expect(r.ok).toBe(false)
    })
  })

  describe("ticker-takeover (Phase 2.y)", () => {
    it("validates a good params object", () => {
      const r = validateBlueprintParams("ticker-takeover", {
        leadIn: "It could be your CRM, your inbox, your",
        options: ["spreadsheet", "calendar"],
        hero: "Acme",
        accentColor: "#FF5733",
      })
      expect(r.ok).toBe(true)
    })
    it("rejects an object missing the required hero field", () => {
      const r = validateBlueprintParams("ticker-takeover", {
        leadIn: "It could be your CRM, your inbox, your",
        options: ["spreadsheet", "calendar"],
      })
      expect(r.ok).toBe(false)
    })
  })

  it("titlecard-reveal and grid-card-assemble META include social_proof (doctrine role extension)", () => {
    expect(BLUEPRINT_META["titlecard-reveal"].roles).toContain("social_proof")
    expect(BLUEPRINT_META["grid-card-assemble"].roles).toContain("social_proof")
  })
})
