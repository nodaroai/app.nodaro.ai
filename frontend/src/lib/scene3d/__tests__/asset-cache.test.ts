import { describe, it, expect, vi } from "vitest"
import type { Scene3DAssetRef } from "@nodaro/shared"
import { createMemoizedAssetResolver } from "../asset-cache"

/**
 * The cache is what keeps a re-render — or an overlay revision that reuses the
 * same baked GLB — from re-downloading tens of megabytes. Its correctness is
 * mostly about what it must NOT remember: a failure, and a request nobody is
 * waiting for any more.
 */
function ref(assetId: string, sha256 = "a".repeat(64), byteLength = 4): Scene3DAssetRef {
  return { assetId, kind: "glb", role: "entity-geometry", byteLength, sha256 }
}

function bytes(n = 4): ArrayBuffer {
  return new ArrayBuffer(n)
}

describe("createMemoizedAssetResolver", () => {
  it("fetches once for concurrent AND repeat requests of the same content", async () => {
    const inner = { resolve: vi.fn().mockResolvedValue(bytes()) }
    const resolver = createMemoizedAssetResolver(inner)
    const signal = new AbortController().signal

    const [a, b] = await Promise.all([resolver.resolve(ref("geo"), signal), resolver.resolve(ref("geo"), signal)])
    expect(a).toBe(b)
    await resolver.resolve(ref("geo"), signal)
    expect(inner.resolve).toHaveBeenCalledTimes(1)
  })

  it("re-fetches when the DIGEST changes, even under the same asset id", async () => {
    // The key is content, not identity: a rebuilt asset that kept its id must
    // not be served from the cache of the bytes it replaced.
    const inner = { resolve: vi.fn().mockResolvedValue(bytes()) }
    const resolver = createMemoizedAssetResolver(inner)
    const signal = new AbortController().signal
    await resolver.resolve(ref("geo", "a".repeat(64)), signal)
    await resolver.resolve(ref("geo", "b".repeat(64)), signal)
    expect(inner.resolve).toHaveBeenCalledTimes(2)
  })

  it("never remembers a failure, so a retry is a real retry", async () => {
    const inner = {
      resolve: vi
        .fn()
        .mockRejectedValueOnce(new Error("session expired"))
        .mockResolvedValueOnce(bytes()),
    }
    const resolver = createMemoizedAssetResolver(inner)
    const signal = new AbortController().signal

    await expect(resolver.resolve(ref("geo"), signal)).rejects.toThrow(/session expired/)
    await expect(resolver.resolve(ref("geo"), signal)).resolves.toBeInstanceOf(ArrayBuffer)
    expect(inner.resolve).toHaveBeenCalledTimes(2)
  })

  it("cancels one consumer without cancelling the other", async () => {
    const settle: Array<(bytes: ArrayBuffer) => void> = []
    const inner = {
      resolve: vi.fn(() => new Promise<ArrayBuffer>((resolve) => {
        settle.push(resolve)
      })),
    }
    const resolver = createMemoizedAssetResolver(inner)
    const giveUp = new AbortController()
    const keep = new AbortController()

    const abandoned = resolver.resolve(ref("geo"), giveUp.signal)
    const wanted = resolver.resolve(ref("geo"), keep.signal)
    giveUp.abort()
    await expect(abandoned).rejects.toMatchObject({ name: "AbortError" })

    settle[0](bytes())
    await expect(wanted).resolves.toBeInstanceOf(ArrayBuffer)
    expect(inner.resolve).toHaveBeenCalledTimes(1)
  })

  it("abandons a download nobody is waiting for", async () => {
    const aborted: AbortSignal[] = []
    const inner = {
      resolve: vi.fn((_: Scene3DAssetRef, signal: AbortSignal) => {
        aborted.push(signal)
        return new Promise<ArrayBuffer>(() => {})
      }),
    }
    const resolver = createMemoizedAssetResolver(inner)
    const controller = new AbortController()
    const promise = resolver.resolve(ref("geo"), controller.signal)
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: "AbortError" })

    // The shared request is cancelled too — an unmounted preview must not keep
    // pulling a 60 MB asset for a scene nobody is looking at.
    expect(aborted[0].aborted).toBe(true)

    // And the entry is gone, so a later mount really re-requests rather than
    // awaiting a download that was abandoned.
    void resolver.resolve(ref("geo"), new AbortController().signal)
    await Promise.resolve()
    expect(inner.resolve).toHaveBeenCalledTimes(2)
  })

  it("refuses to grow past its byte budget", async () => {
    const inner = { resolve: vi.fn(async (r: Scene3DAssetRef) => bytes(r.byteLength)) }
    const resolver = createMemoizedAssetResolver(inner, { maxBytes: 8, maxEntries: 8 })
    const signal = new AbortController().signal
    await resolver.resolve(ref("a", "a".repeat(64), 8), signal)
    await resolver.resolve(ref("b", "b".repeat(64), 8), signal)
    // The first entry was evicted to make room, so asking again re-fetches.
    await resolver.resolve(ref("a", "a".repeat(64), 8), signal)
    expect(inner.resolve).toHaveBeenCalledTimes(3)
  })

  it("refuses excess concurrent requests while its budget is occupied", async () => {
    let settle!: (value: ArrayBuffer) => void
    const inner = { resolve: vi.fn(() => new Promise<ArrayBuffer>(r => { settle = r })) }
    const resolver = createMemoizedAssetResolver(inner, { maxBytes: 4, maxEntries: 1 })
    const signal = new AbortController().signal
    const first = resolver.resolve(ref("a"), signal)
    await Promise.resolve()
    await expect(resolver.resolve(ref("b"), signal)).rejects.toThrow("cache is full")
    expect(inner.resolve).toHaveBeenCalledOnce()
    settle(bytes())
    await first
  })

  it("rejects oversized declarations before fetching and evicts wrong-length responses", async () => {
    const inner = { resolve: vi.fn().mockResolvedValueOnce(bytes(5)).mockResolvedValue(bytes(4)) }
    const resolver = createMemoizedAssetResolver(inner, { maxBytes: 4 })
    const signal = new AbortController().signal
    await expect(resolver.resolve(ref("big", "a".repeat(64), 5), signal)).rejects.toThrow("cache limit")
    expect(inner.resolve).not.toHaveBeenCalled()
    await expect(resolver.resolve(ref("a"), signal)).rejects.toThrow("length does not match")
    await expect(resolver.resolve(ref("a"), signal)).resolves.toBeInstanceOf(ArrayBuffer)
    expect(inner.resolve).toHaveBeenCalledTimes(2)
  })
})
