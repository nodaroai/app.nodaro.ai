// packages/prompts/src/__tests__/realism-wording.test.ts
import { describe, it, expect } from "vitest"
import * as wording from "../realism-wording.js"

// These strings are read at run time by other Nodaro services; changing one changes their output on the next deploy, so a change needs its owner's review.
describe("realism wording (frozen)", () => {
  it("exports exactly the selected fragments and the two person functions", () => {
    expect(Object.keys(wording).sort()).toEqual(
      ["NEUTRAL_PERSON", "REALISM_FINISH", "REALISM_PASS_INSTRUCTION", "REALISM_SKIN", "realismEmptyHands", "realismViewpoint"].sort(),
    )
  })

  it("keeps every fragment's text", () => {
    expect(wording.REALISM_SKIN).toBe(
      "Skin shows its real structure: visible pores that vary in size across the nose and cheeks, fine vellus hair catching the light, faint uneven pigmentation, a little redness around the nostrils, natural oil on the forehead.",
    )
    expect(wording.REALISM_FINISH).toBe(
      "The plain look of an everyday small-sensor snapshot: colour left as it was recorded, deep focus from the nearest shoulder to the background, a fine grain in the darker areas, bright areas that fade rather than clip.",
    )
    expect(wording.REALISM_PASS_INSTRUCTION).toBe(
      "Make this photo look like an unretouched everyday snapshot: skin that shows its pores, its fine hairs and the small changes in tone real skin has, colour left as it was recorded, everything sharp from the shoulders to the background, a little grain in the shadows. Take out anything that makes it look rendered — smoothed, waxy or airbrushed skin, a glow, over-sharpened edges — and add no text or icons. Otherwise it stays the same person in the same frame: the face and its proportions, hair, clothing, pose and background as they are.",
    )
  })

  it("keeps the viewpoint and empty-hands sentences, neutral and gendered", () => {
    expect(wording.realismViewpoint(wording.NEUTRAL_PERSON)).toBe(
      "The person is looking straight at the viewer from eye level, mid-sentence: their face and shoulders close up, the framing loose and a little crooked, both arms relaxed and down out of the frame. The whole image is the photograph itself, edge to edge, with no text or icons anywhere.",
    )
    expect(wording.realismViewpoint({ subject: "she", possessive: "her" })).toBe(
      "She is looking straight at the viewer from eye level, mid-sentence: her face and shoulders close up, the framing loose and a little crooked, both arms relaxed and down out of the frame. The whole image is the photograph itself, edge to edge, with no text or icons anywhere.",
    )
    expect(wording.realismEmptyHands(wording.NEUTRAL_PERSON)).toBe("Their hands are empty; the person is holding nothing.")
    expect(wording.realismEmptyHands({ subject: "he", possessive: "his" })).toBe("His hands are empty; he is holding nothing.")
  })

  it("names no device", () => {
    const DEVICE_WORDS = /\b(?:smartphones?|iphones?|phones?|cameras?|lens(?:es)?|webcams?|laptops?|tablets?|screens?|monitors?|displays?|tripods?|selfie[ -]sticks?)\b/i
    for (const s of [wording.REALISM_SKIN, wording.REALISM_FINISH, wording.REALISM_PASS_INSTRUCTION, wording.realismViewpoint(wording.NEUTRAL_PERSON), wording.realismEmptyHands(wording.NEUTRAL_PERSON)])
      expect(s).not.toMatch(DEVICE_WORDS)
  })
})
