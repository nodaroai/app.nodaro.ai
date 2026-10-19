// @test-units-by-name holds every use-case type's body to the editor's sent-settings tables, type by type
/**
 * The tables the editor reads to know which use-case settings a request body
 * takes as null and as an empty string (`usecaseSettingTakesNull` /
 * `usecaseSettingTakesEmpty`, rendered by gen:skills) agree with the bodies
 * themselves, for every type and every setting it sends. A body that comes to
 * take (or stop taking) either fails here until `npm run gen:skills` renders it.
 */
import { describe, expect, it } from "vitest"
import { USE_CASE_NODE_TYPES, usecaseDescriptor, usecaseSettingTakesEmpty, usecaseSettingTakesNull } from "@nodaro/render-rules"
import { usecaseBodyTakesEmpty, usecaseBodyTakesNull } from "../bodies.js"

describe("the editor's copy of the bodies' null and empty-string rules", () => {
  for (const type of USE_CASE_NODE_TYPES) {
    it(`${type}: agrees with its body on every setting`, () => {
      const keys = usecaseDescriptor(type).settingKeys
      expect(keys.filter((k) => usecaseSettingTakesNull(type, k))).toEqual(keys.filter((k) => usecaseBodyTakesNull(type, k)))
      expect(keys.filter((k) => usecaseSettingTakesEmpty(type, k))).toEqual(keys.filter((k) => usecaseBodyTakesEmpty(type, k)))
    })
  }
  it("knows no type that is not a use-case type", () => {
    expect(usecaseSettingTakesNull("generate-image", "framing")).toBe(false)
    expect(usecaseSettingTakesEmpty("generate-image", "instructions")).toBe(false)
  })
  it("free text takes an empty string, a choice does not", () => {
    expect(usecaseBodyTakesEmpty("tighten-episode", "instructions")).toBe(true)
    expect(usecaseBodyTakesEmpty("tighten-episode", "captionStyle")).toBe(false)
    expect(usecaseBodyTakesEmpty("tighten-episode", "planTier")).toBe(false)
  })
})
