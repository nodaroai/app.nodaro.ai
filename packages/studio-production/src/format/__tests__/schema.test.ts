import { describe, it, expect } from "vitest"

import {
  FORMAT_ID,
  FORMAT_VERSION,
  productionDocumentSchema,
} from "../schema"

/**
 * The structural schema is the importer's ONE trust boundary (spec §6.2): it
 * decides what is a document at all. Everything catalog-shaped — ids, models,
 * cardinality — is repair's, so the gates here are deliberately few.
 */
const minimal = {
  format: FORMAT_ID,
  version: FORMAT_VERSION,
  scenes: [{ frame: { prompt: "a wide alley at dusk" } }],
}

describe("the production document schema", () => {
  it("is FORMAT_VERSION 2 (D7 — the root voice reserved slot is retired)", () => {
    expect(FORMAT_VERSION).toBe(2)
  })

  it("accepts a minimal document", () => {
    expect(productionDocumentSchema().safeParse(minimal).success).toBe(true)
  })

  it("accepts a version NEWER than ours (D13 — best effort plus a banner)", () => {
    expect(
      productionDocumentSchema().safeParse({ ...minimal, version: FORMAT_VERSION + 6 })
        .success,
    ).toBe(true)
  })

  it("rejects a document with no scenes, naming the path", () => {
    const parsed = productionDocumentSchema().safeParse({
      format: FORMAT_ID,
      version: 1,
    })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0].path).toEqual(["scenes"])
  })

  it("rejects a scene carrying none of frame / motion / shots / voice", () => {
    const parsed = productionDocumentSchema().safeParse({
      ...minimal,
      scenes: [{ name: "empty" }],
    })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0].path).toEqual(["scenes", 0])
  })

  it("rejects a shot with no text, naming the path", () => {
    const parsed = productionDocumentSchema().safeParse({
      ...minimal,
      scenes: [{ shots: [{ seconds: 4 }] }],
    })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0].path).toEqual(["scenes", 0, "shots", 0, "text"])
  })

  it("keeps a zero-second shot for repair to drop, rather than rejecting it", () => {
    const parsed = productionDocumentSchema().safeParse({
      ...minimal,
      scenes: [{ shots: [{ seconds: 0, text: "nothing" }] }],
    })
    expect(parsed.success).toBe(true)
  })

  it("strips unknown keys at every level", () => {
    const parsed = productionDocumentSchema().parse({
      ...minimal,
      weird: 1,
      scenes: [{ frame: { prompt: "p", nonsense: true }, alien: "x" }],
    })
    expect("weird" in parsed).toBe(false)
    expect("alien" in parsed.scenes[0]).toBe(false)
    expect("nonsense" in (parsed.scenes[0].frame ?? {})).toBe(false)
  })

  it("accepts a cast kind from a newer studio (D13 — resolve drops the entry)", () => {
    const parsed = productionDocumentSchema().safeParse({
      ...minimal,
      cast: [{ kind: "vehicle", name: "The SUV" }],
    })
    expect(parsed.success).toBe(true)
  })

  it("accepts and keeps a cast entry's imageUrl (the create-from-image source)", () => {
    const parsed = productionDocumentSchema().parse({
      ...minimal,
      cast: [{ kind: "character", name: "N", imageUrl: "https://x/y.png" }],
    })
    expect(parsed.cast).toEqual([
      { kind: "character", name: "N", imageUrl: "https://x/y.png" },
    ])
  })

  it("strips a root `voice` key — an unknown key now that voice lives at scenes[].voice (D7)", () => {
    const parsed = productionDocumentSchema().parse({ ...minimal, voice: { a: 1 } })
    expect("voice" in parsed).toBe(false)
  })

  // `music` is the only lenient-unknown root slot left (D7 retired the
  // `voice` one — a root `voice` is an ordinary unknown key now, see above) —
  // it stays `z.unknown()` at THIS boundary (fix round 2, R42) so a malformed
  // soundtrack must not fail the whole import the way it briefly did when
  // this slot was hard-typed. `repairMusic` (import-repair-sound.ts) is
  // where the real narrowing (and the one-warning drop) happens; see
  // import-repair.test.ts's "repair — music" describe block for that half.
  it("passes ANY music value through unnarrowed — a wrong shape does not fail the whole document", () => {
    for (const music of [null, "strings", {}, { genre: "cinematic" }, [1, 2, 3]]) {
      const parsed = productionDocumentSchema().safeParse({ ...minimal, music })
      expect(parsed.success, JSON.stringify(music)).toBe(true)
      expect(parsed.success && parsed.data.music).toEqual(music)
    }
  })

  it("passes a well-formed music document through untouched too", () => {
    const parsed = productionDocumentSchema().parse({
      ...minimal,
      music: { prompt: "strings", genre: "not-a-catalog-genre", vocals: "chanting" },
    })
    expect(parsed.music).toEqual({
      prompt: "strings",
      genre: "not-a-catalog-genre",
      vocals: "chanting",
    })
  })
})
