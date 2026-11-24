import { describe, expect, it, vi } from "vitest"

/**
 * The header probe says whether it read the file (decided 2026-11-24): a
 * caller can tell a file that is no image (read, not sized) from one that was
 * never read (a failed fetch), and sniff the first bytes it read.
 */
const answer = vi.hoisted(() => ({ res: undefined as Response | undefined }))
vi.mock("../fetch-own-media.js", () => ({ fetchOwnMedia: async () => answer.res }))

import { probeImageSource } from "../image-source-probe.js"

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom"), Buffer.alloc(200)])

describe("probeImageSource", () => {
  it("a file that is read but is no image: no size, marked read, its first bytes kept", async () => {
    answer.res = new Response(MP4, { status: 206, headers: { "content-range": `bytes 0-${MP4.length - 1}/50000` } })
    const probe = await probeImageSource("https://cdn.test/clip.mp4")
    expect(probe.size).toBeUndefined()
    expect(probe.fetched).toBe(true)
    expect(probe.head?.subarray(4, 8).toString("latin1")).toBe("ftyp")
    expect(probe.sizeBytes).toBe(50000)
  })

  it("a fetch that fails: nothing read, nothing marked", async () => {
    answer.res = new Response("gone", { status: 404 })
    expect(await probeImageSource("https://cdn.test/x.png")).toEqual({})
  })
})
