// @test-watches frontend/src/nodes/** tools/units/__fixtures__/use-case-output-shapes.json
import { readFileSync } from "node:fs"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import { describe, expect, it } from "vitest"
import { UNIT_NODE_DEFINITIONS } from "@/lib/unit-definitions"
import { unitOutputValue } from "@/lib/unit-compose"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"
import { usecaseSavedOutput } from "@/components/editor/workflow-editor/use-case-io"

/**
 * The precedence guard for use-case node units (decided 2026-10-18): a node
 * unit whose `execution.kind` is "use-case" hands on what the use-case reader
 * reads (use-case-io.ts — its plan on `json`, its text on `text`, else the
 * episode), never what the generic unit reader (`unitOutputValue`, a `from`
 * read) would. `extractNodeOutput` asks the use-case reader before the unit
 * reader, so equality here pins that branch ORDER: were the unit branch first,
 * the witness below shows the two readers hand on different values.
 *
 * Every use-case unit, over every saved shape and every pip any of them
 * declares (plus no pip), over the shared use-case output shapes fixture
 * (tools/units/__fixtures__/use-case-output-shapes.json). Mirrors the server's
 * services/workflow-engine/__tests__/use-case-unit-output-parity.test.ts.
 */
const SHAPES = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../tools/units/__fixtures__/use-case-output-shapes.json"), "utf8"),
) as Record<string, Record<string, unknown>>

const USE_CASE_UNITS = UNIT_NODE_DEFINITIONS.filter((u) => u.execution.kind === "use-case")
const PIPS: ReadonlyArray<string | undefined> = [undefined, ...new Set(USE_CASE_UNITS.flatMap((u) => u.handles.outputs.map((o) => o.id)))]

describe("a use-case unit's output is the use-case reader's (the precedence guard)", () => {
  it("there are use-case units to guard (never vacuous)", () => {
    expect(USE_CASE_UNITS.length).toBeGreaterThanOrEqual(2)
    expect(Object.keys(SHAPES).length).toBeGreaterThan(0)
  })

  for (const u of USE_CASE_UNITS) {
    describe(u.type, () => {
      for (const [shape, data] of Object.entries(SHAPES)) {
        it(`${shape}: every pip`, () => {
          const node = { id: "n", type: u.type, position: { x: 0, y: 0 }, data } as never
          for (const pip of PIPS) {
            expect(extractNodeOutput(node, pip), `${shape} ${pip ?? "(no pip)"}`).toEqual(usecaseSavedOutput(u.type, data, pip))
          }
        })
      }

      it("some shape and pip where the generic unit reader would hand on something else (the order matters)", () => {
        const differs = Object.entries(SHAPES).some(([, data]) =>
          PIPS.some((pip) => !isDeepStrictEqual(unitOutputValue(u, data, pip), usecaseSavedOutput(u.type, data, pip))))
        expect(differs).toBe(true)
      })
    })
  }
})

/**
 * Concrete values, so the guard above cannot pass on two readers that agree on
 * the wrong thing: what each reader hands on for two shapes of the fixture.
 */
describe("what the two readers hand on (pinned values)", () => {
  const unit = (type: string) => {
    const u = USE_CASE_UNITS.find((x) => x.type === type)
    if (!u) throw new Error(`${type} is not a use-case unit`)
    return u
  }
  const node = (type: string, data: Record<string, unknown>) => ({ id: "n", type, position: { x: 0, y: 0 }, data }) as never

  it("Tighten Episode, videoTakes: the episode it shows and its plan, not the active take; the generic reader has nothing", () => {
    const data = SHAPES.videoTakes
    const plan = JSON.stringify({ version: 1, segments: [{ start: 0, end: 10 }], dropped: [] })
    expect(extractNodeOutput(node("tighten-episode", data), "media")).toBe("https://r/g.mp4")
    expect(extractNodeOutput(node("tighten-episode", data), undefined)).toBe("https://r/g.mp4")
    expect(extractNodeOutput(node("tighten-episode", data), "json")).toBe(plan)
    for (const pip of ["media", "json", undefined]) expect(unitOutputValue(unit("tighten-episode"), data, pip)).toBeUndefined()
  })

  it("Chapters, chapters: its show notes, and its list on json; the generic reader has nothing", () => {
    const data = SHAPES.chapters
    expect(extractNodeOutput(node("episode-chapters", data), undefined)).toBe("0:00 Intro\n1:02 Main")
    expect(extractNodeOutput(node("episode-chapters", data), "json")).toBe(JSON.stringify([{ startMs: 0, title: "Intro" }, { startMs: 62000, title: "Main" }]))
    for (const pip of ["text", "json", undefined]) expect(unitOutputValue(unit("episode-chapters"), data, pip)).toBeUndefined()
  })
})
