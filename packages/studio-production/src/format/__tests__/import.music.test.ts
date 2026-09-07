import { describe, it, expect } from "vitest"

import { videoDurationOptions } from "../../model-menu"
import { EXAMPLE_LIBRARY } from "../fixtures/library"
import {
  importProduction,
  type ImportOptions,
  type ImportResult,
} from "../import"
import { buildFormatRegistry } from "../registry"

/**
 * The production's ONE soundtrack across the whole import path (spec D5, R42)
 * — the plan a document's root `music` maps to, and the refusal to let a
 * malformed value there fail the import around it. Split out of
 * `import.test.ts` in the follow-ups fix wave once that file passed the
 * 800-line house cap.
 *
 * The local builders below are this file's OWN copies rather than an import
 * from a sibling: importing a `.test.ts` file would re-run its `describe`/`it`
 * blocks a second time — the same standalone-with-local-fixtures precedent
 * `production-bundle.recipe.test.ts` set. Every case is a PURE MOVE.
 */

const REGISTRY = buildFormatRegistry()

const options = (
  candidates = EXAMPLE_LIBRARY,
): ImportOptions => ({
  candidates,
  durationsFor: (model) => videoDurationOptions(model).map((d) => d.value),
  registry: REGISTRY,
})

describe("importProduction — the soundtrack plan (D5)", () => {
  const scene = { frame: { prompt: "an alley" } }

  it("maps a full music document onto ImportResult.music, filling the picker defaults", () => {
    const out = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        scenes: [scene],
        music: {
          prompt: "a driving synth pulse",
          duration: 20,
          vocals: "vocals",
          vocalGender: "female",
          genre: "synthwave",
          mood: "energetic",
          instruments: ["synth", "drums"],
          singingStyle: "powerful",
          language: "english",
        },
      },
      options(),
    )
    expect(out.ok && out.music).toEqual({
      prompt: "a driving synth pulse",
      duration: 20,
      selections: {
        vocals: "vocals",
        vocalGender: "female",
        instruments: ["synth", "drums"],
        genre: "synthwave",
        mood: "energetic",
        singingStyle: "powerful",
        language: "english",
      },
    })
  })

  it("fills vocals/vocalGender/instruments with the instrumental defaults when the document omits them", () => {
    const out = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        scenes: [scene],
        music: { prompt: "ambient pads" },
      },
      options(),
    )
    expect(out.ok && out.music).toEqual({
      prompt: "ambient pads",
      selections: { vocals: "instrumental", vocalGender: "any", instruments: [] },
    })
  })

  it("omits ImportResult.music when the document carries none", () => {
    const out = importProduction(
      { format: "nodaro-studio-production", version: 1, scenes: [scene] },
      options(),
    )
    expect(out.ok && "music" in out).toBe(false)
  })

  it("drops an unknown genre from the mapped music, with a warning, rather than failing the import", () => {
    const out = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        scenes: [scene],
        music: { prompt: "strings", genre: "nope" },
      },
      options(),
    )
    expect(out.ok && out.music).toEqual({
      prompt: "strings",
      selections: { vocals: "instrumental", vocalGender: "any", instruments: [] },
    })
    expect(out.ok && out.warnings.some((w) => w.code === "unknown-id" && w.path === "music.genre")).toBe(
      true,
    )
  })

  it("sweeps an alien key on music, dropping it with unknown-key", () => {
    const out = importProduction(
      {
        format: "nodaro-studio-production",
        version: 1,
        scenes: [scene],
        music: { prompt: "strings", tempo: 120 },
      },
      options(),
    )
    expect(out.ok && out.warnings).toContainEqual({
      code: "unknown-key",
      message: '"tempo" is not part of this format — dropped.',
      path: "music.tempo",
    })
  })
})

describe("importProduction — a malformed music value never fails the whole import (fix round 2, R42)", () => {
  const scene = { frame: { prompt: "an alley" } }
  const base = { format: "nodaro-studio-production" as const, version: 1, scenes: [scene] }

  // Before D5 the root `music` was `z.unknown()` (accepted, then dropped with
  // a `reserved` warning) and the published skill never said `prompt` was
  // required — so `music: null`, `music: {}`, or a plausible pre-D5 output
  // like `{ genre: "cinematic" }` are all documents a real file or an older
  // catalog could carry. Each must still import `ok: true` with the scenes
  // intact and exactly one music warning — never `{ ok: false }`.
  const malformed: ReadonlyArray<{ name: string; music: unknown }> = [
    { name: "null", music: null },
    { name: "a bare string", music: "strings" },
    { name: "an empty object", music: {} },
    { name: "fields but no prompt (plausible pre-D5 output)", music: { genre: "cinematic" } },
    { name: "a wrong-typed field", music: { prompt: "x", instruments: "piano" } },
  ]

  for (const { name, music } of malformed) {
    it(`imports ok:true with the scenes intact and one music warning — ${name}`, () => {
      const out = importProduction({ ...base, music }, options())
      expect(out.ok).toBe(true)
      if (!out.ok) return
      expect(out.shots).toHaveLength(1)
      expect(out.warnings.filter((w) => w.path?.startsWith("music"))).toHaveLength(1)
      expect("music" in out).toBe(false)
    })
  }

  it("still maps a genuinely valid node — the malformed cases above aren't blanket-dropping everything", () => {
    const out = importProduction({ ...base, music: { prompt: "strings" } }, options())
    expect(out.ok && out.music).toEqual({
      prompt: "strings",
      selections: { vocals: "instrumental", vocalGender: "any", instruments: [] },
    })
  })
})
