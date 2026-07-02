import { describe, it, expect, vi } from "vitest"

vi.mock("../../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const { jobResultWithWidget } = await import("../tools/_verb-helpers.js")

const session = { userId: "u1", scopes: [], clientName: "Claude" } as never

describe("job result text contract", () => {
  const result = jobResultWithWidget({
    jobId: "job-123",
    label: "image generation",
    session,
    widgetKind: "image",
    widgetData: { prompt: "p" },
  })
  const text = result.content[0]!.text

  it("carries the label and job id", () => {
    expect(text).toContain("image generation started (id job-123)")
  })
  it("makes the card the primary pointer and forbids gallery-steering", () => {
    expect(text.toLowerCase()).toContain("card")
    expect(text).toContain("do not send the user to the gallery")
  })
  it("never contains the gallery URL (the whole point of this change)", () => {
    expect(text).not.toContain("app.nodaro.ai/gallery")
  })
  it("gives non-card clients the get_job fallback, without the Cursor traps", () => {
    expect(text).toContain("get_job")
    expect(text).not.toContain("tasks/get")
  })
  it("no-widgetKind variant gets the same text, no structuredContent", () => {
    const r = jobResultWithWidget({ jobId: "j2", label: "x", session })
    expect(r.content[0]!.text).not.toContain("app.nodaro.ai/gallery")
    expect((r as { structuredContent?: unknown }).structuredContent).toBeUndefined()
  })
  it("legacy jobResult() is gone (drift-back guard)", async () => {
    const mod = await import("../tools/_verb-helpers.js")
    expect((mod as Record<string, unknown>).jobResult).toBeUndefined()
  })
})
