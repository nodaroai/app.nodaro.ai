import { describe, it, expect } from "vitest"
import { joinHintFragments, joinSentences, appendPromptHints } from "../hint-join.js"
import { joinPromptHints } from "../prompt-hint-join.js"
import { composeNegative, resolvePrompt } from "../resolve-prompt.js"
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
    // roll-left kept its one-clause catalog wording through the Camera Motion Lab.
    expect(composeCameraMotionHintFromConnections("roll-left", ["wide shot"], [])).toBe(
      "camera rolls counterclockwise around the lens axis, beginning with wide shot",
    )
  })
})

/**
 * A prompt typed with a closing period used to come out doubled once a picker
 * hint was appended: "No text, no logos, no watermark.. butterfly portrait
 * lighting" (every picker example run in the docs rebuild).
 */
describe("joinSentences", () => {
  it("joins with a period and a space", () => {
    expect(joinSentences(["a red fox", "soft window light"])).toBe("a red fox. soft window light")
  })

  it("never doubles a closing period, question or exclamation mark, or ellipsis", () => {
    expect(joinSentences(["No text, no logos, no watermark.", "butterfly portrait lighting"])).toBe(
      "No text, no logos, no watermark. butterfly portrait lighting",
    )
    expect(joinSentences(["Is it raining?", "wet asphalt"])).toBe("Is it raining? wet asphalt")
    expect(joinSentences(["Go!", "motion blur"])).toBe("Go! motion blur")
    expect(joinSentences(["and then…", "a door opens"])).toBe("and then… a door opens")
    expect(joinSentences(["雨の街。", "neon"])).toBe("雨の街。 neon")
  })

  it("does not carry trailing space into the join, and drops blank pieces", () => {
    expect(joinSentences(["a cat.  ", "noir"])).toBe("a cat. noir")
    expect(joinSentences(["a cat \n", "noir"])).toBe("a cat. noir")
    expect(joinSentences(["", "  ", undefined, "noir"])).toBe("noir")
    expect(joinSentences([])).toBe("")
  })
})

describe("appendPromptHints", () => {
  it("joins the hints as clauses, then follows the prompt as a new sentence", () => {
    expect(appendPromptHints("A studio portrait.", ["butterfly lighting", "85mm lens"])).toBe(
      "A studio portrait. butterfly lighting, 85mm lens",
    )
    expect(appendPromptHints("A studio portrait", ["butterfly lighting"])).toBe("A studio portrait. butterfly lighting")
  })

  it("gives the hints alone with no prompt, and the prompt back unchanged with no hints", () => {
    expect(appendPromptHints(undefined, ["butterfly lighting"])).toBe("butterfly lighting")
    expect(appendPromptHints("", ["butterfly lighting"])).toBe("butterfly lighting")
    expect(appendPromptHints("A portrait.  ", [])).toBe("A portrait.  ")
    expect(appendPromptHints("A portrait", ["", "  "])).toBe("A portrait")
  })
})

describe("the other prompt joins are sentence-aware too", () => {
  const M = new Map<string, string>()
  it("folded direction hints (joinPromptHints)", () => {
    expect(joinPromptHints("No watermark.", ["golden hour", "shallow depth of field"])).toBe(
      "No watermark. golden hour. shallow depth of field",
    )
    expect(joinPromptHints("  untouched  ", [])).toBe("  untouched  ")
  })
  it("a connected prompt appended to the typed one (appendWired)", () => {
    expect(resolvePrompt({ typed: ["A fox."], wired: "in the snow", refMap: M, appendWired: true })).toBe("A fox. in the snow")
  })
  it("a connected negative prompt (composeNegative)", () => {
    expect(composeNegative("blurry.", "watermark")).toBe("blurry. watermark")
    expect(composeNegative("blurry", "watermark")).toBe("blurry. watermark")
  })
})
