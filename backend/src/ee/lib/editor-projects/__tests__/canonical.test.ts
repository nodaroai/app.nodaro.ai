// @test-watches backend/src/ee/lib/editor-projects/__tests__/canonical-vectors.json
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { canonicalJson, contentHash } from "../canonical.js"

/**
 * The canonical text of a saved video-editor project. The editor writes it and
 * hashes it; the platform parses what it receives, writes it again and checks
 * the hash. Both sides carry the same `canonical-vectors.json` (copied byte for
 * byte from the editor's copy) and check their own function against it.
 */

interface Vector {
  readonly name: string
  readonly value: unknown
  readonly text: string
  readonly hash: string
}

const HERE = dirname(fileURLToPath(import.meta.url))
const vectors = JSON.parse(readFileSync(join(HERE, "canonical-vectors.json"), "utf8")) as Vector[]
const nodeSha256 = (text: string) => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")

describe("canonicalJson", () => {
  it("has the ten shared vectors, loaded with their minus zero intact", () => {
    expect(vectors).toHaveLength(10)
    const minusZero = vectors.find((v) => v.name === "minus zero written as 0")
    expect(Object.is((minusZero?.value as unknown[])[0], -0)).toBe(true)
  })

  for (const vector of vectors) {
    it(`matches the shared vector: ${vector.name}`, () => {
      const text = canonicalJson(vector.value)
      expect(text).toBe(vector.text)
      expect(nodeSha256(vector.text)).toBe(vector.hash)
      expect(contentHash(text)).toBe(vector.hash)
      // What the platform does with a save: parse the text, write it again.
      expect(canonicalJson(JSON.parse(text))).toBe(text)
    })
  }

  it("orders integer-like keys as text, never numbers first", () => {
    expect(canonicalJson({ 10: "x", 9: "y", 1: "z", a: 0 })).toBe('{"1":"z","10":"x","9":"y","a":0}')
  })

  it("sorts keys by UTF-16 code unit, not by locale", () => {
    expect(canonicalJson({ b: 1, B: 2, "é": 3, e: 4, "😀": 5, "￿": 6 })).toBe('{"B":2,"b":1,"e":4,"é":3,"😀":5,"￿":6}')
  })

  it("leaves out object members JSON has no value for, and writes null for them in arrays", () => {
    const fn = () => 1
    expect(canonicalJson({ b: undefined, a: 1, c: fn })).toBe('{"a":1}')
    expect(canonicalJson([undefined, fn, NaN, Infinity, 1])).toBe("[null,null,null,null,1]")
  })

  it("keeps a key named __proto__ that JSON.parse made an own property", () => {
    const parsed = JSON.parse('{"__proto__":{"x":1},"a":2}') as unknown
    expect(canonicalJson(parsed)).toBe('{"__proto__":{"x":1},"a":2}')
  })

  it("refuses what JSON cannot write", () => {
    expect(() => canonicalJson(undefined)).toThrow(TypeError)
    expect(() => canonicalJson({ n: BigInt(1) })).toThrow(TypeError)
    const loop: Record<string, unknown> = {}
    loop.self = loop
    expect(() => canonicalJson(loop)).toThrow(TypeError)
  })
})
