import { describe, it, expect, vi } from "vitest"

vi.mock("remotion", () => ({ Img: (p: Record<string, unknown>) => null }))

import { chooseMediaRender } from "../media-frame"

describe("chooseMediaRender", () => {
  it("renders media when a src is present and no error", () => {
    expect(chooseMediaRender("https://cdn/x.png", false)).toBe("media")
  })
  it("falls back when the src errored", () => {
    expect(chooseMediaRender("https://cdn/x.png", true)).toBe("fallback")
  })
  it("falls back when there is no src", () => {
    expect(chooseMediaRender(undefined, false)).toBe("fallback")
  })
})
