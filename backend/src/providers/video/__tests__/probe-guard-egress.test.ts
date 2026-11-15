// @test-reads-none sockets only: a client through the proxy on the loopback, no file
/**
 * What a guarded run throws when its read fails after the proxy refused a hop
 * (`withProbeEgress`): the refusal only when the failure names no cause of its
 * own. A read that ran out of time, was stopped, or was refused by the probe
 * itself (a link that is not an ordinary media file) fails as what happened —
 * a refused playlist alternate must not turn a retryable timeout into
 * "unreadable".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import http from "node:http"
import { isPrivateOrReservedIP } from "@nodaro/shared/workflow"
import { probeNetwork, ProbeSourceBlockedError, withProbeEgress, type ProbeEgress } from "../probe-guard.js"
import { proxyAuthorization } from "./probe-media-server.js"

beforeEach(() => {
  vi.spyOn(probeNetwork, "lookup").mockImplementation(async (host) => [{ address: host === "blocked.test" ? "10.0.0.7" : "127.0.0.1", family: 4 }])
  vi.spyOn(probeNetwork, "isRefusedAddress").mockImplementation((ip) => ip !== "127.0.0.1" && isPrivateOrReservedIP(ip))
})
afterEach(() => vi.restoreAllMocks())

/** One request through the run's proxy to a host it refuses: the refusal is recorded. */
function hitRefusedHop(egress: ProbeEgress): Promise<void> {
  const proxy = new URL(egress.env.http_proxy!)
  return new Promise((resolve) => {
    const req = http.request({ host: proxy.hostname, port: Number(proxy.port), path: "http://blocked.test/alt.m3u8", headers: { host: "blocked.test", "proxy-authorization": proxyAuthorization(egress.env.http_proxy!) } })
    req.on("response", (res) => res.resume().on("end", () => resolve()))
    req.on("error", () => resolve())
    req.end()
  })
}

const failAfterRefusal = (failure: unknown) =>
  withProbeEgress(async (egress) => {
    await hitRefusedHop(egress)
    expect(egress.refusal()).toMatchObject({ reason: "address" })
    throw failure
  }).then(() => undefined, (e: unknown) => e)

describe("a read that fails after a refused hop", () => {
  it("with no cause of its own: the refusal, with the failure as its cause", async () => {
    const plain = new Error("ffprobe failed: Invalid data found when processing input")
    const err = await failAfterRefusal(plain)
    expect(err).toBeInstanceOf(ProbeSourceBlockedError)
    expect(err).toMatchObject({ reason: "address", message: "probeVideoSource: blocked — blocked.test resolves to private/reserved IP 10.0.0.7", cause: plain })
  })

  it.each([
    ["timed out (ffprobe killed at its timeout)", Object.assign(new Error("ffprobe failed: "), { killed: true, timedOut: true })],
    ["stopped by its caller", Object.assign(new Error("The operation was aborted"), { name: "AbortError" })],
    ["out of time on a deadline", Object.assign(new Error("clip reading: out of time"), { timedOut: true })],
    ["refused by the probe itself (not a media file)", new ProbeSourceBlockedError("container", "probeVideoSource: blocked — a hls link is not an ordinary media file")],
  ])("%s: thrown as it is", async (_label, failure) => {
    expect(await failAfterRefusal(failure)).toBe(failure)
  })
})
