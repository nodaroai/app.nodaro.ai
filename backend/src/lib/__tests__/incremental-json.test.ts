import { describe, it, expect } from "vitest"
import { createIncrementalJsonParser, type JsonPath } from "../incremental-json.js"

interface Emission {
  path: JsonPath
  value: unknown
}

function collect(chunks: readonly string[]): { out: Emission[]; failed: boolean } {
  const out: Emission[] = []
  const parser = createIncrementalJsonParser((path, value) => out.push({ path: [...path], value }))
  for (const chunk of chunks) parser.push(chunk)
  return { out, failed: parser.failed }
}

/** Every way the tests slice a document: whole, every single cut point, and fixed-size runs. */
function chunkings(text: string): string[][] {
  const out: string[][] = [[text]]
  for (let i = 1; i < text.length; i++) out.push([text.slice(0, i), text.slice(i)])
  for (const size of [1, 2, 3, 5, 7]) {
    const run: string[] = []
    for (let i = 0; i < text.length; i += size) run.push(text.slice(i, i + size))
    out.push(run)
  }
  return out
}

/** A tool input shaped like the picker analyzer's, with every awkward token kind in it. */
const DOC =
  '{"person":{"type":"handsome-man","age":"age-30s","distinctiveFeature":["feature-freckles","feature-dimples"]},' +
  '"styling":{"headwear":"hw-turban","note":"a \\"quoted\\" word\\\\ and \\u00e9"},' +
  '"gaps":{"missingItems":[],"missingCategories":[{"picker":"person","suggestedDimension":"tattoo","observed":"x"}]},' +
  '"n":-12.5e2,"flags":[true,false,null]}'

describe("createIncrementalJsonParser", () => {
  it("reports every value once, children before the container that holds them", () => {
    const { out, failed } = collect([DOC])
    expect(failed).toBe(false)
    expect(out.map((e) => e.path)).toEqual([
      ["person", "type"],
      ["person", "age"],
      ["person", "distinctiveFeature", 0],
      ["person", "distinctiveFeature", 1],
      ["person", "distinctiveFeature"],
      ["person"],
      ["styling", "headwear"],
      ["styling", "note"],
      ["styling"],
      ["gaps", "missingItems"],
      ["gaps", "missingCategories", 0, "picker"],
      ["gaps", "missingCategories", 0, "suggestedDimension"],
      ["gaps", "missingCategories", 0, "observed"],
      ["gaps", "missingCategories", 0],
      ["gaps", "missingCategories"],
      ["gaps"],
      ["n"],
      ["flags", 0],
      ["flags", 1],
      ["flags", 2],
      ["flags"],
      [],
    ])
    expect(out.at(-1)?.value).toEqual(JSON.parse(DOC))
  })

  it("decodes values exactly as JSON.parse does", () => {
    const { out } = collect([DOC])
    const byPath = new Map(out.map((e) => [JSON.stringify(e.path), e.value]))
    expect(byPath.get('["styling","note"]')).toBe('a "quoted" word\\ and é')
    expect(byPath.get('["n"]')).toBe(-1250)
    expect(byPath.get('["person","distinctiveFeature"]')).toEqual(["feature-freckles", "feature-dimples"])
    expect(byPath.get('["flags"]')).toEqual([true, false, null])
    expect(byPath.get('["gaps","missingItems"]')).toEqual([])
  })

  it("emits the same values in the same order however the text is split", () => {
    const whole = collect([DOC]).out
    for (const chunks of chunkings(DOC)) {
      const { out, failed } = collect(chunks)
      expect(failed).toBe(false)
      expect(out).toEqual(whole)
    }
  })

  it("never reports a string before its closing quote", () => {
    expect(collect(['{"person":{"type":"hands']).out).toEqual([])
    expect(collect(['{"person":{"type":"handsome-man']).out).toEqual([])
    expect(collect(['{"person":{"type":"handsome-man"']).out).toEqual([
      { path: ["person", "type"], value: "handsome-man" },
    ])
  })

  it("never reports a key's value while the key itself is still being written", () => {
    expect(collect(['{"person":{"ty']).out).toEqual([])
    expect(collect(['{"person":{"type"']).out).toEqual([])
    expect(collect(['{"person":{"type":']).out).toEqual([])
  })

  it("holds a number until a delimiter proves it has ended", () => {
    expect(collect(['{"n":12']).out).toEqual([])
    expect(collect(['{"n":12', "3,"]).out).toEqual([{ path: ["n"], value: 123 }])
    expect(collect(['{"n":-0.5e', "+2}"]).out.map((e) => e.value)).toEqual([-50, { n: -50 }])
  })

  it("reports a literal once it is spelled out in full", () => {
    expect(collect(['{"f":tru']).out).toEqual([])
    expect(collect(['{"f":tru', "e"]).out).toEqual([{ path: ["f"], value: true }])
  })

  it("reports a multi-pick array whole only when it closes", () => {
    const partial = collect(['{"f":["a","b"']).out
    expect(partial.map((e) => e.path)).toEqual([["f", 0], ["f", 1]])
    const closed = collect(['{"f":["a","b"]']).out
    expect(closed.at(-1)).toEqual({ path: ["f"], value: ["a", "b"] })
  })

  it("decodes escapes split across chunks, including \\u escapes and surrogate pairs", () => {
    expect(collect(['{"s":"a\\', '"b"}']).out[0]).toEqual({ path: ["s"], value: 'a"b' })
    expect(collect(['{"s":"\\u00', 'e9"}']).out[0]).toEqual({ path: ["s"], value: "é" })
    expect(collect(['{"s":"\\ud83d', '\\ude00"}']).out[0]).toEqual({ path: ["s"], value: "\u{1F600}" })
  })

  it("keeps an escaped quote inside a key", () => {
    expect(collect(['{"a\\"b":1}']).out[0]).toEqual({ path: ['a"b'], value: 1 })
  })

  it("treats pretty-printed input exactly like compact input", () => {
    const pretty = JSON.stringify(JSON.parse(DOC), null, 2)
    expect(collect([pretty]).out).toEqual(collect([DOC]).out)
  })

  it("builds own properties exactly as JSON.parse does, even for a __proto__ key", () => {
    const text = '{"person":{"__proto__":{"age":"age-30s"},"type":"x"},"b":2}'
    const root = collect([text]).out.at(-1)?.value as Record<string, Record<string, unknown>>
    expect(Object.getPrototypeOf(root.person)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(root.person, "__proto__")).toBe(true)
    expect((root.person as { age?: unknown }).age).toBeUndefined()
    expect(JSON.stringify(root)).toBe(JSON.stringify(JSON.parse(text)))
  })

  it("keeps the last value of a repeated key, as JSON.parse does", () => {
    const text = '{"a":1,"b":{"c":1},"a":2,"b":{"d":2}}'
    expect(collect([text]).out.at(-1)?.value).toEqual(JSON.parse(text))
  })

  it("reports empty containers", () => {
    expect(collect(['{"a":{},"b":[]}']).out).toEqual([
      { path: ["a"], value: {} },
      { path: ["b"], value: [] },
      { path: [], value: { a: {}, b: [] } },
    ])
  })

  it("marks malformed input failed, never throws, and reports nothing after the fault", () => {
    for (const bad of ['{"a" 1}', '{"a":1}}', '{"a":tx}', '{"a":"\\q"}', '{"a":01}', "{'a':1}", '{"a":"line\nbreak"}']) {
      const { failed } = collect([bad])
      expect(failed, bad).toBe(true)
    }
    const { out, failed } = collect(['{"a":"ok",', '"b" "nope"', ',"c":"late"}'])
    expect(failed).toBe(true)
    expect(out).toEqual([{ path: ["a"], value: "ok" }])
  })
})
