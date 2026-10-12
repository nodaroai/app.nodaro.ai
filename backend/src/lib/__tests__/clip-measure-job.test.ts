/**
 * The clip measurement as a BACKGROUND JOB (decided 2026-10-12, R4): the editor
 * starts it and polls, so a big file never rides one long request. A `running`
 * marker beside the cached answer keeps one measurement per address across
 * instances; a refusal is held briefly so a poll can still read its sentence.
 */
import { describe, it, expect, vi } from "vitest"
import { ClipMeasureError, type MeasuredClip } from "../clip-measure.js"
import { clipJobMarkerKey, createClipMeasureJob, type ClipJobDeps } from "../clip-measure-job.js"

const URL = "https://cdn.example.test/uploads/videos/clip.mp4"
const CLIP: MeasuredClip = { durationMs: 14_600, width: 3840, height: 2160, faces: "present" }

function deps(over: Partial<ClipJobDeps> = {}) {
  const store = new Map<string, string>()
  const ttls = new Map<string, number>()
  const cache = new Map<string, MeasuredClip>()
  let release: (() => void) | undefined
  const d: ClipJobDeps = {
    peek: vi.fn(async (url: string) => cache.get(url) ?? null),
    measure: vi.fn(async (url: string) => {
      await new Promise<void>((resolve) => { release = resolve })
      cache.set(url, CLIP)
      return CLIP
    }),
    store: {
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      setNx: vi.fn(async (k: string, v: string, ttl: number) => {
        if (store.has(k)) return false
        store.set(k, v); ttls.set(k, ttl); return true
      }),
      set: vi.fn(async (k: string, v: string, ttl: number) => { store.set(k, v); ttls.set(k, ttl) }),
      expire: vi.fn(async (k: string, ttl: number) => { ttls.set(k, ttl) }),
      del: vi.fn(async (k: string) => { store.delete(k); ttls.delete(k) }),
    },
    maxBytes: 500 * 1024 * 1024,
    heartbeatMs: 10_000,
    ...over,
  }
  return { d, store, ttls, cache, finish: () => release?.() }
}
const settle = () => new Promise((r) => setTimeout(r, 0))

describe("clip measure job", () => {
  it("answers a cached measurement at once, starting nothing", async () => {
    const { d, cache } = deps()
    cache.set(URL, CLIP)
    const job = createClipMeasureJob(d)
    await expect(job.poll(URL)).resolves.toEqual({ status: "ready", clip: CLIP })
    expect(d.measure).not.toHaveBeenCalled()
  })

  it("reports nothing yet for an address no one has asked about", async () => {
    const job = createClipMeasureJob(deps().d)
    await expect(job.poll(URL)).resolves.toEqual({ status: "none" })
  })

  it("start runs the measurement in the background and returns running before it ends", async () => {
    const { d, finish } = deps()
    const job = createClipMeasureJob(d)
    await expect(job.start(URL)).resolves.toEqual({ status: "running" })
    expect(d.measure).toHaveBeenCalledWith(URL, { maxBytes: 500 * 1024 * 1024 })
    await expect(job.poll(URL)).resolves.toEqual({ status: "running" })
    finish()
    await settle()
    await expect(job.poll(URL)).resolves.toEqual({ status: "ready", clip: CLIP })
  })

  it("starts one measurement per address, however many ask (and across instances, through the marker)", async () => {
    const { d, finish } = deps()
    const a = createClipMeasureJob(d)
    const b = createClipMeasureJob(d)
    await Promise.all([a.start(URL), b.start(URL), a.start(URL)])
    expect(d.measure).toHaveBeenCalledTimes(1)
    finish()
    await settle()
  })

  it("drops the running marker when it finishes, and holds the marker with a lease while it runs", async () => {
    const { d, store, ttls, finish } = deps()
    const job = createClipMeasureJob(d)
    await job.start(URL)
    const key = clipJobMarkerKey(URL)
    expect(JSON.parse(store.get(key)!)).toMatchObject({ status: "running" })
    expect(ttls.get(key)).toBeGreaterThan(0)
    finish()
    await settle()
    expect(store.has(key)).toBe(false)
  })

  it("holds a refusal briefly so a poll reads its sentence, without caching it as an answer", async () => {
    const { d, store } = deps({ measure: vi.fn(async () => { throw new ClipMeasureError("no-picture", "This file has no picture.") }) })
    const job = createClipMeasureJob(d)
    await job.start(URL)
    await settle()
    await expect(job.poll(URL)).resolves.toEqual({ status: "failed", code: "no-picture", message: "This file has no picture." })
    expect(JSON.parse(store.get(clipJobMarkerKey(URL))!)).toMatchObject({ status: "failed" })
  })

  it("turns an unexpected error into a plain sentence, not the raw error", async () => {
    const { d } = deps({ measure: vi.fn(async () => { throw new Error("ECONNRESET secret-host") }) })
    const job = createClipMeasureJob(d)
    await job.start(URL)
    await settle()
    const state = await job.poll(URL)
    expect(state).toMatchObject({ status: "failed", code: "unreadable" })
    expect(JSON.stringify(state)).not.toMatch(/secret-host/)
  })

  it("does not start again while a refusal is held, and starts again once it has expired", async () => {
    const { d, store } = deps({ measure: vi.fn(async () => { throw new ClipMeasureError("unmeasured", "Could not tell how long.") }) })
    const job = createClipMeasureJob(d)
    await job.start(URL)
    await settle()
    await expect(job.start(URL)).resolves.toMatchObject({ status: "failed" })
    expect(d.measure).toHaveBeenCalledTimes(1)
    store.delete(clipJobMarkerKey(URL))
    await job.start(URL)
    await settle()
    expect(d.measure).toHaveBeenCalledTimes(2)
  })

  it("F7: when the answer could not be cached, the finished job holds it briefly itself, so polling never restarts the download", async () => {
    // A measure that succeeds without leaving anything in the cache (the cache write failed).
    const { d, finish } = deps({ measure: vi.fn(async () => { await new Promise<void>((r) => setTimeout(r, 0)); return CLIP }) })
    void finish
    const job = createClipMeasureJob(d)
    await job.start(URL)
    await new Promise((r) => setTimeout(r, 10))
    await expect(job.poll(URL)).resolves.toEqual({ status: "ready", clip: CLIP })
    await expect(job.start(URL)).resolves.toEqual({ status: "ready", clip: CLIP })
    await expect(job.start(URL)).resolves.toEqual({ status: "ready", clip: CLIP })
    expect(d.measure).toHaveBeenCalledTimes(1)
  })

  it("F7: when the answer is in the cache the marker is simply dropped", async () => {
    const { d, store, finish } = deps()
    const job = createClipMeasureJob(d)
    await job.start(URL)
    finish()
    await settle()
    expect(store.has(clipJobMarkerKey(URL))).toBe(false)
  })

  it("ignores a marker it cannot read", async () => {
    const { d, store } = deps()
    store.set(clipJobMarkerKey(URL), "{")
    await expect(createClipMeasureJob(d).poll(URL)).resolves.toEqual({ status: "none" })
  })

  it("reports running even if the store is down when it only needs to peek the cache", async () => {
    const { d, cache } = deps()
    cache.set(URL, CLIP)
    ;(d.store.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("redis down"))
    await expect(createClipMeasureJob(d).poll(URL)).resolves.toMatchObject({ status: "ready" })
  })
})
