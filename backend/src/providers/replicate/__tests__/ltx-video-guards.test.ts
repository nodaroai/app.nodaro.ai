import { describe, it, expect } from "vitest"
import { snapLtxInput, LTX_RESOLUTIONS, LTX_ASPECT_RATIOS } from "../ltx-video.js"
import { applyDefaultVideoSelection, buildVideoCreditModelIdentifier, MODEL_CATALOG } from "@nodaro/shared"

// LTX_RESOLUTIONS / LTX_ASPECT_RATIOS are derived from MODEL_CATALOG["ltx-2.3-pro"]
// (see ltx-video.ts) so they can't drift from the catalog by hand-edit. That
// derivation only reads the "pro" entry, so it alone can't catch the "fast"
// entry drifting away from "pro" — these assertions close that gap directly.
describe("LTX catalog parity — both variants must declare identical levers", () => {
  it("ltx-2.3-fast declares the same resolutions as ltx-2.3-pro", () => {
    expect(MODEL_CATALOG["ltx-2.3-fast"]?.resolutions).toEqual(MODEL_CATALOG["ltx-2.3-pro"]?.resolutions)
  })
  it("ltx-2.3-fast declares the same aspect ratios as ltx-2.3-pro", () => {
    expect(MODEL_CATALOG["ltx-2.3-fast"]?.aspectRatios).toEqual(MODEL_CATALOG["ltx-2.3-pro"]?.aspectRatios)
  })
  it("LTX_RESOLUTIONS / LTX_ASPECT_RATIOS mirror the pro catalog entry exactly (derived, not hand-copied)", () => {
    expect(LTX_RESOLUTIONS).toEqual(MODEL_CATALOG["ltx-2.3-pro"]?.resolutions)
    expect(LTX_ASPECT_RATIOS).toEqual(MODEL_CATALOG["ltx-2.3-pro"]?.aspectRatios)
  })
})

describe("snapLtxInput", () => {
  it("snaps an unknown resolution to 1080p — the band the reservation falls back to", () => {
    expect(snapLtxInput({ resolution: "720p" }).resolution).toBe("1080p")
    expect(snapLtxInput({ resolution: "480p" }).resolution).toBe("1080p")
  })
  it("accepts the three real bands", () => {
    expect(snapLtxInput({ resolution: "1080p" }).resolution).toBe("1080p")
    expect(snapLtxInput({ resolution: "2k" }).resolution).toBe("2k")
    expect(snapLtxInput({ resolution: "4k" }).resolution).toBe("4k")
  })

  // R3 — THE RULE FOR THIS FUNCTION: it must NOT lower-case. The credit
  // identifier indexes LTX_DURATION_TIERS with the resolution STRING
  // (`credit-identifiers.ts:221-229`), case-SENSITIVE with lowercase keys, so
  // it already treats "4K" as an unknown band and reserves 1080p. If this
  // last-mile guard quietly lower-cased, the render would go to 4k against a
  // 1080p reservation — 960-1600 cr rendered for 240-400 cr reserved, the exact
  // 4x under-reserve Task 5 exists to close, re-opened through this door.
  // Agreeing with the identifier (both fall back to 1080p) is the safe answer;
  // the ONE place a case variant is canonicalised is Task 9's
  // `normalizeVideoRequestParams`, which runs BEFORE the identifier and feeds
  // both it and the payload, so a real "4K" request is already "4k" by here.
  it("does NOT lower-case: an un-canonicalised case variant falls back exactly as the credit identifier does", () => {
    expect(snapLtxInput({ resolution: "4K" }).resolution).toBe("1080p")
    expect(snapLtxInput({ resolution: "2K" }).resolution).toBe("1080p")
  })
  it("snaps an off-list aspect ratio to the nearest of 16:9 / 9:16", () => {
    expect(snapLtxInput({ aspectRatio: "4:3" }).aspectRatio).toBe("16:9")
    expect(snapLtxInput({ aspectRatio: "9:21" }).aspectRatio).toBe("9:16")
    expect(snapLtxInput({ aspectRatio: "Auto" }).aspectRatio).toBe("16:9")
  })
  // R23: the earlier draft called this "snaps an unsupported fps to 24" while
  // asserting 50 → 50; 50 IS supported. Two cases, honestly named.
  it("snaps an unsupported fps to 24", () => {
    expect(snapLtxInput({ fps: 30 }).fps).toBe(24)
  })
  it("leaves a supported fps alone", () => {
    expect(snapLtxInput({ fps: 50 }).fps).toBe(50)
  })
  it("leaves an undefined lever undefined (the provider default applies)", () => {
    expect(snapLtxInput({}).resolution).toBeUndefined()
    expect(snapLtxInput({}).aspectRatio).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// CHECK / DEBIT / payload parity.
//
// Neither route (`text-to-video.ts`, `generate-video.ts`) is touched by this
// task — `snapLtxInput` only runs at the Replicate dispatch site
// (`buildCommonInput` / `runLtxRetake`), deep inside the worker. So the value
// that actually reaches Replicate (the "payload" column below) is computed by
// a DIFFERENT function, on a DIFFERENT un-normalized value, than the one the
// credit-guard preHandler ("CHECK") and the post-parse `modelIdentifier` used
// for the job's reservation ("DEBIT") compute. This suite pins that the two
// identifier computations agree with each other AND with the resolution band
// `snapLtxInput` will actually render — for every value in the brief's set,
// crossed with both node types. If `buildVideoCreditModelIdentifier`'s
// case-sensitive 1080p fallback (`credit-identifiers.ts:295-303`) and
// `snapLtxInput`'s fallback ever diverge (e.g. one of them starts
// lower-casing), this is the test that catches it — the exact "reservation
// and render disagree" failure mode Task 5 closed for the DAG lane.
describe("LTX CHECK / DEBIT / payload parity", () => {
  // "undefined" is handled separately below — see that test for why it can't
  // share this three-way assertion.
  const RESOLUTIONS: Array<string | undefined> = ["4k", "1080p", "2k", "garbage"]
  const provider = "ltx-2.3-pro"

  // Mirrors the credit-guard closure at text-to-video.ts:64-79 (CHECK) and
  // the post-parse identifier at text-to-video.ts:282-289 (DEBIT) — both feed
  // buildVideoCreditModelIdentifier with the raw, un-snapped `resolution`.
  const t2vCheck = (resolution: string | undefined) => {
    const sel = applyDefaultVideoSelection({ provider, duration: undefined as number | string | undefined })
    return buildVideoCreditModelIdentifier(sel.provider, sel.duration, undefined, "text-to-video", undefined, resolution, false)
  }
  const t2vDebit = (resolution: string | undefined) => {
    const { provider: p, duration } = applyDefaultVideoSelection({ provider, duration: undefined as number | string | undefined })
    return buildVideoCreditModelIdentifier(p, duration, undefined, "text-to-video", undefined, resolution, false)
  }

  // Mirrors the credit-guard closure at generate-video.ts:464-478 (CHECK) and
  // the post-parse identifier at generate-video.ts:803-811 (DEBIT).
  const i2vCheck = (resolution: string | undefined) => {
    const sel = applyDefaultVideoSelection({ provider, duration: undefined as number | string | undefined })
    return buildVideoCreditModelIdentifier(sel.provider, sel.duration, undefined, "image-to-video", undefined, resolution, false)
  }
  const i2vDebit = (resolution: string | undefined) => {
    const { provider: p, duration } = applyDefaultVideoSelection({ provider, duration: undefined as number | string | undefined })
    return buildVideoCreditModelIdentifier(p, duration, undefined, "image-to-video", undefined, resolution, false)
  }

  // "ltx-2.3-pro:1080p:6s" -> "1080p"
  const bandOf = (identifier: string) => identifier.split(":")[1]

  it.each(RESOLUTIONS)("t2v: CHECK id === DEBIT id === payload resolution for resolution=%s", (resolution) => {
    const checkId = t2vCheck(resolution)
    const debitId = t2vDebit(resolution)
    const payloadResolution = snapLtxInput({ resolution }).resolution

    expect(checkId).toBe(debitId)
    expect(bandOf(checkId)).toBe(payloadResolution)
  })

  it.each(RESOLUTIONS)("i2v: CHECK id === DEBIT id === payload resolution for resolution=%s", (resolution) => {
    const checkId = i2vCheck(resolution)
    const debitId = i2vDebit(resolution)
    const payloadResolution = snapLtxInput({ resolution }).resolution

    expect(checkId).toBe(debitId)
    expect(bandOf(checkId)).toBe(payloadResolution)
  })

  // undefined is a genuine, documented asymmetry, not a bug this task fixes.
  // `buildVideoCreditModelIdentifier`'s LTX branch ALWAYS decides a concrete
  // band — `bands[String(resolution)]` on `String(undefined)` misses, so an
  // omitted resolution still reserves the 1080p tier. `snapLtxInput`, per the
  // brief's own test ("leaves an undefined lever undefined — the provider
  // default applies"), does NOT decide a band for an omitted lever; it leaves
  // the key out entirely so Replicate's own model default renders. CHECK and
  // DEBIT still agree with each other (both reserve 1080p); they just don't
  // agree with the payload's literal value, because the payload intentionally
  // defers to Replicate rather than mirroring the reservation. Task 9's
  // `uiResolutionFill` closes this by feeding a concrete default into the
  // identifier call sites before they ever see `undefined` — out of scope here.
  it("undefined: CHECK id === DEBIT id (both reserve 1080p); payload defers to Replicate's own default", () => {
    expect(t2vCheck(undefined)).toBe(t2vDebit(undefined))
    expect(bandOf(t2vCheck(undefined))).toBe("1080p")
    expect(i2vCheck(undefined)).toBe(i2vDebit(undefined))
    expect(bandOf(i2vCheck(undefined))).toBe("1080p")
    expect(snapLtxInput({ resolution: undefined }).resolution).toBeUndefined()
  })
})
