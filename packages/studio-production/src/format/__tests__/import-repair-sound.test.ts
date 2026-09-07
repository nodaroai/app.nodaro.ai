import { describe, it, expect } from "vitest"

import { buildFormatRegistry } from "../registry"
import { repairDocument } from "../import"
import { repairMusic } from "../import-repair-sound"
import type { FormatRegistry } from "../registry"
import type { ImportWarning } from "../warnings"
import {
  FORMAT_ID,
  FORMAT_VERSION,
  type MusicDocument,
  type ProductionDocument,
  type SceneDocument,
  type VoiceDocument,
} from "../schema"
import { videoDurationOptions } from "../../model-menu"
import { VOICE_DELIVERY_BOUNDS } from "../../voice-delivery-settings"

/**
 * Stage 3's SPOKEN-and-SCORED repairs (spec §6.3) — a scene's `voice` (D4)
 * and the production's `music` (D5). Split out of `import-repair.test.ts`
 * (G2's own R40-style split, taken in the follow-ups fix wave) once that file
 * passed the 800-line house cap; the third area `import-repair-sound.ts` owns,
 * a shot's `/` audio CUES (D3), is the sibling `import-repair-audio.test.ts` —
 * one file per area, none of them near the cap again.
 *
 * Repair is CATALOG-AWARE and NEVER REJECTS: a file written against a newer
 * catalog, or by a model that invented an id, opens with what this studio
 * understands and a warning for the rest.
 *
 * Each of the three files carries its OWN copy of the tiny local builders
 * (`doc`/`document`, `REGISTRY`, `durationsFor`) rather than importing them
 * from a sibling: importing a `.test.ts` file would re-run its `describe`/`it`
 * blocks a second time — the same standalone-with-local-fixtures precedent
 * `production-bundle.recipe.test.ts` set. Every `describe` below is a PURE
 * MOVE: not a line of a case changed.
 */

const REGISTRY = buildFormatRegistry()
const durationsFor = (model: string) =>
  videoDurationOptions(model).map((d) => d.value)

const doc = (over: Partial<ProductionDocument> = {}): ProductionDocument => ({
  format: FORMAT_ID,
  version: 1,
  scenes: [{ frame: { prompt: "an alley" } }],
  ...over,
})

// A second, narrower builder for the tests that destructure `{ doc, warnings }`
// off `repairDocument`'s result, which would shadow the `doc(...)` factory
// above if it were reused in the same statement.
const document = (scenes: ReadonlyArray<SceneDocument>): ProductionDocument => ({
  format: FORMAT_ID,
  version: FORMAT_VERSION,
  scenes: [...scenes],
})

/** `doc.music` reads as `unknown` at the document's own type (fix round 2,
 *  R42 — the trust boundary for this slot moved into `repairMusic`); tests
 *  assert on its shape post-repair, so narrow it the same honest way
 *  `import.ts`'s `toPlanMusic` call does. */
const musicOf = (d: ProductionDocument): MusicDocument | undefined =>
  d.music as MusicDocument | undefined

describe("repair — scenes[].voice (D4)", () => {
  it("drops a voiceover with no words, with a voice warning", () => {
    const out = repairDocument(
      document([{ frame: { prompt: "x" }, voice: { text: "   " } }]),
      REGISTRY,
      durationsFor,
    )
    expect(out.doc.scenes[0].voice).toBeUndefined()
    expect(out.warnings).toEqual([
      { code: "voice", message: "A voiceover with no words was dropped.", path: "scenes[0].voice.text" },
    ])
  })

  it("trims the spoken line", () => {
    const out = repairDocument(
      document([{ frame: { prompt: "x" }, voice: { text: "  Go now  " } }]),
      REGISTRY,
      durationsFor,
    )
    expect(out.doc.scenes[0].voice).toEqual({ text: "Go now" })
    expect(out.warnings).toEqual([])
  })

  it("trims casting the same way it trims text, so repair and readVoice agree (R40-2)", () => {
    const out = repairDocument(
      document([
        { frame: { prompt: "x" }, voice: { text: "Go now", casting: "  male, urgent  " } },
      ]),
      REGISTRY,
      durationsFor,
    )
    expect(out.doc.scenes[0].voice).toEqual({ text: "Go now", casting: "male, urgent" })
    expect(out.warnings).toEqual([])
  })

  it("drops a whitespace-only casting note, keeping the rest of the voiceover (R40-2)", () => {
    const out = repairDocument(
      document([{ frame: { prompt: "x" }, voice: { text: "Go now", casting: "   " } }]),
      REGISTRY,
      durationsFor,
    )
    expect(out.doc.scenes[0].voice).toEqual({ text: "Go now" })
    expect(out.warnings).toEqual([])
  })

  it("drops an unrecognised voiceType, keeping the rest of the voiceover", () => {
    const out = repairDocument(
      document([
        {
          frame: { prompt: "x" },
          voice: { text: "Go", voiceType: "robot" as VoiceDocument["voiceType"] },
        },
      ]),
      REGISTRY,
      durationsFor,
    )
    expect(out.doc.scenes[0].voice).toEqual({ text: "Go" })
    expect(out.warnings).toEqual([
      { code: "option", message: '"robot" is not a voice type — dropped.', path: "scenes[0].voice.voiceType" },
    ])
  })

  it("keeps a recognised voiceType", () => {
    const out = repairDocument(
      document([{ frame: { prompt: "x" }, voice: { text: "Go", voiceType: "library" } }]),
      REGISTRY,
      durationsFor,
    )
    expect(out.doc.scenes[0].voice).toEqual({ text: "Go", voiceType: "library" })
    expect(out.warnings).toEqual([])
  })

  it("drops an unrecognised ttsProvider, keeping the rest of the voiceover (R38-1)", () => {
    const out = repairDocument(
      document([{ frame: { prompt: "x" }, voice: { text: "Go", ttsProvider: "acme" } }]),
      REGISTRY,
      durationsFor,
    )
    expect(out.doc.scenes[0].voice).toEqual({ text: "Go" })
    expect(out.warnings).toEqual([
      { code: "option", message: '"acme" is not a TTS provider — dropped.', path: "scenes[0].voice.ttsProvider" },
    ])
  })

  it("keeps a recognised ttsProvider (R38-1)", () => {
    const out = repairDocument(
      document([
        { frame: { prompt: "x" }, voice: { text: "Go", ttsProvider: "elevenlabs-multilingual" } },
      ]),
      REGISTRY,
      durationsFor,
    )
    expect(out.doc.scenes[0].voice).toEqual({ text: "Go", ttsProvider: "elevenlabs-multilingual" })
    expect(out.warnings).toEqual([])
  })

  it("clamps an out-of-range delivery lever (via readDeliverySettings — no second clamp)", () => {
    const out = repairDocument(
      document([
        { frame: { prompt: "x" }, voice: { text: "Go", delivery: { speed: 3, stability: 0.6 } } },
      ]),
      REGISTRY,
      durationsFor,
    )
    expect(out.doc.scenes[0].voice).toEqual({
      text: "Go",
      delivery: { speed: 1.2, stability: 0.6 },
    })
    // …WITH A RECEIPT (fix wave): a clamp changes a value the author wrote, and
    // D11's rule is that nothing changes without a warning. One per moved
    // lever, at its own path; the in-range sibling earns none.
    expect(out.warnings).toEqual([
      {
        code: "option",
        message: `speed 3 is outside ${VOICE_DELIVERY_BOUNDS.speed.min}–${VOICE_DELIVERY_BOUNDS.speed.max} — clamped to ${VOICE_DELIVERY_BOUNDS.speed.max}.`,
        path: "scenes[0].voice.delivery.speed",
      },
    ])
  })

  it("says nothing about a delivery lever that was already in range", () => {
    const out = repairDocument(
      document([
        {
          frame: { prompt: "x" },
          voice: { text: "Go", delivery: { speed: 1.1, stability: 0.6 } },
        },
      ]),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings).toEqual([])
  })

  it("drops delivery entirely once every lever clamps onto its default", () => {
    const out = repairDocument(
      document([{ frame: { prompt: "x" }, voice: { text: "Go", delivery: { style: -5 } } }]),
      REGISTRY,
      durationsFor,
    )
    expect(out.doc.scenes[0].voice).toEqual({ text: "Go" })
    // The lever clamped from -5 onto its MINIMUM, which happens to be the
    // default — so it is pruned from the document AND still reported: the
    // value the author wrote is not the value that lands.
    expect(out.warnings).toEqual([
      {
        code: "option",
        message: `style -5 is outside ${VOICE_DELIVERY_BOUNDS.style.min}–${VOICE_DELIVERY_BOUNDS.style.max} — clamped to ${VOICE_DELIVERY_BOUNDS.style.min}.`,
        path: "scenes[0].voice.delivery.style",
      },
    ])
  })

  it("never mutates the document it was given", () => {
    const input = document([
      {
        frame: { prompt: "x" },
        voice: { text: "  Go  ", voiceType: "robot" as VoiceDocument["voiceType"] },
      },
    ])
    repairDocument(input, REGISTRY, durationsFor)
    expect(input.scenes[0].voice).toEqual({ text: "  Go  ", voiceType: "robot" })
  })
})

describe("repair — music (D5)", () => {
  it("keeps a soundtrack whose fields are all catalog-valid, with no warnings", () => {
    const out = repairDocument(
      doc({ music: { prompt: "a driving synth pulse", genre: "synthwave" } }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings).toEqual([])
    expect(out.doc.music).toEqual({ prompt: "a driving synth pulse", genre: "synthwave" })
  })

  it("clamps an over-long duration onto the format's ceiling, with a duration warning", () => {
    const out = repairDocument(
      doc({ music: { prompt: "strings", duration: 90 } }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings.map((w) => w.code)).toEqual(["duration"])
    expect(musicOf(out.doc)?.duration).toBe(30)
  })

  it("clamps a non-positive duration up to 1s", () => {
    const out = repairDocument(
      doc({ music: { prompt: "strings", duration: 0 } }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings.map((w) => w.code)).toEqual(["duration"])
    expect(musicOf(out.doc)?.duration).toBe(1)
  })

  it("drops an unknown genre with unknown-id, keeping the rest of the soundtrack", () => {
    const out = repairDocument(
      doc({ music: { prompt: "strings", genre: "nope" } }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings).toEqual([
      { code: "unknown-id", message: '"nope" is not a genre — dropped.', path: "music.genre" },
    ])
    expect(out.doc.music).toEqual({ prompt: "strings" })
  })

  it("drops an unknown mood, singingStyle and language the same way", () => {
    const out = repairDocument(
      doc({
        music: {
          prompt: "strings",
          mood: "nope",
          singingStyle: "nope",
          language: "nope",
        },
      }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings.map((w) => w.code)).toEqual(["unknown-id", "unknown-id", "unknown-id"])
    expect(out.doc.music).toEqual({ prompt: "strings" })
  })

  it("drops an unrecognised vocals value and vocalGender, each with an option warning", () => {
    const out = repairDocument(
      doc({
        music: {
          prompt: "strings",
          vocals: "chanting" as MusicDocument["vocals"],
          vocalGender: "robot" as MusicDocument["vocalGender"],
        },
      }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings.map((w) => w.code)).toEqual(["option", "option"])
    expect(out.doc.music).toEqual({ prompt: "strings" })
  })

  it("filters unknown instruments out of the list, keeping the known ones", () => {
    const out = repairDocument(
      doc({ music: { prompt: "strings", instruments: ["piano", "theremin"] } }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings).toEqual([
      { code: "unknown-id", message: '"theremin" is not an instrument — dropped.', path: "music.instruments" },
    ])
    expect(musicOf(out.doc)?.instruments).toEqual(["piano"])
  })

  it("drops instruments entirely once every one of them is unknown", () => {
    const out = repairDocument(
      doc({ music: { prompt: "strings", instruments: ["theremin"] } }),
      REGISTRY,
      durationsFor,
    )
    expect(musicOf(out.doc)?.instruments).toBeUndefined()
  })

  // Fix round 2, item 4: an id repeated verbatim reaches repair a KNOWN one —
  // it never touches `dropUnknownMusicOption`'s warning path — so dedupe has
  // to be its own step, and a doc with thousands of repeats must not carry
  // them all the way through, only the catalog's own count at most.
  it("dedupes a repeated known instrument down to one occurrence", () => {
    const out = repairDocument(
      doc({ music: { prompt: "strings", instruments: ["piano", "piano", "piano"] } }),
      REGISTRY,
      durationsFor,
    )
    expect(musicOf(out.doc)?.instruments).toEqual(["piano"])
  })

  it("caps instruments at the catalog's own length, even given thousands of (deduped) repeats", () => {
    const out = repairDocument(
      doc({ music: { prompt: "strings", instruments: Array(5000).fill("piano") as string[] } }),
      REGISTRY,
      durationsFor,
    )
    const kept = musicOf(out.doc)?.instruments ?? []
    expect(kept).toEqual(["piano"])
    expect(kept.length).toBeLessThanOrEqual(REGISTRY.music.instruments.length)
  })

  it("caps a document naming every catalog instrument twice down to the catalog's own count, in order", () => {
    const catalogIds = REGISTRY.music.instruments.map((o) => o.id)
    const out = repairDocument(
      doc({ music: { prompt: "strings", instruments: [...catalogIds, ...catalogIds] } }),
      REGISTRY,
      durationsFor,
    )
    expect(musicOf(out.doc)?.instruments).toEqual(catalogIds)
  })

  it("caps the AUTHORED instrument list, before the unknown-id filter", () => {
    // The cap is the contract the STRUCTURAL schema publishes as `maxItems`:
    // how many ids a document may ASK for. Behind the unknown-id filter it
    // could never fire (the filter already leaves at most one entry per
    // catalog row), which left the published cap unenforced. A two-row catalog
    // stub is the only way to say that out loud with the real catalog's size.
    const stub: FormatRegistry = {
      ...REGISTRY,
      music: {
        ...REGISTRY.music,
        instruments: [
          { id: "piano", label: "Piano", term: "piano" },
          { id: "synth", label: "Synth", term: "synth" },
        ],
      },
    }
    const warnings: ImportWarning[] = []
    const out = repairMusic(
      { prompt: "strings", instruments: ["nope-1", "nope-2", "piano", "synth"] },
      stub,
      warnings,
    )
    // The two ids past the cap were never asked about — the document asked for
    // four rows from a two-row catalog and got the first two considered.
    expect(out?.instruments).toBeUndefined()
    expect(warnings.map((w) => [w.code, w.path])).toEqual([
      ["unknown-id", "music.instruments"],
      ["unknown-id", "music.instruments"],
    ])
  })

  it("spells a malformed soundtrack's path the way every other warning does", () => {
    const out = repairDocument(
      doc({ music: { prompt: "strings", instruments: [42] } }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings).toEqual([
      {
        code: "audio",
        message: "The soundtrack could not be read and was dropped.",
        path: "music.instruments[0]",
      },
    ])
  })

  it("drops a soundtrack with no description, with an audio warning", () => {
    const out = repairDocument(doc({ music: { prompt: "   " } }), REGISTRY, durationsFor)
    expect(out.warnings).toEqual([
      { code: "audio", message: "A soundtrack with no description was dropped.", path: "music.prompt" },
    ])
    expect(out.doc.music).toBeUndefined()
  })

  it("trims the prompt", () => {
    const out = repairDocument(
      doc({ music: { prompt: "  strings and a slow build  " } }),
      REGISTRY,
      durationsFor,
    )
    expect(out.doc.music).toEqual({ prompt: "strings and a slow build" })
  })

  it("never mutates the document it was given", () => {
    const input = doc({ music: { prompt: "strings", genre: "nope", duration: 90 } })
    repairDocument(input, REGISTRY, durationsFor)
    expect(input.music).toEqual({ prompt: "strings", genre: "nope", duration: 90 })
  })

  it("leaves music absent when the document carries none", () => {
    const out = repairDocument(doc(), REGISTRY, durationsFor)
    expect(out.doc.music).toBeUndefined()
    expect(out.warnings).toEqual([])
  })

  // Fix round 2, R42: a malformed `music` value must drop ONLY the
  // soundtrack, never the whole import — before this fix each of these
  // reached `music.prompt.trim()` on a value that wasn't even an object
  // (or hard-failed the structural schema) and took every scene down with
  // it. Each case: exactly one `audio` warning, the rest of the document
  // untouched.
  it("drops a null music value with one audio warning, keeping the rest of the document", () => {
    const out = repairDocument(doc({ music: null as unknown as MusicDocument }), REGISTRY, durationsFor)
    expect(out.warnings).toEqual([
      { code: "audio", message: "The soundtrack could not be read and was dropped.", path: "music" },
    ])
    expect(out.doc.music).toBeUndefined()
    expect(out.doc.scenes).toEqual([{ frame: { prompt: "an alley" } }])
  })

  it("drops a music value that isn't an object at all (a bare string)", () => {
    const out = repairDocument(doc({ music: "strings" as unknown as MusicDocument }), REGISTRY, durationsFor)
    expect(out.warnings).toEqual([
      { code: "audio", message: "The soundtrack could not be read and was dropped.", path: "music" },
    ])
    expect(out.doc.music).toBeUndefined()
  })

  it("drops an empty music object — prompt absent reads as blank, same as whitespace-only", () => {
    const out = repairDocument(doc({ music: {} as MusicDocument }), REGISTRY, durationsFor)
    expect(out.warnings).toEqual([
      { code: "audio", message: "A soundtrack with no description was dropped.", path: "music.prompt" },
    ])
    expect(out.doc.music).toBeUndefined()
  })

  it("drops a music object with fields but no prompt (a plausible pre-D5 catalog output)", () => {
    const out = repairDocument(
      doc({ music: { genre: "cinematic" } as unknown as MusicDocument }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings).toEqual([
      { code: "audio", message: "A soundtrack with no description was dropped.", path: "music.prompt" },
    ])
    expect(out.doc.music).toBeUndefined()
  })

  it("drops a music object whose field is the wrong TYPE (instruments as a string, not an array)", () => {
    const out = repairDocument(
      doc({
        music: { prompt: "x", instruments: "piano" } as unknown as MusicDocument,
      }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings).toEqual([
      { code: "audio", message: "The soundtrack could not be read and was dropped.", path: "music.instruments" },
    ])
    expect(out.doc.music).toBeUndefined()
  })

  it("still lands a genuinely valid node — the malformed cases above aren't blanket-dropping everything", () => {
    const out = repairDocument(
      doc({ music: { prompt: "strings, a slow build" } }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings).toEqual([])
    expect(out.doc.music).toEqual({ prompt: "strings, a slow build" })
  })
})
