/**
 * PARITY with the measured detector — real ffmpeg, real onnxruntime-node, the
 * pinned model.
 *
 * The fixture `rt4k-540p2-gop.mp4` is 26 frames (one GOP, stream-copied, so
 * every frame decodes bit-identically: framemd5-checked) of the 540p 2 fps
 * proxy the P3.0b holdout (2026-10-06) scored: a 4K wide of four seated people,
 * the core podcast shot. `rt4k-540p2-gop.ort-dets.json` is what the holdout's
 * onnxruntime-node run returned on those frames (linux/x64, ffmpeg n8.1.2).
 * Those runs are the detector the v1 bar was measured on, so this file is the
 * proof that the shipped code IS that detector: same counts, boxes within
 * 1e-4 of the frame.
 *
 * Footage: "Round Table - 10 Years On - The stars of 2014-15 reminisce on
 * HISTORIC promotion season", AFCB TV, Wikimedia Commons, CC BY 3.0
 * (fixtures/README.md).
 *
 * The strict tolerance holds where the measurement ran: linux/x64 with the
 * pinned ffmpeg n8.1.2 (what CI installs and production ships). The detector
 * is sensitive to the decoded PIXELS: ffmpeg's yuv→bgr conversion moved by
 * about one level between majors, and one level of noise alone moves a score
 * by ~0.01 and a box by ~5e-4 of the frame (measured on this fixture). So
 * elsewhere (a dev machine's newer ffmpeg, Apple silicon's binary) only the
 * operating point is checked — the same faces at 0.7, boxes within 2e-3 — and
 * no parity claim is made.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { monitorEventLoopDelay, performance } from "node:perf_hooks"
import { detectFacesInMedia, FACE_DETECT_THUMB } from "../detect-faces.js"
import { readFaceDescriptor } from "../face-descriptor.js"
import { yunetSession, releaseYunetSession } from "../yunet-session.js"
import { YUNET_DETECTOR_ID } from "../yunet-model.js"
import type { ProxySpanMap } from "../../media-proxy-span-map.js"

// Real decodes and real inference: the tiling test alone runs nine windows. A
// slow 2-vCPU runner must read as slow, never as a parity failure.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 })

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIP = join(HERE, "fixtures", "rt4k-540p2-gop.mp4")
const REF = JSON.parse(readFileSync(join(HERE, "fixtures", "rt4k-540p2-gop.ort-dets.json"), "utf8")) as {
  width: number
  height: number
  frames: Array<Array<{ box: [number, number, number, number]; score: number }>>
}

const FFMPEG_VERSION = execFileSync("ffmpeg", ["-version"], { encoding: "utf8" }).split("\n")[0] ?? ""
/** The measured platform: linux/x64 and the pinned ffmpeg. */
const PINNED = process.platform === "linux" && process.arch === "x64" && /^ffmpeg version n8\.1\.2\b/.test(FFMPEG_VERSION)
/** Box tolerance, fraction of the frame. The reference is rounded to 5 decimals. */
const BOX_TOL = PINNED ? 1e-4 : 2e-3
/** Score tolerance. The reference is rounded to 4 decimals. */
const SCORE_TOL = PINNED ? 1e-3 : 5e-2
/** Score floors compared. 0.4 sits 0.0047 from the nearest reference score, so
 *  only exact pixels can promise the same faces there. */
const FLOORS = PINNED ? [0.7, 0.4] : [0.7]

const FPS = 2
const FRAMES = REF.frames.length // 26
/** The clip shows the rt4k window from source time 1,569 s (frame 18 of a window cut at 1,560 s). */
const SOURCE_START_MS = 1_569_000
const ONE_ROW: ProxySpanMap = [
  { proxyStartMs: 0, proxyEndMs: (FRAMES * 1000) / FPS, sourceStartMs: SOURCE_START_MS, firstFrame: 0, frameCount: FRAMES },
]

/** The reference at `minScore`, as top-left boxes. */
function reference(minScore: number) {
  return REF.frames.map((frame) =>
    frame
      .filter((d) => d.score >= minScore)
      .map(({ box: [cx, cy, w, h], score }) => ({ x: cx - w / 2, y: cy - h / 2, w, h, score })),
  )
}

beforeAll(async () => {
  await yunetSession() // warm: one session per process
})
afterAll(async () => {
  await releaseYunetSession()
})

describe("YuNet through onnxruntime-node reproduces the measured detections", () => {
  it("the comparison names its platform", () => {
    // Recorded in the test output, so a CI log says which bound was asserted.
    expect(typeof FFMPEG_VERSION).toBe("string")
    console.info(`[face-detect parity] ${process.platform}/${process.arch}, ${FFMPEG_VERSION}: ${PINNED ? "strict" : "operating point only"}`)
  })

  for (const minScore of FLOORS) {
    it(`at score >= ${minScore}: the same faces on every frame, boxes within ${BOX_TOL} of the frame`, async () => {
      const result = await detectFacesInMedia(CLIP, { fps: FPS, spanMap: ONE_ROW, fromFrame: 0, toFrame: FRAMES, minScore })
      const want = reference(minScore)
      expect(result.frame).toEqual({ w: REF.width, h: REF.height })
      expect(result.frames).toHaveLength(FRAMES)
      expect(result.dropped).toBe(0)
      let worstBox = 0
      let worstScore = 0
      result.frames.forEach((got, i) => {
        expect(got.frame).toBe(i)
        expect(got.boxes.length, `frame ${i} face count`).toBe(want[i]!.length)
        // Pair each measured face with the nearest detected one (by centre):
        // two near-equal scores may swap order under a hair of numeric noise.
        for (const r of want[i]!) {
          const centre = (b: { x: number; y: number; w: number; h: number }) => [b.x + b.w / 2, b.y + b.h / 2] as const
          const [rx, ry] = centre(r)
          const b = [...got.boxes].sort((p, q) => Math.hypot(centre(p)[0] - rx, centre(p)[1] - ry) - Math.hypot(centre(q)[0] - rx, centre(q)[1] - ry))[0]!
          worstBox = Math.max(worstBox, Math.abs(b.x - r.x), Math.abs(b.y - r.y), Math.abs(b.w - r.w), Math.abs(b.h - r.h))
          worstScore = Math.max(worstScore, Math.abs(b.score - r.score))
          expect(b.landmarks).toHaveLength(5)
        }
      })
      expect(result.boxCount).toBe(want.flat().length)
      console.info(`[face-detect parity] >= ${minScore}: worst box delta ${worstBox.toExponential(2)}, worst score delta ${worstScore.toExponential(2)}`)
      expect(worstBox).toBeLessThanOrEqual(BOX_TOL)
      expect(worstScore).toBeLessThanOrEqual(SCORE_TOL)
    })
  }

  it("every box comes back on the SOURCE clock through the span map", async () => {
    const result = await detectFacesInMedia(CLIP, { fps: FPS, spanMap: ONE_ROW, fromFrame: 0, toFrame: FRAMES, minScore: 0.7 })
    expect(result.frames.map((f) => f.sourceMs)).toEqual(Array.from({ length: FRAMES }, (_, k) => SOURCE_START_MS + k * 500))
    expect(result.detector.id).toBe(YUNET_DETECTOR_ID)
  })

  it("the landmarks sit inside their face's box (they are the face's eyes, nose and mouth corners)", async () => {
    const result = await detectFacesInMedia(CLIP, { fps: FPS, spanMap: ONE_ROW, fromFrame: 0, toFrame: FRAMES, minScore: 0.7 })
    for (const b of result.frames.flatMap((f) => f.boxes)) {
      for (const [lx, ly] of b.landmarks) {
        expect(lx).toBeGreaterThanOrEqual(b.x - 0.01)
        expect(lx).toBeLessThanOrEqual(b.x + b.w + 0.01)
        expect(ly).toBeGreaterThanOrEqual(b.y - 0.01)
        expect(ly).toBeLessThanOrEqual(b.y + b.h + 0.01)
      }
    }
  })
})

describe("windows tile the proxy", () => {
  it("every frame is detected exactly once, and identically, however the range is split (a mid-GOP seek included)", async () => {
    const whole = await detectFacesInMedia(CLIP, { fps: FPS, spanMap: ONE_ROW, fromFrame: 0, toFrame: FRAMES, minScore: 0.7 })
    for (const cut of [1, 11, 13, 25]) {
      const a = await detectFacesInMedia(CLIP, { fps: FPS, spanMap: ONE_ROW, fromFrame: 0, toFrame: cut, minScore: 0.7 })
      const b = await detectFacesInMedia(CLIP, { fps: FPS, spanMap: ONE_ROW, fromFrame: cut, toFrame: FRAMES, minScore: 0.7 })
      expect([...a.frames, ...b.frames], `split at ${cut}`).toEqual(whole.frames)
    }
  })
})

describe("the span map is the only clock", () => {
  it("frames in no row are dropped and counted; the rest map through their own row", async () => {
    // Two spans of the source laid end to end, with frames 10–11 claimed by
    // neither (a map the encoder would never write, but the member must not
    // guess a time for them).
    const map: ProxySpanMap = [
      { proxyStartMs: 0, proxyEndMs: 5000, sourceStartMs: 60_000, firstFrame: 0, frameCount: 10 },
      { proxyStartMs: 6000, proxyEndMs: 13_000, sourceStartMs: 600_000, firstFrame: 12, frameCount: 14 },
    ]
    const result = await detectFacesInMedia(CLIP, { fps: FPS, spanMap: map, fromFrame: 8, toFrame: 14, minScore: 0.7 })
    expect(result.dropped).toBe(2)
    expect(result.frames.map((f) => [f.frame, f.sourceMs])).toEqual([
      [8, 64_000],
      [9, 64_500],
      [12, 600_000],
      [13, 600_500],
    ])
  })
})

describe("the setup thumbnail", () => {
  it("is a tiny RGB frame per sample, only when asked for", async () => {
    const without = await detectFacesInMedia(CLIP, { fps: FPS, spanMap: ONE_ROW, fromFrame: 0, toFrame: 2, minScore: 0.7 })
    expect(without.frames.every((f) => f.thumb === undefined)).toBe(true)
    const withThumb = await detectFacesInMedia(CLIP, { fps: FPS, spanMap: ONE_ROW, fromFrame: 0, toFrame: 2, minScore: 0.7, thumb: true })
    for (const f of withThumb.frames) {
      expect(Buffer.from(f.thumb!, "base64")).toHaveLength(FACE_DETECT_THUMB.w * FACE_DETECT_THUMB.h * 3)
    }
  })
})

describe("the job-only face descriptor on real frames (P3.2b round 3)", () => {
  const all = Array.from({ length: FRAMES }, (_, k) => k)

  it("asking for descriptors changes no box: the same faces, the same numbers", async () => {
    const plain = await detectFacesInMedia(CLIP, { fps: FPS, spanMap: ONE_ROW, fromFrame: 0, toFrame: FRAMES, minScore: 0.7 })
    const described = await detectFacesInMedia(CLIP, { fps: FPS, spanMap: ONE_ROW, fromFrame: 0, toFrame: FRAMES, minScore: 0.7, descriptorFrames: all })
    const strip = (r: typeof described) => r.frames.map((f) => f.boxes.map(({ descriptor: _d, ...b }) => b))
    expect(strip(described)).toEqual(strip(plain))
    expect(described.frames.every((f) => f.boxes.every((b) => b.descriptor?.version === 1))).toBe(true)
  })

  it("is the same however the window is split", async () => {
    const whole = await detectFacesInMedia(CLIP, { fps: FPS, spanMap: ONE_ROW, fromFrame: 0, toFrame: FRAMES, minScore: 0.7, descriptorFrames: all })
    const a = await detectFacesInMedia(CLIP, { fps: FPS, spanMap: ONE_ROW, fromFrame: 0, toFrame: 13, minScore: 0.7, descriptorFrames: all.slice(0, 13) })
    const b = await detectFacesInMedia(CLIP, { fps: FPS, spanMap: ONE_ROW, fromFrame: 13, toFrame: FRAMES, minScore: 0.7, descriptorFrames: all.slice(13) })
    expect([...a.frames, ...b.frames]).toEqual(whole.frames)
  })

  it("tells the four seated people apart: each face's best luma match a second later is the same seat", async () => {
    const r = await detectFacesInMedia(CLIP, { fps: FPS, spanMap: ONE_ROW, fromFrame: 0, toFrame: FRAMES, minScore: 0.7, descriptorFrames: all })
    const cos = (p: Int8Array, q: Int8Array) => {
      let d = 0, np = 0, nq = 0
      for (let i = 0; i < p.length; i++) { d += p[i]! * q[i]!; np += p[i]! ** 2; nq += q[i]! ** 2 }
      return np && nq ? d / Math.sqrt(np * nq) : 0
    }
    let pairs = 0
    let agree = 0
    for (let k = 0; k + 2 < r.frames.length; k++) {
      const now = r.frames[k]!.boxes, later = r.frames[k + 2]!.boxes
      for (const f of now) {
        const lf = readFaceDescriptor(f.descriptor!).luma
        const byLook = [...later].sort((p, q) => cos(lf, readFaceDescriptor(q.descriptor!).luma) - cos(lf, readFaceDescriptor(p.descriptor!).luma))[0]
        const byPlace = [...later].sort((p, q) => Math.abs(p.x - f.x) - Math.abs(q.x - f.x))[0]
        if (!byLook || !byPlace) continue
        pairs++
        if (byLook === byPlace) agree++
      }
    }
    console.info(`[face-detect descriptor] best luma match = same seat in ${agree} of ${pairs} pairs`)
    expect(pairs).toBeGreaterThan(40)
    expect(agree / pairs).toBeGreaterThan(0.9)
  })
})

describe("the event loop while a window runs", () => {
  it("no single stall comes near a job's heartbeat, though the loop is busy for most of the window", async () => {
    const h = monitorEventLoopDelay({ resolution: 10 })
    h.enable()
    const elu0 = performance.eventLoopUtilization()
    await detectFacesInMedia(CLIP, { fps: FPS, spanMap: ONE_ROW, fromFrame: 0, toFrame: FRAMES, minScore: 0.7, thumb: true })
    const elu = performance.eventLoopUtilization(elu0)
    h.disable()
    console.info(
      `[face-detect loop] utilization ${elu.utilization.toFixed(3)} (${Math.round(elu.active)} of ${Math.round(elu.idle + elu.active)} ms), worst stall ${(h.max / 1e6).toFixed(1)} ms`,
    )
    // Inference runs ON this thread: onnxruntime-node's run() is a synchronous
    // native call after a setImmediate, and one intra-op thread computes on the
    // caller. Per frame the loop blocks for the inference (~10–16 ms at 540p)
    // plus ~2 ms of pre-processing, then yields to the decode's next chunk. So
    // each stall is one frame's work — a loop that never yielded would stall
    // for the whole window (26 frames × 10+ ms) — ...
    expect(h.max / 1e6).toBeLessThan(250)
    // ... but the loop is busy for most of the window (0.87 measured on Apple
    // silicon). This pins the thread story the budget and the session document:
    // if utilization ever drops near the decode-only share, inference has moved
    // off the loop (a `worker_threads` session, the P3.3 fallback) and those
    // comments are stale.
    expect(elu.utilization).toBeGreaterThan(0.4)
  })
})
