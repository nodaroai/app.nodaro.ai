/**
 * Render-appearance regression for the v1 Scene3D clay look (PR #1328:
 * deterministic shadows + ACES tone mapping at exposure 1.15).
 *
 * PR #1328 shipped the look with no pixel test and said so. This is that test.
 * It renders through the REAL path — `packages/remotion/src/Root3DScene.tsx`
 * bundled exactly the way `backend/src/workers/render-worker.ts` bundles it
 * (`bundle({entryPoint})`, no `webpackOverride`), then `openBrowser` /
 * `selectComposition` / `renderStill` with the render worker's own `{gl}`
 * option — so what it looks at is what a customer's render produces.
 *
 * ## What it asserts, and why it is layered
 *
 * 1. **Reference match, portable.** Frame 0 and frame 12 of a small fixed v1
 *    plan must match committed reference PNGs through a 16x9 block signature
 *    (mean-pooled RGB). This is the gate that runs on every machine.
 * 2. **Reference match, strict.** The same two frames must also match
 *    per-channel — but ONLY when this machine reproduces the provenance the
 *    references were recorded under (platform, arch, GL backend, browser build,
 *    Remotion version). See "the strict gate" below.
 * 3. **Three coarse properties that hold on any GPU path** — the ones a
 *    tolerance can never be tuned away:
 *      (a) the floor inside the box's cast shadow is measurably darker than the
 *          same floor with the shadow map off, and the UNSHADOWED floor is not,
 *          so the darkening is the shadow and not a global exposure change;
 *      (b) the box's hottest lit face is not clipped — no channel pegged —
 *          where the pre-#1328 reference pegs every pixel of the same patch;
 *      (c) the frame differs from the pre-#1328 flat look (no shadow map,
 *          `NoToneMapping`) by far more than the reference tolerance.
 *
 * ## Why not a byte snapshot
 *
 * The software path (`swangle` — ANGLE over SwiftShader, what a Linux
 * container and the render worker use) and macOS (`angle` over Metal) do not
 * agree pixel for pixel. Measured on this fixture: a full backend swap moves
 * individual pixels by up to 78 while the block signature moves by at most
 * 3.28, against a clay-vs-flat signal of 153 / 132.64. The full table is in
 * `render-appearance-harness.ts`. So the portable gate is the signature and the
 * per-channel gate is provenance-gated.
 *
 * ## The strict gate
 *
 * The committed references were recorded on macOS arm64. The render worker runs
 * Linux x86-64, so on CI the strict per-channel comparison DISARMS itself with a
 * logged reason and only the portable gate applies. To arm it for CI, re-record
 * inside the render worker's own Linux image (below) and commit the result: a
 * Linux-recorded manifest makes the strict comparison run on every Linux
 * machine, which is exactly the `process.platform === "linux"` gate this was
 * asked for, expressed as the property that makes the gate correct rather than
 * as the platform name.
 *
 * ## Re-recording the references
 *
 *     cd packages/remotion
 *     SCENE3D_APPEARANCE_RECORD=1 npx vitest run src/scene3d/__tests__/render-appearance.test.ts
 *
 * That rewrites all four PNGs and `manifest.json` from the CURRENT code and
 * then runs every assertion below against what it just wrote (so a recording
 * run still proves the coarse properties; the two reference-match assertions
 * are trivially satisfied on that run and only bite afterwards). Commit the
 * PNGs and the manifest together — the manifest is what a later run reads to
 * decide whether the strict gate applies, and it carries the deltas the
 * thresholds here were derived from.
 *
 * Re-record when, and only when:
 *   - `fixtures/appearance-plan.ts` changed (the manifest pins its
 *     `revisionId`, so a plan edit fails loudly instead of silently drifting);
 *   - the clay look changed ON PURPOSE — in which case look at the new PNGs
 *     before committing them, because that is the review;
 *   - you are arming the strict gate on Linux.
 *
 * Arming it DURABLY on CI needs one more thing than a Linux recording: the
 * browser build is part of the provenance, and the `Remotion Tests` job renders
 * with `ubuntu-latest`'s system Chrome, which auto-updates. A Linux recording
 * alone therefore arms the gate until the next runner-image bump and then
 * disarms it again. Whoever arms it must also pin what CI renders with — either
 * `CHROME_PATH` to a fixed build in `ci.yml`, or preferring `ensureBrowser()`
 * (pinned by the Remotion version, at the cost of a download per run) over
 * system Chrome when `CI` is set — and record with that same browser. That
 * trade is left open here on purpose rather than decided by a test.
 *
 * The three historical variants are produced by
 * `fixtures/appearance-recorder-root.tsx`, a test-only Remotion root that
 * overrides `shadowMap.enabled` / `toneMapping` at the renderer. Only a
 * recording run bundles it; the assertions always bundle the real root. The
 * recording run also asserts that root renders "clay" byte-for-byte identically
 * to the real one, so the historical variants cannot silently become pictures
 * of a different scene.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { VERSION as REMOTION_VERSION } from "remotion/version"
import { scene3DPlanSchema } from "@nodaro/shared"
import { APPEARANCE_FRAMES, APPEARANCE_PLAN, FRAME0_PATCHES } from "./fixtures/appearance-plan"
import {
  APPEARANCE_GL,
  currentProvenance,
  frameKey,
  patchStats,
  pixelDelta,
  provenanceMismatch,
  readPng,
  renderAppearanceFrames,
  resolveBrowser,
  signatureDelta,
  type BrowserChoice,
  type Delta,
  type PngImage,
  type ReferenceManifest,
  type RenderedFrames,
} from "./render-appearance-harness"

/**
 * Vitest 4's default reporter swallows `console.*` from a worker entirely —
 * measured: a `console.warn` at module scope, in `beforeAll` and inside a test
 * body all printed nothing, while a direct `process.stderr.write` printed. A
 * skip whose reason nobody can read is a test nobody wrote, so every reason
 * this file reports goes out this way.
 */
function note(message: string): void {
  process.stderr.write(`[scene3d appearance] ${message}\n`)
}

const REFERENCE_DIR = fileURLToPath(new URL("./fixtures/appearance-references/", import.meta.url))
const LIVE_ENTRY = fileURLToPath(new URL("../../Root3DScene.tsx", import.meta.url))
const RECORDER_ENTRY = fileURLToPath(new URL("./fixtures/appearance-recorder-root.tsx", import.meta.url))
const MANIFEST_FILE = `${REFERENCE_DIR}manifest.json`

const RECORD = process.env.SCENE3D_APPEARANCE_RECORD === "1"

/** A cold webpack bundle of three.js plus a browser launch is minutes, not seconds. */
const RENDER_TIMEOUT_MS = 300_000

/**
 * Thresholds, each with the measurement it came from and the margin it keeps.
 *
 * Reference match uses BOTH a max and a mean because they fail differently: a
 * one-pixel geometry shift at a high-contrast edge moves ONE block's mean by
 * ~11 while barely touching the frame mean, so a max-only gate would be
 * jumpy and a mean-only gate would miss a localised change.
 *
 *   noise (full GL backend swap): max 3.28, mean 0.24
 *   signal (clay vs pre-#1328):   max 132.64, mean 12.42
 *
 * 24 / 2.0 sits ~7x above the noise and ~5x below the weakest signal.
 */
const SIGNATURE_TOLERANCE_MAX = 24
const SIGNATURE_TOLERANCE_MEAN = 2.0

/**
 * On a provenance match the render is reproducible — the recording run measured
 * exactly 0 between two different bundles of the same scene. These are not a
 * tolerance for a real difference, only a refusal to make the suite hostage to
 * a single stray texel.
 */
const STRICT_TOLERANCE_MAX = 4
const STRICT_TOLERANCE_MEAN = 0.05

/** Clay must differ from the pre-#1328 flat look by far more than a match would. */
const FLAT_DISTINCTION_MAX = 40
const FLAT_DISTINCTION_MEAN = 4

/** The mid frame must be a genuinely different picture (measured max 230.00). */
const FRAME_MOTION_MAX = 40

/** Shadows must change the frame at all (measured max 151.00). */
const SHADOW_CONTRIBUTION_MAX = 40

const [FRAME_FIRST, FRAME_MID] = APPEARANCE_FRAMES

interface ReferenceSet {
  readonly manifest: ReferenceManifest
  readonly clay: Record<number, PngImage>
  readonly noShadows: PngImage
  readonly flat: PngImage
}

function referenceFile(name: string): string {
  return `${REFERENCE_DIR}${name}`
}

function clayFileName(frame: number): string {
  return `clay-frame-${String(frame).padStart(3, "0")}.png`
}

function loadReferences(): ReferenceSet {
  const manifest = JSON.parse(readFileSync(MANIFEST_FILE, "utf8")) as ReferenceManifest
  const clay: Record<number, PngImage> = {}
  for (const frame of APPEARANCE_FRAMES) clay[frame] = readPng(referenceFile(clayFileName(frame)))
  return {
    manifest,
    clay,
    noShadows: readPng(referenceFile("no-shadows-frame-000.png")),
    flat: readPng(referenceFile("flat-frame-000.png")),
  }
}

/**
 * Render the historical variants and rewrite the whole reference set.
 *
 * The clay references come from the REAL root; only `no-shadows` and `flat`
 * come from the recorder. The recorder's own clay render is used for one thing:
 * proving it is not drawing a different scene.
 */
async function recordReferences(browser: BrowserChoice, live: RenderedFrames): Promise<void> {
  const plan = APPEARANCE_PLAN as unknown as Record<string, unknown>
  const recorded = await renderAppearanceFrames({
    entryPoint: RECORDER_ENTRY,
    browser,
    jobs: [
      { key: "clay", inputProps: { plan, appearance: "clay" }, frames: [FRAME_FIRST] },
      { key: "no-shadows", inputProps: { plan, appearance: "no-shadows" }, frames: [FRAME_FIRST] },
      { key: "flat", inputProps: { plan, appearance: "flat" }, frames: [FRAME_FIRST] },
    ],
  })
  try {
    const recorderClay = recorded.frames.get(frameKey("clay", FRAME_FIRST))!
    const liveClay = live.get(frameKey("clay", FRAME_FIRST))!
    const drift = pixelDelta(liveClay.image, recorderClay.image)
    if (drift.max !== 0) {
      throw new Error(
        `the recorder root no longer renders "clay" identically to Root3DScene ` +
          `(max per-channel ${drift.max}); the historical references it produces would be ` +
          `pictures of a different scene`,
      )
    }
    const noShadows = recorded.frames.get(frameKey("no-shadows", FRAME_FIRST))!
    const flat = recorded.frames.get(frameKey("flat", FRAME_FIRST))!

    mkdirSync(REFERENCE_DIR, { recursive: true })
    for (const frame of APPEARANCE_FRAMES) {
      writeFileSync(referenceFile(clayFileName(frame)), live.get(frameKey("clay", frame))!.bytes)
    }
    writeFileSync(referenceFile("no-shadows-frame-000.png"), noShadows.bytes)
    writeFileSync(referenceFile("flat-frame-000.png"), flat.bytes)

    const measured: Record<string, Delta> = {
      "recorder-clay-vs-live-clay": drift,
      "frame0-vs-frame-mid": signatureDelta(liveClay.image, live.get(frameKey("clay", FRAME_MID))!.image),
      "clay-vs-flat": signatureDelta(liveClay.image, flat.image),
      "clay-vs-no-shadows": signatureDelta(liveClay.image, noShadows.image),
    }
    const manifest: ReferenceManifest = {
      ...currentProvenance(browser, REMOTION_VERSION),
      recordedAt: new Date().toISOString().slice(0, 10),
      planRevisionId: APPEARANCE_PLAN.revisionId,
      width: APPEARANCE_PLAN.width,
      height: APPEARANCE_PLAN.height,
      measured,
    }
    writeFileSync(MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`)
    // The only output of a recording run, and how the operator sees the numbers
    // the thresholds above are supposed to sit between.
    note(`recorded references\n${JSON.stringify(manifest, null, 2)}`)
  } finally {
    recorded.cleanup()
  }
}

const browser = await resolveBrowser()
const unavailable = "unavailable" in browser ? browser.unavailable : null
if (unavailable) note(`SKIPPED, no render coverage this run — ${unavailable}`)

describe("Scene3D appearance fixture", () => {
  it("is a plan the shared contract accepts", () => {
    // The plan schema is `.strict()`. PR #1328 records a measurement harness
    // that silently drew a STATIC scene because it used a field the v1 shape
    // does not have; one parse is what stops that class of mistake here.
    const parsed = scene3DPlanSchema.safeParse(APPEARANCE_PLAN)
    const issues = parsed.success
      ? ""
      : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
    expect(issues).toBe("")
  })
})

describe.skipIf(unavailable !== null)("Scene3D v1 clay render appearance", () => {
  let rendered: RenderedFrames
  let cleanup = (): void => {}
  let references: ReferenceSet
  let strictSkipReason: string | null = null

  beforeAll(async () => {
    const choice = browser as BrowserChoice
    const live = await renderAppearanceFrames({
      entryPoint: LIVE_ENTRY,
      browser: choice,
      jobs: [
        {
          key: "clay",
          inputProps: { plan: APPEARANCE_PLAN as unknown as Record<string, unknown> },
          frames: APPEARANCE_FRAMES,
        },
      ],
    })
    rendered = live.frames
    cleanup = live.cleanup
    if (RECORD) await recordReferences(choice, rendered)
    references = loadReferences()
    strictSkipReason = provenanceMismatch(references.manifest, currentProvenance(choice, REMOTION_VERSION))
    if (strictSkipReason) {
      note(
        `strict per-channel comparison disarmed — ${strictSkipReason}. ` +
          `The portable block-signature gate still applies.`,
      )
    }
  }, RENDER_TIMEOUT_MS)

  afterAll(() => cleanup())

  it("draws the plan the references are pictures of", () => {
    expect(references.manifest.planRevisionId).toBe(APPEARANCE_PLAN.revisionId)
    expect(references.manifest.gl).toBe(APPEARANCE_GL)
    for (const frame of APPEARANCE_FRAMES) {
      const image = rendered.get(frameKey("clay", frame))!.image
      expect([image.width, image.height]).toEqual([APPEARANCE_PLAN.width, APPEARANCE_PLAN.height])
      expect([references.clay[frame]!.width, references.clay[frame]!.height]).toEqual([
        APPEARANCE_PLAN.width,
        APPEARANCE_PLAN.height,
      ])
    }
  })

  it("matches the committed references through the portable block signature", () => {
    for (const frame of APPEARANCE_FRAMES) {
      const delta = signatureDelta(rendered.get(frameKey("clay", frame))!.image, references.clay[frame]!)
      expect(
        delta.max,
        `frame ${frame} block signature drifted (${JSON.stringify(delta)})`,
      ).toBeLessThanOrEqual(SIGNATURE_TOLERANCE_MAX)
      expect(delta.mean).toBeLessThanOrEqual(SIGNATURE_TOLERANCE_MEAN)
    }
  })

  it("matches the committed references per channel on a matching provenance", (ctx) => {
    // A real skip, not an early `return`: returning would report this gate as
    // PASSING on every machine that cannot run it, which is how a permanently
    // disarmed gate goes unnoticed. `ctx.skip` puts it in the skipped count.
    if (strictSkipReason) ctx.skip(`provenance mismatch — ${strictSkipReason}`)
    for (const frame of APPEARANCE_FRAMES) {
      const delta = pixelDelta(rendered.get(frameKey("clay", frame))!.image, references.clay[frame]!)
      expect(delta.max, `frame ${frame} per-channel drift (${JSON.stringify(delta)})`).toBeLessThanOrEqual(
        STRICT_TOLERANCE_MAX,
      )
      expect(delta.mean).toBeLessThanOrEqual(STRICT_TOLERANCE_MEAN)
    }
  })

  it("renders a genuinely different picture at the mid frame", () => {
    // Guards the fixture, not the look: a mid frame equal to frame 0 would mean
    // the sampler never ran and every assertion below would be about one frame.
    const delta = signatureDelta(
      rendered.get(frameKey("clay", FRAME_FIRST))!.image,
      rendered.get(frameKey("clay", FRAME_MID))!.image,
    )
    expect(delta.max).toBeGreaterThanOrEqual(FRAME_MOTION_MAX)
  })

  it("(a) casts a shadow: the occluded floor is far darker, the lit floor is not", () => {
    const frame = rendered.get(frameKey("clay", FRAME_FIRST))!.image
    const shadowed = patchStats(frame, FRAME0_PATCHES.SHADOW_PATCH)
    const lit = patchStats(frame, FRAME0_PATCHES.LIT_PATCH)
    const refShadowRegion = patchStats(references.noShadows, FRAME0_PATCHES.SHADOW_PATCH)
    const refLitRegion = patchStats(references.noShadows, FRAME0_PATCHES.LIT_PATCH)

    // The same floor rectangle, with the shadow map off, is unshadowed floor.
    expect(shadowed.luma).toBeLessThanOrEqual(refShadowRegion.luma * 0.5)
    // ...and the darkening is LOCAL. If the whole frame had merely got darker,
    // this would move too and the shadow assertion would prove nothing.
    expect(Math.abs(lit.luma - refLitRegion.luma)).toBeLessThanOrEqual(12)
    // Both of those hold within the shipped frame alone, with no reference:
    // two mirrored floor patches on the same scanlines, one occluded.
    expect(shadowed.luma).toBeLessThanOrEqual(lit.luma * 0.5)
    // And shadows change the frame as a whole, not just the chosen rectangle.
    expect(signatureDelta(frame, references.noShadows).max).toBeGreaterThanOrEqual(
      SHADOW_CONTRIBUTION_MAX,
    )
  })

  it("(b) rolls the hot highlight off instead of clipping it", () => {
    const frame = rendered.get(frameKey("clay", FRAME_FIRST))!.image
    const highlight = patchStats(frame, FRAME0_PATCHES.HIGHLIGHT_PATCH)
    const flatHighlight = patchStats(references.flat, FRAME0_PATCHES.HIGHLIGHT_PATCH)

    // The assertion has teeth: the pre-#1328 look pegs a channel on EVERY pixel
    // of this patch. Without this line, a patch that lands on the background
    // would satisfy everything below.
    expect(flatHighlight.saturatedFraction).toBeGreaterThanOrEqual(0.9)
    expect(flatHighlight.maxChannel).toBe(255)

    expect(highlight.maxChannel).toBeLessThanOrEqual(250)
    expect(highlight.saturatedFraction).toBeLessThanOrEqual(0.02)
    expect(highlight.whiteFraction).toBe(0)
    // Still a lit highlight, not a crushed one: the roll-off must not have
    // bought its headroom by darkening the surface into the midtones.
    expect(highlight.luma).toBeGreaterThanOrEqual(150)
    expect(highlight.luma).toBeLessThanOrEqual(245)
  })

  it("(c) is not the flat pre-#1328 look", () => {
    const frame = rendered.get(frameKey("clay", FRAME_FIRST))!.image
    const delta = signatureDelta(frame, references.flat)
    expect(delta.max, `clay is too close to the flat look (${JSON.stringify(delta)})`).toBeGreaterThanOrEqual(
      FLAT_DISTINCTION_MAX,
    )
    expect(delta.mean).toBeGreaterThanOrEqual(FLAT_DISTINCTION_MEAN)
    // The distinction has to be bigger than a reference match is allowed to be,
    // or "matches the reference" and "is not the old look" could both be true
    // of the same frame.
    expect(FLAT_DISTINCTION_MAX).toBeGreaterThan(SIGNATURE_TOLERANCE_MAX)
    expect(FLAT_DISTINCTION_MEAN).toBeGreaterThan(SIGNATURE_TOLERANCE_MEAN)
  })
})
