import { VIDEO_ANALYSIS_AUDIO_MODES } from "@nodaro/shared"
import { describe, it, expect } from "vitest"
import { z } from "zod"

import example from "../fixtures/example.json"
import { buildFormatRegistry } from "../registry"
import {
  renderStrictJsonSchema,
  renderStructuralJsonSchema,
} from "../json-schema"
import { AUDIO_MODES } from "../schema"

/**
 * The sound-cue slice of the two JSON Schemas — split out of
 * `json-schema.test.ts` once that file crossed the 800-line house cap (fix
 * round 1, the same pure-move discipline `import-repair-sound.ts` and the
 * `ImportProductionDialog` test siblings use): its own full copy of the small
 * shared helpers this slice needs, not an import from another spec.
 */

type Node = Record<string, unknown>

/**
 * `example` (`fixtures/example.json`) with its two STRICT-only fields
 * stripped — `scenes[].frame.subject` (D1) and `cast[].imageUrl` (D8) — the
 * same projection `renderStructuralJsonSchema` needs (D7 fix round 1, R47:
 * the fixture keeps both fields as the studio-EXPORT-shaped superset; the
 * route's own `frame`/`cast.items` are `additionalProperties: false` with
 * neither). See `json-schema.test.ts`'s own copy for the full rationale.
 */
function routeSafe(doc: typeof example): Record<string, unknown> {
  return {
    ...doc,
    scenes: doc.scenes.map((scene) => {
      if (!scene.frame?.subject) return scene
      const { subject, ...frame } = scene.frame
      return { ...scene, frame }
    }),
    ...(doc.cast ? { cast: doc.cast.map(({ imageUrl, ...rest }) => rest) } : {}),
  }
}

describe("structuralAudio — the shared audio-cue schema (B19)", () => {
  it("gives the shared audio-cue array its own description, naming every AUDIO_MODES member", () => {
    // The generator reads descriptions — an empty one leaves it guessing what
    // `mode` means. The SAME `structuralAudio` object backs both `audio`
    // sites, so pinning one pins both.
    const registry = buildFormatRegistry()
    const schema = renderStructuralJsonSchema(registry) as Node
    const scene = (schema.properties as Record<string, Node>).scenes.items as Node
    const motionAudio = (
      (scene.properties as Record<string, Node>).motion.properties as Record<string, Node>
    ).audio
    const shotAudio = (
      ((scene.properties as Record<string, Node>).shots.items as Node).properties as Record<
        string,
        Node
      >
    ).audio
    expect(motionAudio).toBe(shotAudio)
    // `String(undefined)` reads as `"undefined"`, a truthy non-empty string —
    // a plain `.length` check stays green with no `description` at all.
    // Assert the TYPE first, so removing the field fails here too.
    expect(typeof motionAudio.description).toBe("string")
    expect(String(motionAudio.description).length).toBeGreaterThan(0)
    for (const mode of AUDIO_MODES) {
      expect(String(motionAudio.description)).toContain(`\`${mode}\``)
    }
  })
})

describe("audio — shots[].audio / motion.audio (D3)", () => {
  it("both schemas carry audio on shots and motion, with the mode enum and the caps", () => {
    const registry = buildFormatRegistry()
    const structural = renderStructuralJsonSchema(registry) as Node
    const scene = (structural.properties as Record<string, Node>).scenes.items as Node
    const sceneProps = scene.properties as Record<string, Node>
    const shot = ((sceneProps.shots.items as Node).properties as Record<string, Node>).audio
    const shotItemProps = (shot.items as Node).properties as Record<string, Node>
    expect(shot.maxItems).toBe(8)
    expect(shotItemProps.mode.enum).toEqual(["speech", "tone", "sfx", "ambience", "music"])
    expect(shotItemProps.content.maxLength).toBe(300)
    const motion = (sceneProps.motion.properties as Record<string, Node>).audio
    expect(motion.maxItems).toBe(8)
    const motionMode = ((motion.items as Node).properties as Record<string, Node>).mode
    expect(motionMode.enum).toEqual(["speech", "tone", "sfx", "ambience", "music"])
    expect(
      z
        .fromJSONSchema(renderStrictJsonSchema(registry))
        .safeParse({
          ...example,
          scenes: [{ shots: [{ seconds: 4, text: "x", audio: [{ mode: "growl", content: "y" }] }] }],
        }).success,
    ).toBe(false)
  })

  /** R68 — the format's cue modes ARE the platform's analyzer modes plus
   *  studio's delivery-only `tone`. `audio.ts` pins that at compile time; this
   *  is the RUNTIME half, over the PUBLISHED enums both schemas carry, so a
   *  mode `@nodaro/shared` adds fails loudly here rather than being silently
   *  rejected by the contract (or silently accepted, had the enum been derived
   *  from the shared list). Order is the assertions above's job — this one is
   *  about MEMBERSHIP. */
  it("enumerates exactly the shared analyzer's modes plus studio's `tone`", () => {
    const registry = buildFormatRegistry()
    const union = new Set<string>([...VIDEO_ANALYSIS_AUDIO_MODES, "tone"])
    const structural = renderStructuralJsonSchema(registry) as Node
    const sceneProps = ((structural.properties as Record<string, Node>).scenes.items as Node)
      .properties as Record<string, Node>
    const shotAudio = ((sceneProps.shots.items as Node).properties as Record<string, Node>).audio
    const shotMode = ((shotAudio.items as Node).properties as Record<string, Node>).mode
    expect(new Set(shotMode.enum as string[])).toEqual(union)
    expect(new Set(AUDIO_MODES)).toEqual(union)
  })
})

describe("music (D5) — the structural/strict asymmetry, mirroring scenes[].voice's own test", () => {
  it("the structural schema carries prompt/duration/all five catalog fields as plain strings, plus vocals/vocalGender enumerated off the registry; the strict one enumerates every field", () => {
    const registry = buildFormatRegistry()
    const structural = renderStructuralJsonSchema(registry) as Node
    const structuralMusic = (structural.properties as Record<string, Node>).music
    const structuralProps = structuralMusic.properties as Record<string, Node>
    expect(Object.keys(structuralProps).sort()).toEqual(
      [
        "prompt",
        "duration",
        "vocals",
        "vocalGender",
        "genre",
        "mood",
        "instruments",
        "singingStyle",
        "language",
      ].sort(),
    )
    expect(structuralMusic.required).toEqual(["prompt"])
    expect(structuralProps.duration.minimum).toBe(1)
    expect(structuralProps.duration.maximum).toBe(registry.music.maxDuration)
    // The five catalog fields carry NO enum here (D11 — what the catalog
    // OFFERS is repair's business, not the route's structural contract);
    // `vocals`/`vocalGender` DO — the format's own small fixed vocabulary,
    // same reasoning `AUDIO_MODES` gets.
    for (const field of ["genre", "mood", "singingStyle", "language"]) {
      expect(structuralProps[field].type, field).toBe("string")
      expect(structuralProps[field].enum, field).toBeUndefined()
    }
    expect((structuralProps.instruments.items as Node).type).toBe("string")
    expect((structuralProps.instruments.items as Node).enum).toBeUndefined()
    expect(structuralProps.vocals.enum).toEqual([...registry.music.vocals])
    expect(structuralProps.vocalGender.enum).toEqual([...registry.music.vocalGenders])

    const strict = renderStrictJsonSchema(registry) as Node
    const strictMusic = (strict.properties as Record<string, Node>).music
    const strictProps = strictMusic.properties as Record<string, Node>
    expect(Object.keys(strictProps).sort()).toEqual(Object.keys(structuralProps).sort())
    // The strict side enumerates every catalog field for real.
    expect(strictProps.genre.enum).toEqual(registry.music.genres.map((o) => o.id))
    expect(strictProps.mood.enum).toEqual(registry.music.moods.map((o) => o.id))
    expect(strictProps.singingStyle.enum).toEqual(registry.music.singingStyles.map((o) => o.id))
    expect(strictProps.language.enum).toEqual(registry.music.languages.map((o) => o.id))
    // `z.toJSONSchema` does not guarantee `z.enum([...ids])` preserves the
    // catalog's own array order — this pins the SET, the way the rest of
    // this file compares an enum whose renderer doesn't promise ordering.
    expect(((strictProps.instruments.items as Node).enum as string[]).sort()).toEqual(
      registry.music.instruments.map((o) => o.id).sort(),
    )
    expect(strictProps.vocals.enum).toEqual([...registry.music.vocals])
    expect(strictProps.vocalGender.enum).toEqual([...registry.music.vocalGenders])
  })

  it("the structural schema bounds instruments at the catalog's own length (fix round 2, item 4)", () => {
    const registry = buildFormatRegistry()
    const structural = renderStructuralJsonSchema(registry) as Node
    const structuralMusic = (structural.properties as Record<string, Node>).music
    const instruments = (structuralMusic.properties as Record<string, Node>).instruments
    expect(instruments.maxItems).toBe(registry.music.instruments.length)
    expect((instruments.items as Node).maxLength).toBeGreaterThan(0)
  })

  it("the structural schema refuses a wrong-typed field the strict one also refuses", () => {
    const registry = buildFormatRegistry()
    const structural = z.fromJSONSchema(renderStructuralJsonSchema(registry))
    const base = routeSafe(example)
    // The CONTROL leg (fix round 1 addendum, item 6) — see the voiceId test's
    // own comment for why the un-stripped `example` can't be the base here.
    const parsedBase = structural.safeParse(base)
    expect(parsedBase.success, JSON.stringify(parsedBase.error?.issues)).toBe(true)
    const wrongType = structural.safeParse({
      ...base,
      music: { prompt: "x", instruments: "piano" },
    })
    expect(wrongType.success).toBe(false)
  })
})
