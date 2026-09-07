import { describe, it, expect } from "vitest"
import {
  composeCharacterFxHintFromConnections,
  getCharacterFxPromptHint,
  getCharacterFxTerm,
  type PickerDimension,
} from "@nodaro/prompts"

import { VIDEO_HINT_MODE } from "../direction"
import {
  CHARACTER_FX_DIMENSION,
  characterFxClause,
  characterFxDimensions,
  characterFxIsSet,
  characterFxLabel,
  characterFxLevers,
  effectToken,
  hasEffectToken,
  parseEffectTokens,
  characterFxAfterEdit,
  resolveEffectTokens,
  stripEffectTokens,
} from "../character-fx"
import { characterFxPicker } from "../look-pickers"

/**
 * The three timing scales as the platform's catalog will publish them
 * (`getPickerCatalog("character-fx").dimensions`, from
 * `feat/character-fx-timing-catalogs`). Fabricated here so the lever logic is
 * testable BEFORE that version is bumped in — the ids are the ones the
 * installed builder already composes clauses for.
 */
const FAKE_DIMS: ReadonlyArray<PickerDimension> = [
  {
    field: "position",
    label: "Position",
    options: [
      { id: "auto", label: "Auto", promptHint: "", term: "" },
      { id: "start", label: "Start", promptHint: "the effect occurs at the opening of the clip", term: "at the start" },
      { id: "end", label: "End", promptHint: "the effect occurs at the close of the clip", term: "at the end" },
    ],
  },
  {
    field: "duration",
    label: "Duration",
    options: [
      { id: "auto", label: "Auto", promptHint: "", term: "" },
      { id: "short", label: "Short (~1s)", promptHint: "manifesting over approximately 1 second", term: "brief" },
    ],
  },
  {
    field: "intensity",
    label: "Intensity",
    options: [
      { id: "auto", label: "Auto", promptHint: "", term: "" },
      { id: "crazy", label: "Crazy", promptHint: "with extreme exaggerated energy", term: "extreme" },
    ],
  },
]

describe("character FX — the node's own predicates", () => {
  it("is SET only by an effect that injects something (the catalog's own auto/none rows are unset)", () => {
    expect(characterFxIsSet(undefined)).toBe(false)
    expect(characterFxIsSet({})).toBe(false)
    expect(characterFxIsSet({ id: "auto" })).toBe(false)
    expect(characterFxIsSet({ id: "none" })).toBe(false)
    expect(characterFxIsSet({ id: "werewolf" })).toBe(true)
  })

  it("labels the chosen effect, and Auto when nothing is chosen", () => {
    expect(characterFxLabel({ id: "werewolf" })).toBe("Werewolf")
    expect(characterFxLabel(undefined)).toBe("Auto")
    expect(characterFxLabel({ id: "auto" })).toBe("Auto")
  })

  it("is a derived picker over the platform catalog, outside LOOK_PICKERS", () => {
    const p = characterFxPicker()
    expect(p.key).toBe(CHARACTER_FX_DIMENSION)
    expect(p.catalog.some((e) => e.id === "werewolf")).toBe(true)
    expect(p.getLabel("werewolf")).toBe("Werewolf")
    expect(p.getTerm("werewolf")).toBe(getCharacterFxTerm("werewolf"))
    expect(p.getHint("werewolf")).toBe(getCharacterFxPromptHint("werewolf"))
    expect(p.categories?.order).toContain("transformation")
  })
})

describe("character FX — the timing scales are catalog DIMENSIONS, feature-detected", () => {
  it("reads whatever the installed catalog publishes — an array, possibly empty", () => {
    expect(Array.isArray(characterFxDimensions())).toBe(true)
  })

  it("every published lever id composes a real clause (the builder and the scales ship together)", () => {
    // Trivial while the installed package publishes no dimensions; the moment
    // a bump brings them, this is what catches a scale id the builder can't
    // index — which would otherwise reach the model as "undefined".
    for (const dim of characterFxDimensions()) {
      for (const o of dim.options) {
        const composed = composeCharacterFxHintFromConnections(
          "werewolf",
          [],
          { [dim.field]: o.id },
          "compact",
        )
        expect(composed, `${dim.field}/${o.id}`).not.toContain("undefined")
      }
    }
  })

  it("keeps only the levers the scales know — auto and unknown ids are unset", () => {
    expect(
      characterFxLevers({ id: "werewolf", position: "start", duration: "auto", intensity: "later" }, FAKE_DIMS),
    ).toEqual({ position: "start" })
    // No scales published (today's installed package): no lever folds at all.
    expect(characterFxLevers({ id: "werewolf", position: "start" }, [])).toEqual({})
  })
})

describe("character FX — the clause the window folds", () => {
  it("is the platform's own composition: the effect's term under the video policy, its hint in full", () => {
    expect(characterFxClause({ id: "werewolf" }, VIDEO_HINT_MODE, FAKE_DIMS)).toBe(
      getCharacterFxTerm("werewolf"),
    )
    expect(characterFxClause({ id: "werewolf" }, "full", FAKE_DIMS)).toBe(
      getCharacterFxPromptHint("werewolf"),
    )
  })

  it("appends the timing clauses for the levers that are set, byte-identical to the canvas", () => {
    const fx = { id: "werewolf", position: "start", duration: "short", intensity: "crazy" }
    expect(characterFxClause(fx, VIDEO_HINT_MODE, FAKE_DIMS)).toBe(
      composeCharacterFxHintFromConnections(
        "werewolf",
        [],
        { position: "start", duration: "short", intensity: "crazy" },
        "compact",
      ),
    )
  })

  it("folds NOTHING for an unset node, or for levers without an effect", () => {
    expect(characterFxClause(undefined, VIDEO_HINT_MODE, FAKE_DIMS)).toBe("")
    expect(characterFxClause({ id: "auto", position: "start" }, VIDEO_HINT_MODE, FAKE_DIMS)).toBe("")
    expect(characterFxClause({ position: "start" }, VIDEO_HINT_MODE, FAKE_DIMS)).toBe("")
  })

  it("a lever the installed scales don't publish is left out — never an 'undefined' in the prompt", () => {
    expect(
      characterFxClause({ id: "werewolf", position: "start" }, VIDEO_HINT_MODE, []),
    ).toBe(getCharacterFxTerm("werewolf"))
  })
})

describe("the effect token — an effect chip's place in the prose", () => {
  it("is the neutral `[fx:<id>]`, strict enough never to eat a user's own brackets", () => {
    expect(effectToken("face-crack")).toBe("[fx:face-crack]")
    expect(parseEffectTokens("falls, [fx:face-crack] and [fx:werewolf]")).toEqual([
      "face-crack",
      "werewolf",
    ])
    expect(parseEffectTokens("a [whisper] and [fx:Not An Id] and [fx]")).toEqual([])
    expect(hasEffectToken("she [fx:werewolf] turns")).toBe(true)
    expect(hasEffectToken("she turns")).toBe(false)
  })

  it("resolves each token IN PLACE to the platform's composition — the effect where it happens", () => {
    const term = getCharacterFxTerm("werewolf")
    expect(
      resolveEffectTokens("Woman 6 loses her footing and falls, [fx:werewolf]", VIDEO_HINT_MODE),
    ).toBe(`Woman 6 loses her footing and falls, ${term}`)
    expect(resolveEffectTokens("[fx:werewolf] then she runs", VIDEO_HINT_MODE)).toBe(
      `${term} then she runs`,
    )
  })

  it("carries the node's levers when the token is the node's effect", () => {
    const fx = { id: "werewolf", position: "start" }
    expect(resolveEffectTokens("falls, [fx:werewolf]", VIDEO_HINT_MODE, fx, FAKE_DIMS)).toBe(
      `falls, ${characterFxClause(fx, VIDEO_HINT_MODE, FAKE_DIMS)}`,
    )
    // A token for a DIFFERENT effect than the node's folds bare — the levers
    // tune the node's effect, not whatever the text names.
    expect(resolveEffectTokens("falls, [fx:none-such]", VIDEO_HINT_MODE, fx, FAKE_DIMS)).toBe(
      "falls,",
    )
  })

  it("an unknown or no-op effect vanishes cleanly, leaving no double space", () => {
    expect(resolveEffectTokens("she [fx:auto] turns", VIDEO_HINT_MODE)).toBe("she turns")
    expect(resolveEffectTokens("she turns [fx:nope]", VIDEO_HINT_MODE)).toBe("she turns")
    expect(resolveEffectTokens("no tokens here", VIDEO_HINT_MODE)).toBe("no tokens here")
  })

  it("strips tokens for a surface that can't carry an effect (the Framing mirror)", () => {
    expect(stripEffectTokens("she [fx:werewolf] turns, [fx:face-crack]")).toBe("she turns,")
    expect(stripEffectTokens("a [whisper] stays")).toBe("a [whisper] stays")
  })
})

describe("the chip is the node's id (characterFxAfterEdit)", () => {
  const node = { id: "werewolf", position: "start" }
  it("a chip in the text sets the id and keeps the levers; a swap swaps it", () => {
    expect(characterFxAfterEdit({ text: "a [fx:werewolf]", characterFx: node }, "werewolf")).toEqual(node)
    expect(characterFxAfterEdit({ text: "a [fx:werewolf]", characterFx: node }, "face-crack")).toEqual({
      id: "face-crack",
      position: "start",
    })
    expect(characterFxAfterEdit({ text: "a" }, "werewolf")).toEqual({ id: "werewolf" })
  })
  it("a text that just lost its chip clears the node; a chip-less node survives typing", () => {
    expect(characterFxAfterEdit({ text: "a [fx:werewolf]", characterFx: node }, undefined)).toBeUndefined()
    expect(characterFxAfterEdit({ text: "a", characterFx: node }, undefined)).toEqual(node)
    expect(characterFxAfterEdit({ text: "a" }, undefined)).toBeUndefined()
  })
})
