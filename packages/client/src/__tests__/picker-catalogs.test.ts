import { describe, it, expect, vi } from "vitest"
import { PickerCatalogsResource } from "../resources/picker-catalogs.js"

function fakeClient() {
  const request = vi.fn().mockResolvedValue({ data: { nodeType: "setting" } })
  return { request } as never
}

describe("PickerCatalogsResource", () => {
  it("list() GETs /v1/picker-catalogs", async () => {
    const client = fakeClient()
    await new PickerCatalogsResource(client).list()
    expect((client as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledWith(
      "GET",
      "/v1/picker-catalogs",
    )
  })

  it("get() encodes nodeType and appends query params", async () => {
    const client = fakeClient()
    await new PickerCatalogsResource(client).get("setting", { detail: "full", category: "Urban" })
    expect((client as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledWith(
      "GET",
      "/v1/picker-catalogs/setting?detail=full&category=Urban",
    )
  })

  it("get() with no opts omits the query string", async () => {
    const client = fakeClient()
    await new PickerCatalogsResource(client).get("mood")
    expect((client as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledWith(
      "GET",
      "/v1/picker-catalogs/mood",
    )
  })
})
