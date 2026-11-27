import { describe, expect, it } from "vitest"
import {
  createRenderWatch,
  isLastRenderRun,
  isRendererEncoderDeath,
  RenderEncoderError,
  RenderShortageError,
  RENDER_ENCODER_MESSAGE,
  RENDER_SHORTAGE_MESSAGE,
  SHORTAGE_RETRY_BASE_MS,
  SHORTAGE_RETRY_JITTER_MS,
  SHORTAGE_RETRY_MAX_MS,
  SHORTAGE_SERIAL_MS,
  SHORTAGE_STALL_MS,
  SHORTAGE_SUSPECT_MS,
  SHORTAGE_TURN_JITTER_MS,
  SHORTAGE_TURN_RECHECK_MS,
  shortageRetriesOf,
  shortageRetryDelayMs,
  shortageTurnDelayMs,
} from "../render-shortage.js"

/** A watch over a clock and a refusal time the test moves. */
function harness() {
  const state: { now: number; refusedAt: number | undefined } = { now: 5_000_000, refusedAt: undefined }
  const watch = createRenderWatch({ now: () => state.now, lastRefusalAt: () => state.refusedAt })
  const refuse = () => {
    state.refusedAt = state.now
  }
  const pass = (ms: number) => {
    state.now += ms
  }
  return { state, watch, refuse, pass }
}

describe("a render and the container's process limit", () => {
  it("is never touched while nothing was refused, however long it makes no progress", () => {
    const { watch, pass } = harness()
    const track = watch.track()
    track.started({ frameCount: 900, parallelEncoding: true })
    pass(30 * 60_000)
    expect(track.stuck()).toBeUndefined()
    expect(track.sawShortage()).toBe(false)
  })

  it("is stopped when it makes no progress after a refusal — and not before the stall has lasted", () => {
    const { watch, refuse, pass } = harness()
    const track = watch.track()
    track.started({ frameCount: 900, parallelEncoding: true })
    pass(3_000)
    refuse()
    pass(SHORTAGE_STALL_MS - 1)
    expect(track.stuck()).toBeUndefined()
    pass(1)
    const stuck = track.stuck()
    expect(stuck).toBeInstanceOf(RenderShortageError)
    // What the user reads is the sentence; what happened is kept beside it.
    expect(stuck?.message).toBe(RENDER_SHORTAGE_MESSAGE)
    expect(stuck?.detail).toBe("no progress for 25 s after the container refused a process or thread (0 frames drawn, 0 encoded of 900)")
    expect(track.sawShortage()).toBe(true)
  })

  it("a render whose encoder is gone is stuck although it keeps drawing frames (2026-11-25, the first render)", () => {
    const { watch, refuse, pass } = harness()
    const track = watch.track()
    track.started({ frameCount: 939, parallelEncoding: true })
    // The encoder could not open at frame 68: frames are drawn, none is encoded.
    refuse()
    for (const renderedFrames of [128, 262, 396, 530, 665]) {
      pass(5_000)
      track.progress({ renderedFrames, encodedFrames: 0 })
    }
    expect(track.stuck()?.detail).toContain("665 frames drawn, 0 encoded of 939")
  })

  it("a render that waits on one frame is stuck although later frames are drawn (2026-11-25, the second render)", () => {
    const { watch, refuse, pass } = harness()
    const track = watch.track()
    track.started({ frameCount: 929, parallelEncoding: true })
    track.progress({ renderedFrames: 222, encodedFrames: 88 })
    pass(4_000)
    track.progress({ renderedFrames: 321, encodedFrames: 172 })
    pass(6_000)
    track.progress({ renderedFrames: 442, encodedFrames: 194 })
    refuse()
    pass(SHORTAGE_STALL_MS - 1_000)
    track.progress({ renderedFrames: 574, encodedFrames: 194 })
    expect(track.stuck()).toBeUndefined()
    pass(1_000)
    track.progress({ renderedFrames: 707, encodedFrames: 194 })
    expect(track.stuck()?.detail).toContain("707 frames drawn, 194 encoded of 929")
  })

  it("a render that keeps encoding is left alone after a refusal", () => {
    const { watch, refuse, pass } = harness()
    const track = watch.track()
    track.started({ frameCount: 823, parallelEncoding: true })
    refuse()
    for (let encodedFrames = 70; encodedFrames <= 823; encodedFrames += 70) {
      pass(SHORTAGE_STALL_MS - 5_000)
      track.progress({ renderedFrames: Math.min(823, encodedFrames + 90), encodedFrames })
      expect(track.stuck()).toBeUndefined()
    }
  })

  it("when frames are encoded only after they are all drawn, a drawn frame is progress", () => {
    const { watch, refuse, pass } = harness()
    const track = watch.track()
    track.started({ frameCount: 300, parallelEncoding: false })
    refuse()
    for (const renderedFrames of [30, 60, 90]) {
      pass(SHORTAGE_STALL_MS - 5_000)
      track.progress({ renderedFrames, encodedFrames: 0 })
      expect(track.stuck()).toBeUndefined()
    }
    // …and a render that then draws nothing more is stuck.
    pass(SHORTAGE_STALL_MS)
    expect(track.stuck()?.detail).toContain("90 frames drawn, 0 encoded of 300")
  })

  it("once every frame is encoded, the final steps are judged by any progress at all", () => {
    const { watch, refuse, pass } = harness()
    const track = watch.track()
    track.started({ frameCount: 100, parallelEncoding: true })
    track.progress({ renderedFrames: 100, encodedFrames: 100 })
    refuse()
    pass(SHORTAGE_STALL_MS - 1)
    expect(track.stuck()).toBeUndefined()
  })

  it("the stall is counted from the refusal: a render already slow before it gets the whole wait", () => {
    const { watch, refuse, pass } = harness()
    const track = watch.track()
    track.started({ frameCount: 500, parallelEncoding: true })
    pass(90_000)
    refuse()
    pass(SHORTAGE_STALL_MS - 1)
    expect(track.stuck()).toBeUndefined()
    pass(1)
    expect(track.stuck()).toBeInstanceOf(RenderShortageError)
  })

  it("a refusal stops making renders suspects after a while", () => {
    const { watch, refuse, pass } = harness()
    const track = watch.track()
    track.started({ frameCount: 500, parallelEncoding: true })
    refuse()
    // Progress, then a long silence that begins well after the refusal.
    pass(10_000)
    track.progress({ renderedFrames: 60, encodedFrames: 40 })
    pass(SHORTAGE_SUSPECT_MS)
    expect(track.stuck()).toBeUndefined()
  })

  it("the renderer's report of an encoder that quit stops a stalled render as fast — as an encoder failure, not a shortage", () => {
    const { watch, pass } = harness()
    const track = watch.track()
    track.started({ frameCount: 939, parallelEncoding: true })
    watch.noteEncoderDeath(new Error("FFmpeg quit with code 187 while piping frame 68. Stderr: ffmpeg version n7.1\n[libx264 @ 0x55] Error while opening encoder"))
    pass(SHORTAGE_STALL_MS - 1)
    expect(track.stuck()).toBeUndefined()
    pass(1)
    const stuck = track.stuck()
    // Nothing was refused: an encoder that quits on an idle box is not "the server is busy".
    expect(stuck).toBeInstanceOf(RenderEncoderError)
    expect(stuck?.message).toBe(RENDER_ENCODER_MESSAGE)
    expect(stuck?.detail).toBe(
      "no progress for 25 s after the renderer reported that an encoder quit (0 frames drawn, 0 encoded of 939): FFmpeg quit with code 187 while piping frame 68. Stderr: ffmpeg version n7.1 [libx264 @ 0x55] Error while opening encoder",
    )
    expect(track.sawShortage()).toBe(false)
    // …and it does not put renders in one-at-a-time mode.
    watch.enter()
    expect(watch.mustWaitTurn()).toBe(false)
  })

  it("a render that keeps encoding is left alone after another render's encoder quit", () => {
    const { watch, pass } = harness()
    const track = watch.track()
    track.started({ frameCount: 823, parallelEncoding: true })
    watch.noteEncoderDeath(new Error("FFmpeg quit with code 187 while piping frame 68."))
    for (let encodedFrames = 70; encodedFrames <= 420; encodedFrames += 70) {
      pass(SHORTAGE_STALL_MS - 5_000)
      track.progress({ renderedFrames: encodedFrames + 90, encodedFrames })
      expect(track.stuck()).toBeUndefined()
    }
  })

  it("an encoder that quit while the kernel was refusing is a shortage", () => {
    const { watch, refuse, pass } = harness()
    const track = watch.track()
    track.started({ frameCount: 939, parallelEncoding: true })
    refuse()
    watch.noteEncoderDeath(new Error("FFmpeg quit with code 187 while piping frame 68."))
    pass(SHORTAGE_STALL_MS)
    expect(track.stuck()).toBeInstanceOf(RenderShortageError)
    expect(track.sawShortage()).toBe(true)
  })

  it("a render that began just after a refusal saw the shortage; one that began long after did not", () => {
    const { watch, refuse, pass } = harness()
    refuse()
    pass(5_000)
    expect(watch.track().sawShortage()).toBe(true)
    pass(SHORTAGE_SUSPECT_MS)
    expect(watch.track().sawShortage()).toBe(false)
  })
})

describe("renders one at a time after a shortage", () => {
  it("nothing waits while nothing was refused", () => {
    const { watch } = harness()
    watch.enter()
    expect(watch.mustWaitTurn()).toBe(false)
  })

  it("after a refusal a render waits while another is running, and only then", () => {
    const { watch, refuse, pass } = harness()
    refuse()
    // Nothing is running: this one runs.
    expect(watch.mustWaitTurn()).toBe(false)
    watch.enter()
    expect(watch.mustWaitTurn()).toBe(true)
    pass(SHORTAGE_SERIAL_MS - 1)
    expect(watch.mustWaitTurn()).toBe(true)
    watch.leave()
    expect(watch.mustWaitTurn()).toBe(false)
  })

  it("two at a time again once the container has refused nothing for long enough", () => {
    const { watch, refuse, pass } = harness()
    refuse()
    watch.enter()
    pass(SHORTAGE_SERIAL_MS)
    expect(watch.mustWaitTurn()).toBe(false)
  })

  it("a render put back to wait its turn is looked at again within seconds", () => {
    expect(shortageTurnDelayMs(() => 0)).toBe(SHORTAGE_TURN_RECHECK_MS)
    expect(shortageTurnDelayMs(() => 0.999)).toBeLessThan(SHORTAGE_TURN_RECHECK_MS + SHORTAGE_TURN_JITTER_MS)
  })
})

describe("running a render again after a shortage", () => {
  it("waits a minute, then longer each time, never past the cap, with jitter on top", () => {
    expect(shortageRetryDelayMs(0, () => 0)).toBe(SHORTAGE_RETRY_BASE_MS)
    expect(shortageRetryDelayMs(1, () => 0)).toBe(2 * SHORTAGE_RETRY_BASE_MS)
    expect(shortageRetryDelayMs(2, () => 0)).toBe(4 * SHORTAGE_RETRY_BASE_MS)
    expect(shortageRetryDelayMs(3, () => 0)).toBe(SHORTAGE_RETRY_MAX_MS)
    expect(shortageRetryDelayMs(9, () => 0)).toBe(SHORTAGE_RETRY_MAX_MS)
    expect(shortageRetryDelayMs(0, () => 0.999)).toBeLessThan(SHORTAGE_RETRY_BASE_MS + SHORTAGE_RETRY_JITTER_MS)
    expect(shortageRetryDelayMs(0, () => 0.5)).toBe(SHORTAGE_RETRY_BASE_MS + SHORTAGE_RETRY_JITTER_MS / 2)
  })

  it("reads how many times a job was already put back", () => {
    expect(shortageRetriesOf({ jobId: "j", shortageRetries: 2 })).toBe(2)
    expect(shortageRetriesOf({ jobId: "j" })).toBe(0)
    expect(shortageRetriesOf({ shortageRetries: -1 })).toBe(0)
    expect(shortageRetriesOf({ shortageRetries: "3" })).toBe(0)
    expect(shortageRetriesOf(null)).toBe(0)
  })

  it("a job gets the runs it was queued with: failed attempts and shortage retries count together", () => {
    const opts = { attempts: 4 }
    expect(isLastRenderRun({ attemptsMade: 0, opts, data: {} })).toBe(false)
    expect(isLastRenderRun({ attemptsMade: 3, opts, data: {} })).toBe(true)
    // Three runs put back after a shortage: the fourth is the last, though the queue has counted no failure.
    expect(isLastRenderRun({ attemptsMade: 0, opts, data: { shortageRetries: 2 } })).toBe(false)
    expect(isLastRenderRun({ attemptsMade: 0, opts, data: { shortageRetries: 3 } })).toBe(true)
    expect(isLastRenderRun({ attemptsMade: 1, opts, data: { shortageRetries: 2 } })).toBe(true)
    // A job queued for one attempt has one run.
    expect(isLastRenderRun({ attemptsMade: 0, data: {} })).toBe(true)
  })
})

describe("the renderer's report that an encoder quit", () => {
  it("recognizes what the renderer rejects with", () => {
    expect(isRendererEncoderDeath(new Error("FFmpeg quit with code 187 while piping frame 68. Stderr: ffmpeg version n7.1"))).toBe(true)
    expect(isRendererEncoderDeath(new Error("FFmpeg already quit while trying to pipe frame 12 to it."))).toBe(true)
    expect(isRendererEncoderDeath(Object.assign(new Error("write EPIPE"), { code: "EPIPE", errno: -32 }))).toBe(true)
  })

  it("is not raised by anything else", () => {
    expect(isRendererEncoderDeath(new Error("Timeout (120000ms) exceeded rendering the component at frame 355"))).toBe(false)
    expect(isRendererEncoderDeath(new Error("the job mentions FFmpeg quit somewhere inside"))).toBe(false)
    expect(isRendererEncoderDeath("FFmpeg quit with code 187")).toBe(false)
    expect(isRendererEncoderDeath(undefined)).toBe(false)
  })
})
