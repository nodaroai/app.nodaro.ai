import { describe, expect, it } from "vitest"
import {
  parseUploadFaststartEnabled,
  uploadFaststartEnabled,
  uploadFaststartMaxFileRemuxes,
  UPLOAD_FASTSTART_MAX_FILE_REMUXES_DEFAULT,
} from "../config.js"

describe("UPLOAD_FASTSTART_ENABLED", () => {
  it.each([
    [undefined, true],
    ["", true],
    ["true", true],
    ["1", true],
    ["0", true],
    ["false", false],
    [" FALSE ", false],
  ])("%j -> %s (unset or anything but false means on)", (value, on) => {
    expect(parseUploadFaststartEnabled(value)).toBe(on)
  })
  it("the test environment leaves it unset, so the rewrite is on", () => expect(uploadFaststartEnabled()).toBe(true))
})

describe("UPLOAD_FASTSTART_MAX_FILE_REMUXES", () => {
  it("the test environment leaves it unset, so the file lane runs two at once", () => {
    expect(uploadFaststartMaxFileRemuxes()).toBe(2)
    expect(UPLOAD_FASTSTART_MAX_FILE_REMUXES_DEFAULT).toBe(2)
  })
})
