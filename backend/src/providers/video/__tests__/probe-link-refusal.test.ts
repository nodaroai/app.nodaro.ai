/**
 * The one meaning a failed probe has on every route that measures a link
 * (`probeLinkRefusal`): a read the server itself could not run — its ffprobe
 * never started, or the read was stopped — is the retryable 503
 * `probe_unavailable`, never the route's "the file may be corrupted" 400. A
 * file ffprobe ran on and could not read keeps that 400.
 */
import { describe, expect, it } from "vitest"
import { runFfprobe } from "../ffmpeg-utils.js"
import { LINK_READ_TIMED_OUT, PROBE_UNAVAILABLE, probeLinkRefusal, probeRefusalStatus, ProbeSourceBlockedError } from "../probe-guard.js"

const failureOf = (p: Promise<unknown>) => p.then(() => { throw new Error("expected a failure") }, (e: unknown) => e)

describe("a probe the server could not run", () => {
  it("ffprobe that cannot be started (not on the PATH: the spawn fails) is the retryable 503", async () => {
    const saved = process.env.PATH
    process.env.PATH = "/nonexistent-probe-path"
    let err: unknown
    try {
      err = await failureOf(runFfprobe(["-version"]))
    } finally {
      process.env.PATH = saved
    }
    expect(err).toMatchObject({ notStarted: true })
    expect(probeLinkRefusal(err)).toBe(PROBE_UNAVAILABLE)
    expect(probeRefusalStatus(PROBE_UNAVAILABLE.code)).toBe(503)
  })

  it("a run stopped by its signal is the retryable 503", async () => {
    const stop = new AbortController()
    stop.abort()
    const err = await failureOf(runFfprobe(["-version"], { signal: stop.signal }))
    expect(err).toMatchObject({ aborted: true })
    expect(probeLinkRefusal(err)).toBe(PROBE_UNAVAILABLE)
  })

  it("a spawn failure thrown as it is, or kept as a guard refusal's cause, reads the same", () => {
    const spawnError = Object.assign(new Error("spawn ffprobe EAGAIN"), { code: "EAGAIN", syscall: "spawn ffprobe" })
    expect(probeLinkRefusal(spawnError)).toBe(PROBE_UNAVAILABLE)
    expect(probeLinkRefusal(Object.assign(new Error("probeClipLengthSec: could not read"), { cause: spawnError }))).toBe(PROBE_UNAVAILABLE)
  })

  it("a stop whose cause is a timeout is a timeout; a file ffprobe could not read, a missing local file and a refused address keep the route's 400", async () => {
    const timeout = Object.assign(new Error("The operation was aborted"), { name: "AbortError", cause: Object.assign(new Error("timed out"), { name: "TimeoutError" }) })
    expect(probeLinkRefusal(timeout)).toBe(LINK_READ_TIMED_OUT)
    // ffprobe ran: the file is the problem.
    expect(probeLinkRefusal(await failureOf(runFfprobe(["-v", "error", "/nonexistent/clip.mp4"])))).toBeUndefined()
    expect(probeLinkRefusal(Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT", syscall: "open" }))).toBeUndefined()
    expect(probeLinkRefusal(new ProbeSourceBlockedError("address", "probeVideoSource: blocked private/reserved IP"))).toBeUndefined()
  })
})
