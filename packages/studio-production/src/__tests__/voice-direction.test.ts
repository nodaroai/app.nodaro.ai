import { describe, it, expect } from "vitest"

import {
  DIRECTION_BRACKET_RUN,
  VOICE_DIRECTION_SECTIONS,
  beatsOwnDirection,
  isVoiceDirectionKind,
  voiceDirectionKindsFor,
  neutralDirectionText,
  renderVoiceDirection,
  renderDirectionsIntoPrompt,
  restoreClipDirections,
  stripDirectionTokens,
  readVoiceDirections,
  unplacedDirectionTokens,
  withDirectionTokens,
  type VoiceDirection,
} from "../voice-direction"

/**
 * The model-aware voice-direction layer: semantic chips ({kind, text}) render
 * into EACH VIDEO MODEL'S official audio syntax at submit. Load-bearing
 * invariants: kind availability derives from the platform's
 * `getVideoAudioCapability` (SSOT — never a hardcoded model list); the
 * neutral in-editor form is `[text]`; per-family renderers emit the OFFICIAL
 * syntax (Seedance 2 `<sfx>`/`（music）`, VEO `SFX:`/`Ambient noise:` labels,
 * ambient models a generic `Audio:` clause); silent models drop directions
 * with an explicit `dropped` list (never silently).
 */

const d = (kind: VoiceDirection["kind"], text: string): VoiceDirection => ({ kind, text })

/** The file's AMBIENT provider fixture — sound layers but no speech/tone. */
const AMBIENT_PROVIDER = "seedance"

describe("voiceDirectionKindsFor (capability-derived)", () => {
  it("native-speech models (VEO) offer every kind incl. tone", () => {
    expect(voiceDirectionKindsFor("veo3")).toEqual([
      "speech",
      "tone",
      "sfx",
      "ambience",
      "music",
    ])
    expect(voiceDirectionKindsFor("veo3.1")).toContain("tone")
  })

  it("audio-driven models (Seedance 2) offer every kind incl. tone", () => {
    expect(voiceDirectionKindsFor("seedance-2")).toContain("tone")
    expect(voiceDirectionKindsFor("seedance-2-fast")).toContain("sfx")
  })

  it("native-speech Kling (shared@1.11.0 upgrade) offers every kind incl. tone", () => {
    // The capability-map bump alone lights tone up — no studio gating change.
    expect(voiceDirectionKindsFor("kling-3.0")).toEqual([
      "speech",
      "tone",
      "sfx",
      "ambience",
      "music",
    ])
    expect(voiceDirectionKindsFor("kling")).toContain("tone")
  })

  it("ambient-only models (Seedance 1.x) offer sfx/ambience/music but NOT tone", () => {
    const kinds = voiceDirectionKindsFor("seedance")
    expect(kinds).toEqual(["sfx", "ambience", "music"])
  })

  it("silent models offer nothing", () => {
    expect(voiceDirectionKindsFor("wan-turbo")).toEqual([])
    expect(voiceDirectionKindsFor("minimax")).toEqual([])
    expect(voiceDirectionKindsFor(undefined)).toEqual([])
  })
})

describe("catalog sections", () => {
  it("has one section per kind with non-empty presets, except speech (a line is never a preset)", () => {
    expect(VOICE_DIRECTION_SECTIONS.map((s) => s.kind)).toEqual([
      "speech",
      "tone",
      "sfx",
      "ambience",
      "music",
    ])
    for (const section of VOICE_DIRECTION_SECTIONS) {
      if (section.kind === "speech") {
        expect(section.presets.length).toBe(0)
        continue
      }
      expect(section.presets.length).toBeGreaterThan(3)
    }
  })
})

describe("neutralDirectionText", () => {
  it("is the bracketed semantic text (the in-editor / persisted form)", () => {
    expect(neutralDirectionText(d("sfx", "door creaks"))).toBe("[door creaks]")
  })
})

describe("DIRECTION_BRACKET_RUN (B2 — one bracket grammar, shared with warnOrphanRuns)", () => {
  it("matches the exact token neutralDirectionText writes, for every kind", () => {
    for (const section of VOICE_DIRECTION_SECTIONS) {
      const token = neutralDirectionText(d(section.kind, "sample text"))
      const matches = [...token.matchAll(DIRECTION_BRACKET_RUN)]
      expect(matches).toHaveLength(1)
      expect(matches[0][0]).toBe(token)
      expect(matches[0][1]).toBe("sample text")
    }
  })
})

describe("renderVoiceDirection (per model family)", () => {
  it("Seedance 2 uses the official symbols: <sfx> and （music）", () => {
    expect(renderVoiceDirection(d("sfx", "door creaks"), "seedance-2")).toBe("<door creaks>")
    expect(renderVoiceDirection(d("ambience", "heavy rain"), "seedance-2-fast")).toBe(
      "<heavy rain>",
    )
    expect(renderVoiceDirection(d("music", "slow jazz piano"), "seedance-2")).toBe(
      "（slow jazz piano）",
    )
    expect(renderVoiceDirection(d("tone", "whispering"), "seedance-2")).toBe(
      "spoken in a whispering tone",
    )
  })

  it("VEO uses the official prompt labels", () => {
    expect(renderVoiceDirection(d("sfx", "thunder cracks"), "veo3")).toBe(
      "SFX: thunder cracks.",
    )
    expect(renderVoiceDirection(d("ambience", "quiet room tone"), "veo3.1")).toBe(
      "Ambient noise: quiet room tone.",
    )
    expect(renderVoiceDirection(d("music", "tense strings"), "veo3")).toBe(
      "Music: tense strings.",
    )
    expect(renderVoiceDirection(d("tone", "urgent"), "veo3")).toBe(
      "(spoken in an urgent tone)",
    )
  })

  it("Kling (native speech since 1.11.0) gets the Audio clause AND tone prose", () => {
    expect(renderVoiceDirection(d("sfx", "glass breaking"), "kling-3.0")).toBe(
      "Audio: glass breaking.",
    )
    expect(renderVoiceDirection(d("music", "soft piano"), "kling")).toBe(
      "Audio: background music, soft piano.",
    )
    expect(renderVoiceDirection(d("tone", "whispering"), "kling-3.0")).toBe(
      "spoken in a whispering tone",
    )
  })

  it("ambient-only models (Seedance 1.x) get the Audio clause; tone is null", () => {
    expect(renderVoiceDirection(d("sfx", "glass breaking"), "seedance")).toBe(
      "Audio: glass breaking.",
    )
    expect(renderVoiceDirection(d("tone", "whispering"), "seedance")).toBeNull()
  })

  it("silent models render nothing", () => {
    expect(renderVoiceDirection(d("sfx", "door creaks"), "wan-turbo")).toBeNull()
    expect(renderVoiceDirection(d("music", "soft piano"), "minimax")).toBeNull()
  })
})

describe("renderDirectionsIntoPrompt", () => {
  it("replaces each neutral [text] in place with the model rendering", () => {
    const out = renderDirectionsIntoPrompt(
      "She opens the door [door creaks] and freezes. [tense strings]",
      [d("sfx", "door creaks"), d("music", "tense strings")],
      "seedance-2",
    )
    expect(out.prompt).toBe(
      "She opens the door <door creaks> and freezes. （tense strings）",
    )
    expect(out.dropped).toEqual([])
  })

  it("drops unsupported directions (removes the token, reports them)", () => {
    // Seedance 1.x is ambient-only — tone drops; the ambience still renders.
    const out = renderDirectionsIntoPrompt(
      "She whispers [whispering] as rain falls [heavy rain]",
      [d("tone", "whispering"), d("ambience", "heavy rain")],
      "seedance",
    )
    expect(out.prompt).toBe("She whispers as rain falls Audio: ambient heavy rain.")
    expect(out.dropped).toEqual([d("tone", "whispering")])
  })

  it("drops everything on a silent model and cleans the whitespace", () => {
    const out = renderDirectionsIntoPrompt(
      "A quiet scene [door creaks] at dusk",
      [d("sfx", "door creaks")],
      "wan-turbo",
    )
    expect(out.prompt).toBe("A quiet scene at dusk")
    expect(out.dropped).toHaveLength(1)
  })

  it("renders each direction at ITS OWN token, whatever order the list is in", () => {
    // The reviewer's case: `audio: [wind, drums]` against prose that says
    // `[drums]` first. A cursor walk renders `[wind]` and skips `[drums]`,
    // leaking the author's brackets to the model; positions do not.
    const out = renderDirectionsIntoPrompt(
      "she runs [drums] and stops [wind]",
      [d("sfx", "wind"), d("music", "drums")],
      "seedance-2",
    )
    expect(out.prompt).toBe("she runs （drums） and stops <wind>")
    expect(out.dropped).toEqual([])
  })

  it("handles duplicate identical chips left-to-right", () => {
    const out = renderDirectionsIntoPrompt(
      "[applause] then again [applause]",
      [d("sfx", "applause"), d("sfx", "applause")],
      "veo3",
    )
    expect(out.prompt).toBe("SFX: applause. then again SFX: applause.")
  })

  it("gives two equal cues the first two occurrences, and a third one nothing", () => {
    // Equal cues consume successive occurrences in order (the placer's rule),
    // so the third has nothing left — rendered by neither function.
    const wind = d("sfx", "wind")
    const twice = renderDirectionsIntoPrompt("[wind] a [wind] b", [wind, wind], "veo3")
    expect(twice.prompt).toBe("SFX: wind. a SFX: wind. b")
    expect(unplacedDirectionTokens("[wind] a [wind] b", [wind, wind, wind])).toEqual([
      "[wind]",
    ])
    const thrice = renderDirectionsIntoPrompt(
      "[wind] a [wind] b",
      [wind, wind, wind],
      "veo3",
    )
    expect(thrice.prompt).toBe("SFX: wind. a SFX: wind. b")
  })

  it("returns the prompt untouched when there are no directions", () => {
    const out = renderDirectionsIntoPrompt("Just prose.", [], "veo3")
    expect(out.prompt).toBe("Just prose.")
    expect(out.dropped).toEqual([])
  })

  it("leaves the prompt BYTE-IDENTICAL when no token matched (no stealth tidy)", () => {
    // Authored whitespace quirks must survive a chip-less submit — tidying is
    // cleanup for replacement seams only, never an unconditional rewrite.
    const quirky = "wait ...  what\n  really"
    expect(renderDirectionsIntoPrompt(quirky, [], "veo3").prompt).toBe(quirky)
    expect(
      renderDirectionsIntoPrompt(quirky, [d("sfx", "absent token")], "veo3").prompt,
    ).toBe(quirky)
  })
})

describe("stripDirectionTokens (the Directing→Framing mirror)", () => {
  it("removes every token so audio cues never reach an image prompt", () => {
    const out = stripDirectionTokens(
      "She opens the door [door creaks] and gasps [tense strings]",
      [
        { kind: "sfx", text: "door creaks" },
        { kind: "music", text: "tense strings" },
      ],
    )
    expect(out).toBe("She opens the door and gasps")
  })

  it("is a no-op without direction chips", () => {
    expect(stripDirectionTokens("plain prose", [])).toBe("plain prose")
  })
})

describe("restoreClipDirections (legacy `[token]` recovery)", () => {
  it("returns the persisted list untouched when the result carries one", () => {
    const persisted = [d("sfx", "boom")]
    expect(
      restoreClipDirections({ prompt: "[forest birds]", directions: persisted }),
    ).toBe(persisted)
  })

  it("recovers a catalog-preset token (with its kind) from a legacy prompt", () => {
    expect(
      restoreClipDirections({ prompt: "riverbank at dawn [forest birds] Iris walks" }),
    ).toEqual([{ kind: "ambience", text: "forest birds" }])
  })

  it("recovers multiple presets in prompt order, across kinds", () => {
    expect(
      restoreClipDirections({
        prompt: "[door creaks] she runs [soft piano] fade",
      }),
    ).toEqual([
      { kind: "sfx", text: "door creaks" },
      { kind: "music", text: "soft piano" },
    ])
  })

  it("matches presets case-insensitively but keeps the token text VERBATIM", () => {
    // The neutral form `[${text}]` must reproduce the prompt's exact span or
    // buildPromptDoc can't consume it back into a chip.
    expect(restoreClipDirections({ prompt: "[Forest Birds] chirp" })).toEqual([
      { kind: "ambience", text: "Forest Birds" },
    ])
  })

  it("recovers duplicate tokens once per occurrence (buildPromptDoc consumes in order)", () => {
    expect(
      restoreClipDirections({ prompt: "[footsteps] pause [footsteps]" }),
    ).toEqual([
      { kind: "sfx", text: "footsteps" },
      { kind: "sfx", text: "footsteps" },
    ])
  })

  it("does NOT guess free-text tokens (their kind is unrecoverable)", () => {
    expect(
      restoreClipDirections({ prompt: "[flying whales sing] over the sea" }),
    ).toBeUndefined()
  })

  it("returns undefined for a bracket-less or absent prompt", () => {
    expect(restoreClipDirections({ prompt: "plain prose" })).toBeUndefined()
    expect(restoreClipDirections({})).toBeUndefined()
  })
})

describe("speech directions (plan-import-v2 D4)", () => {
  const line = { kind: "speech", text: "We made it.", speaker: "Anna", voice: "warm calm voice" } as const
  it("speech-capable models list speech FIRST; ambient and silent models never offer it", () => {
    expect(voiceDirectionKindsFor("seedance-2-5")).toEqual(["speech", "tone", "sfx", "ambience", "music"])
    expect(voiceDirectionKindsFor("veo3.1")[0]).toBe("speech")
    expect(voiceDirectionKindsFor(AMBIENT_PROVIDER)).toEqual(["sfx", "ambience", "music"])
    expect(voiceDirectionKindsFor("wan-turbo")).toEqual([])
  })
  it("Kling gets the bracketed casting form", () => {
    expect(renderVoiceDirection(line, "kling-3.0")).toBe('[Anna: warm calm voice]: "We made it."')
    expect(renderVoiceDirection({ kind: "speech", text: "Run!" }, "kling-3.0")).toBe('[A voice: natural voice]: "Run!"')
  })
  it("VEO gets Google's attribution formula", () => {
    expect(renderVoiceDirection(line, "veo3.1")).toBe('Anna (warm calm voice) says, "We made it."')
  })
  it("every other speech-capable model gets quoted dialogue inline", () => {
    expect(renderVoiceDirection(line, "seedance-2-5")).toBe('Anna (warm calm voice) says: "We made it."')
    expect(renderVoiceDirection({ kind: "speech", text: "Run!" }, "seedance-2-5")).toBe('A voice says: "Run!"')
  })
  it("drops on ambient and silent models", () => {
    expect(renderVoiceDirection(line, AMBIENT_PROVIDER)).toBeNull()
    expect(renderVoiceDirection(line, "minimax")).toBeNull()
  })
})

describe("isVoiceDirectionKind (the one kind vocabulary)", () => {
  it("accepts exactly the catalog's kinds and nothing else", () => {
    for (const section of VOICE_DIRECTION_SECTIONS) {
      expect(isVoiceDirectionKind(section.kind)).toBe(true)
    }
    expect(isVoiceDirectionKind("growl")).toBe(false)
    expect(isVoiceDirectionKind(undefined)).toBe(false)
    expect(isVoiceDirectionKind(null)).toBe(false)
    expect(isVoiceDirectionKind(2)).toBe(false)
  })
})

describe("readVoiceDirections (the one persisted-blob reader)", () => {
  it("keeps speech with its two strings, drops unknown kinds and blank text", () => {
    expect(
      readVoiceDirections([
        { kind: "speech", text: "Run!", speaker: "Anna", voice: " urgent " },
        { kind: "sfx", text: "wind", speaker: "ignored" },
        { kind: "shout", text: "x" },
        { kind: "music", text: "  " },
      ]),
    ).toEqual([
      { kind: "speech", text: "Run!", speaker: "Anna", voice: "urgent" },
      { kind: "sfx", text: "wind" },
    ])
    expect(readVoiceDirections([])).toBeUndefined()
    expect(readVoiceDirections("nope")).toBeUndefined()
  })
})

describe("beatsOwnDirection (a scene cue a SHOT already carries)", () => {
  /** A beat as the helper sees it — prose plus, sometimes, its own chips. */
  const beat = (text: string, directions?: ReadonlyArray<VoiceDirection>) => ({
    text,
    ...(directions ? { directions } : {}),
  })
  const drums = d("music", "drums")

  it("is true only when a beat OWNS an equal cue — the prose is not consulted", () => {
    expect(beatsOwnDirection([beat("she runs [drums]", [drums])], drums)).toBe(true)
    // The token with no chip behind it: a split made before shots owned their
    // cues, or a paste. The SCENE's entry is the only one that can render it.
    expect(beatsOwnDirection([beat("she runs [drums]")], drums)).toBe(false)
    expect(beatsOwnDirection([beat("she runs")], drums)).toBe(false)
    expect(beatsOwnDirection([], drums)).toBe(false)
  })

  it("compares kind AND text — `[wind]` as sfx is not `[wind]` as music", () => {
    expect(beatsOwnDirection([beat("x", [d("sfx", "wind")])], d("music", "wind"))).toBe(
      false,
    )
    expect(beatsOwnDirection([beat("x", [d("sfx", "wind")])], d("sfx", "wind"))).toBe(true)
    // The speech fields do not participate: the cue is the LINE.
    expect(
      beatsOwnDirection(
        [beat("x", [{ kind: "speech", text: "Run!", speaker: "Anna" }])],
        { kind: "speech", text: "Run!" },
      ),
    ).toBe(true)
  })
})

describe("token placement (D6 — the importer places tokens)", () => {
  const wind = { kind: "sfx", text: "wind" } as const
  const drum = { kind: "music", text: "drum" } as const
  it("lists a token with no unclaimed occurrence left as unplaced — position claims it, not a left-to-right scan", () => {
    expect(unplacedDirectionTokens("she runs [wind]", [wind, drum])).toEqual(["[drum]"])
    expect(unplacedDirectionTokens("[wind] [wind]", [wind, wind, wind])).toEqual(["[wind]"])
  })
  it("appends missing tokens at the end and leaves complete prose byte-identical", () => {
    expect(withDirectionTokens("she runs", [wind, drum])).toBe("she runs [wind] [drum]")
    expect(withDirectionTokens("she runs [wind]", [wind])).toBe("she runs [wind]")
    expect(withDirectionTokens("", [wind])).toBe("[wind]")
  })

  it("matches a token by its own position, whatever order the list is in", () => {
    // The author's inline placement is the intent — a plan whose `audio[]` is
    // ordered differently (or a repair that PREPENDS the scene's cues onto the
    // first shot) must not make the importer append a token the prose already
    // carries, and the renderer would then leak the authored one as literal
    // brackets with no toast.
    const drums = { kind: "music", text: "drums" } as const
    expect(
      unplacedDirectionTokens("she runs [drums] and stops [wind]", [wind, drums]),
    ).toEqual([])
    expect(withDirectionTokens("she runs [wind] [drums]", [drums, wind])).toBe(
      "she runs [wind] [drums]",
    )
  })
})
