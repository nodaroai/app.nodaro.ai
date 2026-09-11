/**
 * Test-only harness for the Scene3D render-appearance regression suite.
 *
 * It does two jobs and nothing else:
 *
 *  1. Drive the REAL render path — `@remotion/bundler` over a Remotion root,
 *     then `openBrowser` / `selectComposition` / `renderStill` with the same
 *     `{gl}` chromium option `backend/src/workers/render-worker.ts` passes — so
 *     the pixels under test come from the pipeline that actually ships frames,
 *     not from a jsdom stand-in of it.
 *  2. Compare frames in a way that survives a different GPU path.
 *
 * ## Why the comparison is not a byte snapshot
 *
 * Measured on the committed fixture (macOS arm64, Chrome 320x180, same machine,
 * same frame — the run that recorded `appearance-references/`):
 *
 * | comparison                          | max per-channel | mean per-channel |
 * |-------------------------------------|-----------------|------------------|
 * | swangle vs angle, identical frame   | 78              | 1.92             |
 * | frame 0 vs frame 12, same backend   | 231             | 35.76            |
 * | clay vs pre-#1328 flat, same backend| 153             | 13.84            |
 *
 * A raw-pixel snapshot therefore cannot tell a GPU path apart from a real
 * change: the cross-path noise floor (78) is a third of the signal (231), and
 * HALF the signal that matters most — clay vs the flat look this test exists to
 * detect (153). The SAME three comparisons through a 16x9 block signature —
 * mean-pooled RGB, ~20x20 source pixels per block — separate cleanly:
 *
 * | comparison                          | max block delta | mean block delta |
 * |-------------------------------------|-----------------|------------------|
 * | swangle vs angle, identical frame   | 3.28            | 0.24             |
 * | frame 0 vs frame 12, same backend   | 230.00          | 32.07            |
 * | clay vs pre-#1328 flat, same backend| 132.64          | 12.42            |
 *
 * A factor of 40 between noise and the weakest signal, so the signature is the
 * portable gate and the raw-pixel comparison is kept for the one case where it
 * is meaningful: an environment whose provenance MATCHES the manifest the
 * references were recorded under (see `provenanceMatches`).
 *
 * No dependency does the PNG decoding: `decodePng` below reads the 8-bit,
 * non-interlaced RGB/RGBA PNGs Chromium writes using `node:zlib` alone. A
 * decoder we can read is worth more here than one we would have to add to
 * `package.json` for tests only.
 */
import { inflateSync } from "node:zlib"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export interface PngImage {
  readonly width: number
  readonly height: number
  /** RGBA, 4 bytes per pixel, row-major from the top-left. */
  readonly data: Uint8Array
}

/** `[x, y, width, height]` in pixels, from the top-left. */
export type Rect = readonly [number, number, number, number]

/**
 * Decode the PNG shape Chromium emits: 8 bits per channel, colour type 2 (RGB)
 * or 6 (RGBA), non-interlaced. Anything else throws rather than guessing —
 * a silently mis-decoded reference would make every assertion below meaningless.
 */
export function decodePng(bytes: Uint8Array): PngImage {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG")
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat: Buffer[] = []
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.toString("ascii", offset + 4, offset + 8)
    const data = buf.subarray(offset + 8, offset + 8 + length)
    if (type === "IHDR") {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8] as number
      colorType = data[9] as number
      if (data[12] !== 0) throw new Error("interlaced PNG is not supported")
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data))
    } else if (type === "IEND") {
      break
    }
    offset += 12 + length
  }
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`)
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
  if (channels === 0) throw new Error(`unsupported PNG colour type ${colorType}`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = new Uint8Array(width * height * 4)
  let previous = Buffer.alloc(stride)
  let read = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[read++] as number
    const line = Buffer.from(raw.subarray(read, read + stride))
    read += stride
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? (line[i - channels] as number) : 0
      const up = previous[i] as number
      const upLeft = i >= channels ? (previous[i - channels] as number) : 0
      let value = line[i] as number
      if (filter === 1) value += left
      else if (filter === 2) value += up
      else if (filter === 3) value += (left + up) >> 1
      else if (filter === 4) {
        const estimate = left + up - upLeft
        const dLeft = Math.abs(estimate - left)
        const dUp = Math.abs(estimate - up)
        const dUpLeft = Math.abs(estimate - upLeft)
        value += dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft
      } else if (filter !== 0) {
        throw new Error(`unsupported PNG row filter ${filter}`)
      }
      line[i] = value & 0xff
    }
    for (let x = 0; x < width; x++) {
      const to = (y * width + x) * 4
      const from = x * channels
      out[to] = line[from] as number
      out[to + 1] = line[from + 1] as number
      out[to + 2] = line[from + 2] as number
      out[to + 3] = channels === 4 ? (line[from + 3] as number) : 255
    }
    previous = line
  }
  return { width, height, data: out }
}

export function readPng(file: string): PngImage {
  return decodePng(new Uint8Array(readFileSync(file)))
}

/** Rec. 709 luma, 0-255. */
function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export interface PatchStats {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly luma: number
  /** Largest single channel value anywhere in the patch — the clipping probe. */
  readonly maxChannel: number
  /**
   * Share of pixels with ANY channel pegged at 254 or above.
   *
   * This, not "pure white", is what an untonemapped clay render actually does:
   * a saturated warm surface pegs RED long before the other two channels get
   * anywhere near 255, so the highlight loses its shape while never becoming
   * white. `whiteFraction` is kept alongside to show that it does not fire.
   */
  readonly saturatedFraction: number
  /** Share of pixels with EVERY channel at or above 250. */
  readonly whiteFraction: number
}

export function patchStats(image: PngImage, [x0, y0, w, h]: Rect): PatchStats {
  if (x0 < 0 || y0 < 0 || x0 + w > image.width || y0 + h > image.height) {
    throw new Error(`patch ${[x0, y0, w, h].join(",")} falls outside ${image.width}x${image.height}`)
  }
  let r = 0
  let g = 0
  let b = 0
  let maxChannel = 0
  let saturated = 0
  let white = 0
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const p = (y * image.width + x) * 4
      const pr = image.data[p] as number
      const pg = image.data[p + 1] as number
      const pb = image.data[p + 2] as number
      r += pr
      g += pg
      b += pb
      maxChannel = Math.max(maxChannel, pr, pg, pb)
      if (pr >= 254 || pg >= 254 || pb >= 254) saturated++
      if (pr >= 250 && pg >= 250 && pb >= 250) white++
    }
  }
  const n = w * h
  return {
    r: r / n,
    g: g / n,
    b: b / n,
    luma: luma(r / n, g / n, b / n),
    maxChannel,
    saturatedFraction: saturated / n,
    whiteFraction: white / n,
  }
}

export const SIGNATURE_COLUMNS = 16
export const SIGNATURE_ROWS = 9

/**
 * Mean-pooled RGB over a `SIGNATURE_COLUMNS x SIGNATURE_ROWS` grid.
 *
 * Averaging is what makes this portable: two GL backends disagree on individual
 * texels (edge coverage, shadow-map filtering, shadow acne on a near-parallel
 * floor, rounding in the ACES curve) but agree on how much light lands in a
 * region, which is the property the clay look is actually about.
 */
export function blockSignature(image: PngImage): Float64Array {
  const signature = new Float64Array(SIGNATURE_COLUMNS * SIGNATURE_ROWS * 3)
  for (let row = 0; row < SIGNATURE_ROWS; row++) {
    for (let col = 0; col < SIGNATURE_COLUMNS; col++) {
      const x0 = Math.floor((col * image.width) / SIGNATURE_COLUMNS)
      const x1 = Math.floor(((col + 1) * image.width) / SIGNATURE_COLUMNS)
      const y0 = Math.floor((row * image.height) / SIGNATURE_ROWS)
      const y1 = Math.floor(((row + 1) * image.height) / SIGNATURE_ROWS)
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = (y * image.width + x) * 4
          r += image.data[p] as number
          g += image.data[p + 1] as number
          b += image.data[p + 2] as number
          n++
        }
      }
      const at = (row * SIGNATURE_COLUMNS + col) * 3
      signature[at] = r / n
      signature[at + 1] = g / n
      signature[at + 2] = b / n
    }
  }
  return signature
}

export interface Delta {
  readonly max: number
  readonly mean: number
}

export function signatureDelta(a: PngImage, b: PngImage): Delta {
  const sa = blockSignature(a)
  const sb = blockSignature(b)
  let max = 0
  let sum = 0
  for (let i = 0; i < sa.length; i++) {
    const d = Math.abs((sa[i] as number) - (sb[i] as number))
    if (d > max) max = d
    sum += d
  }
  return { max, mean: sum / sa.length }
}

/** Per-channel comparison, alpha ignored. Only meaningful on a matching provenance. */
export function pixelDelta(a: PngImage, b: PngImage): Delta {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`)
  }
  let max = 0
  let sum = 0
  let n = 0
  for (let i = 0; i < a.data.length; i++) {
    if (i % 4 === 3) continue
    const d = Math.abs((a.data[i] as number) - (b.data[i] as number))
    if (d > max) max = d
    sum += d
    n++
  }
  return { max, mean: sum / n }
}

/**
 * The GL backend to render under.
 *
 * `swangle` (ANGLE over SwiftShader) is the software path `chromiumOptionsFor`
 * in `backend/src/workers/render-worker.ts` selects on Linux — the render
 * worker's own path, and the only one that does not depend on the host's GPU
 * driver. The test forces it on EVERY platform: a reference recorded on one
 * machine's hardware driver would not be reproducible on another's.
 */
export const APPEARANCE_GL = "swangle" as const

export interface BrowserChoice {
  /** Absolute path, or undefined to let Remotion use its own pinned shell. */
  readonly executable: string | undefined
  /** Stable identity recorded in the reference manifest. */
  readonly id: string
}

const SYSTEM_CHROME_PATHS = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/opt/google/chrome/chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
]

function versionOf(executable: string): string {
  try {
    return execFileSync(executable, ["--version"], { encoding: "utf8", timeout: 20_000 }).trim()
  } catch {
    return "unknown"
  }
}

/**
 * Find a Chromium to render with, or explain why there is none.
 *
 * Order: an operator's explicit `CHROME_PATH` (what the render worker itself
 * honours), then a system install. Only on CI do we fall back to downloading
 * Remotion's pinned headless shell — `getDownloadsCacheDir()` puts that
 * download in `<package root>/node_modules/.remotion`, and in a git worktree
 * `node_modules` is a symlink into ANOTHER checkout, so a local download would
 * write into a checkout this process does not own.
 */
export async function resolveBrowser(): Promise<BrowserChoice | { unavailable: string }> {
  const fromEnv = process.env.CHROME_PATH
  if (fromEnv) {
    if (!existsSync(fromEnv)) return { unavailable: `CHROME_PATH points at a missing file: ${fromEnv}` }
    return { executable: fromEnv, id: versionOf(fromEnv) }
  }
  const system = SYSTEM_CHROME_PATHS.find((candidate) => existsSync(candidate))
  if (system) return { executable: system, id: versionOf(system) }
  if (!process.env.CI) {
    return {
      unavailable:
        "no Chromium found (looked at CHROME_PATH and the usual system paths); " +
        "set CHROME_PATH to render locally",
    }
  }
  try {
    const { ensureBrowser } = await import("@remotion/renderer")
    await ensureBrowser()
    const { VERSION } = await import("remotion/version")
    return { executable: undefined, id: `remotion-headless-shell ${VERSION}` }
  } catch (error) {
    return {
      unavailable: `Remotion could not provide a headless shell: ${
        error instanceof Error ? error.message : String(error)
      }`,
    }
  }
}

/**
 * Everything about the machine that recorded the references which could move
 * a pixel. The strict per-channel comparison runs only when the CURRENT
 * environment reproduces all of it; otherwise only the portable block-signature
 * gate applies. Written next to the PNGs by the recorder.
 */
export interface ReferenceProvenance {
  readonly platform: string
  readonly arch: string
  readonly gl: string
  readonly browser: string
  readonly remotion: string
}

export interface ReferenceManifest extends ReferenceProvenance {
  /** ISO date of the recording — informational, never compared. */
  readonly recordedAt: string
  /** The plan the references are pictures of; a plan edit must re-record. */
  readonly planRevisionId: string
  readonly width: number
  readonly height: number
  /** Deltas measured by the recording run, so the thresholds can be re-checked. */
  readonly measured: Record<string, Delta>
}

export function currentProvenance(browser: BrowserChoice, remotionVersion: string): ReferenceProvenance {
  return {
    platform: process.platform,
    arch: process.arch,
    gl: APPEARANCE_GL,
    browser: browser.id,
    remotion: remotionVersion,
  }
}

/**
 * Does this machine reproduce the machine the references were recorded on?
 *
 * This is the generalisation of "only compare pixels strictly on Linux": the
 * render worker's Linux container is the environment whose pixels the strict
 * gate is FOR, but the rule that actually keeps the gate honest is that the
 * reference set and the run agree on platform, arch, GL backend, browser build
 * and Remotion version. A mismatch disarms the strict comparison with a logged
 * reason rather than failing on a difference nobody introduced.
 */
export function provenanceMismatch(
  manifest: ReferenceProvenance,
  current: ReferenceProvenance,
): string | null {
  const keys: (keyof ReferenceProvenance)[] = ["platform", "arch", "gl", "browser", "remotion"]
  const differing = keys.filter((key) => manifest[key] !== current[key])
  if (differing.length === 0) return null
  return differing.map((key) => `${key}: recorded ${manifest[key]!}, running ${current[key]!}`).join("; ")
}

export interface RenderedFrame {
  readonly frame: number
  readonly file: string
  readonly image: PngImage
  readonly bytes: Uint8Array
}

/** One `selectComposition` + N `renderStill` calls against one set of inputProps. */
export interface RenderJob {
  readonly key: string
  readonly inputProps: Record<string, unknown>
  readonly frames: readonly number[]
}

export interface RenderAppearanceOptions {
  readonly entryPoint: string
  readonly jobs: readonly RenderJob[]
  readonly browser: BrowserChoice
}

/** `${job.key}:${frame}` → the rendered still. */
export type RenderedFrames = Map<string, RenderedFrame>

export function frameKey(jobKey: string, frame: number): string {
  return `${jobKey}:${frame}`
}

/**
 * Bundle a Remotion root and render frames of composition `3d-scene` as PNG
 * stills — the same four calls, in the same order, with the same options, that
 * `backend/src/workers/scene3d-render-child.ts` makes for a stills render.
 *
 * One bundle and one browser for every job: a second browser would be a second
 * GL context, which is exactly the variable this suite is trying to hold still.
 */
export async function renderAppearanceFrames(
  options: RenderAppearanceOptions,
): Promise<{ frames: RenderedFrames; cleanup: () => void }> {
  const { bundle } = await import("@remotion/bundler")
  const { openBrowser, selectComposition, renderStill } = await import("@remotion/renderer")

  const workDir = mkdtempSync(join(tmpdir(), "scene3d-appearance-"))
  const chromiumOptions = { gl: APPEARANCE_GL }
  const browserExecutable = options.browser.executable
  const serveUrl = await bundle({ entryPoint: options.entryPoint })
  const instance = await openBrowser("chrome", { browserExecutable, chromiumOptions })
  const frames: RenderedFrames = new Map()
  try {
    for (const job of options.jobs) {
      const composition = await selectComposition({
        serveUrl,
        id: "3d-scene",
        inputProps: job.inputProps,
        puppeteerInstance: instance,
        chromiumOptions,
        browserExecutable,
        timeoutInMilliseconds: 120_000,
      })
      for (const frame of job.frames) {
        const file = join(workDir, `${job.key}-${String(frame).padStart(3, "0")}.png`)
        await renderStill({
          serveUrl,
          composition,
          inputProps: job.inputProps,
          frame,
          imageFormat: "png",
          output: file,
          puppeteerInstance: instance,
          chromiumOptions,
          browserExecutable,
          timeoutInMilliseconds: 120_000,
          logLevel: "warn",
        })
        const bytes = new Uint8Array(readFileSync(file))
        frames.set(frameKey(job.key, frame), { frame, file, image: decodePng(bytes), bytes })
      }
    }
    return { frames, cleanup: () => rmSync(workDir, { recursive: true, force: true }) }
  } catch (error) {
    rmSync(workDir, { recursive: true, force: true })
    throw error
  } finally {
    await instance.close({ silent: true })
  }
}
