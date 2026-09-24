// The rendered look previews live on the Nodaro CDN, so only the Cloud edition
// may register them: a self-hosted install (Community / Business) must never
// call the CDN and keeps the drawn previews.
import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  vi.resetModules()
  vi.doUnmock("@/lib/edition")
})

async function bootWithEdition(cloud: boolean) {
  vi.doMock("@/lib/edition", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/edition")>()),
    isCloud: () => cloud,
  }))
  const ui = await import("@nodaro/picker-ui")
  ui.resetLookPreviewsForTests()
  const { bootstrapLookPreviews } = await import("@/lib/look-previews-bootstrap")
  bootstrapLookPreviews()
  return ui
}

describe("bootstrapLookPreviews", () => {
  it("registers the renders in the Cloud edition", async () => {
    const ui = await bootWithEdition(true)
    expect(ui.hasLookPreviews("style")).toBe(true)
    expect(ui.getLookPreviewUrl("lens", "fisheye")).toMatch(/^https:\/\/cdn\.nodaro\.ai\//)
  })

  it("registers nothing in a self-hosted edition", async () => {
    const ui = await bootWithEdition(false)
    for (const key of Object.keys(ui.LOOK_PREVIEW_SETS)) expect(ui.hasLookPreviews(key)).toBe(false)
  })
})
