/**
 * Nodaro Motion's prompt part overrides for direct runs
 * (`nodaro_motion_prompt_parts`): keyed by public engine id, then style, then
 * part. The admin save is strict; the stored row's read is tolerant (an
 * earlier engine id reads as the current one, the current key wins, an
 * invalid entry is dropped alone).
 */
import { describe, expect, it } from "vitest"
import {
  nodaroMotionPromptPartsSchema,
  parseNodaroMotionPromptParts,
  withEarlierPromptPartKeys,
  type NodaroMotionPromptParts,
} from "../nodaro-motion-prompt-parts.js"

const SAVED: NodaroMotionPromptParts = {
  "motion-prism": { precise: { face: "Keep each face." }, motion: { avoid: "-", person: "{name} is {image}." } },
  "motion-pulse": { motion: { opener: "{video} gives the movement only." } },
}

describe("the admin save", () => {
  it("round-trips a setting", () => {
    expect(nodaroMotionPromptPartsSchema.parse(structuredClone(SAVED))).toEqual(SAVED)
    expect(parseNodaroMotionPromptParts(structuredClone(SAVED))).toEqual(SAVED)
  })

  it("refuses an unknown part, style or engine, and an empty or over-long text", () => {
    for (const bad of [
      { "motion-prism": { precise: { faces: "x" } } },
      { "motion-prism": { fast: { face: "x" } } },
      { "motion-turbo": { precise: { face: "x" } } },
      // The earlier ids are read, never saved.
      { "motion-pro": { precise: { face: "x" } } },
      { "motion-prism": { precise: { face: "" } } },
      { "motion-prism": { precise: { face: "x".repeat(2001) } } },
    ]) {
      expect(nodaroMotionPromptPartsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })
})

describe("the stored row's read", () => {
  it("reads an earlier engine id as the current one, the current key winning", () => {
    expect(parseNodaroMotionPromptParts({ "motion-pro": { precise: { face: "old" } }, "motion-lite": { motion: { face: "lite" } } }))
      .toEqual({ "motion-prism": { precise: { face: "old" } }, "motion-pulse": { motion: { face: "lite" } } })
    expect(parseNodaroMotionPromptParts({ "motion-pro": { precise: { face: "old" } }, "motion-prism": { precise: { face: "new" } } }))
      .toEqual({ "motion-prism": { precise: { face: "new" } } })
  })

  it("drops an unknown engine and an invalid entry alone, with a warning, and reads a non-object as never saved", () => {
    const warns: string[] = []
    const got = parseNodaroMotionPromptParts({ "motion-prism": { precise: { faces: "x" } }, "motion-pulse": { motion: { face: "ok" } }, other: {} }, (m) => warns.push(m))
    expect(got).toEqual({ "motion-pulse": { motion: { face: "ok" } } })
    expect(warns).toHaveLength(2)
    expect(parseNodaroMotionPromptParts(null)).toBeNull()
    expect(parseNodaroMotionPromptParts("x", () => {})).toBeNull()
  })
})

describe("what the toolkit answers", () => {
  it("is each entry under its current and its earlier key, each a copy", () => {
    const got = withEarlierPromptPartKeys(SAVED)
    expect(got).toEqual({ ...SAVED, "motion-pro": SAVED["motion-prism"], "motion-lite": SAVED["motion-pulse"] })
    got["motion-prism"]!.precise!.face = "changed"
    expect(got["motion-pro"]!.precise!.face).toBe("Keep each face.")
    expect(SAVED["motion-prism"]!.precise!.face).toBe("Keep each face.")
  })
})
