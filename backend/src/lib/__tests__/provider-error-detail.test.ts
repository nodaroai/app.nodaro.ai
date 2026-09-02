import { describe, it, expect, vi } from "vitest"
import {
  redactProviderDetail,
  providerDetailOf,
  logProviderFailure,
  ERROR_DETAIL_MAX,
} from "../provider-error-detail.js"

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

describe("logProviderFailure", () => {
  it("emits ONE line carrying the job id, the user message and the redacted provider text", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    logProviderFailure(
      "reconcile/kie",
      "11111111-2222-3333-4444-555555555555",
      "Generation failed. Please try again.",
      "task failed: [500] Internal Error at https://api.kie.ai/v1/x?token=abc",
    )
    expect(spy).toHaveBeenCalledTimes(1)
    const line = spy.mock.calls[0]![0] as string
    expect(line.split("\n")).toHaveLength(1)
    expect(line).toContain("[reconcile/kie]")
    expect(line).toContain("11111111-2222-3333-4444-555555555555")
    expect(line).toContain("Internal Error")
    expect(line).not.toContain("token=abc")
    expect(line).not.toContain("https://api.kie.ai/v1/x")
    spy.mockRestore()
  })

  it("still logs when there is no provider text, so the failure is never silent", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    logProviderFailure("reconcile/fal", "job-1", "Generation failed on the provider.", null)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]![0]).toContain("<none>")
    spy.mockRestore()
  })

  it("is safe on already-redacted text (the writers redact before markFailed sees it)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    logProviderFailure("reconcile/kie", "job-2", "msg", "boom at api.kie.ai/… Bearer <redacted>")
    expect(spy.mock.calls[0]![0]).toContain("api.kie.ai/…")
    spy.mockRestore()
  })
})
