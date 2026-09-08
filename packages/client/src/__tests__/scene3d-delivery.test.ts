import { describe, expect, it, vi } from "vitest"
import { createClient, StaticTokenAuth, NotFoundError, type Scene3DDeliveryAsset } from "../index.js"

const poster: Scene3DDeliveryAsset = { assetId: "poster", kind: "poster", usage: "poster", byteLength: 8,
  sha256: "a".repeat(64), viaRevisionId: null }
function setup(response: () => Response) {
  const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => response())
  return { fetch, client: createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("test"), fetch }) }
}

describe("scene delivery SDK", () => {
  it("reads delivery metadata with normal authentication", async () => {
    const delivery = { deliveryId: "job", sceneRevisionId: "revision", assets: [poster] }
    const { client, fetch } = setup(() => new Response(JSON.stringify(delivery)))
    expect(await client.scene3d.getDelivery("job/segment")).toEqual(delivery)
    expect(fetch.mock.calls[0][0]).toBe("https://api.example.com/v1/3d-scene/deliveries/job%2Fsegment")
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer test")
  })
  it("retrieves bytes through the delivery id, independently of a deleted source revision", async () => {
    const { client, fetch } = setup(() => new Response(new Uint8Array(8)))
    expect((await client.scene3d.deliveryAssetBytes("job", poster)).byteLength).toBe(8)
    expect(fetch.mock.calls[0][0]).toBe("https://api.example.com/v1/3d-scene/deliveries/job/assets/poster")
  })
  it("caps actual bytes even if the response does not declare its length", async () => {
    const { client } = setup(() => new Response(new Uint8Array(9)))
    await expect(client.scene3d.deliveryAssetBytes("job", poster)).rejects.toThrow()
  })
  it("preserves typed authorization misses", async () => {
    const { client } = setup(() => new Response(JSON.stringify({ error: { code: "not_found", message: "Scene not found" } }), { status: 404 }))
    await expect(client.scene3d.getDelivery("job")).rejects.toBeInstanceOf(NotFoundError)
    await expect(client.scene3d.deliveryAssetBytes("job", poster)).rejects.toBeInstanceOf(NotFoundError)
  })
  it("refuses private kinds and invalid byte bounds before a network call", () => {
    const { client, fetch } = setup(() => new Response())
    expect(() => client.scene3d.deliveryAssetBytes("job", { ...poster, usage: "validation" })).toThrow()
    expect(() => client.scene3d.deliveryAssetBytes("job", { ...poster, kind: "source-json" } as unknown as Scene3DDeliveryAsset)).toThrow()
    for (const byteLength of [0, -1, 0.5, Infinity, 1024 ** 3]) {
      expect(() => client.scene3d.deliveryAssetBytes("job", { ...poster, byteLength })).toThrow()
    }
    expect(fetch).not.toHaveBeenCalled()
  })
  it("honors cancellation before requesting bytes", async () => {
    const { client, fetch } = setup(() => new Response(new Uint8Array(8)))
    const abort = new AbortController(); abort.abort()
    await expect(client.scene3d.deliveryAssetBytes("job", poster, { signal: abort.signal })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
})
