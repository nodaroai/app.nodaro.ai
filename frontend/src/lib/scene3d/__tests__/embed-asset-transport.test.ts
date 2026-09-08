import { describe, it, expect, vi, afterEach } from "vitest"
import { sha256Hex } from "@remotion-pkg/scene3d/v2/sha256"
import type { Scene3DAssetRef } from "@nodaro/shared"
import {
  SCENE3D_EMBED_ASSET_LIMITS,
  SCENE3D_EMBED_ASSET_RESPONSE_TYPE,
  Scene3DEmbedAssetTransport,
  type Scene3DEmbedAssetRequestMessage,
} from "../embed-asset-transport"
import { REV_V2, REV_V2_B } from "./fixture"

/**
 * The embed's asset lane is the one place where a page the platform does not
 * control hands the renderer bytes. Everything here is therefore an ADVERSARIAL
 * test: the happy path is one case, and the rest are the ways a parent — buggy,
 * confused, or hostile — could try to get the frame to draw something other
 * than the revision it was given.
 *
 * `window` never appears: the transport takes `post` and is fed messages, so
 * the exact origin/source/channel rules are testable as pure logic.
 */
const PARENT = "https://studio.nodaro.ai"
const CHANNEL = "3f1c9a2e-7b4d-4c8f-9a11-5d6e7f801234"
/** Stands in for `window.parent` — compared by IDENTITY, never by value. */
const SOURCE = { name: "the parent window" }

const context = { parentOrigin: PARENT, channel: CHANNEL, expectedSource: SOURCE }

function bytesOf(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer
}

async function refFor(assetId: string, bytes: ArrayBuffer, kind: Scene3DAssetRef["kind"] = "glb"): Promise<Scene3DAssetRef> {
  return {
    assetId,
    kind,
    role: kind === "glb" ? "entity-geometry" : "camera-track",
    byteLength: bytes.byteLength,
    sha256: await sha256Hex(bytes),
  }
}

function setup(options: Partial<ConstructorParameters<typeof Scene3DEmbedAssetTransport>[0]> = {}) {
  const posted: Scene3DEmbedAssetRequestMessage[] = []
  let counter = 0
  const transport = new Scene3DEmbedAssetTransport({
    channel: CHANNEL,
    revisionId: REV_V2,
    post: (message) => posted.push(message),
    newRequestId: () => `req-${++counter}`,
    ...options,
  })
  const deliver = (
    data: unknown,
    { origin = PARENT, source = SOURCE as unknown }: { origin?: string; source?: unknown } = {},
  ) => transport.handleMessage({ data, origin, source }, context)
  return { transport, posted, deliver }
}

function answer(
  request: Scene3DEmbedAssetRequestMessage,
  bytes: ArrayBuffer | undefined,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: SCENE3D_EMBED_ASSET_RESPONSE_TYPE,
    version: 2,
    channel: CHANNEL,
    requestId: request.requestId,
    revisionId: request.revisionId,
    assetId: request.assetId,
    ok: true,
    ...(bytes ? { bytes } : {}),
    ...overrides,
  }
}

/** "pending" / "resolved" / "rejected" after letting the microtask queue drain. */
async function stateOf(promise: Promise<unknown>): Promise<string> {
  let state = "pending"
  void promise.then(
    () => (state = "resolved"),
    () => (state = "rejected"),
  )
  for (let i = 0; i < 8; i++) await Promise.resolve()
  return state
}

afterEach(() => {
  vi.useRealTimers()
})

describe("Scene3DEmbedAssetTransport — asking the parent for bytes", () => {
  it("asks for exactly the asset the manifest declares, and resolves the verified bytes", async () => {
    const { posted, transport } = setup()
    const bytes = bytesOf("glTF-ish payload")
    const ref = await refFor("geo", bytes)
    const promise = transport.resolve(ref, new AbortController().signal)

    expect(posted).toHaveLength(1)
    expect(posted[0]).toEqual({
      type: "nodaro:scene3d:asset-request",
      version: 2,
      channel: CHANNEL,
      requestId: "req-1",
      revisionId: REV_V2,
      assetId: "geo",
      kind: "glb",
      byteLength: ref.byteLength,
      sha256: ref.sha256,
    })
    // Not a URL, not a token, not a workflow id — an id, a length and a digest.
    expect(JSON.stringify(posted[0])).not.toMatch(/http|token|bearer/i)

    transport.handleMessage({ data: answer(posted[0], bytes), origin: PARENT, source: SOURCE }, context)
    await expect(promise).resolves.toBe(bytes)
  })

  /**
   * Every retained revision pins all its playback assets, including reused
   * bytes. Origin metadata must not change the authorization scope.
   */
  it("asks under the current retained revision even when bytes were reused", async () => {
    const { posted, transport } = setup()
    const bytes = bytesOf("reused")
    const ref = { ...(await refFor("geo", bytes)), originRevisionId: REV_V2_B }
    void transport.resolve(ref, new AbortController().signal)
    expect(posted[0].revisionId).toBe(REV_V2)
  })

  it("queues past its concurrency bound and frees a slot when one lands", async () => {
    const { posted, transport } = setup()
    const bytes = bytesOf("x")
    const ref = await refFor("a", bytes)
    const signal = new AbortController().signal
    const promises = Array.from({ length: SCENE3D_EMBED_ASSET_LIMITS.maxOutstanding + 2 }, (_, i) =>
      transport.resolve({ ...ref, assetId: `a${i}` }, signal),
    )
    expect(posted).toHaveLength(SCENE3D_EMBED_ASSET_LIMITS.maxOutstanding)

    transport.handleMessage({ data: answer(posted[0], bytes), origin: PARENT, source: SOURCE }, context)
    await promises[0]
    expect(posted).toHaveLength(SCENE3D_EMBED_ASSET_LIMITS.maxOutstanding + 1)
    transport.dispose()
    await Promise.allSettled(promises)
  })
})

describe("Scene3DEmbedAssetTransport — messages that are NOT ours", () => {
  it("ignores a response from another window, another origin, or another channel", async () => {
    const { posted, transport, deliver } = setup()
    const bytes = bytesOf("payload")
    const ref = await refFor("geo", bytes)
    const promise = transport.resolve(ref, new AbortController().signal)

    // Right shape, wrong sender: an ad frame, a sibling iframe, or the parent
    // after it navigated somewhere else.
    expect(deliver(answer(posted[0], bytes), { source: { other: true } })).toBeNull()
    expect(deliver(answer(posted[0], bytes), { origin: "https://evil.example" })).toBeNull()
    expect(deliver(answer(posted[0], bytes, { channel: "another-channel" }))).toBeNull()
    expect(await stateOf(promise)).toBe("pending")

    transport.dispose()
    await expect(promise).rejects.toThrow()
  })

  it("ignores an answer to a question it never asked", async () => {
    const { posted, transport, deliver } = setup()
    const bytes = bytesOf("payload")
    const promise = transport.resolve(await refFor("geo", bytes), new AbortController().signal)

    // Unsolicited, and a duplicate of an already-settled request: both must be
    // no-ops rather than a second resolution or a spurious failure.
    expect(deliver(answer({ ...posted[0], requestId: "req-999" }, bytes))).toBeNull()
    expect(await stateOf(promise)).toBe("pending")

    deliver(answer(posted[0], bytes))
    await expect(promise).resolves.toBe(bytes)
    expect(deliver(answer(posted[0], bytesOf("something else")))).toBeNull()
  })
})

describe("Scene3DEmbedAssetTransport — answers that are ours and wrong", () => {
  it("refuses an answer for a different asset or a different revision", async () => {
    const { posted, transport, deliver } = setup()
    const bytes = bytesOf("payload")
    const promise = transport.resolve(await refFor("geo", bytes), new AbortController().signal)

    const failure = deliver(answer(posted[0], bytes, { assetId: "some-other-asset" }))
    expect(failure).toMatch(/did not match/)
    await expect(promise).rejects.toThrow(/did not match/)

    const second = setup()
    const p2 = second.transport.resolve(await refFor("geo", bytes), new AbortController().signal)
    expect(second.deliver(answer(second.posted[0], bytes, { revisionId: REV_V2_B }))).toMatch(/did not match/)
    await expect(p2).rejects.toThrow(/did not match/)
  })

  it("refuses bytes whose length or digest is not the one the manifest names", async () => {
    const bytes = bytesOf("the real payload")
    const ref = await refFor("geo", bytes)

    const shortOne = setup()
    const p1 = shortOne.transport.resolve(ref, new AbortController().signal)
    expect(shortOne.deliver(answer(shortOne.posted[0], bytesOf("short")))).toMatch(/bytes; the scene declares/)
    await expect(p1).rejects.toThrow()

    // Same LENGTH, different content: only the digest catches this one, and it
    // is exactly the swap a compromised host would attempt.
    const swapped = setup()
    const p2 = swapped.transport.resolve(ref, new AbortController().signal)
    swapped.deliver(answer(swapped.posted[0], bytesOf("the fake payload")))
    await expect(p2).rejects.toThrow(/SHA-256 mismatch/)
  })

  it("refuses a response that is not bytes at all", async () => {
    const { posted, transport, deliver } = setup()
    const promise = transport.resolve(await refFor("geo", bytesOf("payload")), new AbortController().signal)
    // A URL where the bytes should be is the exact shape this transport exists
    // to make impossible.
    expect(deliver(answer(posted[0], undefined, { bytes: "https://cdn.example/asset.glb" }))).toMatch(
      /ArrayBuffer/,
    )
    await expect(promise).rejects.toThrow(/ArrayBuffer/)
  })

  it("surfaces the host's own failure, bounded", async () => {
    const { posted, transport, deliver } = setup()
    const promise = transport.resolve(await refFor("geo", bytesOf("payload")), new AbortController().signal)
    const failure = deliver(answer(posted[0], undefined, { ok: false, error: "not authorized" }))
    expect(failure).toMatch(/not authorized/)
    await expect(promise).rejects.toThrow(/not authorized/)

    const long = setup()
    const p2 = long.transport.resolve(await refFor("geo", bytesOf("payload")), new AbortController().signal)
    long.deliver(answer(long.posted[0], undefined, { ok: false, error: "e".repeat(5_000) }))
    await expect(p2).rejects.toThrow(/malformed asset response/)
  })

  it("refuses a response that speaks a protocol version this frame does not", async () => {
    const { posted, transport, deliver } = setup()
    const bytes = bytesOf("payload")
    const promise = transport.resolve(await refFor("geo", bytes), new AbortController().signal)
    expect(deliver(answer(posted[0], bytes, { version: 3 }))).toMatch(/protocol version 3/)
    await expect(promise).rejects.toThrow()
  })

  it("refuses unknown fields rather than reading half an envelope", async () => {
    const { posted, transport, deliver } = setup()
    const bytes = bytesOf("payload")
    const promise = transport.resolve(await refFor("geo", bytes), new AbortController().signal)
    expect(deliver(answer(posted[0], bytes, { authorization: "Bearer sk-live-1" }))).toMatch(/malformed/)
    await expect(promise).rejects.toThrow()
  })
})

describe("Scene3DEmbedAssetTransport — cancellation, staleness and timeouts", () => {
  it("drops everything in flight when the revision is replaced", async () => {
    const { posted, transport, deliver } = setup()
    const bytes = bytesOf("payload")
    const promise = transport.resolve(await refFor("geo", bytes), new AbortController().signal)

    transport.dispose()
    await expect(promise).rejects.toThrow(/replaced/)
    // A late answer for the abandoned revision changes nothing — there is no
    // path from a disposed transport to a canvas.
    expect(deliver(answer(posted[0], bytes))).toBeNull()
  })

  it("rejects a cancelled request and ignores its late answer", async () => {
    const { posted, transport, deliver } = setup()
    const bytes = bytesOf("payload")
    const controller = new AbortController()
    const promise = transport.resolve(await refFor("geo", bytes), controller.signal)

    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: "AbortError" })
    expect(deliver(answer(posted[0], bytes))).toBeNull()
  })

  it("gives up on a parent that never answers", async () => {
    vi.useFakeTimers()
    const { transport } = setup({ timeoutMs: 1_000 })
    const promise = transport.resolve(await refFor("geo", bytesOf("payload")), new AbortController().signal)
    const assertion = expect(promise).rejects.toThrow(/did not supply "geo" within 1000ms/)
    await vi.advanceTimersByTimeAsync(1_001)
    await assertion
  })
})
