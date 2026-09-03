import { describe, it, expect } from "vitest"
import {
  windowAnalysisSchema, videoAnalysisResultSchema,
  deriveSlotRefs, rewriteSlotTokens, unwrapUnresolvedTokens,
  renderAnalyzedScene, isOversizedScene, aspectRatioFromDims,
  entitySlotSchema, analyzedSceneSchema,
  rewriteSceneBindings, dropUnknownBindings,
  rewriteSpeakerSlots, dropUnknownSpeakers, mergeClipLook,
  VIDEO_ANALYSIS_SPEED_EFFECTS, VIDEO_ANALYSIS_SHOT_ANGLES, VIDEO_ANALYSIS_FACELESS_ANGLES,
  VIDEO_ANALYSIS_VISUAL_EFFECTS, VIDEO_ANALYSIS_TRANSITIONS,
  VIDEO_ANALYSIS_MAX_VARIATIONS, VIDEO_ANALYSIS_VARIATION_SLUGS, VIDEO_ANALYSIS_DEFAULT_VARIATION,
  VIDEO_ANALYSIS_AUDIO_MODES,
  type EntitySlot, type AudioLayer,
} from "../video-analysis.js"

const slot: EntitySlot = { slotId: "hero", label: "Protagonist", source: "wired-character", role: "person", description: "tan man, mustache, black tee" }
const baseScene = { startSec: 0, endSec: 4, label: "Hook", shotType: "Medium Close-Up", camera: "slow push-in", visual: "{slot:hero} juggles a ball", audio: [{ mode: "speech" as const, content: "As a kid…", voice: "male, warm" }] }

describe("windowAnalysisSchema", () => {
  it("accepts a zero-scene window (quiet footage is a VALID result)", () => {
    expect(windowAnalysisSchema.safeParse({ slots: [], scenes: [] }).success).toBe(true)
  })
  it("rejects endSec <= startSec", () => {
    expect(windowAnalysisSchema.safeParse({ slots: [slot], scenes: [{ ...baseScene, endSec: 0 }] }).success).toBe(false)
  })
  it("does NOT accept model-emitted oversized/slotRefs (validator-computed)", () => {
    const parsed = windowAnalysisSchema.parse({ slots: [slot], scenes: [{ ...baseScene, oversized: true, slotRefs: ["hero"] }] })
    expect((parsed.scenes[0] as Record<string, unknown>).oversized).toBeUndefined()
    expect((parsed.scenes[0] as Record<string, unknown>).slotRefs).toBeUndefined()
  })
})

describe("videoAnalysisResultSchema", () => {
  it("requires >=1 scene overall", () => {
    const meta = { durationSec: 10, width: 1920, height: 1080, aspectRatio: "16:9" }
    expect(videoAnalysisResultSchema.safeParse({ meta, slots: [], scenes: [] }).success).toBe(false)
  })
})

describe("token helpers", () => {
  it("deriveSlotRefs reads tokens from visual", () => {
    expect(deriveSlotRefs("{slot:hero} kicks; {slot:product-can} glints; {slot:hero} smiles")).toEqual(["hero", "product-can"])
  })
  it("rewriteSlotTokens renames losers to survivors", () => {
    expect(rewriteSlotTokens("{slot:man-2} runs", { "man-2": "hero" })).toBe("{slot:hero} runs")
  })
  it("unwrapUnresolvedTokens unwraps to literal text, never deletes", () => {
    const r = unwrapUnresolvedTokens("{slot:ghost} appears near {slot:hero}", new Set(["hero"]))
    expect(r.text).toBe("ghost appears near {slot:hero}")
    expect(r.unresolved).toEqual(["ghost"])
  })
  it("renderAnalyzedScene substitutes descriptions (uncast) and castMap bindings (cast)", () => {
    expect(renderAnalyzedScene({ visual: "{slot:hero} runs" }, [slot])).toBe("tan man, mustache, black tee runs")
    expect(renderAnalyzedScene({ visual: "{slot:hero} runs" }, [slot], { hero: "the person from @image_1" })).toBe("the person from @image_1 runs")
  })
})

const dreamVariation = {
  variationId: "dream",
  label: "Dream self",
  description: "tan man, mustache — flowing white robe, barefoot, hair loose (dream sequences)",
  refImageUrl: "https://cdn.example/frames/hero-dream.jpg",
}

describe("appearance variations (cast-variations spec §4)", () => {
  it("entitySlotSchema round-trips variations[] including refImageUrl", () => {
    const parsed = entitySlotSchema.parse({ ...slot, variations: [dreamVariation] })
    expect(parsed.variations).toEqual([dreamVariation])
  })
  it("absent variations stays absent (no [] materialization)", () => {
    const parsed = entitySlotSchema.parse(slot)
    expect("variations" in parsed && parsed.variations !== undefined).toBe(false)
  })
  it(`rejects more than VIDEO_ANALYSIS_MAX_VARIATIONS (${4}) — window layer rejects, merge folds`, () => {
    expect(VIDEO_ANALYSIS_MAX_VARIATIONS).toBe(4)
    const five = ["dream", "flashback", "disguise", "era", "alt-1"].map((id) => ({ ...dreamVariation, variationId: id }))
    expect(entitySlotSchema.safeParse({ ...slot, variations: five }).success).toBe(false)
  })
  it("rejects the reserved 'default' variationId inside variations[] (D9)", () => {
    expect(VIDEO_ANALYSIS_DEFAULT_VARIATION).toBe("default")
    expect(entitySlotSchema.safeParse({ ...slot, variations: [{ ...dreamVariation, variationId: "default" }] }).success).toBe(false)
  })
  it("rejects a malformed variationId (slug charset only; vocabulary is doctrine-enforced)", () => {
    expect(entitySlotSchema.safeParse({ ...slot, variations: [{ ...dreamVariation, variationId: "Dream Look" }] }).success).toBe(false)
    expect(VIDEO_ANALYSIS_VARIATION_SLUGS).toContain("dream")
    expect(VIDEO_ANALYSIS_VARIATION_SLUGS).toContain("alt-2")
  })
  it("windowAnalysisSchema scenes round-trip slotVariations; absent stays absent", () => {
    const bound = { ...baseScene, slotVariations: { hero: "dream" } }
    const parsed = windowAnalysisSchema.parse({ slots: [{ ...slot, variations: [dreamVariation] }], scenes: [bound, baseScene] })
    expect(parsed.scenes[0].slotVariations).toEqual({ hero: "dream" })
    expect(parsed.scenes[1].slotVariations).toBeUndefined()
  })
  it("analyzedSceneSchema inherits slotVariations from the same base", () => {
    const parsed = analyzedSceneSchema.parse({
      ...baseScene, sceneNumber: 1, visualResolved: "a man juggles", slotRefs: ["hero"], slotVariations: { hero: "dream" },
    })
    expect(parsed.slotVariations).toEqual({ hero: "dream" })
  })
  it("videoAnalysisResultSchema full-document round-trip with both fields", () => {
    const meta = { durationSec: 10, width: 1920, height: 1080, aspectRatio: "16:9" }
    const doc = {
      meta,
      slots: [{ ...slot, variations: [dreamVariation] }],
      scenes: [{ ...baseScene, sceneNumber: 1, visualResolved: "a man juggles", slotRefs: ["hero"], slotVariations: { hero: "dream" } }],
    }
    expect(videoAnalysisResultSchema.parse(doc)).toEqual(doc)
  })
})

describe("variationFolds (cast-variations §4/§6 — review F5)", () => {
  const meta = { durationSec: 10, width: 1920, height: 1080, aspectRatio: "16:9" }
  const doc = {
    meta,
    slots: [slot],
    scenes: [{ ...baseScene, sceneNumber: 1, visualResolved: "a man juggles", slotRefs: ["hero"] }],
  }
  it("videoAnalysisResultSchema round-trips variationFolds — strip-mode consumers keep the §6 fold note", () => {
    const withFolds = { ...doc, variationFolds: [{ slotId: "hero", variationId: "era", label: "Era" }] }
    expect(videoAnalysisResultSchema.parse(withFolds)).toEqual(withFolds)
  })
  it("absent variationFolds stays absent (no [] materialization)", () => {
    const parsed = videoAnalysisResultSchema.parse(doc)
    expect("variationFolds" in parsed && parsed.variationFolds !== undefined).toBe(false)
  })
})

describe("binding rewrite helpers (merge consumes — spec §4)", () => {
  it("rewriteSceneBindings renames slot keys and per-slot variation values", () => {
    expect(rewriteSceneBindings({ "man-2": "dream", other: "era" }, { "man-2": "hero" }, { hero: { dream: "flashback" } }))
      .toEqual({ hero: "flashback", other: "era" })
  })
  it("rewriteSceneBindings passes undefined through", () => {
    expect(rewriteSceneBindings(undefined, { a: "b" })).toBeUndefined()
  })
  it("dropUnknownBindings drops unknown (slot, variation) pairs and reports them", () => {
    const valid = new Map([["hero", new Set(["dream"])]])
    const r = dropUnknownBindings({ hero: "dream", hero2: "dream", other: "ghost" }, valid)
    expect(r.kept).toEqual({ hero: "dream" })
    expect(r.dropped).toEqual([{ slotId: "hero2", variationId: "dream" }, { slotId: "other", variationId: "ghost" }])
  })
  it("dropUnknownBindings treats 'default' as always valid for a known slot", () => {
    const valid = new Map([["hero", new Set<string>()]])
    const r = dropUnknownBindings({ hero: "default" }, valid)
    expect(r.kept).toEqual({ hero: "default" })
    expect(r.dropped).toEqual([])
  })
  it("dropUnknownBindings returns kept: undefined when nothing survives (no {} materialization)", () => {
    const r = dropUnknownBindings({ ghost: "dream" }, new Map())
    expect(r.kept).toBeUndefined()
    expect(r.dropped).toEqual([{ slotId: "ghost", variationId: "dream" }])
  })
})

describe("speech attribution (speakerSlot)", () => {
  const speech = (content: string, over: Partial<AudioLayer> = {}): AudioLayer => ({ mode: "speech", content, ...over })

  it("rides on speech layers and survives a window round-trip", () => {
    const parsed = windowAnalysisSchema.parse({
      slots: [slot],
      scenes: [{ ...baseScene, audio: [speech("As a kid…", { voice: "male, warm", speakerSlot: "hero" })] }],
    })
    expect(parsed.scenes[0]!.audio[0]!.speakerSlot).toBe("hero")
  })

  it("is NOT refined against mode — a mis-tagged music layer must not fail the whole roll", () => {
    // The window schema IS the enforced decode grammar. Rejecting here would
    // throw away every scene in a window over one stray field; the sanitizer
    // below strips it instead.
    expect(windowAnalysisSchema.safeParse({
      slots: [slot],
      scenes: [{ ...baseScene, audio: [{ mode: "music", content: "synth bed", speakerSlot: "hero" }] }],
    }).success).toBe(true)
  })

  it("rewriteSpeakerSlots follows a slot through cross-window unification", () => {
    // Slot unification renames the loser id and rewrites {slot:…} tokens and
    // variation bindings; attribution has to move with them or it dangles.
    const audio = [speech("hi", { speakerSlot: "man-2" }), speech("ho", { speakerSlot: "other" })]
    expect(rewriteSpeakerSlots(audio, { "man-2": "hero" }).map((a) => a.speakerSlot)).toEqual(["hero", "other"])
  })

  it("rewriteSpeakerSlots is copy-on-write when no layer names a renamed slot", () => {
    const audio = [speech("hi", { speakerSlot: "hero" }), { mode: "music" as const, content: "bed" }]
    expect(rewriteSpeakerSlots(audio, { ghost: "other" })).toBe(audio)
  })

  it("dropUnknownSpeakers strips attribution to a slot that no longer exists", () => {
    const r = dropUnknownSpeakers([speech("hi", { speakerSlot: "ghost" })], new Set(["hero"]))
    expect(r.audio[0]).not.toHaveProperty("speakerSlot")
    expect(r.dropped).toEqual(["ghost"])
  })

  it("dropUnknownSpeakers strips attribution from music/sfx — nobody is speaking", () => {
    const r = dropUnknownSpeakers(
      [{ mode: "sfx", content: "door slam", speakerSlot: "hero" }],
      new Set(["hero"]),
    )
    expect(r.audio[0]).not.toHaveProperty("speakerSlot")
    expect(r.dropped).toEqual(["hero"])
  })

  it("dropUnknownSpeakers keeps a valid speaker and every other layer field", () => {
    const audio = [speech("As a kid…", { voice: "male, warm", speakerSlot: "hero" })]
    const r = dropUnknownSpeakers(audio, new Set(["hero"]))
    expect(r.audio).toBe(audio)          // copy-on-write: untouched input returned as-is
    expect(r.dropped).toEqual([])
  })

  it("attribution alone must NOT keep a slot alive — that is the phantom narrator", () => {
    // A slot referenced only as a speaker is a voice with no body (doctrine §5).
    // deriveSlotRefs reads {slot:…} tokens from `visual` ONLY, so an
    // attribution-only slot stays invisible to the reference sweep and gets
    // dropped — then dropUnknownSpeakers removes the dangling attribution.
    expect(deriveSlotRefs("a lunar plain, no one in frame")).toEqual([])
    const r = dropUnknownSpeakers([speech("that's me!", { speakerSlot: "creator" })], new Set())
    expect(r.audio[0]).not.toHaveProperty("speakerSlot")
    expect(r.dropped).toEqual(["creator"])
  })
})

describe("the audio grammar (mode vocabulary + who is speaking)", () => {
  it("distinguishes AMBIENCE from SFX — room tone is not a door slam", () => {
    // They are different layers of a real mix and they are recreated by
    // different means: ambience is a continuous bed, an sfx is a discrete hit.
    // Collapsing them onto `sfx` made a scene's continuous bed indistinguishable
    // from its one-off noises, so a recreation had to guess which it was told.
    expect([...VIDEO_ANALYSIS_AUDIO_MODES]).toEqual(["speech", "music", "sfx", "ambience"])
    const parsed = windowAnalysisSchema.parse({
      slots: [slot],
      scenes: [{ ...baseScene, audio: [{ mode: "ambience", content: "distant traffic, room tone" }] }],
    })
    expect(parsed.scenes[0]!.audio[0]!.mode).toBe("ambience")
  })

  it("names the speaker BOTH ways — by slot id and by cast name", () => {
    // `speakerSlot` addresses a slot in THIS analysis; `speaker` is the plain
    // name a document that has no slots (a studio production's cast) keys by.
    // One layer may legitimately carry both.
    const parsed = windowAnalysisSchema.parse({
      slots: [slot],
      scenes: [{ ...baseScene, audio: [{ mode: "speech", content: "As a kid…", speakerSlot: "hero", speaker: "Jack Mercer" }] }],
    })
    expect(parsed.scenes[0]!.audio[0]).toMatchObject({ speakerSlot: "hero", speaker: "Jack Mercer" })
  })

  it("dropUnknownSpeakers strips slot attribution from an AMBIENCE layer too — nobody is speaking", () => {
    // The new mode must land on the non-speech side of the sanitizer, not slip
    // through it as an unrecognised value.
    const r = dropUnknownSpeakers([{ mode: "ambience", content: "room tone", speakerSlot: "hero" }], new Set(["hero"]))
    expect(r.audio[0]).not.toHaveProperty("speakerSlot")
    expect(r.dropped).toEqual(["hero"])
  })

  it("the name-keyed speaker survives the SLOT sanitizer — it names no slot to check", () => {
    // `dropUnknownSpeakers` is the slot channel's sweep: it can only judge an
    // id against the surviving slot list, and a cast NAME has no id space to be
    // unknown in. Pinned so a later reader does not "fix" the asymmetry into a
    // sweep that silently eats the field studio imports this type for.
    const audio: AudioLayer[] = [{ mode: "speech", content: "hi", speaker: "Jack Mercer" }]
    const r = dropUnknownSpeakers(audio, new Set())
    expect(r.audio).toBe(audio)
    expect(r.audio[0]!.speaker).toBe("Jack Mercer")
    expect(r.dropped).toEqual([])
  })

  it("both attributions are OPTIONAL — an older producer emits neither", () => {
    const parsed = windowAnalysisSchema.parse({ slots: [slot], scenes: [baseScene] })
    expect(parsed.scenes[0]!.audio[0]).not.toHaveProperty("speakerSlot")
    expect(parsed.scenes[0]!.audio[0]).not.toHaveProperty("speaker")
  })
})

describe("cinematography fields (angle / speed / onScreenText / look)", () => {
  it("carries angle and speed as closed enums through a window round-trip", () => {
    const parsed = windowAnalysisSchema.parse({
      slots: [slot],
      scenes: [{ ...baseScene, angle: "low", speed: "slow-motion", onScreenText: "ACT I" }],
    })
    expect(parsed.scenes[0]).toMatchObject({ angle: "low", speed: "slow-motion", onScreenText: "ACT I" })
  })

  it("supports the RELATIONAL viewpoints, so shotType keeps the size", () => {
    // These were conventions inside the `shotType` list, competing with the
    // sizes for one slot — so an over-the-shoulder MEDIUM had to throw one away.
    const parsed = windowAnalysisSchema.parse({
      slots: [slot],
      scenes: [{ ...baseScene, shotType: "Medium", angle: "over-the-shoulder" }],
    })
    expect(parsed.scenes[0]).toMatchObject({ shotType: "Medium", angle: "over-the-shoulder" })
    for (const a of ["pov", "profile", "from-behind"]) {
      expect(windowAnalysisSchema.safeParse({ slots: [slot], scenes: [{ ...baseScene, angle: a }] }).success).toBe(true)
    }
  })

  it("carries picture EFFECTS as an array — a shot can be grainy and vignetted", () => {
    const parsed = windowAnalysisSchema.parse({
      slots: [slot], scenes: [{ ...baseScene, effects: ["grain", "vignette"] }],
    })
    expect(parsed.scenes[0]!.effects).toEqual(["grain", "vignette"])
  })

  it("keeps compositing OUT of effects — that is where the phantom slot came from", () => {
    // A field for "there is an inset of a person here" would hand a legitimate
    // home to the invented `{slot:creator} overlay talking to camera`. An effect
    // is verifiable in the pixels; a claim about who is inset is not.
    for (const bad of ["picture-in-picture", "split-screen", "overlay"]) {
      expect(windowAnalysisSchema.safeParse({ slots: [slot], scenes: [{ ...baseScene, effects: [bad] }] }).success).toBe(false)
    }
  })

  it("transitions distinguish DISSOLVE from FADE — they look nothing alike", () => {
    // Collapsed onto `fade` before this, so a cross-dissolve was rendered as a
    // fade through black.
    expect(VIDEO_ANALYSIS_TRANSITIONS).toContain("dissolve")
    for (const t of VIDEO_ANALYSIS_TRANSITIONS) {
      expect(windowAnalysisSchema.safeParse({ slots: [slot], scenes: [{ ...baseScene, transitionOut: t }] }).success).toBe(true)
    }
  })

  it("effects and transitions are NOT the same axis", () => {
    // `dissolve`/`fade` are edits BETWEEN shots; blur/pixelate are on the picture.
    for (const t of ["dissolve", "fade", "wipe", "cut"]) {
      expect(VIDEO_ANALYSIS_VISUAL_EFFECTS).not.toContain(t)
    }
    for (const e of VIDEO_ANALYSIS_VISUAL_EFFECTS) {
      expect(VIDEO_ANALYSIS_TRANSITIONS).not.toContain(e as never)
    }
  })

  it("vocabulary v2 carries the twelve common edits, and the wire neutral is not a member", () => {
    // rev 1.5 Appendix F: absent = nothing asserted; `none` is wire-local to the
    // analyser's roll schema and must never reach the canonical enum.
    expect([...VIDEO_ANALYSIS_TRANSITIONS]).toEqual([
      "cut", "fade", "dissolve", "wipe", "whip",
      "zoom", "slide", "white-flash", "digital-glitch", "morph", "match", "jump",
    ])
    expect(VIDEO_ANALYSIS_TRANSITIONS).not.toContain("none" as never)
    expect(windowAnalysisSchema.safeParse({ slots: [slot], scenes: [{ ...baseScene, transitionOut: "none" }] }).success).toBe(false)
    expect(windowAnalysisSchema.safeParse({ slots: [slot], scenes: [{ ...baseScene }] }).success).toBe(true)
  })

  it("round 4: a scene carries a free-text `transition` beside the legacy enum", () => {
    // F.8: the analyser describes the edit in its own words; the enum is legacy.
    const ok = windowAnalysisSchema.safeParse({ slots: [slot], scenes: [{ ...baseScene, transition: "fast blurred pan left" }] })
    expect(ok.success).toBe(true)
    expect(ok.success && ok.data.scenes[0]!.transition).toBe("fast blurred pan left")
    expect(windowAnalysisSchema.safeParse({ slots: [slot], scenes: [{ ...baseScene, transition: "" }] }).success).toBe(false)
    expect(windowAnalysisSchema.safeParse({ slots: [slot], scenes: [{ ...baseScene, transition: "x".repeat(121) }] }).success).toBe(false)
    // legacy blueprints still parse
    expect(windowAnalysisSchema.safeParse({ slots: [slot], scenes: [{ ...baseScene, transitionOut: "whip" }] }).success).toBe(true)
  })

  it("marks the viewpoints where no face is visible — auto-cast reads this", () => {
    // A reference frame shot from behind cannot cast a face, however well framed.
    expect([...VIDEO_ANALYSIS_FACELESS_ANGLES].sort()).toEqual(["from-behind", "over-the-shoulder"])
    for (const a of VIDEO_ANALYSIS_FACELESS_ANGLES) {
      expect(VIDEO_ANALYSIS_SHOT_ANGLES).toContain(a)   // never a stale literal
    }
  })

  it("rejects free-text angle — improvising it is the failure being fixed", () => {
    // The shipped defect: `"camera": "low angle static"`, because angle had no
    // field. A free-text `angle` would just move the improvisation.
    expect(windowAnalysisSchema.safeParse({
      slots: [slot], scenes: [{ ...baseScene, angle: "low angle static" }],
    }).success).toBe(false)
  })

  it("has NO 'normal' speed member — absence is normal, so there is one way to say it", () => {
    expect(VIDEO_ANALYSIS_SPEED_EFFECTS).not.toContain("normal")
    expect(windowAnalysisSchema.safeParse({
      slots: [slot], scenes: [{ ...baseScene, speed: "normal" }],
    }).success).toBe(false)
    // …and omitting it is valid.
    expect(windowAnalysisSchema.safeParse({ slots: [slot], scenes: [baseScene] }).success).toBe(true)
  })

  it("keeps every new field OPTIONAL so an older producer still validates", () => {
    const parsed = windowAnalysisSchema.parse({ slots: [slot], scenes: [baseScene] })
    expect(parsed.scenes[0]).not.toHaveProperty("angle")
    expect(parsed.scenes[0]).not.toHaveProperty("speed")
    expect(parsed.scenes[0]).not.toHaveProperty("onScreenText")
    expect(parsed).not.toHaveProperty("look")
  })

  it("the new scene fields reach the RESULT schema, not just the window one", () => {
    // analyzedSceneSchema extends windowSceneBase — this pins that it stays that
    // way, since a field the merged result drops is invisible to every consumer.
    const scene = { ...baseScene, sceneNumber: 1, visualResolved: "x", slotRefs: [], angle: "dutch", speed: "freeze", onScreenText: "THE END" }
    expect(analyzedSceneSchema.parse(scene)).toMatchObject({ angle: "dutch", speed: "freeze", onScreenText: "THE END" })
  })

  it("look is a SIBLING of meta, not inside it — meta is measured, look is read", () => {
    const r = videoAnalysisResultSchema.parse({
      meta: { durationSec: 10, width: 1920, height: 1080, aspectRatio: "16:9" },
      look: { grade: "muted teal", format: "anamorphic digital", genre: "cinematic trailer" },
      slots: [],
      scenes: [{ ...baseScene, sceneNumber: 1, visualResolved: "x", slotRefs: [] }],
    })
    expect(r.look?.format).toBe("anamorphic digital")
    expect(r.meta).not.toHaveProperty("look")
  })

  it("look carries the Style picker's own ID beside the prose — the PICK must not be stripped", () => {
    // The analyzer emits the id it PICKED from the Style catalog alongside the
    // prose it corresponds to: { styleId: "pixar-3d", style: "3D stylized
    // animation", influence: "Pixar style" }. A z.object drops what it does not
    // declare, so an undeclared `styleId` silently loses the pick on every
    // consumer that reads an analysis back THROUGH this schema — and a pick is
    // worth strictly more than the prose, because it addresses the catalog.
    const look = { styleId: "pixar-3d", style: "3D stylized animation", influence: "Pixar style" }
    // The window layer, where the pick enters…
    expect(windowAnalysisSchema.parse({ look, slots: [], scenes: [] }).look).toMatchObject(look)
    // …and the merged result, where every consumer reads it.
    const r = videoAnalysisResultSchema.parse({
      meta: { durationSec: 10, width: 1920, height: 1080, aspectRatio: "16:9" },
      look,
      slots: [],
      scenes: [{ ...baseScene, sceneNumber: 1, visualResolved: "x", slotRefs: [] }],
    })
    expect(r.look).toMatchObject(look)
  })

  it("mergeClipLook folds the pick like any other field — first window to read it wins", () => {
    // The fold is generic (Object.entries), so this only breaks if someone
    // narrows it to a hand-written field list — the hop that has eaten a field
    // before.
    expect(mergeClipLook([{ style: "3D stylized animation" }, { styleId: "pixar-3d" }]))
      .toEqual({ style: "3D stylized animation", styleId: "pixar-3d" })
  })
})

describe("mergeClipLook", () => {
  it("takes the first non-empty value PER FIELD, not the first window wholesale", () => {
    // Windows see different footage: one may read the grade while only a later
    // one contains the shot that reveals the format.
    expect(mergeClipLook([
      { grade: "muted teal" },
      { grade: "warm", format: "16mm film grain" },
      { lens: "anamorphic flare" },
    ])).toEqual({ grade: "muted teal", format: "16mm film grain", lens: "anamorphic flare" })
  })

  it("ignores blank strings and trims what it keeps", () => {
    expect(mergeClipLook([{ grade: "   " }, { grade: "  crushed blacks  " }])).toEqual({ grade: "crushed blacks" })
  })

  it("returns undefined when nothing was read — never an empty object", () => {
    expect(mergeClipLook([])).toBeUndefined()
    expect(mergeClipLook([undefined, {}, { grade: "" }])).toBeUndefined()
  })
})

describe("misc", () => {
  it("isOversizedScene flags > 8s only", () => {
    expect(isOversizedScene(0, 8)).toBe(false)
    expect(isOversizedScene(0, 8.5)).toBe(true)
  })

  it("does not flag an exactly-8s scene whose float subtraction overshoots", () => {
    // Real job bdc9c8eb: 12.67 → 20.67 computes as 8.000000000000002.
    expect(20.67 - 12.67).toBeGreaterThan(8) // the hazard this guards
    expect(isOversizedScene(12.67, 20.67)).toBe(false)
    // Same hazard at other offsets — none of these are genuinely over the cap.
    expect(isOversizedScene(4.67, 12.67)).toBe(false)
    expect(isOversizedScene(0.1, 8.1)).toBe(false)
  })

  it("still flags a real overshoot far smaller than a boundary step", () => {
    expect(isOversizedScene(0, 8.01)).toBe(true)
  })
  it("aspectRatioFromDims snaps to nearest standard, else reduces", () => {
    expect(aspectRatioFromDims(1920, 1080)).toBe("16:9")
    expect(aspectRatioFromDims(1080, 1920)).toBe("9:16")
    expect(aspectRatioFromDims(1000, 1000)).toBe("1:1")
    expect(aspectRatioFromDims(2560, 1080)).toBe("21:9")
    expect(aspectRatioFromDims(1000, 400)).toBe("5:2")
  })
})
