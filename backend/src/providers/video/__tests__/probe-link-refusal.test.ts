/**
 * The one meaning a failed probe has on every route that measures a link
 * (`probeLinkRefusal`): a read the server itself could not run — its ffprobe
 * never started, or the read was stopped — is the retryable 503
 * `probe_unavailable`, never the route's "the file may be corrupted" 400. A
 * file ffprobe ran on and could not read keeps that 400. A host that does not
 * exist, or a private address, is its own 400 (`media_link_bad_host`).
 */
import { describe, expect, it } from "vitest"
import { runFfprobe } from "../ffmpeg-utils.js"
import { LINK_HOST_NOT_FOUND, LINK_HOST_UNREACHABLE, LINK_NOT_PUBLIC, LINK_READ_TIMED_OUT, MEDIA_LINK_BAD_HOST, PROBE_UNAVAILABLE, probeLinkRefusal, probeRefusalStatus, ProbeSourceBlockedError } from "../probe-guard.js"

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

  it("a stop whose cause is a timeout is a timeout; a file ffprobe could not read and a missing local file keep the route's 400", async () => {
    const timeout = Object.assign(new Error("The operation was aborted"), { name: "AbortError", cause: Object.assign(new Error("timed out"), { name: "TimeoutError" }) })
    expect(probeLinkRefusal(timeout)).toBe(LINK_READ_TIMED_OUT)
    // ffprobe ran: the file is the problem.
    expect(probeLinkRefusal(await failureOf(runFfprobe(["-v", "error", "/nonexistent/clip.mp4"])))).toBeUndefined()
    expect(probeLinkRefusal(Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT", syscall: "open" }))).toBeUndefined()
  })
})

describe("a read that failed for now, though ffprobe ran (decided 2026-11-17)", () => {
  const ffprobeSaid = (stderr: string) => Object.assign(new Error(`ffprobe failed: ${stderr}`), { killed: false, timedOut: false })
  it("the server short of threads (the system's own words): the retryable probe_unavailable, never the file", () => {
    expect(probeLinkRefusal(ffprobeSaid("[h264 @ 0x55] Error while opening decoder: Resource temporarily unavailable"))).toBe(PROBE_UNAVAILABLE)
    // Kept as a refusal's cause, it reads the same.
    expect(probeLinkRefusal(Object.assign(new Error("could not read"), { cause: ffprobeSaid("Resource temporarily unavailable") }))).toBe(PROBE_UNAVAILABLE)
  })
  it("words a link or a damaged file can carry are never read as the server's: a link naming EAGAIN, an allocation a damaged file failed", () => {
    expect(probeLinkRefusal(ffprobeSaid("https://cdn.example.com/EAGAIN-ECONNRESET.mp4: Server returned 404 Not Found"))).toBeUndefined()
    expect(probeLinkRefusal(ffprobeSaid("[mov,mp4 @ 0x55] Cannot allocate memory"))).toBeUndefined()
  })
  it("a refusal the guard gave for its own reason keeps it, whatever the read printed after it (a proxy's 502)", () => {
    const refused = Object.assign(new ProbeSourceBlockedError("host", "probeVideoSource: blocked — DNS resolution failed for cdn.exmaple.com"), { cause: ffprobeSaid("Server returned 5XX Server Error reply") })
    expect(probeLinkRefusal(refused)).toBe(LINK_HOST_NOT_FOUND)
    const link = Object.assign(new ProbeSourceBlockedError("link", "probeVideoSource: blocked — a link two URL parsers read differently"), { cause: ffprobeSaid("Resource temporarily unavailable") })
    expect(probeLinkRefusal(link)).toBeUndefined()
  })
  it("our own download out of time is the timeout; a dropped connection read off its code is the host's", () => {
    expect(probeLinkRefusal(new Error("Download timeout: no response within 120 s"))).toBe(LINK_READ_TIMED_OUT)
    expect(probeLinkRefusal(Object.assign(new Error("read failed"), { code: "ECONNRESET" }))).toBe(LINK_HOST_UNREACHABLE)
  })
  it("a host that failed for now (a 5xx, a dropped connection): the retryable source_unreachable", () => {
    for (const said of [
      "https://cdn.example.com/ep.mp4: Server returned 5XX Server Error reply",
      "Connection reset by peer",
      "Connection timed out",
    ]) expect(probeLinkRefusal(ffprobeSaid(said)), said).toBe(LINK_HOST_UNREACHABLE)
    expect(probeLinkRefusal(new Error("Failed to download: https://cdn.example.com/ep.mp4 (502)"))).toBe(LINK_HOST_UNREACHABLE)
    expect(probeLinkRefusal(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }))).toBe(LINK_HOST_UNREACHABLE)
    expect(probeRefusalStatus(LINK_HOST_UNREACHABLE.code)).toBe(503)
  })
  it("what the file itself says keeps the route's 400: a bare number is never a status, a 4xx is the link's", () => {
    for (const said of [
      "Invalid data found when processing input",
      "moov atom not found",
      "Server returned 404 Not Found",
      "Server returned 403 Forbidden (access denied)",
      "[h264 @ 0x55] 544x960 frame=512 error 503",
    ]) expect(probeLinkRefusal(ffprobeSaid(said)), said).toBeUndefined()
  })
})

describe("a link whose host the server will not read", () => {
  it("a host that does not exist and a private address are each their own 400, media_link_bad_host, never the route's \"may be corrupted\"", () => {
    expect(probeLinkRefusal(new ProbeSourceBlockedError("host", "probeVideoSource: blocked — DNS resolution failed for cdn.exmaple.com"))).toBe(LINK_HOST_NOT_FOUND)
    expect(probeLinkRefusal(new ProbeSourceBlockedError("address", "probeVideoSource: blocked private/reserved IP"))).toBe(LINK_NOT_PUBLIC)
    expect(LINK_HOST_NOT_FOUND.code).toBe(MEDIA_LINK_BAD_HOST)
    expect(LINK_NOT_PUBLIC.code).toBe(MEDIA_LINK_BAD_HOST)
    expect(probeRefusalStatus(MEDIA_LINK_BAD_HOST)).toBe(400)
    // A read that ran out of time after a hop was refused is still the retryable timeout.
    const timedOut = Object.assign(new ProbeSourceBlockedError("address", "probeVideoSource: blocked private/reserved IP"), { cause: Object.assign(new Error("ffprobe failed"), { timedOut: true }) })
    expect(probeLinkRefusal(timedOut)).toBe(LINK_READ_TIMED_OUT)
    // A link both URL parsers read differently keeps the route's own 400.
    expect(probeLinkRefusal(new ProbeSourceBlockedError("link", "probeVideoSource: blocked — a link two URL parsers read differently"))).toBeUndefined()
  })
})
