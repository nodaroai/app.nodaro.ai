// @test-watches backend/src/nodes/** tools/units/__fixtures__/use-case-output-shapes.json
import { readFileSync } from "node:fs"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import { describe, expect, it } from "vitest"
import { UNIT_NODE_DESCRIPTORS } from "../../../lib/unit-descriptors.js"
import { unitSavedOutput } from "../../../lib/unit-compose.js"
import { extractSavedNodeOutput } from "../output-extractor.js"
import { usecaseSavedNodeOutput } from "../use-case-output.js"

/**
 * The precedence guard for use-case node units (decided 2026-10-18): a node
 * unit whose `execution.kind` is "use-case" saves what the use-case reader
 * reads (use-case-output.ts `usecaseSavedNodeOutput` — the episode it shows,
 * its plan with the review applied, its text), never what the generic unit
 * reader (`unitSavedOutput`, a `from` read) would. `extractSavedNodeOutput`
 * asks the use-case reader before the unit reader, so equality here pins that
 * branch ORDER: were the unit branch first, the witness below shows the two
 * readers save different values.
 *
 * Every use-case unit, over every saved shape of the shared use-case output
 * shapes fixture (tools/units/__fixtures__/use-case-output-shapes.json). Mirrors the editor's
 * frontend/src/__tests__/use-case-unit-output-parity.test.ts.
 */
const SHAPES = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../../../tools/units/__fixtures__/use-case-output-shapes.json"), "utf8"),
) as Record<string, Record<string, unknown>>

const USE_CASE_UNITS = UNIT_NODE_DESCRIPTORS.filter((u) => u.execution.kind === "use-case")

describe("a use-case unit's saved output is the use-case reader's (the precedence guard)", () => {
  it("there are use-case units to guard (never vacuous)", () => {
    expect(USE_CASE_UNITS.length).toBeGreaterThanOrEqual(2)
    expect(Object.keys(SHAPES).length).toBeGreaterThan(0)
  })

  for (const u of USE_CASE_UNITS) {
    describe(u.type, () => {
      for (const [shape, data] of Object.entries(SHAPES)) {
        it(shape, () => {
          expect(extractSavedNodeOutput({ id: "n", type: u.type, data } as never)).toEqual(usecaseSavedNodeOutput(data))
        })
      }

      it("some shape where the generic unit reader would save something else (the order matters)", () => {
        const differs = Object.values(SHAPES).some((data) =>
          !isDeepStrictEqual(unitSavedOutput(u, data), usecaseSavedNodeOutput(data)))
        expect(differs).toBe(true)
      })
    })
  }
})

/**
 * Concrete values, so the guard above cannot pass on two readers that agree on
 * the wrong thing: what each reader saves for two shapes of the fixture.
 */
describe("what the two readers save (pinned values)", () => {
  const unit = (type: string) => {
    const u = USE_CASE_UNITS.find((x) => x.type === type)
    if (!u) throw new Error(`${type} is not a use-case unit`)
    return u
  }

  it("Tighten Episode, videoTakes: the episode it shows and its plan, not the active take; the generic reader has nothing", () => {
    const data = SHAPES.videoTakes
    expect(extractSavedNodeOutput({ id: "n", type: "tighten-episode", data } as never)).toEqual({
      videoUrl: "https://r/g.mp4",
      json: { version: 1, segments: [{ start: 0, end: 10 }], dropped: [] },
    })
    expect(unitSavedOutput(unit("tighten-episode"), data)).toBeUndefined()
  })

  it("Chapters, chapters: its show notes and its list; the generic reader has nothing", () => {
    const data = SHAPES.chapters
    expect(extractSavedNodeOutput({ id: "n", type: "episode-chapters", data } as never)).toEqual({
      text: "0:00 Intro\n1:02 Main",
      json: [{ startMs: 0, title: "Intro" }, { startMs: 62000, title: "Main" }],
    })
    expect(unitSavedOutput(unit("episode-chapters"), data)).toBeUndefined()
  })
})
