import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * LTX 2.5 Fast's portrait check through the real header probe (decided
 * 2026-11-24): only the fetch is stood in. It refuses only what it read and
 * is not a usable picture; a fetch that fails, is refused or times out lets
 * the run go on as before.
 */
const answer = vi.hoisted(() => ({ res: undefined as (() => Promise<Response>) | undefined }))
vi.mock("../fetch-own-media.js", () => ({ fetchOwnMedia: async () => answer.res!() }))
vi.mock("../url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

import { drivingAudioFaceRefusal } from "../driving-audio-measure.js"
import { IMAGE_SOURCE_PROBE_DEADLINE_MS } from "../image-source-probe.js"

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom"), Buffer.alloc(200)])
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64")
const URL_ = "https://third-party.test/portrait"

afterEach(() => vi.useRealTimers())

describe("drivingAudioFaceRefusal", () => {
  it("a host that times out: not refused (the run goes on, as before)", async () => {
    vi.useFakeTimers()
    answer.res = () => new Promise<Response>(() => {})
    const pending = drivingAudioFaceRefusal("ltx-2.5-fast", URL_)
    await vi.advanceTimersByTimeAsync(IMAGE_SOURCE_PROBE_DEADLINE_MS + 10)
    expect(await pending).toBeUndefined()
  })

  it("a host that refuses the read (403): not refused", async () => {
    answer.res = async () => new Response("forbidden", { status: 403 })
    expect(await drivingAudioFaceRefusal("ltx-2.5-fast", URL_)).toBeUndefined()
  })

  it("a host that ignores the range and sends the whole file: still read by content", async () => {
    answer.res = async () => new Response(MP4, { status: 200, headers: { "content-length": String(MP4.length) } })
    expect(await drivingAudioFaceRefusal("ltx-2.5-fast", URL_)).toMatchObject({ code: "lip_sync_image_required", message: expect.stringMatching(/video or audio file \(MP4\)/) })
    answer.res = async () => new Response(PNG, { status: 200, headers: { "content-length": String(PNG.length) } })
    expect(await drivingAudioFaceRefusal("ltx-2.5-fast", URL_)).toBeUndefined()
  })
})
