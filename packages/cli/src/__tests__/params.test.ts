import { describe, it, expect, afterAll } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseParamPairs, loadParamsFile, mergeParams, resolveParams } from "../params.js"

describe("parseParamPairs", () => {
  it("returns empty object when no pairs given", () => {
    expect(parseParamPairs(undefined)).toEqual({})
    expect(parseParamPairs([])).toEqual({})
  })

  it("parses simple string values", () => {
    expect(parseParamPairs(["prompt=hello"])).toEqual({ prompt: "hello" })
  })

  it("coerces booleans", () => {
    expect(parseParamPairs(["a=true", "b=false"])).toEqual({ a: true, b: false })
  })

  it("coerces null", () => {
    expect(parseParamPairs(["x=null"])).toEqual({ x: null })
  })

  it("coerces integers and floats", () => {
    expect(parseParamPairs(["duration=8", "ratio=1.5", "neg=-3"])).toEqual({
      duration: 8,
      ratio: 1.5,
      neg: -3,
    })
  })

  it("leaves non-numeric strings as strings even when they start with digits", () => {
    expect(parseParamPairs(["seed=8a", "version=1.2.3"])).toEqual({ seed: "8a", version: "1.2.3" })
  })

  it("preserves additional `=` characters in the value", () => {
    expect(parseParamPairs(["query=a=b=c"])).toEqual({ query: "a=b=c" })
  })

  it("rejects pairs without an `=`", () => {
    expect(() => parseParamPairs(["just-a-key"])).toThrow(/expected key=value/)
  })

  it("rejects pairs with an empty key", () => {
    expect(() => parseParamPairs(["=value"])).toThrow(/empty key/)
  })

  it("last write wins on duplicate keys", () => {
    expect(parseParamPairs(["k=1", "k=2"])).toEqual({ k: 2 })
  })
})

describe("loadParamsFile", () => {
  const dir = mkdtempSync(join(tmpdir(), "nci-params-"))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it("loads a JSON object", () => {
    const path = join(dir, "ok.json")
    writeFileSync(path, JSON.stringify({ a: 1, b: "x", c: true }))
    expect(loadParamsFile(path)).toEqual({ a: 1, b: "x", c: true })
  })

  it("rejects a JSON array at the top level", () => {
    const path = join(dir, "array.json")
    writeFileSync(path, "[1, 2, 3]")
    expect(() => loadParamsFile(path)).toThrow(/JSON object at the top level/)
  })

  it("rejects a JSON scalar at the top level", () => {
    const path = join(dir, "scalar.json")
    writeFileSync(path, '"hello"')
    expect(() => loadParamsFile(path)).toThrow(/JSON object at the top level/)
  })

  it("reports a clear error for invalid JSON", () => {
    const path = join(dir, "bad.json")
    writeFileSync(path, "{ not valid json")
    expect(() => loadParamsFile(path)).toThrow(/not valid JSON/)
  })

  it("reports a clear error for missing files", () => {
    expect(() => loadParamsFile(join(dir, "does-not-exist.json"))).toThrow(/cannot read --params-file/)
  })
})

describe("mergeParams", () => {
  it("returns flags-only when file is empty", () => {
    expect(mergeParams({}, { a: 1 })).toEqual({ a: 1 })
  })

  it("returns file-only when flags are empty", () => {
    expect(mergeParams({ a: 1 }, {})).toEqual({ a: 1 })
  })

  it("flags override file values", () => {
    expect(mergeParams({ a: 1, b: 2 }, { a: 9 })).toEqual({ a: 9, b: 2 })
  })

  it("does not mutate either input", () => {
    const file = { a: 1 }
    const flags = { b: 2 }
    mergeParams(file, flags)
    expect(file).toEqual({ a: 1 })
    expect(flags).toEqual({ b: 2 })
  })
})

describe("resolveParams", () => {
  const dir = mkdtempSync(join(tmpdir(), "nci-resolve-"))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it("returns empty object when both inputs are absent", () => {
    expect(resolveParams(undefined, undefined)).toEqual({})
  })

  it("returns flags-only when no file path given", () => {
    expect(resolveParams(["a=1"], undefined)).toEqual({ a: 1 })
  })

  it("returns file-only when no flags given", () => {
    const path = join(dir, "f.json")
    writeFileSync(path, JSON.stringify({ a: 1 }))
    expect(resolveParams(undefined, path)).toEqual({ a: 1 })
  })

  it("flags override file values for the same key", () => {
    const path = join(dir, "g.json")
    writeFileSync(path, JSON.stringify({ a: 1, b: 2 }))
    expect(resolveParams(["a=9"], path)).toEqual({ a: 9, b: 2 })
  })
})
