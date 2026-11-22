/**
 * What a Voice Changer run sends (`voice-changer-run.ts`): never bytes the
 * price did not see (decided 2026-11-22). The audio a run sends is read again
 * — an audio file's sound DECODED from the very bytes sent, a video's extracted
 * track by the reader that priced it — and refused when it would cost more
 * units than the run holds or runs past the 5-minute cap; a job queued before
 * the price followed the length holds no units and is held to the cap alone.
 * The fetch, the work dir, the decode and the probe are stood in for.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { join } from "node:path"

const state = vi.hoisted(() => ({
  /** The probe of a video's extracted track. */
  sec: 8 as number | "unreadable" | "not-run",
  /** The decode of an audio file's sound. */
  decoded: 8 as number | "unreadable" | "stopped-part-way" | "killed" | "over-cap" | "nothing",
  tooLarge: false,
  calls: [] as string[],
}))

vi.mock("../../providers/elevenlabs/client.js", () => {
  class MediaTooLargeError extends Error {
    constructor(maxBytes: number) {
      super(`The source file is larger than ${maxBytes} bytes.`)
      this.name = "MediaTooLargeError"
    }
  }
  return {
    MediaTooLargeError,
    fetchMediaFromUrl: vi.fn(async (url: string, maxBytes: number) => {
      state.calls.push(`fetch ${url} ${maxBytes}`)
      if (state.tooLarge) throw new MediaTooLargeError(maxBytes)
      return Buffer.from("the-audio")
    }),
  }
})
vi.mock("../../providers/video/decoded-audio-length.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../providers/video/decoded-audio-length.js")>()
  return {
    ...orig,
    measureDecodedAudio: vi.fn(async (path: string, opts: { capSec: number }) => {
      state.calls.push(`decode ${path} ${opts.capSec}`)
      if (state.decoded === "unreadable") throw new Error("Invalid data found when processing input")
      if (state.decoded === "stopped-part-way") throw new orig.AudioReadStoppedError("decoded 9.000 s of the 300.000 s the mp3 file states")
      if (state.decoded === "killed") throw Object.assign(new Error("ffmpeg killed"), { killed: true })
      if (state.decoded === "over-cap") return { overCap: true }
      if (state.decoded === "nothing") return undefined
      return { overCap: false, samples: Math.round(state.decoded * 44_100), seconds: state.decoded }
    }),
  }
})
vi.mock("../../providers/video/ffmpeg-utils.js", () => ({
  createWorkDir: vi.fn(async () => "/tmp/vc-work"),
  cleanupWorkDir: vi.fn(async (dir: string) => { state.calls.push(`cleanup ${dir}`) }),
}))
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  writeFile: vi.fn(async (path: string, bytes: Buffer) => { state.calls.push(`write ${path} ${bytes.toString()}`) }),
}))
vi.mock("../video-utility-probe.js", () => ({
  probeSoundLengthSec: vi.fn(async (path: string) => {
    state.calls.push(`probe ${path}`)
    if (state.sec === "unreadable") throw new Error("ffprobe: Invalid data found when processing input")
    if (state.sec === "not-run") throw Object.assign(new Error("spawn ffprobe EAGAIN"), { notStarted: true })
    return state.sec
  }),
}))

import {
  VOICE_CHANGER_SENT_OVER_CAP_MESSAGE,
  VOICE_CHANGER_SOURCE_MAX_BYTES,
  VOICE_CHANGER_SOURCE_TOO_LARGE_MESSAGE,
  assertVoiceChangerSendable,
  checkExtractedVoiceChangerAudio,
  fetchVoiceChangerAudio,
} from "../voice-changer-run.js"
import { isDeterministicJobError } from "../deterministic-job-error.js"

beforeEach(() => {
  state.sec = 8
  state.decoded = 8
  state.tooLarge = false
  state.calls = []
})

describe("assertVoiceChangerSendable", () => {
  it("sends audio within what the run holds", () => {
    expect(() => assertVoiceChangerSendable(8, 1)).not.toThrow()
    expect(() => assertVoiceChangerSendable(30.05, 3)).not.toThrow()
    expect(() => assertVoiceChangerSendable(300.05, 30)).not.toThrow()
  })

  it("refuses audio that would cost more units than the run holds, deterministic", () => {
    let err: unknown
    try {
      assertVoiceChangerSendable(25, 2)
    } catch (e) {
      err = e
    }
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toMatch(/longer than when the run was priced \(25 s, priced for up to 20 s\)/)
  })

  it("refuses audio past 5 minutes, whatever the run holds", () => {
    expect(() => assertVoiceChangerSendable(6 * 60, 30)).toThrow(/5 minutes/)
  })

  it("a job queued before units existed is not compared, but is held to the 5-minute cap", () => {
    expect(() => assertVoiceChangerSendable(250)).not.toThrow()
    expect(() => assertVoiceChangerSendable(301)).toThrow(/5 minutes/)
  })

  it("forgives what an MP3 encode adds past the track it came from (up to half a second), never more", () => {
    // A video priced at 20.04 s (two units, the hair forgiven) whose extracted MP3 reads 20.09 s.
    expect(() => assertVoiceChangerSendable(20.09, 2)).not.toThrow()
    expect(() => assertVoiceChangerSendable(20.5, 2)).not.toThrow()
    expect(() => assertVoiceChangerSendable(20.6, 2)).toThrow(/longer than when the run was priced/)
    // At the cap: a video priced at 300.04 s whose MP3 reads 300.09 s runs; one past the tolerance does not.
    expect(() => assertVoiceChangerSendable(300.09, 30)).not.toThrow()
    expect(() => assertVoiceChangerSendable(300.6, 30)).toThrow(/The audio is 5 min 1 s long/)
  })
})

describe("fetchVoiceChangerAudio — an audio-mode run", () => {
  it("fetches the audio once under the byte cap, decodes that copy's sound, and hands back those exact bytes", async () => {
    const out = await fetchVoiceChangerAudio("https://cdn.test/a.mp3", 1)
    expect(out.bytes.toString()).toBe("the-audio")
    expect(out.sentSec).toBe(8)
    const copy = join("/tmp/vc-work", "source")
    expect(state.calls).toEqual([
      `fetch https://cdn.test/a.mp3 ${VOICE_CHANGER_SOURCE_MAX_BYTES}`,
      `write ${copy} the-audio`,
      // Decoded up to just past what a run may send: the cap, its grace and the send tolerance.
      `decode ${copy} ${300 + 0.05 + 0.5}`,
      "cleanup /tmp/vc-work",
    ])
  })

  it("a file that states less than it plays is caught: priced on 9 s (one unit), it plays 5 minutes, and is refused before it is sent", async () => {
    state.decoded = 300
    const err = await fetchVoiceChangerAudio("https://cdn.test/a.mp3", 1).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toMatch(/longer than when the run was priced \(300 s, priced for up to 10 s\)/)
  })

  it("a copy that plays longer than the run holds is refused, deterministic, and its work dir removed", async () => {
    state.decoded = 25
    const err = await fetchVoiceChangerAudio("https://cdn.test/a.mp3", 2).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toMatch(/longer than when the run was priced/)
    expect(state.calls.at(-1)).toBe("cleanup /tmp/vc-work")
  })

  it("a copy that plays past 5 minutes is refused even with no units held", async () => {
    state.decoded = "over-cap"
    const err = await fetchVoiceChangerAudio("https://cdn.test/a.mp3").catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe(VOICE_CHANGER_SENT_OVER_CAP_MESSAGE)
  })

  it.each(["unreadable", "stopped-part-way", "nothing"] as const)("a copy whose sound is %s has no length to trust: refused, deterministic", async (how) => {
    state.decoded = how
    const err = await fetchVoiceChangerAudio("https://cdn.test/a.mp3", 1).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toMatch(/Couldn't read the length of the audio/)
  })

  it("a decode our side stopped (its time limit) is left retryable, not refused for good", async () => {
    state.decoded = "killed"
    const err = await fetchVoiceChangerAudio("https://cdn.test/a.mp3", 1).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(isDeterministicJobError(err)).toBe(false)
  })

  it("a file past the byte cap is refused, deterministic, never written or decoded", async () => {
    state.tooLarge = true
    const err = await fetchVoiceChangerAudio("https://cdn.test/a.mp3", 1).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe(VOICE_CHANGER_SOURCE_TOO_LARGE_MESSAGE)
    expect(state.calls).toEqual([`fetch https://cdn.test/a.mp3 ${VOICE_CHANGER_SOURCE_MAX_BYTES}`])
  })
})

describe("checkExtractedVoiceChangerAudio — a video's sound, extracted", () => {
  it("reads the extracted audio's length by the same reader", async () => {
    state.sec = 29.9
    expect(await checkExtractedVoiceChangerAudio("/tmp/vc/audio.mp3", 3)).toBe(29.9)
    expect(state.calls).toEqual(["probe /tmp/vc/audio.mp3"])
  })

  it("refuses extracted audio that would cost more than the run holds, or that runs past 5 minutes", async () => {
    state.sec = 31
    await expect(checkExtractedVoiceChangerAudio("/tmp/vc/audio.mp3", 3)).rejects.toThrow(/longer than when the run was priced/)
    state.sec = 320
    await expect(checkExtractedVoiceChangerAudio("/tmp/vc/audio.mp3")).rejects.toThrow(/5 minutes/)
  })
})
