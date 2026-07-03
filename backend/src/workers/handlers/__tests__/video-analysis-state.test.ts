import { describe, it, expect, vi, beforeEach } from "vitest"
import type { WindowAnalysis } from "@nodaro/shared"
import type { VaState } from "../video-analysis-state.js"

/**
 * R2 tmp-state module for the video-analysis node. The storage layer is mocked
 * so no test touches the network: `uploadBufferToR2`/`deleteFromR2` are spies
 * (assert call args + order), and `readVaState` reads through a mocked
 * `readR2ObjectBuffer` (the S3-origin reader — never the immutable-cached CDN).
 * Serialization of concurrent writes is asserted by gating each mocked upload on
 * a deferred and observing that the second PUT never starts until the first
 * settles.
 */

const mocks = vi.hoisted(() => ({
  uploadBufferToR2: vi.fn(async () => "https://r2.example.com/uploaded"),
  deleteFromR2: vi.fn(async () => {}),
  readR2ObjectBuffer: vi.fn(async (): Promise<Buffer | null> => null),
}))

vi.mock("@/lib/storage.js", () => ({
  uploadBufferToR2: mocks.uploadBufferToR2,
  deleteFromR2: mocks.deleteFromR2,
  readR2ObjectBuffer: mocks.readR2ObjectBuffer,
}))

// Imported AFTER the mocks are registered (mocks are hoisted regardless).
import { vaTmpKeys, readVaState, writeVaState, deleteVaTmp } from "../video-analysis-state.js"

function makeWindowAnalysis(): WindowAnalysis {
  return { language: "en", slots: [], scenes: [] }
}

function makeState(over: Partial<VaState> = {}): VaState {
  return {
    meta: { durationSec: 120, width: 1920, height: 1080, title: "clip" },
    windows: [{ k: 0, startSec: 0, endSec: 60, r2Key: "video-analysis-tmp/j1/window-0.mp4" }],
    results: { 0: makeWindowAnalysis() },
    ...over,
  }
}

function deferred<T = void>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// Macrotask boundary — flushes the full microtask queue regardless of how many
// promise hops the write-chain adds (robust to microtask-counting fragility).
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

beforeEach(() => {
  vi.clearAllMocks()
})

describe("vaTmpKeys", () => {
  it("builds deterministic jobId-scoped keys", () => {
    const k = vaTmpKeys("j1")
    expect(k.prefix).toBe("video-analysis-tmp/j1/")
    expect(k.source).toBe("video-analysis-tmp/j1/source.mp4")
    expect(k.state).toBe("video-analysis-tmp/j1/state.json")
    expect(k.window(2)).toBe("video-analysis-tmp/j1/window-2.mp4")
    expect(k.window(0)).toBe("video-analysis-tmp/j1/window-0.mp4")
  })
})

describe("readVaState", () => {
  it("reads the checkpoint from the R2 origin (state key) and returns the parsed state", async () => {
    const state = makeState()
    mocks.readR2ObjectBuffer.mockResolvedValueOnce(Buffer.from(JSON.stringify(state)))

    const result = await readVaState("j1")

    expect(mocks.readR2ObjectBuffer).toHaveBeenCalledWith("video-analysis-tmp/j1/state.json")
    expect(result).toEqual(state)
  })

  it("returns null when the object is absent (null buffer)", async () => {
    mocks.readR2ObjectBuffer.mockResolvedValueOnce(null)
    expect(await readVaState("j1")).toBeNull()
  })

  it("returns null on malformed JSON", async () => {
    mocks.readR2ObjectBuffer.mockResolvedValueOnce(Buffer.from("{not json"))
    expect(await readVaState("j1")).toBeNull()
  })
})

describe("writeVaState", () => {
  it("uploads JSON of the state to the state key with NO trackUserId", async () => {
    const state = makeState()
    await writeVaState("j1", state)

    expect(mocks.uploadBufferToR2).toHaveBeenCalledTimes(1)
    const [buf, key, contentType, trackUserId] = mocks.uploadBufferToR2.mock.calls[0] as unknown as [
      Buffer,
      string,
      string,
      string | undefined,
    ]
    expect(key).toBe("video-analysis-tmp/j1/state.json")
    expect(contentType).toBe("application/json")
    expect(trackUserId).toBeUndefined()
    expect(JSON.parse(buf.toString())).toEqual(state)
  })

  it("serializes concurrent writes — the second PUT never starts until the first settles", async () => {
    const started: number[] = []
    const finished: number[] = []
    const gates = [deferred(), deferred()]
    let seq = 0
    mocks.uploadBufferToR2.mockImplementation(async () => {
      const i = seq++
      started.push(i)
      await gates[i].promise
      finished.push(i)
      return "https://r2.example.com/uploaded"
    })

    const p1 = writeVaState("j1", makeState())
    const p2 = writeVaState("j1", makeState())

    // Advance the chain as far as it can go — only the first upload may run.
    await flush()
    expect(started).toEqual([0])
    expect(finished).toEqual([])

    // Release the first; the second may now begin, but only after #0 finished.
    gates[0].resolve()
    await flush()
    expect(finished).toEqual([0])
    expect(started).toEqual([0, 1])

    gates[1].resolve()
    await Promise.all([p1, p2])
    expect(finished).toEqual([0, 1])
  })

  it("a failed write does not poison the chain — the next write still runs", async () => {
    mocks.uploadBufferToR2
      .mockRejectedValueOnce(new Error("PUT failed"))
      .mockResolvedValueOnce("https://r2.example.com/uploaded")

    const p1 = writeVaState("j1", makeState())
    const p2 = writeVaState("j1", makeState())

    await expect(p1).rejects.toThrow("PUT failed")
    await expect(p2).resolves.toBeUndefined()
    expect(mocks.uploadBufferToR2).toHaveBeenCalledTimes(2)
  })
})

describe("deleteVaTmp", () => {
  it("best-effort deletes state + source + every window key 0..count-1", async () => {
    await deleteVaTmp("j1", 3)

    const keys = mocks.deleteFromR2.mock.calls.map((c) => (c as unknown as [string])[0])
    expect(keys).toEqual([
      "video-analysis-tmp/j1/state.json",
      "video-analysis-tmp/j1/source.mp4",
      "video-analysis-tmp/j1/window-0.mp4",
      "video-analysis-tmp/j1/window-1.mp4",
      "video-analysis-tmp/j1/window-2.mp4",
    ])
  })

  it("deletes only state + source when windowCount is 0", async () => {
    await deleteVaTmp("j1", 0)
    expect(mocks.deleteFromR2).toHaveBeenCalledTimes(2)
  })

  it("swallows individual delete failures (Promise.allSettled)", async () => {
    mocks.deleteFromR2.mockRejectedValue(new Error("delete boom"))
    await expect(deleteVaTmp("j1", 2)).resolves.toBeUndefined()
  })
})
