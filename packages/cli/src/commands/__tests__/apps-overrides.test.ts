import { describe, it, expect } from "vitest"
import { parseOverridePairs } from "../apps.js"

describe("parseOverridePairs", () => {
  it("builds nested overrides and JSON-parses values", () =>
    expect(parseOverridePairs(["n1.promptPrefix=Studio portrait of", "n1.promptSuffix=\", 85mm\"", "n2.count=3"]))
      .toEqual({ n1: { promptPrefix: "Studio portrait of", promptSuffix: ", 85mm" }, n2: { count: 3 } }))
  it("undefined / empty → undefined", () => {
    expect(parseOverridePairs(undefined)).toBeUndefined()
    expect(parseOverridePairs([])).toBeUndefined()
  })
  it("rejects a malformed pair", () => expect(() => parseOverridePairs(["nofield=1"])).toThrow(/nodeId\.field=value/))
})
