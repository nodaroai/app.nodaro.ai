/**
 * One fixture, two engines: every case in tools/fixtures/speech-estimate-cases.json
 * is met by the backend estimator here and by the editor's mirror
 * (frontend/src/lib/__tests__/speech-estimate.test.ts). A rule that changes on
 * one side without the other fails exactly one of the two suites.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { speechPriceUnits } from "@nodaro/shared"
import { speechEstimateChars, type SpeechEstimateContext } from "../speech-estimate.js"

type Repeat = { repeat: number; of: string; prefix?: string }
type Case = {
  name: string
  nodeType: string
  data: Record<string, unknown>
  ctx?: Record<string, unknown>
  expect: { runsAs: string; chars: number; exact: boolean; units: number }
}

const FIXTURE = resolve(__dirname, "../../../../tools/fixtures/speech-estimate-cases.json")
const { cases } = JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: Case[] }

/** Expand `{ repeat, of, prefix }` values into strings, anywhere in the value. */
function expand(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expand)
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>
    if (typeof o.repeat === "number" && typeof o.of === "string") {
      const r = o as Repeat
      return (r.prefix ?? "") + r.of.repeat(r.repeat)
    }
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, expand(v)]))
  }
  return value
}

describe("the speech estimate fixture — backend engine", () => {
  it("has a meaningful number of cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20)
  })

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const data = expand(c.data) as Record<string, unknown>
    const ctx = (c.ctx ? expand(c.ctx) : {}) as SpeechEstimateContext
    const e = speechEstimateChars(c.nodeType, data, ctx)
    expect({ runsAs: e.runsAs, chars: e.chars, exact: e.exact, units: speechPriceUnits(e.chars) }).toEqual(c.expect)
  })
})
