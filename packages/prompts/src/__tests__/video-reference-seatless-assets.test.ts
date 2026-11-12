/**
 * `assetsTakeNoSeat` — the reference walk for a model whose image references
 * are its FRAMES (a `keyframes` video model, decided 2026-11-11). No asset is
 * seated: nothing attaches a URL or numbers an `@image_N`. A wired character
 * gives its name and description in BOTH reference formats (production renders
 * hybrid), its mentions and `{ref:<id>}` read as its name, and a non-character
 * extra adds nothing.
 */
import { describe, it, expect } from "vitest"
import type { ConnectedReference } from "@nodaro/shared/types"
import { resolveVideoReferenceCore } from "../video-reference-resolver.js"

const F1 = "https://cdn/frame-1.png"
const F2 = "https://cdn/frame-2.png"
const MAYA = "https://cdn/maya.png"
const MAYA_SMILE = "https://cdn/maya-smile.png"
const CAR = "https://cdn/car.png"

const maya: ConnectedReference = {
  id: "maya-ref",
  defaultName: "Maya",
  source: "wired-character",
  url: MAYA,
  characterSlug: "maya",
  characterCanonicalDescription: "Short silver hair, green coat",
}
const mayaSmile: ConnectedReference = { ...maya, id: "maya-smile", url: MAYA_SMILE, variantSlug: "smile" }

for (const hybridRoles of [false, true]) {
  const format = hybridRoles ? "hybrid" : "legacy"
  describe(`resolveVideoReferenceCore — assetsTakeNoSeat (${format})`, () => {
    it("a wired character gives its name and description; only the frames go out", () => {
      const r = resolveVideoReferenceCore({
        prompt: "she walks to the window",
        wiredCharRefs: [maya],
        ordinalOffset: 2,
        hybridRoles,
        assetsTakeNoSeat: true,
      })
      expect(r.additionalUrls).toEqual([])
      expect(r.prompt).toContain("Maya — Short silver hair, green coat.")
      expect(r.prompt).toContain("she walks to the window")
      expect(r.prompt).not.toMatch(/@image|from @/)
    })

    it("leading frames come back untouched and nothing joins them", () => {
      const r = resolveVideoReferenceCore({
        prompt: "she walks",
        wiredCharRefs: [maya, mayaSmile],
        leadingRefUrls: [F1, F2],
        extraRefs: [{ id: "car", url: CAR, description: "a red car" }],
        hybridRoles,
        assetsTakeNoSeat: true,
      })
      expect(r.additionalUrls).toEqual([F1, F2])
      expect(r.prompt).not.toContain("a red car")
    })

    it("mentions, variant mentions and {ref:<id>} of the character read as its name", () => {
      const r = resolveVideoReferenceCore({
        prompt: "@maya:1 smiles at {ref:maya-ref}, then @maya:2:smile waves",
        wiredCharRefs: [maya, mayaSmile],
        ordinalOffset: 2,
        hybridRoles,
        assetsTakeNoSeat: true,
      })
      expect(r.prompt).toContain("Maya smiles at Maya, then Maya waves")
      expect(r.prompt).toContain("Maya — Short silver hair, green coat.")
      expect(r.prompt).not.toMatch(/@maya|@image|\{ref:/)
    })

    it("a character extra speaks for its character once, and its {ref:<id>} reads as the character", () => {
      const r = resolveVideoReferenceCore({
        prompt: "look at {ref:x1}",
        wiredCharRefs: [maya],
        extraRefs: [{ id: "x1", url: MAYA_SMILE, characterSlug: "maya", variantSlug: "smile", description: "smiling" }],
        lookupCharacterBySlug: () => ({ characterName: "Maya", canonicalDescription: "Short silver hair, green coat" }),
        ordinalOffset: 2,
        hybridRoles,
        assetsTakeNoSeat: true,
      })
      expect(r.prompt).toContain("look at Maya")
      expect(r.prompt?.match(/Maya — /g)).toHaveLength(1)
      expect(r.additionalUrls).toEqual([])
    })

    it("a hidden canonical fallback stays hidden unless the prompt mentions the character", () => {
      const hidden = resolveVideoReferenceCore({
        prompt: "an empty room",
        wiredCharRefs: [maya],
        suppressedCanonicalCharacterIds: ["maya"],
        ordinalOffset: 1,
        hybridRoles,
        assetsTakeNoSeat: true,
      })
      expect(hidden.prompt).toBe("an empty room")
      const mentioned = resolveVideoReferenceCore({
        prompt: "@maya:1 in an empty room",
        wiredCharRefs: [maya],
        suppressedCanonicalCharacterIds: ["maya"],
        ordinalOffset: 1,
        hybridRoles,
        assetsTakeNoSeat: true,
      })
      expect(mentioned.prompt).toContain("Maya in an empty room")
      expect(mentioned.prompt).toContain("Maya — Short silver hair, green coat.")
    })

    it("an {image:N} past the frames keeps only its label", () => {
      const r = resolveVideoReferenceCore({
        prompt: "between {image:1:the door} and {image:3:Maya}",
        wiredCharRefs: [maya],
        ordinalOffset: 2,
        hybridRoles,
        assetsTakeNoSeat: true,
      })
      expect(r.prompt).toContain("the door from @image_1")
      expect(r.prompt).not.toContain("@image_3")
    })
  })
}

it("without assetsTakeNoSeat the hybrid walk still seats the character after the frames", () => {
  const r = resolveVideoReferenceCore({
    prompt: "she walks",
    wiredCharRefs: [maya],
    leadingRefUrls: [F1, F2],
    hybridRoles: true,
  })
  expect(r.additionalUrls).toEqual([F1, F2, MAYA])
  expect(r.prompt).toMatch(/from @image_3/)
})
