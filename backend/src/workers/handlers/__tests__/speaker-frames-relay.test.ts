/**
 * Speaker Frames from a connected self-host (P3.6, decided 2026-10-09):
 *  - nothing is relayed until nodaro.ai takes a relayed job (its capability);
 *  - the self-host builds the detection proxies over the plugin's own scope and
 *    relays them, with the relayed marker, in place of the originals; every
 *    source it does not sample goes as a placeholder URL nodaro.ai never reads
 *    (round 2, decided 2026-10-09);
 *  - after the run the track file is copied home under the job's own key, its
 *    hash and size re-checked.
 */
import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

vi.mock("../../../lib/post-processing-error.js", async (orig) => orig())

import { validateEdl } from "@nodaro/shared"
import {
  SPEAKER_FRAMES_UNSAMPLED_URL_BASE,
  bringTrackSetHome,
  isSpeakerFramesUnsampledUrl,
  speakerFramesRelayPayload,
  speakerFramesUnsampledUrl,
  type SpeakerFramesRelayDeps,
  type TrackSetHomeDeps,
} from "../speaker-frames-relay.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"
import { isPostProcessingError } from "../../../lib/post-processing-error.js"
import { isOwnedObjectKey } from "../../../lib/job-policy-outputs.js"
import { NODARO_CONNECTION_REJECTED_MESSAGE, NODARO_CONNECTION_REQUIRED_MESSAGE } from "../../../lib/nodaro-connection-messages.js"

const edl = {
  version: 1,
  clock: "master",
  sources: [
    { id: "mic", url: "http://localhost:9000/mic.wav", kind: "audio", role: "master-audio" },
    { id: "camA", url: "http://localhost:9000/cam-a.mp4", kind: "video" },
    { id: "camB", url: "http://localhost:9000/cam-b.mp4", kind: "video", offsetMs: 4_000 },
  ],
  segments: [{ id: "s0", inMs: 0, outMs: 30_000, video: "camA", speaker: "Host" }],
}

const proxyFor = (url: string) => ({
  url: `http://localhost:9000/media-proxies/${url.split("/").pop()}`,
  key: "k",
  kind: "video" as const,
  cached: false,
  fps: 2,
  spanMap: [{ proxyStartMs: 0, proxyEndMs: 32_000, sourceStartMs: 0, firstFrame: 0, frameCount: 64 }],
  frame: { w: 960, h: 540 },
  frameCount: 64,
  cuts: [12_000],
})

const deps = (over: Partial<SpeakerFramesRelayDeps> = {}): SpeakerFramesRelayDeps & { proxyCalls: Array<[string, unknown]> } => {
  const proxyCalls: Array<[string, unknown]> = []
  return {
    proxyCalls,
    relaySupport: async () => ({ relay: true, source: "nodaro.ai" }),
    ensureProxy: async (url, opts) => {
      proxyCalls.push([url, opts])
      return proxyFor(url)
    },
    toCloud: async (url) => url.replace("http://localhost:9000/", "https://cloud.example/"),
    probeSize: async () => undefined,
    ...over,
  }
}

describe("speakerFramesRelayPayload", () => {
  it("refuses once, before any proxy is built, while nodaro.ai does not take a relayed job", async () => {
    const d = deps({ relaySupport: async () => ({ relay: false, source: "nodaro.ai" }) })
    const err = await speakerFramesRelayPayload({ edl }, d).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toContain("not available on a connected install yet")
    expect(d.proxyCalls).toEqual([])
  })

  // A workflow run reaches here without the route's connection gate.
  it("an unconnected install is told to connect — once, before any proxy is built", async () => {
    const d = deps({ relaySupport: async () => ({ relay: false, source: "not-connected" }) })
    const err = await speakerFramesRelayPayload({ edl }, d).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe(NODARO_CONNECTION_REQUIRED_MESSAGE)
    expect(d.proxyCalls).toEqual([])
  })

  it("a rejected connection (401/403) says so — once, not as an outage, before any proxy is built", async () => {
    const d = deps({ relaySupport: async () => ({ relay: false, source: "nodaro.ai-rejected" }) })
    const err = await speakerFramesRelayPayload({ edl }, d).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe(NODARO_CONNECTION_REJECTED_MESSAGE)
    expect((err as Error).message).not.toContain("Couldn't reach")
    expect(d.proxyCalls).toEqual([])
  })

  // nodaro.ai's span-row schema is strict too: a row carries exactly its five
  // fields, whatever else the proxy's manifest holds.
  it("relays each span row with exactly the fields nodaro.ai's schema names", async () => {
    const d = deps({
      ensureProxy: async (url) => {
        const p = proxyFor(url)
        return { ...p, spanMap: p.spanMap.map((r) => ({ ...r, note: "manifest-only" })) }
      },
    })
    const out = await speakerFramesRelayPayload({ edl, excludeSourceIds: [] }, d)
    for (const p of out.proxies as Array<{ spanMap: Array<Record<string, unknown>> }>) {
      expect(p.spanMap).toEqual(proxyFor("x").spanMap)
    }
  })

  // Round 2 (decided 2026-10-09): every source it does NOT sample (the master
  // audio, an unticked camera, a non-video source) goes with a placeholder URL
  // nodaro.ai never reads — the edit stays whole, nothing of it is sized,
  // fetched or uploaded. Only the detection proxies travel.
  it("sends every unsampled source as the placeholder — never sized, never uploaded — and keeps the edit whole", async () => {
    const withStill = { ...edl, sources: [...edl.sources, { id: "logo", url: "http://localhost:9000/logo.png", kind: "image" }] }
    const probed: string[] = []
    const uploaded: string[] = []
    const d = deps({
      // The proxies are small; whatever an original weighs, it is never asked.
      probeSize: async (url) => {
        probed.push(url)
        return url.includes("/media-proxies/") ? 40_000_000 : 9_000_000_000_000
      },
      toCloud: async (url) => {
        uploaded.push(url)
        return url.replace("http://localhost:9000/", "https://cloud.example/")
      },
    })
    const out = await speakerFramesRelayPayload({ edl: withStill, excludeSourceIds: ["camB"] }, d)
    const sent = out.edl as typeof withStill
    expect(sent.sources.map((s) => [s.id, s.url])).toEqual([
      ["mic", speakerFramesUnsampledUrl("mic")],
      ["camA", "https://cloud.example/media-proxies/cam-a.mp4"],
      ["camB", speakerFramesUnsampledUrl("camB")],
      ["logo", speakerFramesUnsampledUrl("logo")],
    ])
    // Everything else about the edit is as the user made it.
    expect(sent.sources.map(({ url: _u, ...rest }) => rest)).toEqual(withStill.sources.map(({ url: _u, ...rest }) => rest))
    expect(sent.segments).toEqual(withStill.segments)
    // shared's validateEdl (which the plugin runs) reads the placeholder as a URL like any other.
    expect(validateEdl(sent as never).issues).toEqual(validateEdl(withStill as never).issues)
    // No original is sized or uploaded — the proxies only.
    expect(probed).toEqual(["http://localhost:9000/media-proxies/cam-a.mp4"])
    expect(uploaded).toEqual(["http://localhost:9000/media-proxies/cam-a.mp4"])
  })

  it("the placeholder is a reserved, never-resolving https URL the generic re-host passes through", () => {
    const url = speakerFramesUnsampledUrl("cam B/ü")
    const parsed = new URL(url)
    expect(parsed.protocol).toBe("https:")
    // RFC 6761: .invalid never resolves, so nothing can ever be fetched from it.
    expect(parsed.hostname.endsWith(".invalid")).toBe(true)
    expect(url.startsWith(SPEAKER_FRAMES_UNSAMPLED_URL_BASE)).toBe(true)
    expect(isSpeakerFramesUnsampledUrl(url)).toBe(true)
    expect(isSpeakerFramesUnsampledUrl("https://cloud.example/cam-b.mp4")).toBe(false)
    // One source id, one URL: the plugin refuses a pack that names two files for one id.
    expect(speakerFramesUnsampledUrl("cam B/ü")).toBe(url)
    expect(speakerFramesUnsampledUrl("camA")).not.toBe(speakerFramesUnsampledUrl("camB"))
  })

  it("refuses a detection proxy over the re-host cap before uploading any, naming its camera", async () => {
    const uploaded: string[] = []
    const d = deps({
      probeSize: async (url) => (url.endsWith("/media-proxies/cam-b.mp4") ? 812_000_000 : 30_000_000),
      toCloud: async (url) => {
        uploaded.push(url)
        return url
      },
    })
    const err = await speakerFramesRelayPayload({ edl }, d).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toContain('"camB"')
    expect((err as Error).message).toContain("812 MB")
    expect((err as Error).message).not.toContain('"camA"')
    expect(uploaded).toEqual([])
  })

  it("fails retryably when nodaro.ai can't be asked", async () => {
    const err = await speakerFramesRelayPayload({ edl }, deps({ relaySupport: async () => ({ relay: false, source: "nodaro.ai-unreachable" }) })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(isDeterministicJobError(err)).toBe(false)
  })

  it("builds one 2 fps / 540p proxy per sampled source over the plugin's own spans, and relays them with the marker", async () => {
    const d = deps()
    const out = await speakerFramesRelayPayload({ jobId: "j", edl, transcript: { version: 1, words: [] }, excludeSourceIds: [] }, d)
    expect(d.proxyCalls).toEqual([
      ["http://localhost:9000/cam-a.mp4", { fps: 2, height: 540, spans: [{ startMs: 0, endMs: 32_000 }] }],
      // camB is 4 s behind the master: [0, 26 s] on its own clock, padded.
      ["http://localhost:9000/cam-b.mp4", { fps: 2, height: 540, spans: [{ startMs: 0, endMs: 28_000 }] }],
    ])
    expect(out.relayed).toBe(true)
    expect(out.proxies).toEqual([
      { sourceId: "camA", url: "https://cloud.example/media-proxies/cam-a.mp4", fps: 2, height: 540, spanMap: proxyFor("x").spanMap, cuts: [12_000] },
      { sourceId: "camB", url: "https://cloud.example/media-proxies/cam-b.mp4", fps: 2, height: 540, spanMap: proxyFor("x").spanMap, cuts: [12_000] },
    ])
    // nodaro.ai's proxy schema is strict (cloud-plugins P3-15 (a)): a field it
    // does not name refuses the whole job as invalid_proxy, so exactly these go.
    for (const p of out.proxies as Array<Record<string, unknown>>) {
      expect(Object.keys(p).sort()).toEqual(["cuts", "fps", "height", "sourceId", "spanMap", "url"])
      for (const row of p.spanMap as Array<Record<string, unknown>>) {
        expect(Object.keys(row).sort()).toEqual(["firstFrame", "frameCount", "proxyEndMs", "proxyStartMs", "sourceStartMs"])
      }
    }
    // No original of a sampled camera is sent: its source names its proxy.
    const sent = out.edl as typeof edl
    expect(sent.sources.map((s) => s.url)).toEqual([
      speakerFramesUnsampledUrl("mic"),
      "https://cloud.example/media-proxies/cam-a.mp4",
      "https://cloud.example/media-proxies/cam-b.mp4",
    ])
    expect(out.transcript).toEqual({ version: 1, words: [] })
  })

  it("keeps a pack a pack, one proxy per source over the union of its clips", async () => {
    const d = deps()
    const clip2 = { ...edl, segments: [{ id: "s1", inMs: 60_000, outMs: 70_000, video: "camA" }] }
    const out = await speakerFramesRelayPayload({ edl: [edl, clip2], excludeSourceIds: ["camB"] }, d)
    expect(d.proxyCalls).toEqual([["http://localhost:9000/cam-a.mp4", { fps: 2, height: 540, spans: [{ startMs: 0, endMs: 32_000 }, { startMs: 58_000, endMs: 72_000 }] }]])
    expect(Array.isArray(out.edl)).toBe(true)
    expect((out.edl as Array<typeof edl>).every((e) => e.sources[1]!.url === "https://cloud.example/media-proxies/cam-a.mp4")).toBe(true)
    // The unticked camera and the mic: one placeholder per id across the pack.
    expect((out.edl as Array<typeof edl>).map((e) => [e.sources[0]!.url, e.sources[2]!.url])).toEqual([
      [speakerFramesUnsampledUrl("mic"), speakerFramesUnsampledUrl("camB")],
      [speakerFramesUnsampledUrl("mic"), speakerFramesUnsampledUrl("camB")],
    ])
  })

  it("relays a bare video as its whole-source proxy", async () => {
    const d = deps()
    const out = await speakerFramesRelayPayload({ videoUrl: "http://localhost:9000/v.mp4" }, d)
    expect(d.proxyCalls).toEqual([["http://localhost:9000/v.mp4", { fps: 2, height: 540 }]])
    expect(out.videoUrl).toBe("https://cloud.example/media-proxies/v.mp4")
    expect((out.proxies as Array<{ sourceId: string }>)[0]!.sourceId).toBe("video")
  })

  it("refuses the scope the plugin would refuse, deterministically", async () => {
    const err = await speakerFramesRelayPayload({ edl, excludeSourceIds: ["nope"] }, deps()).catch((e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
  })
})

describe("bringTrackSetHome", () => {
  const body = Buffer.from(JSON.stringify({ version: 1, sources: [] }))
  const sha = createHash("sha256").update(body).digest("hex")
  const descriptor = { version: 1, sampleFps: 2, detector: { id: "yunet" }, sources: [], url: "https://cloud.example/speaker-tracks/cloud-1.json", sha256: sha, bytes: body.length }

  const homeDeps = (file: Buffer, uploads: Array<[number, string]>): TrackSetHomeDeps => ({
    workDir: () => mkdtemp(join(tmpdir(), "sf-home-")),
    cleanup: (dir) => rm(dir, { recursive: true, force: true }),
    download: async (_url, dest) => writeFile(dest, file),
    upload: async (b, jobId) => {
      uploads.push([b.length, jobId])
      return `https://local.example/speaker-tracks/${jobId}.json`
    },
  })

  it("copies the file under the job's own key and points the descriptor at the copy", async () => {
    const uploads: Array<[number, string]> = []
    const JOB = "00000000-0000-4000-8000-0000000000aa"
    const out = await bringTrackSetHome({ json: descriptor, notes: ["a"] }, JOB, "u", homeDeps(body, uploads))
    expect(uploads).toEqual([[body.length, JOB]])
    expect(out).toEqual({ json: { ...descriptor, url: `https://local.example/speaker-tracks/${JOB}.json` }, notes: ["a"] })
    // In the job's family: it expires and is expunged with the install's own job.
    expect(isOwnedObjectKey(JOB, `speaker-tracks/${JOB}.json`)).toBe(true)
  })

  it("refuses a file whose bytes don't match the descriptor, without a refund (nodaro.ai billed the run)", async () => {
    const uploads: Array<[number, string]> = []
    const err = await bringTrackSetHome({ json: descriptor }, "j", "u", homeDeps(Buffer.from("tampered"), uploads)).catch((e: unknown) => e)
    expect(isPostProcessingError(err)).toBe(true)
    expect((err as Error).message).toContain("does not match its descriptor")
    expect(uploads).toEqual([])
  })

  it("refuses an output with no usable descriptor", async () => {
    const err = await bringTrackSetHome({ json: { url: "" } }, "j", "u", homeDeps(body, [])).catch((e: unknown) => e)
    expect(isPostProcessingError(err)).toBe(true)
  })
})
