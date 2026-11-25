// @test-reads-none sockets only, and the files it renders into its own temp dir
/**
 * What a separation's source link IS, read by the REAL probe: ffprobe, the
 * probe guard (its link check, its proxy and its `-format_whitelist`) and
 * `classifyMediaSource`, against a local media server standing in for a public
 * host. Nothing on the probe's path is mocked: a picture link reaches the guard
 * exactly as one from a CDN does.
 *
 * The case that shipped (2026-11-24): a WebP and a PNG sent as the source were
 * passed to the provider, which failed three times with its own error. The
 * guard reads a link only with ordinary audio and video demuxers, so it refuses
 * a picture for its format, the stream probe threw, and the step failed open.
 * The unit tests had stood the probe in with a stream list the guard never
 * returns for a picture link.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isPrivateOrReservedIP } from "@nodaro/shared/workflow"
import { probeNetwork } from "../../video/probe-guard.js"
import { probeMediaStreams } from "../../video/ffmpeg-utils.js"
import { renderClip, startMediaServer, type MediaServer } from "../../video/__tests__/probe-media-server.js"
import { inputUnusableHintOf } from "../../../lib/safety-block.js"
import { NoAudioToSeparateError, NotSeparableMediaError, toSeparableAudio } from "../separable-audio.js"

let media: MediaServer
const at = (path: string) => `http://cdn.test:${media.port}${path}`

/** One file rendered by the local ffmpeg from lavfi: a still picture, or a short video with no sound. */
function render(name: string, args: readonly string[]): Buffer {
  const dir = mkdtempSync(join(tmpdir(), "separable-probe-"))
  try {
    const out = join(dir, name)
    execFileSync("ffmpeg", ["-v", "error", "-y", ...args, out])
    return readFileSync(out)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const still = ["-f", "lavfi", "-i", "color=c=red:s=16x16:d=1", "-frames:v", "1"]

beforeAll(async () => {
  media = await startMediaServer()
  // Served under names that say nothing, and as octet-stream: the bytes decide.
  media.route("/a-png", { file: render("a.png", still) })
  media.route("/a-jpeg", { file: render("a.jpg", still) })
  media.route("/a.png", { file: render("b.png", still), type: "image/png" })
  media.route("/a-gif", { file: renderClip("gif", 1) })
  media.route("/song.mp3", { file: renderClip("audio", 1), type: "audio/mpeg" })
  // A very short MP3 under a picture's name: its few frames score below the name, so ffmpeg picks image2
  // from the NAME (measured: 0.1 s and shorter) — which is no verdict on the bytes.
  media.route("/song.png", { file: renderClip("audio", 0.05), type: "image/png" })
  media.route("/song.jpg", { file: renderClip("audio", 0.05), type: "image/jpeg" })
  media.route("/silent.mp4", { file: render("silent.mp4", ["-f", "lavfi", "-i", "testsrc=d=1:s=64x48:r=10", "-pix_fmt", "yuv420p"]), type: "video/mp4" })
  media.route("/list.m3u8", { type: "application/vnd.apple.mpegurl", text: `#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\n${at("/song.mp3")}\n#EXT-X-ENDLIST\n` })
})

afterAll(async () => {
  await media.close()
})

beforeEach(() => {
  // cdn.test resolves to the local media server, which the guard treats as a public host.
  vi.spyOn(probeNetwork, "lookup").mockResolvedValue([{ address: "127.0.0.1", family: 4 }])
  vi.spyOn(probeNetwork, "isRefusedAddress").mockImplementation((ip) => ip !== "127.0.0.1" && isPrivateOrReservedIP(ip))
})

afterEach(() => vi.restoreAllMocks())

describe("a picture link sent to a separation is refused as a picture, by the real probe", () => {
  it.each([
    ["a PNG with no extension", "/a-png"],
    ["a JPEG with no extension", "/a-jpeg"],
    ["a PNG by its name", "/a.png"],
    ["a GIF", "/a-gif"],
  ])("%s: NotSeparableMediaError on the first attempt, with the not-retryable hint", async (_label, path) => {
    const err = await toSeparableAudio(at(path), "job-e2e").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NotSeparableMediaError)
    expect(inputUnusableHintOf(err)).toEqual({ kind: "input-unusable", reason: "image" })
  }, 30_000)
})

describe("the controls: only a picture is refused", () => {
  it("an MP3 is sent exactly as it came", async () => {
    expect(await toSeparableAudio(at("/song.mp3"), "job-e2e")).toBe(at("/song.mp3"))
  }, 30_000)

  it.each([["/song.png"], ["/song.jpg"]])("an MP3 named %s is not refused as a picture: the link is left as it came (fail open)", async (path) => {
    // The guard refuses it by its name (image2), so the control proves the name is not taken for a picture.
    const refusal = await probeMediaStreams(at(path)).then(() => undefined, (e: unknown) => e)
    expect(refusal).toMatchObject({ reason: "container", demuxer: "image2" })
    expect(await toSeparableAudio(at(path), "job-e2e")).toBe(at(path))
  }, 30_000)

  it("a video without sound is refused as a silent video (not as a picture)", async () => {
    const err = await toSeparableAudio(at("/silent.mp4"), "job-e2e").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NoAudioToSeparateError)
    expect(inputUnusableHintOf(err)).toEqual({ kind: "input-unusable", reason: "no-sound" })
  }, 30_000)

  it("a playlist the guard refuses is no picture: the link is left as it came (fail open)", async () => {
    expect(await toSeparableAudio(at("/list.m3u8"), "job-e2e")).toBe(at("/list.m3u8"))
  }, 30_000)

  it("a link that answers 404 is left as it came (fail open)", async () => {
    expect(await toSeparableAudio(at("/missing.mp3"), "job-e2e")).toBe(at("/missing.mp3"))
  }, 30_000)
})
