import { gunzipSync, gzipSync } from "node:zlib"
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  store: new Map<string, Buffer>(),
  leases: new Map<string, string>(),
  redisFails: false,
  released: [] as string[],
  log: { metadata: null as unknown, error: null as unknown },
}))

vi.mock("../queue.js", () => ({
  redis: {
    getBuffer: async (key: string) => {
      if (h.redisFails) throw new Error("redis down")
      return h.store.get(key) ?? null
    },
    set: async (key: string, value: Buffer) => {
      h.store.set(key, value)
      return "OK"
    },
  },
}))
vi.mock("../redis-lease.js", () => ({
  acquireLease: async (key: string) => {
    if (h.redisFails) throw new Error("redis down")
    if (h.leases.has(key)) return null
    h.leases.set(key, "tok")
    return "tok"
  },
  renewLease: async () => true,
  releaseLease: async (key: string) => {
    h.leases.delete(key)
    h.released.push(key)
    return true
  },
}))
vi.mock("../supabase.js", () => ({
  supabase: {
    from: () => {
      const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { metadata: h.log.metadata }, error: h.log.error }) }
      return chain
    },
  },
}))

const { MAX_WAIT_MS, POLL_MS, packOfStep, sharedTranscript, transcriptShareKey } = await import("../pack-transcript-share.js")

const REQ = { audioUrl: "https://r2/ep.mp4", provider: "elevenlabs-stt", language: "auto", diarize: true }
const KEY = transcriptShareKey("pack-1", REQ)
const OUT = { text: "hello", language: "en", segments: [] }

/** A clock a waiting step's sleeps move. */
function clock() {
  let t = 0
  return { now: () => t, sleep: async (ms: number) => void (t += ms), stopIfCancelled: async () => undefined }
}

beforeEach(() => {
  h.store.clear()
  h.leases.clear()
  h.redisFails = false
  h.released.length = 0
  h.log = { metadata: null, error: null }
})

describe("sharedTranscript", () => {
  it("the first step transcribes, keeps the result and lets the lease go", async () => {
    const produce = vi.fn(async () => ({ outputData: OUT, actualCost: 0.4 }))
    const shared = await sharedTranscript(KEY, produce, (t) => t.outputData, clock())
    expect(shared).toEqual({ reused: false, produced: { outputData: OUT, actualCost: 0.4 } })
    expect(produce).toHaveBeenCalledTimes(1)
    expect(JSON.parse(gunzipSync(h.store.get(`${KEY}:result`)!).toString("utf8"))).toEqual(OUT)
    expect(h.leases.size).toBe(0)
  })

  it("a later step takes the kept result and never asks the provider", async () => {
    h.store.set(`${KEY}:result`, gzipSync(Buffer.from(JSON.stringify(OUT))))
    const produce = vi.fn()
    expect(await sharedTranscript(KEY, produce, () => ({}), clock())).toEqual({ reused: true, output: OUT })
    expect(produce).not.toHaveBeenCalled()
  })

  it("a step that arrives while another transcribes waits for its result", async () => {
    h.leases.set(`${KEY}`, "other")
    const c = clock()
    const sleep = vi.fn(async (ms: number) => {
      await c.sleep(ms)
      // The other step finishes during the second wait.
      if (sleep.mock.calls.length === 2) {
        h.store.set(`${KEY}:result`, gzipSync(Buffer.from(JSON.stringify(OUT))))
        h.leases.delete(KEY)
      }
    })
    const produce = vi.fn()
    expect(await sharedTranscript(KEY, produce, () => ({}), { now: c.now, sleep, stopIfCancelled: c.stopIfCancelled })).toEqual({ reused: true, output: OUT })
    expect(sleep).toHaveBeenCalledWith(POLL_MS)
    expect(produce).not.toHaveBeenCalled()
  })

  it("a holder that failed lets the lease go: the next step transcribes itself", async () => {
    h.leases.set(KEY, "other")
    const c = clock()
    const sleep = vi.fn(async (ms: number) => {
      await c.sleep(ms)
      h.leases.delete(KEY)
    })
    const produce = vi.fn(async () => ({ outputData: OUT }))
    const shared = await sharedTranscript(KEY, produce, (t) => t.outputData, { now: c.now, sleep, stopIfCancelled: c.stopIfCancelled })
    expect(shared.reused).toBe(false)
    expect(produce).toHaveBeenCalledTimes(1)
  })

  it("a step that waited too long transcribes itself", async () => {
    h.leases.set(KEY, "other")
    const produce = vi.fn(async () => ({ outputData: OUT }))
    const c = clock()
    const shared = await sharedTranscript(KEY, produce, (t) => t.outputData, c)
    expect(shared.reused).toBe(false)
    expect(c.now()).toBeGreaterThanOrEqual(MAX_WAIT_MS)
    expect(produce).toHaveBeenCalledTimes(1)
  })

  it("a cancelled step stops waiting at once", async () => {
    h.leases.set(KEY, "other")
    const produce = vi.fn()
    let checks = 0
    const deps = { ...clock(), stopIfCancelled: async () => { if (++checks === 2) throw new Error("cancelled") } }
    await expect(sharedTranscript(KEY, produce, () => ({}), deps)).rejects.toThrow("cancelled")
    expect(produce).not.toHaveBeenCalled()
  })

  it("sharing never fails a step: Redis down transcribes alone", async () => {
    h.redisFails = true
    const produce = vi.fn(async () => ({ outputData: OUT }))
    expect((await sharedTranscript(KEY, produce, (t) => t.outputData, clock())).reused).toBe(false)
    expect(produce).toHaveBeenCalledTimes(1)
  })

  it("a transcription that fails keeps nothing and lets the lease go", async () => {
    await expect(sharedTranscript(KEY, async () => { throw new Error("provider down") }, () => ({}), clock())).rejects.toThrow("provider down")
    expect(h.store.has(`${KEY}:result`)).toBe(false)
    expect(h.released).toEqual([KEY])
  })
})

describe("transcriptShareKey", () => {
  it("one key per pack, audio and settings", () => {
    expect(transcriptShareKey("pack-1", { ...REQ })).toBe(KEY)
    expect(transcriptShareKey("pack-2", REQ)).not.toBe(KEY)
    expect(transcriptShareKey("pack-1", { ...REQ, audioUrl: "https://r2/other.mp4" })).not.toBe(KEY)
    expect(transcriptShareKey("pack-1", { ...REQ, diarize: false })).not.toBe(KEY)
    expect(transcriptShareKey("pack-1", { ...REQ, language: "he" })).not.toBe(KEY)
  })
})

describe("packOfStep", () => {
  it("the pack a covered hold names; null for any other hold, none, or an unreadable one", async () => {
    h.log.metadata = { covered: { by: "pack-1", credits: 9 } }
    expect(await packOfStep("log-1")).toBe("pack-1")
    h.log.metadata = { status: "reserved" }
    expect(await packOfStep("log-1")).toBeNull()
    expect(await packOfStep(null)).toBeNull()
    h.log.error = { message: "boom" }
    expect(await packOfStep("log-1")).toBeNull()
  })
})
