/**
 * getAppVersion: env APP_VERSION (image-baked release tag) wins; dev servers
 * fall back to backend/package.json via fs (NOT an ESM json import — the
 * compiled dist would crash at boot on missing import attributes, a failure
 * vitest's resolver never sees).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { getAppVersion, _resetAppVersionCacheForTests } from "../app-version.js"

const saved = process.env.APP_VERSION

beforeEach(() => _resetAppVersionCacheForTests())
afterEach(() => {
  if (saved === undefined) delete process.env.APP_VERSION
  else process.env.APP_VERSION = saved
  _resetAppVersionCacheForTests()
})

describe("getAppVersion", () => {
  it("the image-baked env version wins", () => {
    process.env.APP_VERSION = "v2.0.0"
    expect(getAppVersion()).toBe("v2.0.0")
  })

  it("whitespace-only env is treated as unset", () => {
    process.env.APP_VERSION = "   "
    expect(getAppVersion()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it("dev fallback reads the real backend package.json", () => {
    delete process.env.APP_VERSION
    expect(getAppVersion()).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
