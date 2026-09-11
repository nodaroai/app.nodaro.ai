import { describe, it, expect } from "vitest"
import { joinHintFragments } from "../hint-join.js"
import { composeCameraMotionHintFromConnections, getCameraMotionPromptHint } from "../camera-motions.js"
import { getParameterPromptHint } from "../parameter-prompt-hint.js"

/**
 * The tested camera-motion injections are multi-sentence paragraphs ending in
 * a period. Every composer used to glue fragments with `", "`, which produced
 * `"...no pull-out., beginning with ..."`. The joiner keeps the comma between
 * clause-style fragments (byte-identical to before) and uses a space after a
 * fragment that already closes a sentence.
 */
describe("joinHintFragments", () => {
  it("keeps the historical comma join for clause-style fragments", () => {
    expect(joinHintFragments(["slow pan left", "beginning with wide shot"])).toBe(
      "slow pan left, beginning with wide shot",
    )
  })

  it("uses a space after a fragment that already ends a sentence", () => {
    expect(joinHintFragments(["The camera pans left.", "beginning with wide shot"])).toBe(
      "The camera pans left. beginning with wide shot",
    )
    expect(joinHintFragments(["Hold!", "then cut", "Done?", "fin"])).toBe("Hold! then cut, Done? fin")
  })

  it("skips empty fragments and never adds or strips punctuation", () => {
    expect(joinHintFragments(["", "The camera pans left.", ""])).toBe("The camera pans left.")
    expect(joinHintFragments([])).toBe("")
  })
})

describe("sentence-style camera-motion hints compose cleanly", () => {
  it("never emits a period directly followed by a comma", () => {
    const composed = composeCameraMotionHintFromConnections("dolly-in", ["wide shot"], ["close-up"])
    expect(composed).not.toContain(".,")
    expect(composed.startsWith(getCameraMotionPromptHint("dolly-in"))).toBe(true)
    expect(composed).toContain("beginning with wide shot, ending with close-up")
  })

  it("wraps preText/postText around a sentence-style hint without a stray comma", () => {
    const out = getParameterPromptHint({
      id: "n1",
      type: "camera-motion",
      data: { cameraMotion: "tilt-up", preText: "shot on location", postText: "golden hour" },
    })
    expect(out).not.toContain(".,")
    expect(out.startsWith("shot on location, The camera")).toBe(true)
    expect(out.endsWith("No zoom, no push-in. golden hour")).toBe(true)
  })

  it("keeps a clause-style hint byte-identical to the pre-joiner output", () => {
    expect(composeCameraMotionHintFromConnections("static", ["wide shot"], [])).toBe(
      "locked off static camera, no camera movement, beginning with wide shot",
    )
  })
})
