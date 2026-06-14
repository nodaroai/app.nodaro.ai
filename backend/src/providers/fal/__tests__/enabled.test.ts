import { describe, it, expect, vi, beforeEach } from "vitest"

// falEnabled() reads config.FAL_KEY. We mutate a ref the mock returns so a
// single module instance reflects both states without re-importing.
const { mockConfig } = vi.hoisted(() => ({ mockConfig: { FAL_KEY: "" } }))

vi.mock("@/lib/config.js", () => ({ config: mockConfig }))

import { falEnabled } from "../enabled.js"

describe("falEnabled", () => {
  beforeEach(() => {
    mockConfig.FAL_KEY = ""
  })

  it("returns false when FAL_KEY is empty", () => {
    mockConfig.FAL_KEY = ""
    expect(falEnabled()).toBe(false)
  })

  it("returns true when FAL_KEY is set", () => {
    mockConfig.FAL_KEY = "fal-secret-key"
    expect(falEnabled()).toBe(true)
  })
})
