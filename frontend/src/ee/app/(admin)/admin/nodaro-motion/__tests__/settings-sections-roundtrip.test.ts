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
  "prompt-wording": { promptWording: { "nodaro-prism": "new" } },
  masking: { masking: { "nodaro-prism": { mode: "auto" }, "nodaro-pulse": { mode: "always", fill: "none", faceMesh: true } } },
  motion: {
    motion: {
      // Face mesh layers no parts value names, as the server saves them (only the layers on).
      "nodaro-prism": { masking: { mode: "always", faceMesh: true, faceMeshLayers: { eyes: true, irises: true, bold: true } }, promptStyle: "precise" },
      "nodaro-pulse": { promptStyle: "precise" },
    },
  },
  steps: { steps: {} },
  style: { style: { "nodaro-prism": "precise", "nodaro-pulse": "flex" } },
  "pulse-audio": { pulseAudio: "generated" },
  "pulse-reference-audio": { pulseReferenceAudio: { "720p": { mode: "voice", semitones: 2.5 }, "1080p": { mode: "none" } } },
  "prism-reference-audio": { prismReferenceAudio: { "480p": "full", "720p": "voice", "1080p": "none" } },
  "style-only": { styleOnly: {} },
  "precise-art-style": { preciseArtStyle: { "nodaro-prism": { opener: "edit" } } },
  "no-person": { noPerson: {} },
  "precise-style-route": {
    preciseStyleRoute: {
      routing: "off",
      // The styles' routes in the catalog's order, as the page saves them.
      styleRoutes: { anime: "precise", cyberpunk: "precise-gray" },
      bypassEmails: ["tester@example.com", "second@example.com"],
      routedDepthBlur: 12,
      describeColours: false,
      faceMesh: true,
      faceMeshParts: "features",
      faceMeshWording: "shape",
    },
  },
  advanced: { show: true },
  "custom-style": {
    customStyle: {
      enabled: false,
      medium: { instructions: "Stand-in instructions for the medium step.", model: "stand-in-model" },
      describe: { instructions: "Stand-in instructions for the describe step." },
    },
  },
  "plan-roles": {
    planRoles: {
      enabled: false,
      plan: { instructions: "Stand-in instructions for the planning step, at most <maxPersons> persons.", model: "stand-in-model" },
    },
  },
  previz: { previz: { enabled: false } },
  "shot-lock": { shotLock: { "nodaro-prism": { ordinary: "on", styleAlone: "on", styles: { cinematic: "off", custom: "on" } }, "nodaro-pulse": "on" } },
  "shot-list-fps": { shotListFps: { fps: 4 } },
  "prompt-parts": { promptParts: { "nodaro-prism": { precise: { face: "Keep the faces." }, motion: { avoid: "-" }, previz: { referenceOnly: "Only the camera of {video}." } } } },
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

  it("keeps the route's per-style map, an entry for a style this catalog lacks included", () => {
    const spec = MOTION_SETTINGS_SPECS["precise-style-route"]
    const body = { preciseStyleRoute: { styleRoutes: { cyberpunk: "precise-gray", "a-future-style": "precise" } } }
    expect(spec.bodyOf(spec.draftOf(spec.storedOfBody(body)))).toEqual(body)
  })
})
