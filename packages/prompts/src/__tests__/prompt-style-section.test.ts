import { describe, it, expect } from "vitest"
import {
  STYLE_SECTION_HEADER,
  asBodyClauses,
  composeSectionedPrompt,
  endsInsideStyleSection,
  insertBeforeStyleSection,
  partitionStyleClauses,
  renderStyleSection,
  sectionedClauseCosts,
  splitStyleSection,
  styleSectionFromClauses,
} from "../prompt-style-section.js"
import {
  DIRECTION_FIELDS,
  FILM_STYLE_KEYS,
  IMAGE_HINT_MODE_DEFAULT,
  VIDEO_HINT_MODE_DEFAULT,
  directionFieldsForSurface,
  renderDirectionHints,
} from "../direction-registry.js"
import { joinPromptHints } from "../prompt-hint-join.js"
import { getStylePromptHint } from "../style.js"
import { getColorLookPromptHint } from "../color-look.js"
import { getEraPromptHint } from "../era.js"
import { getCameraFormatPromptHint } from "../camera-format.js"
import { getFramingPromptHint } from "../framing.js"
import { getLightingPromptHint } from "../lighting.js"
import { getCameraMotionTerm } from "../camera-motions.js"
import { getTransitionTerm } from "../transitions.js"

/**
 * THE `[style]` SECTION CONTRACT, at the level it is defined: clauses in, one
 * string out. The composers (`assembleImageInput`, `composeVideoPromptText`)
 * are pinned against the same shape in their own suites; what lives here is the
 * grammar itself — which clause lands on which line, and the exact bytes.
 *
 * The header is asserted as a LITERAL everywhere below, never through
 * `STYLE_SECTION_HEADER`, so a typo in the constant fails here instead of
 * silently redefining the contract.
 */

// Real catalog ids: every `get*PromptHint` returns "" on a miss, so a made-up
// id would make most of these assertions vacuously pass.
const STYLE = "anime" // look • film
const COLOR_LOOK = "teal-orange" // look • film
const ERA = "1920s-flapper" // look • film
const CAMERA_FORMAT = "16mm-film" // look • film
const SHOT_SIZE = "wide-shot" // look • scene
const TIME_OF_DAY = "golden-hour" // look • scene
const CAMERA_MOTION = "handheld" // motion • body
const TRANSITION = "cross-dissolve" // motion • body

const IMAGE = { surface: "image", mode: IMAGE_HINT_MODE_DEFAULT } as const
const VIDEO = { surface: "video", mode: VIDEO_HINT_MODE_DEFAULT } as const

describe("the section header", () => {
  it("is exactly `[style]:`, lowercase", () => {
    expect(STYLE_SECTION_HEADER).toBe("[style]:")
  })
})

describe("FILM_STYLE_KEYS — the film/scene split lives in the registry", () => {
  it("names the five film rows, in table order", () => {
    expect(FILM_STYLE_KEYS).toEqual([
      "cameraFormat",
      "colorLook",
      "style",
      "era",
      "cameraFormatId",
    ])
  })

  it("derives from the table's own `styleGroup` column (no second list)", () => {
    expect(FILM_STYLE_KEYS).toEqual(
      DIRECTION_FIELDS.filter((f) => "styleGroup" in f && f.styleGroup === "film").map(
        (f) => f.key,
      ),
    )
  })

  it("marks only LOOK rows as film (a motion row could never reach the section)", () => {
    for (const spec of DIRECTION_FIELDS) {
      if ("styleGroup" in spec && spec.styleGroup === "film") {
        expect(spec.family, spec.key).toBe("look")
      }
    }
  })
})

describe("partitionStyleClauses — which slot a clause lands in", () => {
  it("sends the MOTION family to the body and the LOOK family to the section", () => {
    const slots = new Map(
      partitionStyleClauses(
        { cameraMotion: CAMERA_MOTION, transition: TRANSITION, style: STYLE, shotSize: SHOT_SIZE },
        VIDEO,
      ).map((c) => [c.text, c.slot]),
    )
    expect(slots.get(getCameraMotionTerm(CAMERA_MOTION))).toBe("body")
    expect(slots.get(getTransitionTerm(TRANSITION))).toBe("body")
    expect(slots.get(getStylePromptHint(STYLE))).toBe("film")
    expect(slots.get(getFramingPromptHint(SHOT_SIZE))).toBe("scene")
  })

  it("leaves the image surface with no body clause at all (no motion row folds there)", () => {
    // The surface filter and the family split are deliberately aligned: every
    // image-surface direction row is `look`, so an image `[style]` section
    // carries the WHOLE direction fold and the body carries none of it.
    expect(directionFieldsForSurface("image").every((f) => f.family === "look")).toBe(true)
    const everyImageKey = Object.fromEntries(
      directionFieldsForSurface("image").map((f) => [f.key, ""]),
    )
    expect(
      partitionStyleClauses({ ...everyImageKey, style: STYLE, shotSize: SHOT_SIZE }, IMAGE).every(
        (c) => c.slot !== "body",
      ),
    ).toBe(true)
  })

  it("keeps registry table order inside each slot", () => {
    const direction = { style: STYLE, colorLook: COLOR_LOOK, shotSize: SHOT_SIZE, timeOfDay: TIME_OF_DAY }
    expect(partitionStyleClauses(direction, IMAGE).map((c) => c.text)).toEqual(
      renderDirectionHints(direction, IMAGE),
    )
  })

  it("returns nothing for an absent, empty or unresolvable direction", () => {
    expect(partitionStyleClauses(undefined, IMAGE)).toEqual([])
    expect(partitionStyleClauses({}, IMAGE)).toEqual([])
    expect(partitionStyleClauses({ style: "__no_such_id__" }, IMAGE)).toEqual([])
  })
})

describe("renderStyleSection — the two lines", () => {
  it("puts the film line first and the scene line second, each `. `-joined", () => {
    expect(
      renderStyleSection(
        {
          cameraFormat: CAMERA_FORMAT,
          colorLook: COLOR_LOOK,
          style: STYLE,
          era: ERA,
          shotSize: SHOT_SIZE,
          timeOfDay: TIME_OF_DAY,
        },
        IMAGE,
      ),
    ).toBe(
      "[style]:\n" +
        [
          getCameraFormatPromptHint(CAMERA_FORMAT),
          getColorLookPromptHint(COLOR_LOOK),
          getStylePromptHint(STYLE),
          getEraPromptHint(ERA),
        ].join(". ") +
        "\n" +
        [getFramingPromptHint(SHOT_SIZE), getLightingPromptHint(TIME_OF_DAY)].join(". "),
    )
  })

  it("omits the film line entirely when no film dimension is selected", () => {
    expect(renderStyleSection({ shotSize: SHOT_SIZE }, IMAGE)).toBe(
      `[style]:\n${getFramingPromptHint(SHOT_SIZE)}`,
    )
  })

  it("omits the scene line entirely when no other look dimension is selected", () => {
    expect(renderStyleSection({ style: STYLE }, IMAGE)).toBe(
      `[style]:\n${getStylePromptHint(STYLE)}`,
    )
  })

  it("renders NOTHING when the fold carries no look clause", () => {
    expect(renderStyleSection(undefined, VIDEO)).toBe("")
    expect(renderStyleSection({}, VIDEO)).toBe("")
    expect(renderStyleSection({ cameraMotion: CAMERA_MOTION, transition: TRANSITION }, VIDEO)).toBe("")
  })

  it("never indents a line and never ends with a newline", () => {
    // The video reference resolver collapses 2+ HORIZONTAL spaces unanchored,
    // so an indented section line would come back flattened — the section is
    // written flush-left instead of relying on the collapse leaving it alone.
    const section = renderStyleSection(
      { style: STYLE, colorLook: COLOR_LOOK, shotSize: SHOT_SIZE },
      IMAGE,
    )
    for (const line of section.split("\n")) expect(line).toBe(line.trimStart())
    expect(section.endsWith("\n")).toBe(false)
    expect(section).not.toMatch(/[^\S\r\n]{2,}/)
  })

  it("agrees with the clause-level renderer the composers use", () => {
    const direction = { style: STYLE, shotSize: SHOT_SIZE }
    expect(renderStyleSection(direction, VIDEO)).toBe(
      styleSectionFromClauses(partitionStyleClauses(direction, VIDEO)),
    )
  })
})

describe("composeSectionedPrompt — body, gap, section", () => {
  const FILM = getStylePromptHint(STYLE)
  const SCENE = getFramingPromptHint(SHOT_SIZE)
  const clauses = [
    { text: "a knight rides", slot: "body" },
    { text: FILM, slot: "film" },
    { text: SCENE, slot: "scene" },
  ] as const

  it("joins body clauses with `. ` and hangs the section off a blank line", () => {
    expect(composeSectionedPrompt("at dusk", clauses, "")).toBe(
      `at dusk. a knight rides\n\n[style]:\n${FILM}\n${SCENE}`,
    )
  })

  it("keeps the structured fragment last IN THE BODY, ahead of the section", () => {
    expect(composeSectionedPrompt("at dusk", clauses, "Subject: a knight.")).toBe(
      `at dusk. a knight rides. Subject: a knight.\n\n[style]:\n${FILM}\n${SCENE}`,
    )
  })

  it("emits NO header and no extra newline when nothing reaches the section", () => {
    // Byte-identical to the plain hint join — this is what keeps every
    // look-free caller (and every fully-shed one) exactly where it was.
    const bodyOnly = [{ text: "a knight rides", slot: "body" }] as const
    expect(composeSectionedPrompt("at dusk", bodyOnly, "")).toBe(
      joinPromptHints("at dusk", ["a knight rides"]),
    )
    expect(composeSectionedPrompt("at dusk", bodyOnly, "")).not.toContain("[style]")
  })

  it("returns the prompt VERBATIM AND UNTRIMMED with no clause and no fragment", () => {
    expect(composeSectionedPrompt("  a knight \n", [], "")).toBe("  a knight \n")
    expect(composeSectionedPrompt(undefined, [], "")).toBeUndefined()
  })

  it("TRIMS the prompt when the section is the only thing folded", () => {
    // The section counts as "something folded", so the body is trimmed exactly
    // as the hint-join branch trims it — otherwise the blank line would inherit
    // the prompt's trailing whitespace.
    expect(composeSectionedPrompt("  a knight \n", [{ text: FILM, slot: "film" }], "")).toBe(
      `a knight\n\n[style]:\n${FILM}`,
    )
  })

  it("drops the gap for a blank or absent prompt (never a leading newline)", () => {
    const only = [{ text: FILM, slot: "film" }] as const
    expect(composeSectionedPrompt("", only, "")).toBe(`[style]:\n${FILM}`)
    expect(composeSectionedPrompt("   ", only, "")).toBe(`[style]:\n${FILM}`)
    expect(composeSectionedPrompt(undefined, only, "")).toBe(`[style]:\n${FILM}`)
  })

  it("never ends the composed prompt with a newline", () => {
    for (const prompt of ["a knight", "", undefined]) {
      expect(composeSectionedPrompt(prompt, clauses, "Subject: a knight.")!.endsWith("\n")).toBe(
        false,
      )
    }
  })

  it("marks every subject clause as body", () => {
    expect(asBodyClauses(["a woman in her 30s", "wearing a red coat"])).toEqual([
      { text: "a woman in her 30s", slot: "body" },
      { text: "wearing a red coat", slot: "body" },
    ])
  })
})

describe("sectionedClauseCosts — what each clause really costs", () => {
  const clauses = [
    { text: "a knight rides", slot: "body" },
    { text: getStylePromptHint(STYLE), slot: "film" },
    { text: getFramingPromptHint(SHOT_SIZE), slot: "scene" },
  ] as const

  it("is the exact composed-length delta of each clause, tail-first", () => {
    const costs = sectionedClauseCosts("at dusk", clauses, "")
    expect(costs).toHaveLength(clauses.length)
    for (let kept = 0; kept < clauses.length; kept++) {
      const below = composeSectionedPrompt("at dusk", clauses.slice(0, kept), "")?.length ?? 0
      const at = composeSectionedPrompt("at dusk", clauses.slice(0, kept + 1), "")?.length ?? 0
      expect(costs[kept]).toBe(at - below)
    }
  })

  it("charges the LAST surviving look clause for the header it keeps alive", () => {
    // "\n\n[style]:\n" is 11 characters that only come back when the section
    // disappears entirely — so the first look clause carries them, and a shed
    // that drops it reclaims more than the clause's own text.
    const costs = sectionedClauseCosts("at dusk", clauses, "")
    expect(costs[1]).toBe(getStylePromptHint(STYLE).length + "\n\n[style]:\n".length)
    // The second look clause only brings its own line separator.
    expect(costs[2]).toBe(getFramingPromptHint(SHOT_SIZE).length + "\n".length)
    // A body clause brings the ". " it was joined with.
    expect(costs[0]).toBe("a knight rides".length + ". ".length)
  })
})

describe("the section boundary — what a later assembler may append", () => {
  const FILM = getStylePromptHint(STYLE)
  const clauses = [{ text: FILM, slot: "film" }] as const
  const composed = composeSectionedPrompt("a knight", clauses, "")!
  const bodyless = composeSectionedPrompt("", clauses, "")!

  it("splits a composed prompt into its body and its section", () => {
    expect(splitStyleSection(composed)).toEqual({ body: "a knight", section: `[style]:\n${FILM}` })
  })

  it("splits the body-less form, where the section IS the prompt", () => {
    expect(splitStyleSection(bodyless)).toEqual({ body: "", section: `[style]:\n${FILM}` })
  })

  it("reports no section for a prompt that carries none", () => {
    expect(splitStyleSection("a knight")).toEqual({ body: "a knight", section: "" })
  })

  it("inserts body lines AHEAD of the section, keeping the look clauses last", () => {
    expect(insertBeforeStyleSection(composed, ["the person from reference image A"])).toBe(
      `a knight\nthe person from reference image A\n\n[style]:\n${FILM}`,
    )
    expect(insertBeforeStyleSection(bodyless, ["the person from reference image A"])).toBe(
      `the person from reference image A\n\n[style]:\n${FILM}`,
    )
  })

  it("is the plain `\\n` join with no section — the byte-parity path", () => {
    // What every appender emitted before the section existed, including the
    // leading newline an empty prompt produces. Anything else would move bytes
    // on the look-free runs, which are most of them.
    expect(insertBeforeStyleSection("a knight", ["a", "b"])).toBe("a knight\na\nb")
    expect(insertBeforeStyleSection("", ["a"])).toBe("\na")
  })

  it("is a no-op with no lines to add", () => {
    expect(insertBeforeStyleSection(composed, [])).toBe(composed)
  })

  it("knows when a prompt ends INSIDE the section", () => {
    expect(endsInsideStyleSection(composed)).toBe(true)
    expect(endsInsideStyleSection(bodyless)).toBe(true)
    // A blank line closes the header's scope, and the next appender sees it.
    expect(endsInsideStyleSection(`${composed}\n\nStyle: cinematic`)).toBe(false)
    expect(endsInsideStyleSection("a knight")).toBe(false)
    expect(endsInsideStyleSection("")).toBe(false)
  })
})
