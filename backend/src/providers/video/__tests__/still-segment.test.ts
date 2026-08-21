/**
 * Unit tests for the still-segment builder (`../still-segment.ts`) — the
 * shared per-image segment math used by still-to-video (and, later, the
 * slideshow node, which reuses the same builder verbatim).
 *
 * Everything under test is a pure function: geometry, frame math, the
 * intensity→rate mapping, and filter-graph construction per motion value.
 * The real-ffmpeg end-to-end lives in `still-to-video.e2e.test.ts`.
 */
import { describe, it, expect } from "vitest"
import {
  STILL_MOTIONS,
  STILL_RESOLUTIONS,
  STILL_ASPECT_RATIOS,
  computeTargetDimensions,
  computeFrameCount,
  intensityToZoomRate,
  computeUpscaleFactor,
  buildStillFilterGraph,
  buildStillToVideoArgs,
  buildSilentSegmentArgs,
} from "../still-segment.js"

describe("computeTargetDimensions", () => {
  // Short-edge convention (matches the repo's 1080-class ASPECT_RATIO_DIMENSIONS):
  // the resolution names the SHORT side; the long side follows the aspect.
  const expected: Record<string, Record<string, { width: number; height: number }>> = {
    "720p": {
      "16:9": { width: 1280, height: 720 },
      "9:16": { width: 720, height: 1280 },
      "1:1": { width: 720, height: 720 },
      "4:3": { width: 960, height: 720 },
    },
    "1080p": {
      "16:9": { width: 1920, height: 1080 },
      "9:16": { width: 1080, height: 1920 },
      "1:1": { width: 1080, height: 1080 },
      "4:3": { width: 1440, height: 1080 },
    },
    "4K": {
      "16:9": { width: 3840, height: 2160 },
      "9:16": { width: 2160, height: 3840 },
      "1:1": { width: 2160, height: 2160 },
      "4:3": { width: 2880, height: 2160 },
    },
  }

  for (const resolution of STILL_RESOLUTIONS) {
    for (const aspect of STILL_ASPECT_RATIOS) {
      it(`${resolution} ${aspect} → ${expected[resolution]![aspect]!.width}x${expected[resolution]![aspect]!.height}`, () => {
        const dims = computeTargetDimensions(resolution, aspect)
        expect(dims).toEqual(expected[resolution]![aspect])
        // yuv420p requires even dimensions on both axes.
        expect(dims.width % 2).toBe(0)
        expect(dims.height % 2).toBe(0)
      })
    }
  }
})

describe("computeFrameCount", () => {
  it("is ceil(duration * fps) — zoompan's d is in frames, not seconds", () => {
    // The design's worked example: 24.6s at 30fps → 738 frames.
    expect(computeFrameCount(24.6, 30)).toBe(738)
    expect(computeFrameCount(1.0, 24)).toBe(24)
    expect(computeFrameCount(1.0, 30)).toBe(30)
    // Partial trailing frame rounds UP so -shortest trims to the audio,
    // never the other way around.
    expect(computeFrameCount(2.001, 30)).toBe(61)
  })

  it("rejects non-positive / non-finite durations (ffprobe failures surface, not zero-length renders)", () => {
    expect(() => computeFrameCount(0, 30)).toThrow()
    expect(() => computeFrameCount(-1, 30)).toThrow()
    expect(() => computeFrameCount(Number.NaN, 30)).toThrow()
    expect(() => computeFrameCount(Number.POSITIVE_INFINITY, 30)).toThrow()
  })
})

describe("intensityToZoomRate", () => {
  it("maps the 1–10 scale linearly onto zoom+0.0002 … zoom+0.0015 per frame", () => {
    expect(intensityToZoomRate(1)).toBeCloseTo(0.0002, 10)
    expect(intensityToZoomRate(10)).toBeCloseTo(0.0015, 10)
    // The design panel's worked example: intensity 3 ≈ zoom+0.0005/frame.
    expect(intensityToZoomRate(3)).toBeCloseTo(0.0004889, 6)
  })

  it("is monotonic and clamps out-of-range input to the 1–10 scale", () => {
    for (let i = 1; i < 10; i++) {
      expect(intensityToZoomRate(i + 1)).toBeGreaterThan(intensityToZoomRate(i))
    }
    expect(intensityToZoomRate(0)).toBeCloseTo(intensityToZoomRate(1), 10)
    expect(intensityToZoomRate(99)).toBeCloseTo(intensityToZoomRate(10), 10)
  })
})

describe("computeUpscaleFactor", () => {
  it("adapts the pre-zoompan upscale so the intermediate never exceeds ~12k on its long edge", () => {
    // A fixed 8x at 4K would be a ~30720x17280 intermediate — an OOM, not an
    // effect. The factor shrinks as the target grows; jitter headroom shrinks
    // with it but stays ≥2.
    expect(computeUpscaleFactor(1280, 720)).toBe(8)
    expect(computeUpscaleFactor(1920, 1080)).toBe(6)
    expect(computeUpscaleFactor(3840, 2160)).toBe(3)
    expect(computeUpscaleFactor(2160, 3840)).toBe(3) // portrait 4K — long edge governs
    expect(computeUpscaleFactor(8000, 4500)).toBe(2) // floor clamps at 2
  })
})

describe("buildStillFilterGraph — motion: none (cheap path, no zoompan)", () => {
  const base = {
    intensity: 3,
    width: 1920,
    height: 1080,
    fps: 30,
    frames: 738,
    sourceWidth: 800,
    sourceHeight: 600,
  } as const

  it("cover → scale to fill + center crop, exactly as specced", () => {
    const graph = buildStillFilterGraph({ ...base, motion: "none", fit: "cover", padColor: "#000000" })
    expect(graph).toBe("scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080")
  })

  it("contain → scale to fit + centered pad with the pad color", () => {
    const graph = buildStillFilterGraph({ ...base, motion: "none", fit: "contain", padColor: "#112233" })
    expect(graph).toBe(
      "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x112233",
    )
    expect(graph).not.toContain("zoompan")
  })
})

describe("buildStillFilterGraph — motion paths (zoompan)", () => {
  const base = {
    intensity: 3,
    width: 1920,
    height: 1080,
    fps: 30,
    frames: 738,
    fit: "cover",
    padColor: "#000000",
    sourceWidth: 800,
    sourceHeight: 600,
  } as const

  it("crops the SOURCE to the target aspect first, then lanczos-upscales to k×target (bounded memory, no integer-step jitter)", () => {
    const graph = buildStillFilterGraph({ ...base, motion: "zoom-in" })
    // Source 800x600 cropped to 16:9 at source resolution: 800x450.
    expect(graph).toContain("crop=800:450")
    // k=6 for a 1080p target → upscale stage is exactly 11520x6480.
    expect(graph).toContain("scale=11520:6480:flags=lanczos")
    // zoompan carries the frame count (d is FRAMES, not seconds), the target
    // size, and the output fps.
    expect(graph).toContain("d=738")
    expect(graph).toContain("s=1920x1080")
    expect(graph).toContain("fps=30")
  })

  it("zoom-in: per-frame rate from intensity, clamped at 1.5, centered window", () => {
    const graph = buildStillFilterGraph({ ...base, motion: "zoom-in" })
    expect(graph).toContain("z='min(zoom+0.0004889,1.5)'")
    expect(graph).toContain("x='iw/2-(iw/zoom/2)'")
    expect(graph).toContain("y='ih/2-(ih/zoom/2)'")
  })

  it("zoom-in intensity endpoints: 1 → +0.0002/f, 10 → +0.0015/f", () => {
    expect(buildStillFilterGraph({ ...base, motion: "zoom-in", intensity: 1 })).toContain("zoom+0.0002000")
    expect(buildStillFilterGraph({ ...base, motion: "zoom-in", intensity: 10 })).toContain("zoom+0.0015000")
  })

  it("zoom-out: starts at 1.5 on the first frame and decays toward 1", () => {
    const graph = buildStillFilterGraph({ ...base, motion: "zoom-out" })
    expect(graph).toContain("z='if(eq(on,1),1.5,max(zoom-0.0004889,1))'")
  })

  it("pan-left / pan-right: fixed zoom margin, the rate drives x instead of z", () => {
    const right = buildStillFilterGraph({ ...base, motion: "pan-right" })
    expect(right).toContain("z='1.25'")
    expect(right).toContain("x='min(iw-iw/zoom,on*0.0004889*iw)'")
    expect(right).toContain("y='ih/2-(ih/zoom/2)'")

    const left = buildStillFilterGraph({ ...base, motion: "pan-left" })
    expect(left).toContain("z='1.25'")
    expect(left).toContain("x='max(0,iw-iw/zoom-on*0.0004889*iw)'")
  })

  it("ken-burns: zoom + simultaneous drift across the growing margin", () => {
    const graph = buildStillFilterGraph({ ...base, motion: "ken-burns" })
    expect(graph).toContain("z='min(zoom+0.0004889,1.5)'")
    // Drift expressions are normalized by the total frame count.
    expect(graph).toContain("/738")
    expect(graph).toContain("x='(iw-iw/zoom)*(0.5+0.3*on/738)'")
    expect(graph).toContain("y='(ih-ih/zoom)*(0.5-0.2*on/738)'")
  })

  it("contain + motion: the still moves, the pad bars do NOT — zoompan runs on the contained box, pad comes after", () => {
    const graph = buildStillFilterGraph({ ...base, motion: "ken-burns", fit: "contain", padColor: "#0a0b0c" })
    // 800x600 (4:3) contained in 1920x1080 → 1440x1080 box; zoompan renders
    // the box, then a static pad centers it on the target canvas.
    expect(graph).toContain("s=1440x1080")
    const padIdx = graph.indexOf("pad=1920:1080")
    const zoomIdx = graph.indexOf("zoompan")
    expect(padIdx).toBeGreaterThan(zoomIdx)
    expect(graph).toContain("color=0x0a0b0c")
  })

  it("SECURITY: sanitizes a filtergraph-injection padColor to black (workflow-run path is not route-Zod-guarded)", () => {
    // A crafted padColor reaching the builder via MCP write / import / template
    // (no route Zod) must NOT inject a filter. Any non-#RRGGBB value → 0x000000.
    const evil = buildStillFilterGraph({ ...base, motion: "none", fit: "contain", padColor: "black,drawtext=textfile=/etc/passwd" })
    expect(evil).toContain("color=0x000000")
    expect(evil).not.toContain("drawtext")
    expect(evil).not.toContain("/etc/passwd")
    // Same guard on the motion+contain pad site.
    const evilMotion = buildStillFilterGraph({ ...base, motion: "ken-burns", fit: "contain", padColor: "red,movie=/etc/hosts[x]" })
    expect(evilMotion).toContain("color=0x000000")
    expect(evilMotion).not.toContain("movie=")
    // A valid hex is still honored, case-insensitively.
    expect(buildStillFilterGraph({ ...base, motion: "none", fit: "contain", padColor: "#AbCdEf" })).toContain("color=0xAbCdEf")
  })

  it("never emits spaces inside filter expressions (ffmpeg arg-parsing safety)", () => {
    for (const motion of STILL_MOTIONS) {
      const graph = buildStillFilterGraph({ ...base, motion })
      expect(graph).not.toContain(" ")
    }
  })
})

describe("buildStillToVideoArgs", () => {
  const base = {
    imagePath: "/w/input-image.png",
    audioPath: "/w/input-audio.mp3",
    outputPath: "/w/output.mp4",
    motion: "none",
    intensity: 3,
    width: 1920,
    height: 1080,
    fps: 30,
    frames: 738,
    fit: "cover",
    padColor: "#000000",
    sourceWidth: 800,
    sourceHeight: 600,
  } as const

  it("motion none: -loop 1 still + audio, stillimage tune, crf 20, aac 192k, yuv420p, -shortest", () => {
    const args = buildStillToVideoArgs({ ...base })
    const joined = args.join(" ")
    expect(joined).toContain("-loop 1 -i /w/input-image.png")
    expect(joined).toContain("-i /w/input-audio.mp3")
    expect(joined).toContain("-c:v libx264 -tune stillimage -preset veryfast -crf 20")
    expect(joined).toContain("-c:a aac -b:a 192k")
    expect(joined).toContain("-pix_fmt yuv420p")
    expect(joined).toContain("-r 30")
    expect(joined).toContain("-shortest")
    expect(args[args.length - 1]).toBe("/w/output.mp4")
  })

  it("motion paths: single input frame (no -loop) — zoompan's d generates every output frame", () => {
    const args = buildStillToVideoArgs({ ...base, motion: "ken-burns" })
    expect(args).not.toContain("-loop")
    const joined = args.join(" ")
    expect(joined).toContain("zoompan")
    expect(joined).toContain("-shortest")
  })
})

describe("buildSilentSegmentArgs (slideshow segments)", () => {
  const base = {
    imagePath: "/w/image-000.png",
    outputPath: "/w/segment-000.mp4",
    motion: "none",
    intensity: 3,
    width: 1280,
    height: 720,
    fps: 30,
    frames: 180,
    fit: "cover",
    padColor: "#000000",
    sourceWidth: 800,
    sourceHeight: 600,
  } as const

  it("emits EXACTLY the planned frame count, no audio stream, normalized SAR", () => {
    const args = buildSilentSegmentArgs({ ...base })
    const joined = args.join(" ")
    expect(joined).toContain("-frames:v 180")
    expect(args).toContain("-an")
    expect(joined).toContain("setsar=1")
    expect(joined).toContain("-loop 1") // still input for motion none
    expect(args[args.length - 1]).toBe("/w/segment-000.mp4")
  })

  it("motion paths drop -loop (zoompan's d emits the frames) and keep the SAR normalize", () => {
    const args = buildSilentSegmentArgs({ ...base, motion: "zoom-out" })
    expect(args).not.toContain("-loop")
    const joined = args.join(" ")
    expect(joined).toContain("zoompan")
    expect(joined).toContain("setsar=1")
    expect(args).toContain("-an")
  })
})
