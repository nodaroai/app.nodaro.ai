import { describe, expect, it } from "vitest"
import { SERVER_ONLY_KEY_PREFIX, withoutServerOnlyKeys } from "../server-only-keys.js"

describe("withoutServerOnlyKeys", () => {
  it("drops every top-level key that starts with two underscores and keeps the rest", () => {
    const body = { targetLanguage: "fr", __probedDurationSec: 1, __anything: "x", _single: true }
    expect(withoutServerOnlyKeys(body)).toEqual({ targetLanguage: "fr", _single: true })
  })

  it("returns a new object and leaves the body it was given as it was", () => {
    const body = { a: 1, __b: 2 }
    const result = withoutServerOnlyKeys(body)
    expect(result).not.toBe(body)
    expect(body).toEqual({ a: 1, __b: 2 })
  })

  it("returns the same object when it holds no such key", () => {
    const body = { a: 1, nested: { __kept: 1 } }
    expect(withoutServerOnlyKeys(body)).toBe(body)
  })

  it("leaves nested values as they are", () => {
    expect(withoutServerOnlyKeys({ __top: 1, params: { __nested: 2 } })).toEqual({ params: { __nested: 2 } })
  })

  it("drops a key parsed from JSON whatever it names", () => {
    const body = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}') as Record<string, unknown>
    const result = withoutServerOnlyKeys(body)
    expect(Object.keys(result)).toEqual(["a"])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it("returns anything but a plain object as it is", () => {
    const list = [{ __a: 1 }]
    const buffer = Buffer.from("{}")
    expect(withoutServerOnlyKeys(list)).toBe(list)
    expect(withoutServerOnlyKeys(buffer)).toBe(buffer)
    expect(withoutServerOnlyKeys('{"__a":1}')).toBe('{"__a":1}')
    expect(withoutServerOnlyKeys(null)).toBeNull()
    expect(withoutServerOnlyKeys(undefined)).toBeUndefined()
  })

  it("is the two-underscore prefix", () => {
    expect(SERVER_ONLY_KEY_PREFIX).toBe("__")
  })
})
