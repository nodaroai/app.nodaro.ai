/**
 * Real output canvases per (video model, resolution, aspect ratio).
 *
 * Every entry is a pixel size read off a finished render with ffprobe — the
 * geometry a model hands back, never a rate or a price. None of it is
 * arithmetic either, because the providers do not follow arithmetic:
 *
 *   - minimax-h3 at 768P returns 768x1344 (0.5714) for a 9:16 request,
 *   - seedance-2 at 480p 16:9 returns 864x496 (1.742) while seedance-2-5
 *     returns 854x480 (1.778) for the same request,
 *   - grok returns 736x400 (1.84), seedance 1.0 at 1080p 1:1 returns 1440x1440.
 *
 * A formula would get all four wrong, which is why `resolveOutputCanvas`
 * answers `undefined` for anything not measured: callers must then leave the
 * frame alone rather than invent geometry (see `computeFrameFitPlan`).
 *
 * HOW TO EXTEND: run `node tools/harvest-output-canvas.mjs` (it pages the admin
 * jobs API, groups completed video jobs by provider/resolution/aspect and probes
 * real outputs) and paste new rows here. Take rows from REFERENCE or
 * TEXT-TO-VIDEO jobs only: in frame mode the adaptive models (the seedance and
 * wan families) size the output from the INPUT image, so those rows describe the
 * input that was sent, not the canvas the model would choose on its own.
 *
 * Seeded 2026-09-16 from 3000 completed production jobs.
 */

/** `[width, height]` in pixels. */
export type VideoOutputCanvas = readonly [number, number]

/** provider → resolution (lower-cased) → aspect token → canvas. */
export const VIDEO_OUTPUT_CANVAS: Readonly<
  Record<string, Readonly<Record<string, Readonly<Record<string, VideoOutputCanvas>>>>>
> = {
  "seedance-2-5": {
    "480p": { "16:9": [854, 480], "9:16": [480, 854] },
    "720p": { "16:9": [1280, 720], "9:16": [720, 1280], "1:1": [960, 960] },
    "1080p": { "16:9": [1920, 1080] },
  },
  // The 2.0 family is NOT the same as 2.5 at 480p — 864x496 vs 854x480.
  "seedance-2": {
    "480p": { "16:9": [864, 496], "9:16": [496, 864] },
    "720p": { "16:9": [1280, 720], "9:16": [720, 1280] },
  },
  "seedance-2-fast": {
    "480p": { "16:9": [864, 496], "9:16": [496, 864] },
    "720p": { "16:9": [1280, 720], "9:16": [720, 1280] },
  },
  "seedance-2-mini": {
    "480p": { "16:9": [864, 496], "9:16": [496, 864] },
    "720p": { "16:9": [1280, 720], "9:16": [720, 1280] },
  },
  "gemini-omni-video": {
    "720p": { "16:9": [1280, 720], "9:16": [720, 1280] },
    "1080p": { "16:9": [1920, 1080] },
  },
  "gemini-omni-flash": {
    "720p": { "16:9": [1280, 720], "9:16": [720, 1280] },
  },
  "veo3.1": {
    "720p": { "9:16": [720, 1280] },
    "1080p": { "16:9": [1920, 1080] },
  },
  "wan-3": {
    "480p": { "16:9": [832, 480] },
    "720p": { "16:9": [1280, 720], "9:16": [720, 1280] },
  },
  "wan-3-prime": {
    "720p": { "16:9": [1280, 720] },
  },
  // 768P's "9:16" is 0.5714, not 0.5625 — the single clearest reason this table
  // exists.
  "minimax-h3": {
    "768p": { "9:16": [768, 1344] },
    "2k": { "16:9": [2560, 1440], "9:16": [1440, 2560] },
  },
}

/**
 * The canvas a model renders for this request, or `undefined` when we have never
 * measured that combination. `undefined` means "leave the frame alone".
 *
 * Resolution matching is case-insensitive (`768P`, `2K`, `720p` all appear in
 * the wild). An aspect of `adaptive` / `Auto` has no canvas of its own — the
 * caller resolves it to a concrete ratio first (`resolveFrameFitAspect`).
 */
export function resolveOutputCanvas(
  provider: string | undefined,
  resolution: string | undefined,
  aspect: string | undefined,
): VideoOutputCanvas | undefined {
  if (!provider || !resolution || !aspect) return undefined
  return VIDEO_OUTPUT_CANVAS[provider]?.[resolution.toLowerCase()]?.[aspect]
}

/** Every measured combination, for tests and for the harvest script's diff. */
export function measuredCanvasCombinations(): Array<{
  provider: string
  resolution: string
  aspect: string
  canvas: VideoOutputCanvas
}> {
  const out: Array<{ provider: string; resolution: string; aspect: string; canvas: VideoOutputCanvas }> = []
  for (const [provider, byResolution] of Object.entries(VIDEO_OUTPUT_CANVAS)) {
    for (const [resolution, byAspect] of Object.entries(byResolution)) {
      for (const [aspect, canvas] of Object.entries(byAspect)) {
        out.push({ provider, resolution, aspect, canvas })
      }
    }
  }
  return out
}
