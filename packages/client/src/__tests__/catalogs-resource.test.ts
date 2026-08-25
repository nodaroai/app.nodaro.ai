import { describe, it, expect, vi } from "vitest"
import { CatalogsResource } from "../resources/catalogs.js"

function fakeClient() {
  const request = vi.fn().mockResolvedValue({ data: [] })
  return { request } as never
}

describe("CatalogsResource", () => {
  it("list() GETs /v1/catalogs with no query by default", async () => {
    const client = fakeClient()
    await new CatalogsResource(client).list()
    expect((client as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledWith(
      "GET",
      "/v1/catalogs",
    )
  })

  it("list({ detail: 'full' }) appends the detail query param", async () => {
    const client = fakeClient()
    await new CatalogsResource(client).list({ detail: "full" })
    expect((client as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledWith(
      "GET",
      "/v1/catalogs?detail=full",
    )
  })
})
