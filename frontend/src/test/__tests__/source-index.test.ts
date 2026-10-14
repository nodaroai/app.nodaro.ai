// @test-watches frontend/src/test/source-index.ts
/**
 * The guards' parse cache must never serve a result for text it was not
 * computed from: a stale hit would let a guard pass on a file it never read.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { guardKey, perSourceFile } from "../source-index"

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "source-index-"))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function counting(): { readonly derive: (text: string) => string; readonly calls: () => number } {
  let calls = 0
  const derive = (text: string) => {
    calls += 1
    return text.toUpperCase()
  }
  return { derive, calls: () => calls }
}

describe("perSourceFile", () => {
  it("derives a file once while it is unchanged", () => {
    const file = path.join(dir, "a.ts")
    fs.writeFileSync(file, "one")
    const { derive, calls } = counting()
    expect(perSourceFile("k", file, derive)).toBe("ONE")
    expect(perSourceFile("k", file, derive)).toBe("ONE")
    expect(calls()).toBe(1)
  })

  it("derives again once the file changes", () => {
    const file = path.join(dir, "a.ts")
    fs.writeFileSync(file, "one")
    const { derive, calls } = counting()
    perSourceFile("k", file, derive)
    fs.writeFileSync(file, "three")
    expect(perSourceFile("k", file, derive)).toBe("THREE")
    expect(calls()).toBe(2)
  })

  it("keeps each key's result apart", () => {
    const file = path.join(dir, "a.ts")
    fs.writeFileSync(file, "one")
    expect(perSourceFile("k1", file, (text) => `${text}:1`)).toBe("one:1")
    expect(perSourceFile("k2", file, (text) => `${text}:2`)).toBe("one:2")
  })
})

describe("guardKey", () => {
  it("changes when the guard's own file changes, and with what it depends on", () => {
    const guard = path.join(dir, "guard.test.ts")
    fs.writeFileSync(guard, "rules")
    const before = guardKey(guard, "a")
    expect(guardKey(guard, "a")).toBe(before)
    expect(guardKey(guard, "b")).not.toBe(before)
    fs.writeFileSync(guard, "rules, edited")
    expect(guardKey(guard, "a")).not.toBe(before)
  })
})
