import { describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import {
  createUrlAssetResolver,
  resolveVerifiedAsset,
  verifyAssetBytes,
} from "../asset-resolver"
import { Scene3DError } from "../errors"
import { sha256Hex, sha256HexSync } from "../sha256"
import type { Scene3DAssetRef } from "../plan-shape"

function bytesOf(text: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(text)
  const out = new ArrayBuffer(encoded.byteLength)
  new Uint8Array(out).set(encoded)
  return out
}

function refFor(bytes: ArrayBuffer, overrides: Partial<Scene3DAssetRef> = {}): Scene3DAssetRef {
  return {
    assetId: "a1",
    kind: "glb",
    role: "entity-geometry",
    byteLength: bytes.byteLength,
    sha256: sha256HexSync(bytes),
    ...overrides,
  } as Scene3DAssetRef
}

describe("SHA-256", () => {
  // The pure-JS path exists so digest verification can never be SKIPPED on a
  // host without WebCrypto. If it drifted from the real algorithm, every
  // verification on that host would fail open or fail closed for the wrong
  // reason — so it is checked against node's own implementation.
  const cases = ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "a".repeat(1000)]

  it.each(cases)("matches node crypto for a %s-length input", (text) => {
    const expected = createHash("sha256").update(text).digest("hex")
    expect(sha256HexSync(bytesOf(text))).toBe(expected)
  })

  it("agrees with the async path (native subtle when present)", async () => {
    const bytes = bytesOf("nodaro scene3d v2")
    expect(await sha256Hex(bytes)).toBe(sha256HexSync(bytes))
  })

  it("falls back to the JS implementation when subtle.digest throws", async () => {
    const bytes = bytesOf("insecure context")
    const spy = vi
      .spyOn(globalThis.crypto.subtle, "digest")
      .mockRejectedValue(new Error("not a secure context"))
    try {
      expect(await sha256Hex(bytes)).toBe(sha256HexSync(bytes))
    } finally {
      spy.mockRestore()
    }
  })
})

describe("asset verification", () => {
  it("accepts bytes that match the manifest exactly", async () => {
    const bytes = bytesOf("payload")
    await expect(verifyAssetBytes(refFor(bytes), bytes)).resolves.toBe(bytes)
  })

  it("rejects a byte-length mismatch before hashing", async () => {
    const bytes = bytesOf("payload")
    await expect(verifyAssetBytes(refFor(bytes, { byteLength: 999 }), bytes)).rejects.toThrow(
      /byte length mismatch/,
    )
  })

  it("rejects a digest mismatch — same length, different bytes", async () => {
    const declared = bytesOf("payload")
    const swapped = bytesOf("payloaD")
    expect(swapped.byteLength).toBe(declared.byteLength)
    await expect(verifyAssetBytes(refFor(declared), swapped)).rejects.toMatchObject({
      code: "SCENE_ASSET_INVALID",
    })
  })

  it("rejects a manifest digest that is not 64 hex characters", async () => {
    const bytes = bytesOf("payload")
    await expect(verifyAssetBytes(refFor(bytes, { sha256: "nope" }), bytes)).rejects.toThrow(
      /64-character lowercase hex/,
    )
  })
})

describe("URL resolver", () => {
  it("fetches, and the loader verifies what came back", async () => {
    const bytes = bytesOf("real asset")
    const fetchImpl = vi.fn(async () => new Response(bytes)) as unknown as typeof fetch
    const resolver = createUrlAssetResolver({ a1: "https://assets.example/a1" }, { fetchImpl })
    const out = await resolveVerifiedAsset(resolver, refFor(bytes), new AbortController().signal)
    expect(new TextDecoder().decode(out)).toBe("real asset")
  })

  it("fails the render when the server returns different bytes", async () => {
    const declared = bytesOf("real asset")
    const tampered = bytesOf("evil asset")
    const fetchImpl = vi.fn(async () => new Response(tampered)) as unknown as typeof fetch
    const resolver = createUrlAssetResolver({ a1: "https://assets.example/a1" }, { fetchImpl })
    await expect(
      resolveVerifiedAsset(resolver, refFor(declared), new AbortController().signal),
    ).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
  })

  it.each(["file:///etc/passwd", "data:application/octet-stream;base64,AAAA", "blob:x"])(
    "refuses the non-http URL %s",
    async (url) => {
      const fetchImpl = vi.fn() as unknown as typeof fetch
      const resolver = createUrlAssetResolver({ a1: url }, { fetchImpl })
      await expect(
        resolveVerifiedAsset(resolver, refFor(bytesOf("x")), new AbortController().signal),
      ).rejects.toMatchObject({ code: "SCENE_ASSET_UNAVAILABLE" })
      expect(fetchImpl).not.toHaveBeenCalled()
    },
  )

  it("maps a non-OK response onto a stable code", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("nope", { status: 403 }),
    ) as unknown as typeof fetch
    const resolver = createUrlAssetResolver({ a1: "https://assets.example/a1" }, { fetchImpl })
    await expect(
      resolveVerifiedAsset(resolver, refFor(bytesOf("x")), new AbortController().signal),
    ).rejects.toThrow(/HTTP 403/)
  })

  it("reports a missing URL rather than fetching undefined", async () => {
    const resolver = createUrlAssetResolver({})
    await expect(
      resolveVerifiedAsset(resolver, refFor(bytesOf("x")), new AbortController().signal),
    ).rejects.toThrow(/no transport URL/)
  })

  it("propagates an abort instead of turning it into a scene failure", async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => {
      init?.signal?.throwIfAborted()
      throw new DOMException("aborted", "AbortError")
    }) as unknown as typeof fetch
    const resolver = createUrlAssetResolver({ a1: "https://assets.example/a1" }, { fetchImpl })
    controller.abort()
    await expect(
      resolveVerifiedAsset(resolver, refFor(bytesOf("x")), controller.signal),
    ).rejects.toSatisfy((error: unknown) => !(error instanceof Scene3DError))
  })
})

describe("resolver policy", () => {
  it("refuses to fetch a blend-source even if the manifest lists one", async () => {
    const bytes = bytesOf("x")
    const resolver = { resolve: vi.fn() }
    await expect(
      resolveVerifiedAsset(
        resolver,
        refFor(bytes, { kind: "blend-source", role: "source" }),
        new AbortController().signal,
      ),
    ).rejects.toThrow(/not fetchable by the renderer/)
    expect(resolver.resolve).not.toHaveBeenCalled()
  })

  it("fails with an actionable message when no resolver was supplied", async () => {
    await expect(
      resolveVerifiedAsset(undefined, refFor(bytesOf("x")), new AbortController().signal),
    ).rejects.toThrow(/no asset resolver was supplied/)
  })

  it("verifies bytes even when a host resolver returns them unchecked", async () => {
    const declared = bytesOf("real asset")
    const resolver = { resolve: async () => bytesOf("evil asset") }
    await expect(
      resolveVerifiedAsset(resolver, refFor(declared), new AbortController().signal),
    ).rejects.toMatchObject({ code: "SCENE_ASSET_INVALID" })
  })
})
