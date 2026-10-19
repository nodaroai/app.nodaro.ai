import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const probe = vi.hoisted(() => ({
  inFlight: 0,
  peak: 0,
  durations: new Map<string, number | Error>(),
  probeMediaDuration: vi.fn(async (url: string) => {
    probe.inFlight += 1
    probe.peak = Math.max(probe.peak, probe.inFlight)
    await new Promise((r) => setTimeout(r, 5))
    probe.inFlight -= 1
    const d = probe.durations.get(url)
    if (d === undefined || d instanceof Error) throw d ?? new Error("no fixture")
    return d
  }),
}))
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: probe.probeMediaDuration }))

import { probeRefVideoDurations, PROBE_CONCURRENCY } from "../ref-video-probe.js"

const OWN = "https://media.nodaro.test"
const previousPublicUrl = process.env.R2_PUBLIC_URL

beforeEach(() => {
  vi.clearAllMocks()
  probe.durations.clear()
  probe.peak = 0
  process.env.R2_PUBLIC_URL = OWN
})
afterEach(() => {
  process.env.R2_PUBLIC_URL = previousPublicUrl
})

const run = (urls: string[]) => probeRefVideoDurations({ provider: "seedance-2-5", referenceVideoUrls: urls })

// A quote measures the clips, then the run measures the same clips again —
// for a file in our own storage the cache answers the second time.
describe("reference-clip probe cache", () => {
  it("measures an own-storage clip once and answers repeats from the cache", async () => {
    probe.durations.set(`${OWN}/uploads/a.mp4`, 10)
    expect(await run([`${OWN}/uploads/a.mp4`])).toEqual([10])
    expect(await run([`${OWN}/uploads/a.mp4`])).toEqual([10])
    expect(probe.probeMediaDuration).toHaveBeenCalledTimes(1)
  })

  it("never caches a clip on another host — its bytes can change under the same URL", async () => {
    probe.durations.set("https://elsewhere.example.com/a.mp4", 2)
    expect(await run(["https://elsewhere.example.com/a.mp4"])).toEqual([2])
    probe.durations.set("https://elsewhere.example.com/a.mp4", 15)
    expect(await run(["https://elsewhere.example.com/a.mp4"])).toEqual([15])
    expect(probe.probeMediaDuration).toHaveBeenCalledTimes(2)
  })

  it("never caches a failed measurement — the next request tries again", async () => {
    probe.durations.set(`${OWN}/uploads/b.mp4`, new Error("timeout"))
    expect(await run([`${OWN}/uploads/b.mp4`])).toEqual([Number.NaN])
    probe.durations.set(`${OWN}/uploads/b.mp4`, 7)
    expect(await run([`${OWN}/uploads/b.mp4`])).toEqual([7])
    expect(probe.probeMediaDuration).toHaveBeenCalledTimes(2)
  })

  it("concurrent requests for one clip share a single ffprobe", async () => {
    probe.durations.set(`${OWN}/uploads/c.mp4`, 9)
    const [a, b] = await Promise.all([run([`${OWN}/uploads/c.mp4`]), run([`${OWN}/uploads/c.mp4`])])
    expect(a).toEqual([9])
    expect(b).toEqual([9])
    expect(probe.probeMediaDuration).toHaveBeenCalledTimes(1)
  })

  it("probes at most PROBE_CONCURRENCY of one request's clips at once, in order", async () => {
    const urls = Array.from({ length: 10 }, (_, i) => `https://elsewhere.example.com/c${i}.mp4`)
    urls.forEach((u, i) => probe.durations.set(u, i + 1))
    expect(await run(urls)).toEqual(urls.map((_, i) => i + 1))
    expect(probe.probeMediaDuration).toHaveBeenCalledTimes(10)
    expect(probe.peak).toBeLessThanOrEqual(PROBE_CONCURRENCY)
  })
})
