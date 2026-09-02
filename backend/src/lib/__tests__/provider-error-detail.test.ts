import { describe, it, expect } from "vitest"
import { redactProviderDetail, providerDetailOf, ERROR_DETAIL_MAX } from "../provider-error-detail.js"

describe("redactProviderDetail", () => {
  it("keeps the diagnostic text and the URL host, drops path and query", () => {
    const raw =
      'createTask failed: 422 - {"msg":"image_url https://cdn.nodaro.ai/uploads/images/abc.jpg?token=SECRET not reachable"}'
    expect(redactProviderDetail(raw)).toBe(
      'createTask failed: 422 - {"msg":"image_url cdn.nodaro.ai/… not reachable"}',
    )
  })

  it("strips bearer tokens and secret-looking query params outside URLs", () => {
    expect(redactProviderDetail("Authorization: Bearer abc.def-ghi rejected")).toBe(
      "Authorization: Bearer <redacted> rejected",
    )
    expect(redactProviderDetail("retry with ?api_key=12345&x=1")).toBe("retry with ?api_key=<redacted>&x=1")
  })

  it("collapses whitespace and caps at ERROR_DETAIL_MAX", () => {
    const raw = "a".repeat(ERROR_DETAIL_MAX + 50) + "\n\n  tail"
    const out = redactProviderDetail(raw)!
    expect(out.length).toBe(ERROR_DETAIL_MAX)
    expect(out).not.toContain("\n")
  })

  it("returns null for empty input", () => {
    expect(redactProviderDetail(null)).toBeNull()
    expect(redactProviderDetail(undefined)).toBeNull()
    expect(redactProviderDetail("   ")).toBeNull()
  })

  it("survives a malformed URL without throwing", () => {
    expect(redactProviderDetail("see https://[bad")).toBe("see <url>")
  })
})

describe("providerDetailOf", () => {
  it("reads internalDetails off a KieError-shaped error and redacts it", () => {
    const err = Object.assign(new Error("Generation failed."), {
      internalDetails: "task failed: [400] prompt rejected https://kie.ai/x?sig=abc",
    })
    expect(providerDetailOf(err)).toBe("task failed: [400] prompt rejected kie.ai/…")
  })

  it("returns null for a plain Error or a non-error", () => {
    expect(providerDetailOf(new Error("boom"))).toBeNull()
    expect(providerDetailOf("boom")).toBeNull()
    expect(providerDetailOf(undefined)).toBeNull()
  })
})
