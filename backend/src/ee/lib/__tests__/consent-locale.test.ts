import { describe, it, expect } from "vitest"
import { z } from "zod"
import { LANGUAGES } from "@nodaro/shared/i18n"
import { consentLocaleField } from "../consent-locale.js"

const body = z.object({ locale: consentLocaleField })

describe("consentLocaleField", () => {
  it("accepts every interface language the platform ships", () => {
    for (const { id } of LANGUAGES) {
      expect(body.parse({ locale: id }).locale).toBe(id)
    }
  })

  it("accepts the ids a consent is recorded under", () => {
    for (const id of ["en", "ja", "pt-BR"]) {
      expect(body.parse({ locale: id }).locale).toBe(id)
    }
  })

  it.each([
    ["an id the platform does not ship", "xx-XX"],
    ["the right id in the wrong case", "JA"],
    ["an empty string", ""],
    ["a number", 5],
    ["null", null],
    ["an object", {}],
  ])("reads %s as absent — never an error", (_label, value) => {
    const parsed = body.safeParse({ locale: value })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.locale).toBeUndefined()
  })

  it("reads a missing field as absent", () => {
    expect(body.parse({}).locale).toBeUndefined()
  })
})
