// @test-reads-none reads only the clips and certificate it writes to its own temp dir
/**
 * The probe guard against the REAL ffprobe and real HTTP.
 *
 * ffprobe follows redirects, and opens the links a playlist names, by itself:
 * a link that passed the first-hop check (`assertSafeProbeSource`) could then
 * be read from any address. Every guarded probe now runs with `http_proxy` at
 * a proxy of our own (`probe-guard.ts`) that checks each connection ffprobe
 * makes with the first hop's rule and connects to exactly the address it
 * checked.
 *
 * The test world: the local server (127.0.0.1) stands in for a PUBLIC host
 * (`probeNetwork.isRefusedAddress` lets it through); every other private or
 * reserved address is refused as in production. `cdn-a.test` / `cdn-b.test`
 * are public names for that server; `localhost` resolves to 127.0.0.1 AND ::1
 * (refused), so a redirect to it is a private hop that WOULD reach the local
 * server if the guard let it — its absence from the server's log is the proof
 * it was never read.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isPrivateOrReservedIP } from "@nodaro/shared/workflow"
import { guardLookupCaps, NOT_A_MEDIA_FILE, notAMediaFileRefusal, probeNetwork, PROBE_MAX_REDIRECTS, ProbeSourceBlockedError, assertSafeProbeSource } from "../probe-guard.js"
import { remuxToMp4ReadingLinks, runFfmpegCaptureReadingLinks, runFfmpegReadingLinks, transcodeToBrowserSafeReadingLinks } from "../ffmpeg-reading-links.js"
import { getVideoDuration, probeVideoStream, runFfmpeg, OWN_STORAGE_PROBE_MAX_BYTES, probeMediaDuration, probeVideoFramePtsMs, probeVideoSource, runFfprobe, runFfprobeCapture, runFfprobeReadingLinks, scanPacketEnds } from "../ffmpeg-utils.js"
import { probeStreams } from "../video-file-stages.js"
import { probeClipLengthSec } from "../../../lib/video-utility-probe.js"
import { renderClip, renderLargeClip, serveFile, startMediaServer, type MediaServer } from "./probe-media-server.js"

const STAND_IN = "127.0.0.1"
const NAMES: Record<string, ReadonlyArray<{ address: string; family: number }> | { code: string }> = {
  "cdn-a.test": [{ address: STAND_IN, family: 4 }],
  "cdn-b.test": [{ address: STAND_IN, family: 4 }],
  localhost: [{ address: STAND_IN, family: 4 }, { address: "::1", family: 6 }],
  "intranet.test": [{ address: "10.0.0.7", family: 4 }],
  "gone.test": { code: "ENOTFOUND" },
  "flaky.test": { code: "EAI_AGAIN" },
}

let media: MediaServer
let tls: { server: HttpsServer; port: number; dir: string } | undefined
const clip = renderClip("video", 2)
// Read to (near) their end through the proxy: the index at the tail, every packet of a live WebM.
const large = { mp4: renderLargeClip("mp4-index-at-end", 8), webm: renderLargeClip("webm-no-length", 8) }
const savedStorage = process.env.R2_PUBLIC_URL
const savedCertFile = process.env.SSL_CERT_FILE

const hangs: Array<() => void> = []
const secretHits = () => media.hits.filter((h) => h.path.startsWith("/secret"))
const blockedReason = (p: Promise<unknown>) => p.then(() => undefined, (e: unknown) => e)

/** The test world's lookups and verdicts (module note). `flip.test` answers public, then private. */
function standInNetwork(): void {
  let flips = 0
  vi.spyOn(probeNetwork, "lookup").mockImplementation(async (host: string) => {
    // A resolver that does not answer until the test lets it (afterEach), so its scheduler slot is freed after.
    if (host.startsWith("hang-")) return new Promise((_resolve, reject) => hangs.push(() => reject(Object.assign(new Error("EAI_AGAIN"), { code: "EAI_AGAIN" }))))
    if (host === "flip.test" || host === "flip-again.test") return [{ address: flips++ % 2 === 0 ? STAND_IN : "10.0.0.9", family: 4 }]
    const answer = NAMES[host]
    if (!answer) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" })
    if ("code" in answer) throw Object.assign(new Error(`getaddrinfo ${answer.code} ${host}`), { code: answer.code })
    return [...answer]
  })
  vi.spyOn(probeNetwork, "isRefusedAddress").mockImplementation((ip: string) => ip !== STAND_IN && isPrivateOrReservedIP(ip))
}

beforeAll(async () => {
  media = await startMediaServer()
  media.route("/clip.mp4", { file: clip, type: "video/mp4" })
  media.route("/secret.mp4", { file: clip, type: "video/mp4" })
  media.route("/secret.ts", { file: clip, type: "video/mp2t" })
  media.route("/large.mp4", { file: large.mp4, type: "video/mp4" })
  media.route("/large.webm", { file: large.webm, type: "video/webm" })
  // An https server for the CONNECT path, when openssl can make it a certificate.
  try {
    const dir = mkdtempSync(join(tmpdir(), "probe-tls-"))
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "1", "-subj", "/CN=cdn-a.test", "-addext", "subjectAltName=DNS:cdn-a.test"], { stdio: "ignore" })
    const server = createHttpsServer({ key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) }, (req, res) => {
      if (req.url === "/to-secret") return void res.writeHead(302, { location: `http://localhost:${media.port}/secret.mp4` }).end()
      if (req.url === "/large.mp4") return serveFile(req, res, large.mp4, "video/mp4")
      if (req.url === "/large.webm") return serveFile(req, res, large.webm, "video/webm")
      serveFile(req, res, clip, "video/mp4")
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    tls = { server, port: (server.address() as AddressInfo).port, dir }
    // The pinned ffmpeg does not verify a certificate; a newer one does — trust this one.
    process.env.SSL_CERT_FILE = join(dir, "c.pem")
  } catch {
    tls = undefined
  }
})

afterAll(async () => {
  await media.close()
  if (tls) {
    tls.server.closeAllConnections()
    await new Promise<void>((resolve) => tls!.server.close(() => resolve()))
    rmSync(tls.dir, { recursive: true, force: true })
  }
  if (savedStorage === undefined) delete process.env.R2_PUBLIC_URL
  else process.env.R2_PUBLIC_URL = savedStorage
  if (savedCertFile === undefined) delete process.env.SSL_CERT_FILE
  else process.env.SSL_CERT_FILE = savedCertFile
})

beforeEach(() => {
  media.hits.length = 0
  standInNetwork()
})

afterEach(async () => {
  for (const release of hangs.splice(0)) release()
  await new Promise((resolve) => setTimeout(resolve, 5))
  vi.restoreAllMocks()
  delete process.env.R2_PUBLIC_URL
})

const at = (host: string, path: string) => `http://${host}:${media.port}${path}`

describe("public links read as they always have", () => {
  it("two links whose hosts never resolve do not hold up another user's probe: it reads in its normal time (the image's 16-thread pool)", async () => {
    const saved = probeNetwork.lookupTimeoutMs
    const savedCaps = { maxActiveLookups: probeNetwork.maxActiveLookups, maxAbandonedLookups: probeNetwork.maxAbandonedLookups }
    Object.assign(probeNetwork, guardLookupCaps(16))
    probeNetwork.lookupTimeoutMs = 1_500
    try {
      const hung = [probeVideoSource(at("hang-1.slow.test", "/clip.mp4")), probeVideoSource(at("hang-2.slow.test", "/clip.mp4"))].map((p) => blockedReason(p))
      await new Promise((resolve) => setTimeout(resolve, 20))
      const started = Date.now()
      await expect(probeVideoSource(at("cdn-b.test", "/clip.mp4"))).resolves.toMatchObject({ width: 64, height: 48 })
      expect(Date.now() - started).toBeLessThan(1_000)
      // The two hung probes are refused as a resolver failure: retryable.
      expect(await Promise.all(hung)).toMatchObject([{ reason: "dns" }, { reason: "dns" }])
    } finally {
      probeNetwork.lookupTimeoutMs = saved
      Object.assign(probeNetwork, savedCaps)
    }
  })

  it("a direct link is read by ffprobe (through the proxy, with its own range request)", async () => {
    await expect(probeVideoSource(at("cdn-a.test", "/clip.mp4"))).resolves.toMatchObject({ width: 64, height: 48 })
    expect(media.hits.some((h) => h.path === "/clip.mp4" && h.host === `cdn-a.test:${media.port}` && /^Lavf/.test(h.userAgent ?? ""))).toBe(true)
  })

  it("a redirect to another public host is followed and read", async () => {
    media.route("/to-b", { redirect: at("cdn-b.test", "/clip.mp4") })
    await expect(probeMediaDuration(at("cdn-a.test", "/to-b"))).resolves.toBeCloseTo(2, 0)
    expect(media.hits.map((h) => `${h.host}${h.path}`)).toEqual(expect.arrayContaining([`cdn-a.test:${media.port}/to-b`, `cdn-b.test:${media.port}/clip.mp4`]))
  })

  it("an https link is read through a tunnel (CONNECT) to the checked address", async (ctx) => {
    if (!tls) return ctx.skip()
    await expect(probeVideoSource(`https://cdn-a.test:${tls.port}/clip.mp4`)).resolves.toMatchObject({ width: 64, height: 48 })
  })

  it("a file of several MB read to its end reads exactly as the same file on disk (an index at the tail; a live WebM's every packet), over http and https", async (ctx) => {
    const dir = mkdtempSync(join(tmpdir(), "probe-large-"))
    try {
      const local = { mp4: join(dir, "large.mp4"), webm: join(dir, "large.webm") }
      writeFileSync(local.mp4, large.mp4)
      writeFileSync(local.webm, large.webm)
      const expected = { mp4: await probeClipLengthSec(local.mp4), webm: await probeClipLengthSec(local.webm) }
      expect(large.mp4.length).toBeGreaterThan(2 * 1024 * 1024)
      expect(expected.mp4).toBeCloseTo(8, 1)
      expect(expected.webm).toBeCloseTo(8, 1)
      expect(await probeClipLengthSec(at("cdn-a.test", "/large.mp4"))).toBe(expected.mp4)
      expect(await probeClipLengthSec(at("cdn-a.test", "/large.webm"))).toBe(expected.webm)
      // The index at the tail is reached with a range request of its own.
      expect(media.hits.some((h) => h.path === "/large.mp4" && h.range !== undefined && h.range !== "bytes=0-")).toBe(true)
      if (!tls) return ctx.skip()
      expect(await probeClipLengthSec(`https://cdn-a.test:${tls.port}/large.mp4`)).toBe(expected.mp4)
      expect(await probeClipLengthSec(`https://cdn-a.test:${tls.port}/large.webm`)).toBe(expected.webm)
      expect((await probeVideoSource(`https://cdn-a.test:${tls.port}/large.mp4`)).durationSeconds).toBe((await probeVideoSource(local.mp4)).durationSeconds)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it(`ffmpeg's own redirect limit holds: ${PROBE_MAX_REDIRECTS} redirects are followed, one more is not`, async () => {
    const chain = (n: number, path: string) => {
      for (let i = n; i > 0; i--) media.route(`${path}/${i}`, { redirect: i === 1 ? at("cdn-b.test", "/clip.mp4") : `${path}/${i - 1}` })
      return at("cdn-a.test", `${path}/${n}`)
    }
    await expect(probeMediaDuration(chain(PROBE_MAX_REDIRECTS, "/eight"))).resolves.toBeCloseTo(2, 0)
    const over = await blockedReason(probeMediaDuration(chain(PROBE_MAX_REDIRECTS + 1, "/nine")))
    expect(over).toBeInstanceOf(Error)
    expect(over).not.toBeInstanceOf(ProbeSourceBlockedError)
    expect(media.hits.filter((h) => h.path.startsWith("/nine/"))).toHaveLength(PROBE_MAX_REDIRECTS + 1)
  })
})

describe("a private or reserved hop is refused with the first hop's own error, and never read", () => {
  it("before the fix this was read: the first hop passes the guard, its redirect points at a private address", async () => {
    // The first hop alone is public: the old guard (this check) let the link through.
    media.route("/to-secret", { redirect: at("localhost", "/secret.mp4") })
    await expect(assertSafeProbeSource(at("cdn-a.test", "/to-secret"))).resolves.toBeUndefined()
    const err = await blockedReason(probeVideoSource(at("cdn-a.test", "/to-secret")))
    expect(err).toBeInstanceOf(ProbeSourceBlockedError)
    expect(err).toMatchObject({ reason: "address", message: "probeVideoSource: blocked — localhost resolves to private/reserved IP ::1" })
    // The same error the first hop gets for that address.
    expect(await blockedReason(assertSafeProbeSource(at("localhost", "/secret.mp4")))).toMatchObject({ reason: "address", message: (err as Error).message })
    expect(secretHits()).toEqual([])
  })

  it.each([
    ["a literal private IP", "http://10.0.0.7:9/secret.mp4", "probeVideoSource: blocked private/reserved IP 10.0.0.7"],
    ["the cloud metadata address", "http://169.254.169.254/latest/meta-data/", "probeVideoSource: blocked private/reserved IP 169.254.169.254"],
    ["a name that resolves to a private address", "http://intranet.test/secret.mp4", "probeVideoSource: blocked — intranet.test resolves to private/reserved IP 10.0.0.7"],
    ["IPv6 loopback", "http://[::1]:9/secret.mp4", "probeVideoSource: blocked private/reserved IP ::1"],
  ])("a redirect to %s", async (_label, target, message) => {
    media.route("/hop", { redirect: target })
    expect(await blockedReason(probeVideoSource(at("cdn-a.test", "/hop")))).toMatchObject({ reason: "address", message })
  })

  it("a private hop after several public ones is refused the same way", async () => {
    media.route("/1", { redirect: at("cdn-b.test", "/2") })
    media.route("/2", { redirect: at("cdn-a.test", "/3") })
    media.route("/3", { redirect: at("localhost", "/secret.mp4") })
    expect(await blockedReason(probeVideoSource(at("cdn-a.test", "/1")))).toMatchObject({ reason: "address" })
    expect(media.hits.map((h) => h.path)).toEqual(["/1", "/2", "/3"])
  })

  it("an https link redirecting to a private address is refused", async (ctx) => {
    if (!tls) return ctx.skip()
    expect(await blockedReason(probeVideoSource(`https://cdn-a.test:${tls.port}/to-secret`))).toMatchObject({ reason: "address" })
    expect(secretHits()).toEqual([])
  })

  it("a playlist naming a private address is refused as not a media file, before any link in it is opened", async () => {
    media.route("/list.m3u8", {
      type: "application/vnd.apple.mpegurl",
      text: `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\n${at("localhost", "/secret.ts")}\n#EXT-X-ENDLIST\n`,
    })
    expect(await blockedReason(probeVideoSource(at("cdn-a.test", "/list.m3u8")))).toMatchObject({ reason: "container" })
    expect(secretHits()).toEqual([])
  })

  it("a host that answers a public address and then a private one (DNS rebinding) is only ever reached at the address that was checked", async () => {
    // The checked answer is reused for the run's connections: the later, private answer is never asked for or used.
    await expect(probeVideoSource(at("flip.test", "/clip.mp4"))).resolves.toMatchObject({ width: 64, height: 48 })
    expect(vi.mocked(probeNetwork.lookup).mock.calls.filter(([h]) => h === "flip.test")).toHaveLength(1)
  })

  it("with no answer to reuse, the proxy's own lookup is checked again: a private answer is refused at the connection", async () => {
    const saved = probeNetwork.answerCacheMs
    probeNetwork.answerCacheMs = 0
    try {
      expect(await blockedReason(probeVideoSource(at("flip-again.test", "/clip.mp4")))).toMatchObject({
        reason: "address",
        message: "probeVideoSource: blocked — flip-again.test resolves to private/reserved IP 10.0.0.9",
      })
      expect(media.hits).toEqual([])
    } finally {
      probeNetwork.answerCacheMs = saved
    }
  })

  it("a `no_proxy` in the server's environment does not let ffprobe around the proxy", async () => {
    const saved = process.env.no_proxy
    process.env.no_proxy = "localhost,127.0.0.1,::1"
    try {
      media.route("/to-secret", { redirect: at("localhost", "/secret.mp4") })
      expect(await blockedReason(probeVideoSource(at("cdn-a.test", "/to-secret")))).toMatchObject({ reason: "address" })
      expect(secretHits()).toEqual([])
    } finally {
      if (saved === undefined) delete process.env.no_proxy
      else process.env.no_proxy = saved
    }
  })

  it("a playlist on someone's server cannot name a file on this one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "probe-local-"))
    try {
      const local = join(dir, "local.ts")
      execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=d=2:s=64x48:r=10", "-f", "mpegts", local])
      media.route("/local.m3u8", {
        type: "application/vnd.apple.mpegurl",
        text: `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nfile://${local}\n#EXT-X-ENDLIST\n`,
      })
      await expect(probeVideoSource(at("cdn-a.test", "/local.m3u8"))).rejects.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("a redirect target's failed lookup is told apart by the lookup's own answer, as the first hop's is", () => {
  it("a host that does not exist is `host` (for good); a failing resolver is `dns` (retryable)", async () => {
    media.route("/to-gone", { redirect: "http://gone.test/clip.mp4" })
    media.route("/to-flaky", { redirect: "http://flaky.test/clip.mp4" })
    expect(await blockedReason(probeVideoSource(at("cdn-a.test", "/to-gone")))).toMatchObject({ reason: "host", message: "probeVideoSource: blocked — DNS resolution failed for gone.test" })
    expect(await blockedReason(probeVideoSource(at("cdn-a.test", "/to-flaky")))).toMatchObject({ reason: "dns", message: "probeVideoSource: blocked — DNS resolution failed for flaky.test" })
  })
})

describe("this install's own storage (the probe guard's one fallback)", () => {
  const STORAGE = "/storage/nodaro-assets"

  it("a self-host: a file of its own storage on a private address is downloaded and probed on disk", async () => {
    vi.mocked(probeNetwork.isRefusedAddress).mockImplementation((ip) => isPrivateOrReservedIP(ip))
    process.env.R2_PUBLIC_URL = `${media.origin}${STORAGE}`
    media.route(`${STORAGE}/videos/clip.mp4`, { file: clip, type: "video/mp4" })
    await expect(probeVideoSource(`${media.origin}${STORAGE}/videos/clip.mp4`)).resolves.toMatchObject({ width: 64, height: 48 })
    // One plain download (no range, not ffprobe), then the probe read the copy on disk.
    const reads = media.hits.filter((h) => h.path === `${STORAGE}/videos/clip.mp4`)
    expect(reads).toHaveLength(1)
    expect(reads[0]!.range).toBeUndefined()
    expect(reads[0]!.userAgent ?? "").not.toMatch(/^Lavf/)
  })

  it("the download is capped at 2 GiB: a larger file is refused at its headers", async () => {
    expect(OWN_STORAGE_PROBE_MAX_BYTES).toBe(2 * 1024 ** 3)
    vi.mocked(probeNetwork.isRefusedAddress).mockImplementation((ip) => isPrivateOrReservedIP(ip))
    process.env.R2_PUBLIC_URL = `${media.origin}${STORAGE}`
    media.route(`${STORAGE}/videos/huge.mp4`, { announce: 3 * 1024 ** 3 })
    await expect(probeVideoSource(`${media.origin}${STORAGE}/videos/huge.mp4`)).rejects.toThrow(/Download exceeds 2048 MB/)
  })

  it("the same private address outside the storage subtree stays refused, nothing downloaded", async () => {
    vi.mocked(probeNetwork.isRefusedAddress).mockImplementation((ip) => isPrivateOrReservedIP(ip))
    process.env.R2_PUBLIC_URL = `${media.origin}${STORAGE}`
    expect(await blockedReason(probeVideoSource(`${media.origin}/clip.mp4`))).toMatchObject({ reason: "address" })
    expect(media.hits).toEqual([])
  })

  it("Cloud: own storage on a public host is probed where it is (ffprobe's range read), never downloaded", async () => {
    process.env.R2_PUBLIC_URL = at("cdn-a.test", STORAGE)
    media.route(`${STORAGE}/videos/clip.mp4`, { file: clip, type: "video/mp4" })
    await expect(probeVideoSource(at("cdn-a.test", `${STORAGE}/videos/clip.mp4`))).resolves.toMatchObject({ width: 64, height: 48 })
    const reads = media.hits.filter((h) => h.path === `${STORAGE}/videos/clip.mp4`)
    expect(reads.length).toBeGreaterThan(0)
    expect(reads.every((h) => /^Lavf/.test(h.userAgent ?? ""))).toBe(true)
  })
})

describe("a raw ffprobe run is never handed a link (fail closed)", () => {
  it("the local-file runners and helpers refuse a link before ffprobe starts, and nothing is requested", async () => {
    const link = at("cdn-a.test", "/clip.mp4")
    await expect(runFfprobe(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", link])).rejects.toThrow(/outside the probe guard/)
    await expect(runFfprobeCapture(["-v", "error", link])).rejects.toThrow(/outside the probe guard/)
    await expect(getVideoDuration(link)).rejects.toThrow(/outside the probe guard/)
    await expect(scanPacketEnds(link, 0)).rejects.toThrow(/outside the probe guard/)
    await expect(probeVideoFramePtsMs(link)).rejects.toThrow(/outside the probe guard/)
    // The download stage's stream check never rejects: it answers "unknown" without reading the link.
    await expect(probeStreams(link)).resolves.toEqual({ videoCodec: null, hasAudio: null, width: null, height: null })
    expect(media.hits).toEqual([])
  })

  it("the private plugin's runner reads a link through the guard: a public one is read, a private hop refused", async () => {
    const out = await runFfprobeReadingLinks(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", at("cdn-a.test", "/clip.mp4")])
    expect(out.trim()).toBe("64")
    media.route("/to-secret", { redirect: at("localhost", "/secret.mp4") })
    expect(await blockedReason(runFfprobeReadingLinks(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", at("cdn-a.test", "/to-secret")]))).toMatchObject({ reason: "address" })
    expect(secretHits()).toEqual([])
    // A caller cannot set the guard's own options on a run that reads a link (ffprobe keeps the LAST value
    // of an option wherever it sits, so placing ours first or last alone would not hold): refused, before or after it.
    media.route("/widen.m3u8", { type: "application/vnd.apple.mpegurl", text: `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\n${at("cdn-a.test", "/clip.mp4")}\n#EXT-X-ENDLIST\n` })
    media.hits.length = 0
    for (const args of [
      ["-format_whitelist", "hls,mov", "-v", "error", at("cdn-a.test", "/widen.m3u8")],
      ["-v", "error", at("cdn-a.test", "/widen.m3u8"), "-format_whitelist", "hls,mov"],
      ["-v", "error", at("cdn-a.test", "/widen.m3u8"), "-protocol_whitelist", "file,http,https,tcp,tls"],
      ["-v", "error", at("cdn-a.test", "/clip.mp4"), "-enable_drefs", "1"],
      ["-v", "error", at("cdn-a.test", "/clip.mp4"), "-max_redirects", "50"],
    ]) {
      await expect(runFfprobeReadingLinks(args)).rejects.toThrow(/the probe guard's own options/)
    }
    expect(media.hits).toEqual([])
  })
})

describe("the private plugin's ffmpeg runs read a link through the guard", () => {
  const withDir = async (fn: (dir: string) => Promise<void>) => {
    const dir = mkdtempSync(join(tmpdir(), "probe-ffmpeg-"))
    try {
      await fn(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it("a public link reads as it always has: an index at the end reached by a range request, over http and https", async (ctx) => {
    await withDir(async (dir) => {
      const out = join(dir, "copy.mp4")
      await runFfmpegReadingLinks(["-v", "error", "-y", "-i", at("cdn-a.test", "/large.mp4"), "-c", "copy", out])
      expect(await getVideoDuration(out)).toBeCloseTo(8, 1)
      // The index at the tail is reached with a range request of its own, through the proxy.
      expect(media.hits.some((h) => h.path === "/large.mp4" && h.range !== undefined && h.range !== "bytes=0-")).toBe(true)
      // The capture runner as well, with a local input beside the link (only the link gets the guard's options).
      const local = join(dir, "local.mp4")
      writeFileSync(local, clip)
      const both = await runFfmpegCaptureReadingLinks(["-y", "-i", local, "-i", at("cdn-b.test", "/clip.mp4"), "-map", "0:v", "-map", "1:v", "-c", "copy", join(dir, "both.mkv")])
      expect(both.stderr).toMatch(/Input #1, mov,mp4/)
      if (!tls) return ctx.skip()
      const viaTunnel = join(dir, "tunnel.mp4")
      await runFfmpegReadingLinks(["-v", "error", "-y", "-i", `https://cdn-a.test:${tls.port}/large.mp4`, "-c", "copy", viaTunnel])
      expect(await getVideoDuration(viaTunnel)).toBeCloseTo(8, 1)
    })
  })

  it("a link that redirects to a private address is refused, and the private address is never read", async () => {
    await withDir(async (dir) => {
      media.route("/to-secret", { redirect: at("localhost", "/secret.mp4") })
      expect(await blockedReason(runFfmpegReadingLinks(["-y", "-i", at("cdn-a.test", "/to-secret"), "-c", "copy", join(dir, "a.mp4")]))).toMatchObject({ reason: "address" })
      expect(await blockedReason(runFfmpegCaptureReadingLinks(["-y", "-i", at("cdn-a.test", "/to-secret"), "-f", "null", "-"]))).toMatchObject({ reason: "address" })
      // A first hop that is private is refused before ffmpeg starts.
      expect(await blockedReason(runFfmpegReadingLinks(["-y", "-i", at("intranet.test", "/clip.mp4"), "-f", "null", "-"]))).toMatchObject({ reason: "address" })
      if (tls) expect(await blockedReason(runFfmpegReadingLinks(["-y", "-i", `https://cdn-a.test:${tls.port}/to-secret`, "-f", "null", "-"]))).toMatchObject({ reason: "address" })
      expect(secretHits()).toEqual([])
    })
  })

  it("a playlist link is refused as not an ordinary media file, and nothing it names is requested", async () => {
    media.route("/list.m3u8", { type: "application/vnd.apple.mpegurl", text: `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\n${at("cdn-b.test", "/secret.ts")}\n#EXT-X-ENDLIST\n` })
    // At ffmpeg's default log level, as a plugin's run has it: the refusal is read from the full stderr.
    const err = await blockedReason(runFfmpegReadingLinks(["-y", "-i", at("cdn-a.test", "/list.m3u8"), "-f", "null", "-"]))
    expect(err).toMatchObject({ reason: "container" })
    expect(notAMediaFileRefusal(err)).toBe(NOT_A_MEDIA_FILE)
    // A forced demuxer is held to the same list.
    expect(await blockedReason(runFfmpegCaptureReadingLinks(["-v", "error", "-f", "hls", "-i", at("cdn-a.test", "/list.m3u8"), "-f", "null", "-"]))).toMatchObject({ reason: "container" })
    expect(secretHits()).toEqual([])
  })

  it("a local-path argv runs exactly as given: its own whitelist kept, nothing requested", async () => {
    await withDir(async (dir) => {
      const local = join(dir, "in.mp4")
      writeFileSync(local, clip)
      const out = join(dir, "out.mp4")
      await runFfmpegReadingLinks(["-v", "error", "-y", "-protocol_whitelist", "file", "-i", local, "-c", "copy", out])
      expect(await getVideoDuration(out)).toBeCloseTo(2, 0)
      const captured = await runFfmpegCaptureReadingLinks(["-hide_banner", "-protocol_whitelist", "file", "-i", local, "-f", "null", "-"])
      expect(captured.stderr).toMatch(/Input #0/)
      expect(media.hits).toEqual([])
    })
  })

  it("a link anywhere but an input, or the guard's own options beside a link, is refused before ffmpeg starts", async () => {
    await withDir(async (dir) => {
      const local = join(dir, "in.mp4")
      writeFileSync(local, clip)
      const link = at("cdn-a.test", "/clip.mp4")
      for (const args of [
        ["-y", "-i", local, "-c", "copy", "-f", "mp4", at("cdn-a.test", "/upload")],
        ["-y", "-i", local, "-vf", `movie='${link}'`, join(dir, "o.mp4")],
        ["-y", "-i", `concat:${link}|${link}`, join(dir, "o.mp4")],
        ["-y", "-f", "lavfi", "-i", `movie='${link}'`, join(dir, "o.mp4")],
      ]) {
        expect(await blockedReason(runFfmpegReadingLinks(args))).toMatchObject({ reason: "link" })
      }
      for (const args of [
        ["-y", "-protocol_whitelist", "file,http,https,tcp,tls", "-i", link, join(dir, "o.mp4")],
        ["-y", "-format_whitelist", "hls,mov", "-i", link, join(dir, "o.mp4")],
        ["-y", "-enable_drefs", "1", "-i", link, join(dir, "o.mp4")],
        ["-y", "-http_proxy", "127.0.0.1:1", "-i", link, join(dir, "o.mp4")],
      ]) {
        await expect(runFfmpegCaptureReadingLinks(args)).rejects.toThrow(/the probe guard's own options/)
      }
      expect(media.hits).toEqual([])
    })
  })

  it("the toolkit's encoders read a link through the guard: a WebM transcoded, an H.264 file handed back, an MKV remuxed; a private hop and a link output refused", async () => {
    await withDir(async (dir) => {
      media.route("/clip.webm", { file: renderClip("webm", 2), type: "video/webm" })
      const transcoded = join(dir, "t.mp4")
      expect(await transcodeToBrowserSafeReadingLinks(at("cdn-a.test", "/clip.webm"), transcoded)).toBe(transcoded)
      expect(await probeVideoStream(transcoded)).toEqual({ codec: "h264", pixFmt: "yuv420p" })
      // Already browser-safe: handed back as it is, nothing encoded.
      expect(await transcodeToBrowserSafeReadingLinks(at("cdn-a.test", "/clip.mp4"), join(dir, "unused.mp4"))).toBe(at("cdn-a.test", "/clip.mp4"))
      // An MKV of the H.264 clip (a remux copies the picture as it is).
      writeFileSync(join(dir, "src.mp4"), clip)
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", join(dir, "src.mp4"), "-c", "copy", join(dir, "clip.mkv")])
      media.route("/clip.mkv", { file: readFileSync(join(dir, "clip.mkv")), type: "video/x-matroska" })
      const remuxed = join(dir, "r.mp4")
      await remuxToMp4ReadingLinks(at("cdn-b.test", "/clip.mkv"), remuxed)
      expect(await getVideoDuration(remuxed)).toBeCloseTo(2, 0)
      media.route("/to-secret", { redirect: at("localhost", "/secret.mp4") })
      expect(await blockedReason(transcodeToBrowserSafeReadingLinks(at("cdn-a.test", "/to-secret"), join(dir, "x.mp4")))).toMatchObject({ reason: "address" })
      expect(await blockedReason(remuxToMp4ReadingLinks(at("cdn-a.test", "/to-secret"), join(dir, "y.mp4")))).toMatchObject({ reason: "address" })
      expect(secretHits()).toEqual([])
      media.hits.length = 0
      const local = join(dir, "in.mp4")
      writeFileSync(local, clip)
      expect(await blockedReason(remuxToMp4ReadingLinks(local, at("cdn-a.test", "/upload.mp4")))).toMatchObject({ reason: "link" })
      expect(media.hits).toEqual([])
    })
  })

  it("a link a filter spells with ffmpeg's filter escaping (a movie= or amovie= source) is a link too: refused before ffmpeg starts; a local movie= source runs", async () => {
    await withDir(async (dir) => {
      const local = join(dir, "in.mp4")
      writeFileSync(local, clip)
      const out = join(dir, "o.mp4")
      // ffmpeg's two escaping levels in a filter graph: each ":" of the link written as "\\\:".
      const escaped = (link: string, level: string) => link.replace(/:/g, `${level}:`)
      const twice = "\\\\\\"
      // The control: the plain runner (no guard) opens such a link. The media server answers at 127.0.0.1.
      media.route("/escaped-control.mp4", { file: clip, type: "video/mp4" })
      await runFfmpeg(["-v", "error", "-y", "-i", local, "-vf", `movie=${escaped(`${media.origin}/escaped-control.mp4`, twice)}[m];[in][m]overlay`, "-frames:v", "1", join(dir, "control.png")])
      expect(media.hits.map((h) => h.path)).toContain("/escaped-control.mp4")
      media.hits.length = 0
      const link = at("cdn-a.test", "/secret.mp4")
      for (const args of [
        ["-y", "-i", local, "-vf", `movie=${escaped(link, twice)}[m];[in][m]overlay`, out],
        ["-y", "-i", local, "-vf", `movie='${escaped(link, "\\")}'[m];[in][m]overlay`, out],
        ["-y", "-i", local, "-filter_complex", `movie=filename=${escaped(link, "\\\\")}[m];[0:v][m]overlay`, out],
        ["-y", "-i", local, "-af", `amovie=${escaped(link, twice)}[a];[in][a]amix`, out],
        ["-y", "-f", "lavfi", "-i", `movie=${escaped(link, twice)}`, out],
        ["-y", "-i", local, "-vf", `movie=ht'tp:/'/cdn-a.test\\:${media.port}/secret.mp4[m];[in][m]overlay`, out],
      ]) {
        expect(await blockedReason(runFfmpegReadingLinks(args))).toMatchObject({ reason: "link" })
      }
      expect(media.hits).toEqual([])
      // A movie= source naming a local file is unchanged.
      await runFfmpegReadingLinks(["-v", "error", "-y", "-f", "lavfi", "-i", `movie=${local}`, "-frames:v", "1", join(dir, "local.png")])
      expect(media.hits).toEqual([])
    })
  })
})
