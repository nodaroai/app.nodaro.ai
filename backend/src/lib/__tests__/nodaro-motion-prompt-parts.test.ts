/**
 * Video Remake's prompt part overrides for direct runs
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
  "nodaro-prism": { precise: { face: "Keep each face." }, motion: { avoid: "-", person: "{name} is {image}." } },
  "nodaro-pulse": { motion: { opener: "{video} gives the movement only." } },
}

describe("the admin save", () => {
  it("round-trips a setting", () => {
    expect(nodaroMotionPromptPartsSchema.parse(structuredClone(SAVED))).toEqual(SAVED)
    expect(parseNodaroMotionPromptParts(structuredClone(SAVED))).toEqual(SAVED)
  })

  it("refuses an unknown part, style or engine, and an empty or over-long text", () => {
    for (const bad of [
      { "nodaro-prism": { precise: { faces: "x" } } },
      { "nodaro-prism": { fast: { face: "x" } } },
      { "motion-turbo": { precise: { face: "x" } } },
      // The earlier ids are read, never saved.
      { "motion-pro": { precise: { face: "x" } } },
      { "nodaro-prism": { precise: { face: "" } } },
      { "nodaro-prism": { precise: { face: "x".repeat(2001) } } },
    ]) {
      expect(nodaroMotionPromptPartsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })
})

describe("the stored row's read", () => {
  it("reads an earlier engine id as the current one, the current key winning", () => {
    expect(parseNodaroMotionPromptParts({ "motion-pro": { precise: { face: "old" } }, "motion-lite": { motion: { face: "lite" } } }))
      .toEqual({ "nodaro-prism": { precise: { face: "old" } }, "nodaro-pulse": { motion: { face: "lite" } } })
    expect(parseNodaroMotionPromptParts({ "motion-pro": { precise: { face: "old" } }, "nodaro-prism": { precise: { face: "new" } } }))
      .toEqual({ "nodaro-prism": { precise: { face: "new" } } })
  })

  it("drops an unknown engine, reads past a part id it does not know (a newer build's), each with a warning, and reads a non-object as never saved", () => {
    const warns: string[] = []
    const got = parseNodaroMotionPromptParts({ "nodaro-prism": { precise: { faces: "x" } }, "nodaro-pulse": { motion: { face: "ok" } }, other: {} }, (m) => warns.push(m))
    expect(got).toEqual({ "nodaro-prism": { precise: {} }, "nodaro-pulse": { motion: { face: "ok" } } })
    expect(warns).toHaveLength(2)
    expect(warns.join(" ")).toMatch(/precise\.faces/)
    // Any other invalid value still drops that entry alone.
    expect(parseNodaroMotionPromptParts({ "nodaro-prism": { precise: { face: 3 } } }, () => {})).toEqual({})
    expect(parseNodaroMotionPromptParts(null)).toBeNull()
    expect(parseNodaroMotionPromptParts("x", () => {})).toBeNull()
  })
})

describe("what the toolkit answers", () => {
  it("is each entry under its current and its earlier key, each a copy", () => {
    const got = withEarlierPromptPartKeys(SAVED)
    expect(got).toEqual({ ...SAVED, "motion-prism": SAVED["nodaro-prism"], "motion-pro": SAVED["nodaro-prism"], "motion-pulse": SAVED["nodaro-pulse"], "motion-lite": SAVED["nodaro-pulse"] })
    got["nodaro-prism"]!.precise!.face = "changed"
    expect(got["motion-pro"]!.precise!.face).toBe("Keep each face.")
    expect(SAVED["nodaro-prism"]!.precise!.face).toBe("Keep each face.")
  })
})
