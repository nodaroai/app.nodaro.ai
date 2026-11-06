import { describe, expect, it } from "vitest"
import { MOTION_SETTINGS_KEYS, MOTION_SETTINGS_SPECS } from "../settings-sections"

/**
 * A stored set holds each section as its route stores it, and the page names
 * a set live when the live settings, read the way the page reads them, are
 * that set. So the page must read a stored body back unchanged: a section
 * whose draft drops or rewrites a field the server keeps would send something
 * else on Save all, read "edited" right after it, and lose the field from
 * every set saved from the page.
 *
 * One body per section in the server's stored form (each route's `prepare`),
 * with every field the page edits away from its default — a new section must
 * bring one.
 */
const STORED: Readonly<Record<string, unknown>> = {
  "prompt-wording": { promptWording: { "motion-prism": "new" } },
  masking: { masking: { "motion-prism": { mode: "auto" }, "motion-pulse": { mode: "always", fill: "none", faceMesh: true } } },
  motion: {
    motion: {
      // Face mesh layers no parts value names, as the server saves them (only the layers on).
      "motion-prism": { masking: { mode: "always", faceMesh: true, faceMeshLayers: { eyes: true, irises: true, bold: true } }, promptStyle: "precise" },
      "motion-pulse": { promptStyle: "precise" },
    },
  },
  steps: { steps: {} },
  style: { style: { "motion-prism": "precise", "motion-pulse": "flex" } },
  "pulse-audio": { pulseAudio: "generated" },
  "prism-reference-audio": { prismReferenceAudio: { "480p": "full", "720p": "voice", "1080p": "none" } },
  "style-only": { styleOnly: {} },
  "precise-art-style": { preciseArtStyle: { "motion-prism": { opener: "edit" } } },
  "no-person": { noPerson: {} },
  "precise-style-route": {
    preciseStyleRoute: {
      routing: "off",
      bypassEmails: ["tester@example.com", "second@example.com"],
      routedDepthBlur: 12,
      describeColours: false,
      faceMesh: true,
      faceMeshParts: "features",
      faceMeshWording: "shape",
    },
  },
  advanced: { show: true },
  "prompt-parts": { promptParts: { "motion-prism": { precise: { face: "Keep the faces." }, motion: { avoid: "-" } } } },
}

describe("the page reads a stored set back unchanged", () => {
  it("has a body for every section", () => {
    expect(Object.keys(STORED).sort()).toEqual([...MOTION_SETTINGS_KEYS].sort())
  })

  for (const key of MOTION_SETTINGS_KEYS) {
    it(key, () => {
      const spec = MOTION_SETTINGS_SPECS[key]
      const body = STORED[key]
      expect(spec.bodyOf(spec.draftOf(spec.storedOfBody(body)))).toEqual(body)
    })
  }

  it("keeps the route's face mesh layers when they are saved as layers", () => {
    const spec = MOTION_SETTINGS_SPECS["precise-style-route"]
    const body = { preciseStyleRoute: { faceMesh: true, faceMeshLayers: { eyes: true, lips: true, bold: true } } }
    expect(spec.bodyOf(spec.draftOf(spec.storedOfBody(body)))).toEqual(body)
  })
})
