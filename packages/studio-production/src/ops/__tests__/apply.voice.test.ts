/**
 * The `voice` section — `set_voice` / `clear_voice`, the server-side twins of
 * the studio store's `setShotVoice` (production-store-cuts-audio.ts) and
 * `clearShotVoice`.
 *
 * The oracle is the studio suite. `setShotVoice`'s only tests live in
 * `src/store/production-store.import.test.ts`
 * (`describe("recipe consumption — real work replaces the stored inputs")`) —
 * a set voiceover CONSUMES the recipe's `voice` layer, and a recipe-less shot
 * comes back identity-unchanged. Those assertions are ported verbatim; only the
 * call shape changes, from `get().setShotVoice(id, voice)` to
 * `voiceHandlers.set_voice(production, op, ctx)`.
 *
 * `clearShotVoice` has NO test in the studio repo, so its cases below are
 * written from the reducer's behaviour: drop `voice` off a FRESH copy, leave a
 * voiceless shot untouched, never mutate the stored shot.
 *
 * The one deliberate generalisation (`SECTIONS.md` rule 5): the store no-ops on
 * an unknown shot id, an operation raises `op_target_missing` — a caller over
 * the wire must be told its id named nothing.
 */
import { describe, expect, it } from "vitest"

import type { Shot, ShotVoice } from "../../shot"
import { isOpError, OpError } from "../errors"
import type { Production } from "../production"
import type { OpContext } from "../types"
import {
  voiceHandlers,
  voiceOpClasses,
  voiceOpSchemas,
} from "../sections/voice"

/** A still-only shot fixture (stable ids for assertions). */
const stillOnly = (id: string): Shot => ({
  id,
  still: {
    nodeId: `generate-image-${id}`,
    url: `https://r2.example/${id}.png`,
    provider: "nano-banana",
    prompt: `prompt ${id}`,
  },
})

/** A still shot carrying an already-generated voiceover. */
const withVoice = (id: string): Shot => ({
  ...stillOnly(id),
  voice: { url: `https://r2.example/${id}.mp3`, text: "hi", voiceId: "old" },
})

/** The three-layer recipe shot of the studio's recipe-consumption tests. */
const recipeShot = (): Shot => ({
  id: "r1",
  recipe: {
    framing: { prompt: "a dune at dawn", provider: "nano-banana" },
    directing: { prompt: "wind ripples the sand", duration: 5 },
    voice: { text: "Dawn broke." },
  },
})

const production = (...shots: Shot[]): Production => ({ shots })

const ctx: OpContext = { now: "2026-09-06T12:00:00.000Z", mintId: () => "id-1" }

const spoken: ShotVoice = { url: "https://r2.example/v.mp3", text: "Dawn broke." }

describe("set_voice", () => {
  it("sets the voiceover on the addressed shot, leaving its siblings alone", () => {
    const before = production(stillOnly("a"), stillOnly("b"))
    const { production: after } = voiceHandlers.set_voice(
      before,
      { op: "set_voice", shotId: "a", voice: spoken },
      ctx,
    )

    expect(after.shots[0]?.voice).toEqual(spoken)
    expect(after.shots[0]?.still?.url).toBe("https://r2.example/a.png")
    expect(Object.is(before.shots[1], after.shots[1])).toBe(true)
  })

  it("replaces an existing voiceover whole", () => {
    const { production: after } = voiceHandlers.set_voice(
      production(withVoice("a")),
      {
        op: "set_voice",
        shotId: "a",
        voice: { url: "https://r2.example/new.mp3", text: "again", voiceType: "library" },
      },
      ctx,
    )

    expect(after.shots[0]?.voice).toEqual({
      url: "https://r2.example/new.mp3",
      text: "again",
      voiceType: "library",
    })
    expect(after.shots[0]?.voice?.voiceId).toBeUndefined()
  })

  // Ported from production-store.import.test.ts, "a landing clip consumes
  // directing; a set voice consumes voice; the empty recipe disappears".
  it("a set voice consumes voice (framing + directing stay)", () => {
    const { production: after } = voiceHandlers.set_voice(
      production(recipeShot()),
      { op: "set_voice", shotId: "r1", voice: spoken },
      ctx,
    )

    expect(after.shots[0]!.recipe?.voice).toBeUndefined()
    expect(after.shots[0]!.recipe?.framing?.prompt).toBe("a dune at dawn")
    expect(after.shots[0]!.recipe?.directing?.prompt).toBe("wind ripples the sand")
  })

  // Same describe, the last assertion of the same test: "Last layer consumed →
  // the key itself is gone (minimal shape)." — here voice IS the last layer.
  it("drops the recipe key itself when voice was the last layer", () => {
    const { production: after } = voiceHandlers.set_voice(
      production({ id: "r1", recipe: { voice: { text: "Dawn broke." } } }),
      { op: "set_voice", shotId: "r1", voice: spoken },
      ctx,
    )

    expect("recipe" in after.shots[0]!).toBe(false)
  })

  // Ported from production-store.import.test.ts, "shots without a recipe are
  // returned identity-unchanged by the consumption path".
  it("shots without a recipe are returned identity-unchanged by the consumption path", () => {
    const input = production(stillOnly("a"))
    const before = input.shots[0]!
    const { production: after } = voiceHandlers.set_voice(
      input,
      { op: "set_voice", shotId: "a", voice: { url: "https://r2.example/v.mp3", text: "hi" } },
      ctx,
    )
    const shot = after.shots[0]!

    expect(shot.voice?.text).toBe("hi")
    expect(shot.recipe).toBeUndefined()
    expect(before.recipe).toBeUndefined()
  })

  it("is copy-on-write — the input production and shot are untouched", () => {
    const input = production(withVoice("a"))
    const beforeShots = input.shots
    const beforeShot = input.shots[0]!
    const { production: after } = voiceHandlers.set_voice(
      input,
      { op: "set_voice", shotId: "a", voice: spoken },
      ctx,
    )

    expect(Object.is(beforeShots, after.shots)).toBe(false)
    expect(Object.is(beforeShot, after.shots[0])).toBe(false)
    expect(beforeShot.voice?.text).toBe("hi")
  })

  it("throws op_target_missing for an unknown shot id", () => {
    const input = production(stillOnly("a"))
    const call = () =>
      voiceHandlers.set_voice(input, { op: "set_voice", shotId: "nope", voice: spoken }, ctx)

    expect(call).toThrow(OpError)
    try {
      call()
    } catch (error) {
      expect(isOpError(error)).toBe(true)
      if (!isOpError(error)) throw error
      expect(error.code).toBe("op_target_missing")
    }
  })

  it("reports a receipt naming the shot the way the user sees it", () => {
    const named = voiceHandlers.set_voice(
      production(stillOnly("a"), { ...stillOnly("b"), name: "Rooftop" }),
      { op: "set_voice", shotId: "b", voice: spoken },
      ctx,
    )
    const positional = voiceHandlers.set_voice(
      production(stillOnly("a"), stillOnly("b")),
      { op: "set_voice", shotId: "b", voice: spoken },
      ctx,
    )

    expect(named.receipt).toEqual({
      op: "set_voice",
      summary: "Set the voiceover on Rooftop.",
    })
    expect(positional.receipt.summary).toBe("Set the voiceover on Scene 2.")
  })
})

describe("clear_voice", () => {
  it("drops the voiceover off a fresh copy of the shot", () => {
    const input = production(withVoice("a"))
    const beforeShot = input.shots[0]!
    const { production: after } = voiceHandlers.clear_voice(
      input,
      { op: "clear_voice", shotId: "a" },
      ctx,
    )
    const shot = after.shots[0]!

    expect("voice" in shot).toBe(false)
    expect(shot.still?.url).toBe("https://r2.example/a.png")
    expect(Object.is(beforeShot, shot)).toBe(false)
    expect(beforeShot.voice?.text).toBe("hi")
  })

  it("leaves the shot's siblings alone", () => {
    const input = production(withVoice("a"), withVoice("b"))
    const { production: after } = voiceHandlers.clear_voice(
      input,
      { op: "clear_voice", shotId: "a" },
      ctx,
    )

    expect(Object.is(input.shots[1], after.shots[1])).toBe(true)
    expect(after.shots[1]?.voice?.text).toBe("hi")
  })

  it("is a no-op with a warning when the shot has no voiceover", () => {
    const input = production(stillOnly("a"))
    const result = voiceHandlers.clear_voice(input, { op: "clear_voice", shotId: "a" }, ctx)

    expect(Object.is(input, result.production)).toBe(true)
    expect(result.warnings).toEqual(["Scene 1 had no voiceover."])
  })

  it("throws op_target_missing for an unknown shot id", () => {
    const input = production(withVoice("a"))
    const call = () =>
      voiceHandlers.clear_voice(input, { op: "clear_voice", shotId: "nope" }, ctx)

    expect(call).toThrow(OpError)
    try {
      call()
    } catch (error) {
      expect(isOpError(error)).toBe(true)
      if (!isOpError(error)) throw error
      expect(error.code).toBe("op_target_missing")
    }
  })

  it("reports a receipt naming the shot the way the user sees it", () => {
    const { receipt } = voiceHandlers.clear_voice(
      production(withVoice("a"), { ...withVoice("b"), name: "Rooftop" }),
      { op: "clear_voice", shotId: "b" },
      ctx,
    )

    expect(receipt).toEqual({
      op: "clear_voice",
      summary: "Cleared the voiceover on Rooftop.",
    })
  })
})

describe("the section's tables", () => {
  it("declares a schema, a handler and a class for the same two ops", () => {
    expect(Object.keys(voiceOpSchemas)).toEqual(["set_voice", "clear_voice"])
    expect(Object.keys(voiceHandlers)).toEqual(Object.keys(voiceOpSchemas))
    expect(Object.keys(voiceOpClasses)).toEqual(Object.keys(voiceOpSchemas))
    expect(voiceOpClasses).toEqual({ set_voice: "S", clear_voice: "D" })
  })

  it("parses a full voiceover, including the tuned delivery levers", () => {
    const parsed = voiceOpSchemas.set_voice.parse({
      op: "set_voice",
      shotId: "a",
      voice: {
        url: "https://r2.example/v.mp3",
        text: "Dawn broke.",
        voiceId: "lib1",
        voiceType: "library",
        ttsProvider: "elevenlabs-v3",
        model: "eleven_v3",
        delivery: { speed: 0.9, stability: 0.4 },
      },
    })

    expect(parsed.voice.delivery).toEqual({ speed: 0.9, stability: 0.4 })
    expect(parsed.voice.voiceType).toBe("library")
  })

  it("refuses a voiceover with no audio url and an unknown voice kind", () => {
    expect(() =>
      voiceOpSchemas.set_voice.parse({ op: "set_voice", shotId: "a", voice: { text: "hi" } }),
    ).toThrow()
    expect(() =>
      voiceOpSchemas.set_voice.parse({
        op: "set_voice",
        shotId: "a",
        voice: { url: "u", text: "hi", voiceType: "invented" },
      }),
    ).toThrow()
  })
})

// Type-only pin: the schema's `voice` is exactly `ShotVoice`, both directions —
// a field added to the interface without a schema key fails here.
const _voiceOut: ShotVoice = {} as import("zod").z.infer<
  typeof voiceOpSchemas.set_voice
>["voice"]
const _voiceIn: import("zod").z.infer<
  typeof voiceOpSchemas.set_voice
>["voice"] = {} as ShotVoice
void _voiceOut
void _voiceIn
