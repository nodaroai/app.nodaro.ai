// @test-reads-none sockets only, and the clips it renders into its own temp dir
/**
 * A link is read only as an ordinary media file (the owner's decision: refuse
 * remote manifests). A remote probe runs with `-format_whitelist` of the
 * demuxers that read a file from the file itself (`SINGLE_FILE_DEMUXERS`), so a
 * streaming playlist, a manifest or a concat script (HLS, DASH, IMF, ffconcat)
 * is refused — typed, reason `container` — before any link inside it is opened.
 * That includes a link naming a raw transport the guard's proxy never sees
 * (`tcp://`, `httpproxy://`): a listener standing in for a private service
 * records that nothing ever connects to it.
 *
 * The test world: the local media server (127.0.0.1) stands in for a public
 * host; the probe and ffprobe are real.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { execFileSync } from "node:child_process"
import net from "node:net"
import { isPrivateOrReservedIP } from "@nodaro/shared/workflow"
import { NOT_A_MEDIA_FILE, notAMediaFileRefusal, probeInputArgs, probeNetwork, ProbeSourceBlockedError, REMOTE_PROBE_FORMATS, UNSUPPORTED_MEDIA_FORMAT } from "../probe-guard.js"
import { probeMediaDuration, probeVideoSource } from "../ffmpeg-utils.js"
import { probeClipLengthSec } from "../../../lib/video-utility-probe.js"
import { renderClip, startMediaServer, type MediaServer } from "./probe-media-server.js"

let media: MediaServer
/** Stands in for a private service a manifest might name: it records every connection. */
let privateListener: net.Server
const privateConnections: string[] = []
let privatePort: number

const at = (path: string) => `http://cdn.test:${media.port}${path}`

/**
 * Whether the installed ffprobe has this demuxer at all. The pinned build (CI,
 * the image) has every one named here; a build without libxml2 (Homebrew's)
 * has no `dash` or `imf`, so such a link cannot be recognised: it fails as
 * unreadable instead — never read either way.
 */
const DEMUXERS = new Set(
  execFileSync("ffprobe", ["-hide_banner", "-demuxers"], { encoding: "utf8" })
    .split("\n")
    .flatMap((line) => /^\s*D\S*\s+(\S+)/.exec(line)?.[1]?.split(",") ?? []),
)
const expectedReason = (demuxer: string) => (DEMUXERS.has(demuxer) ? "container" : undefined)
const reasonOf = (p: Promise<unknown>) => p.then(() => undefined, (e: unknown) => (e as { reason?: unknown }).reason)

beforeAll(async () => {
  media = await startMediaServer()
  media.route("/clip.mp4", { file: renderClip("video", 2), type: "video/mp4" })
  media.route("/clip.mp3", { file: renderClip("audio", 2), type: "audio/mpeg" })
  media.route("/clip.gif", { file: renderClip("gif", 2), type: "image/gif" })
  media.route("/clip.webm", { file: renderClip("webm", 2), type: "video/webm" })
  privateListener = net.createServer((socket) => {
    privateConnections.push("connected")
    socket.destroy()
  })
  await new Promise<void>((resolve) => privateListener.listen(0, "127.0.0.1", resolve))
  privatePort = (privateListener.address() as net.AddressInfo).port
  const segment = (url: string) => `#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\n${url}\n#EXT-X-ENDLIST\n`
  const mpd = (baseUrl: string) =>
    `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT2S" minBufferTime="PT1S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"><Period><AdaptationSet mimeType="video/mp2t"><Representation id="1" bandwidth="1000"><BaseURL>${baseUrl}</BaseURL></Representation></AdaptationSet></Period></MPD>`
  const HLS = "application/vnd.apple.mpegurl"
  const DASH = "application/dash+xml"
  media.route("/hls.m3u8", { type: HLS, text: segment(at("/clip.mp4")) })
  media.route("/dash.mpd", { type: DASH, text: mpd(at("/clip.mp4")) })
  media.route("/cpl.xml", {
    type: "application/xml",
    text: `<?xml version="1.0" encoding="UTF-8"?><CompositionPlaylist xmlns="http://www.smpte-ra.org/schemas/2067-3/2016"><Id>urn:uuid:aaaaaaaa-0000-0000-0000-000000000001</Id><ContentTitle>t</ContentTitle><EditRate>24 1</EditRate><SegmentList></SegmentList></CompositionPlaylist>`,
  })
  media.route("/list.ffconcat", { type: "text/plain", text: `ffconcat version 1.0\nfile ${at("/clip.mp4")}\n` })
  // Manifests naming a raw transport straight at the stand-in private listener.
  media.route("/hls-tcp.m3u8", { type: HLS, text: segment(`tcp://127.0.0.1:${privatePort}/seg.ts`) })
  media.route("/hls-httpproxy.m3u8", { type: HLS, text: segment(`httpproxy://127.0.0.1:${privatePort}/internal.test:80`) })
  media.route("/dash-tcp.mpd", { type: DASH, text: mpd(`tcp://127.0.0.1:${privatePort}/seg.ts`) })
  media.route("/dash-httpproxy.mpd", { type: DASH, text: mpd(`httpproxy://127.0.0.1:${privatePort}/internal.test:80`) })
})

afterAll(async () => {
  await media.close()
  await new Promise<void>((resolve) => privateListener.close(() => resolve()))
})

beforeEach(() => {
  privateConnections.length = 0
  vi.spyOn(probeNetwork, "lookup").mockResolvedValue([{ address: "127.0.0.1", family: 4 }])
  vi.spyOn(probeNetwork, "isRefusedAddress").mockImplementation((ip) => ip !== "127.0.0.1" && isPrivateOrReservedIP(ip))
})

afterEach(() => vi.restoreAllMocks())

describe("a link must be an ordinary media file", () => {
  it("the remote probe arguments hold it to the single-file demuxers, with a MOV's external references off", () => {
    const args = probeInputArgs(at("/clip.mp4"))
    expect(args[args.indexOf("-format_whitelist") + 1]).toBe(REMOTE_PROBE_FORMATS.join(","))
    expect(args[args.indexOf("-enable_drefs") + 1]).toBe("0")
    for (const manifest of ["hls", "dash", "imf", "concat", "webm_dash_manifest"]) expect(REMOTE_PROBE_FORMATS).not.toContain(manifest)
    // A local file keeps its own rules (file protocol only, no list): what a worker downloaded.
    expect(probeInputArgs("/tmp/clip.mp4")).toEqual(["-protocol_whitelist", "file"])
  })

  it("the installed ffprobe keeps a MOV's external data references off by default", () => {
    const help = execFileSync("ffprobe", ["-hide_banner", "-h", "demuxer=mov"], { encoding: "utf8" })
    expect(help).toMatch(/-enable_drefs\s+<boolean>.*\(default false\)/)
  })

  it.each([
    ["an HLS playlist", "/hls.m3u8", "hls"],
    ["a DASH manifest", "/dash.mpd", "dash"],
    ["an IMF composition playlist", "/cpl.xml", "imf"],
    ["a concat script", "/list.ffconcat", "concat"],
  ])("%s is refused as not a media file (reason `container`), and its route answer is the plain 400", async (_label, path, demuxer) => {
    const err = await probeVideoSource(at(path)).then(() => undefined, (e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    if (!DEMUXERS.has(demuxer)) return // this ffprobe cannot recognise it: refused as unreadable (asserted just above)
    expect(err).toBeInstanceOf(ProbeSourceBlockedError)
    expect(err).toMatchObject({ reason: "container" })
    expect(notAMediaFileRefusal(err)).toEqual(NOT_A_MEDIA_FILE)
    // Every probe of a link reads it the same way.
    expect(await reasonOf(probeMediaDuration(at(path)))).toBe("container")
    expect(await reasonOf(probeClipLengthSec(at(path)))).toBe("container")
  })

  it("the pinned ffprobe has every manifest demuxer above, so CI holds each refusal as typed", () => {
    // The image's build; a local build without them still refuses the link as unreadable.
    if (!/n8\.1\.2/.test(execFileSync("ffprobe", ["-version"], { encoding: "utf8" }))) return
    for (const demuxer of ["hls", "dash", "imf", "concat"]) expect(DEMUXERS.has(demuxer), demuxer).toBe(true)
  })

  it.each([
    ["an HLS segment over tcp://", "/hls-tcp.m3u8", "hls"],
    ["an HLS segment over httpproxy://", "/hls-httpproxy.m3u8", "hls"],
    ["a DASH BaseURL over tcp://", "/dash-tcp.mpd", "dash"],
    ["a DASH BaseURL over httpproxy://", "/dash-httpproxy.mpd", "dash"],
  ])("a manifest naming %s is refused, and nothing connects to the address it names", async (_label, path, demuxer) => {
    expect(await reasonOf(probeVideoSource(at(path)))).toBe(expectedReason(demuxer))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(privateConnections).toEqual([])
  })

  it("an MP4 link and a WebM link are still read", async () => {
    await expect(probeVideoSource(at("/clip.mp4"))).resolves.toMatchObject({ width: 64, height: 48 })
    await expect(probeVideoSource(at("/clip.webm"))).resolves.toMatchObject({ width: 64, height: 48 })
  })

  it("a link in a format the probe does not read (a GIF) is refused the same way, saying which formats it takes", async () => {
    const err = await probeVideoSource(at("/clip.gif")).then(() => undefined, (e: unknown) => e)
    expect(err).toMatchObject({ reason: "container", demuxer: "gif" })
    expect(notAMediaFileRefusal(err)).toEqual(UNSUPPORTED_MEDIA_FORMAT)
    expect(UNSUPPORTED_MEDIA_FORMAT.code).toBe(NOT_A_MEDIA_FILE.code)
    // A playlist is told it is one.
    expect(notAMediaFileRefusal(await probeVideoSource(at("/hls.m3u8")).then(() => undefined, (e: unknown) => e))).toEqual(NOT_A_MEDIA_FILE)
  })

  it("an MP3 link is still read", async () => {
    expect(await probeMediaDuration(at("/clip.mp3"))).toBeCloseTo(2, 0)
  })
})
