import { describe, expect, it, vi } from "vitest"
import { createClient, StaticTokenAuth, NotFoundError } from "../index.js"
import { readBinaryResponse } from "../binary-response.js"

describe("bounded authenticated binary transport", () => {
  it("rejects oversized declared and streamed bodies before retaining excess bytes", async () => {
    await expect(readBinaryResponse(new Response("12345", { headers: { "content-length": "5" } }), 4)).rejects.toThrow("size limit")
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(3)); controller.enqueue(new Uint8Array(3)); controller.enqueue(new Uint8Array(3))
    }, cancel }))
    await expect(readBinaryResponse(response, 4)).rejects.toThrow("size limit")
    expect(cancel).toHaveBeenCalledOnce()
  })
  it("collects bounded chunks and preserves exact bytes", async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([0,1])); controller.enqueue(new Uint8Array([254,255])); controller.close() } })
    expect(new Uint8Array(await readBinaryResponse(new Response(stream), 4))).toEqual(new Uint8Array([0,1,254,255]))
  })
  it("uses fresh auth for each asset read and a separate native-source endpoint", async () => {
    let token = 0
    const fetch = vi.fn(async () => new Response(new Uint8Array([1,2,3])))
    const client = createClient({ baseUrl: "https://api.example.com", auth: { getToken: async () => `token-${++token}` }, fetch: fetch as typeof globalThis.fetch })
    const asset = { assetId: "asset", kind: "glb" as const, role: "scene-geometry" as const, sha256: "a".repeat(64), byteLength: 3 }
    await client.scene3d.assetBytes("revision", asset)
    await client.scene3d.sourceBytes("revision")
    expect(fetch.mock.calls.map((call) => (call as unknown as [string])[0])).toEqual(["https://api.example.com/v1/3d-scene/revisions/revision/assets/asset", "https://api.example.com/v1/3d-scene/revisions/revision/source"])
    const calls = fetch.mock.calls as unknown as [string, RequestInit][]
    expect(calls[0][1].headers).toMatchObject({ Authorization: "Bearer token-1" })
    expect(calls[1][1].headers).toMatchObject({ Authorization: "Bearer token-2" })
    expect(() => client.scene3d.assetBytes("revision", { ...asset, kind: "blend-source" })).toThrow("playback endpoint")
  })
  it("retains typed HTTP errors and refuses an already-aborted read without a fetch", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: "not_found", message: "Missing" } }), { status: 404 }))
    const client = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("test"), fetch: fetch as typeof globalThis.fetch })
    await expect(client.requestBytes("GET", "/missing", { maxBytes: 4 })).rejects.toBeInstanceOf(NotFoundError)
    const controller = new AbortController(); controller.abort(new Error("stopped"))
    await expect(client.requestBytes("GET", "/stopped", { maxBytes: 4, signal: controller.signal })).rejects.toThrow("stopped")
    expect(fetch).toHaveBeenCalledOnce()
  })
  it("removes its abort listener after a completed request", async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, "removeEventListener")
    const client = createClient({ baseUrl: "https://api.example.com", auth: new StaticTokenAuth("test"), fetch: vi.fn(async () => new Response("a")) as typeof globalThis.fetch })
    await client.requestBytes("GET", "/bytes", { maxBytes: 1, signal: controller.signal })
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function))
  })
})
