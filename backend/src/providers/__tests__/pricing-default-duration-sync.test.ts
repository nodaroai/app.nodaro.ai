import { describe, it, expect } from "vitest"
import {
  DURATION_PRICED_PROVIDERS,
  MODEL_CATALOG,
  buildVideoCreditModelIdentifier,
  isGeminiOmniProvider,
  pricedOutputDurationSec,
  snapToNearestDuration,
} from "@nodaro/shared"
import { resolveVideoRequestNorm } from "../../lib/video-request-norm.js"
import { generatedVideoLengthSec } from "../../lib/generated-video-length.js"
import { KIE_VIDEO_MODELS, KIE_TEXT_TO_VIDEO_MODELS } from "../kie/models.js"

/**
 * The invariant behind the catalog's `defaultDuration`: a request that names a
 * provider but omits `duration` is CHARGED for the length the model renders by
 * default, and one that names a length the model does not offer is charged for
 * the nearest length it does — because `commit_credits` can only refund, so the
 * tier a request is priced at must be the tier it renders at.
 */
const LTX = ["ltx-2.3-pro", "ltx-2.3-fast"]
const lengthPriced = (id: string): boolean =>
  DURATION_PRICED_PROVIDERS.has(id) || isGeminiOmniProvider(id) || LTX.includes(id)
const videoEntries = Object.values(MODEL_CATALOG).filter((e) => e.kind === "video")
const kieConfigs = (id: string) =>
  [KIE_VIDEO_MODELS[id], KIE_TEXT_TO_VIDEO_MODELS[id]].filter((c): c is NonNullable<typeof c> => !!c)

describe("an omitted duration is charged at the length the model renders", () => {
  it("every video model priced by length declares its default render length, and offers it", () => {
    const offenders = videoEntries
      .filter((e) => lengthPriced(e.id))
      .filter((e) => typeof e.defaultDuration !== "number" || !e.durations?.includes(e.defaultDuration))
      .map((e) => e.id)
    expect(offenders, "declare `defaultDuration` (a member of `durations`) on the catalog entry").toEqual([])
  })

  it("a KIE-pinned `extraParams.duration` equals the catalog default", () => {
    for (const e of videoEntries) {
      for (const cfg of kieConfigs(e.id)) {
        const pin = cfg.extraParams?.duration
        if (pin === undefined) continue
        expect(e.defaultDuration, `${e.id}: kie/models.ts pins ${pin}s`).toBe(Number(pin))
      }
    }
  })

  it("the KIE config offers exactly the lengths the catalog does, so the runner's snap is the funnel's snap", () => {
    for (const e of videoEntries.filter((x) => lengthPriced(x.id))) {
      for (const cfg of kieConfigs(e.id)) {
        if (!cfg.allowedDurations) continue
        expect(cfg.allowedDurations, e.id).toEqual(e.durations)
      }
    }
  })

  it("an unset duration prices the same composite as the default sent explicitly (both modes)", () => {
    const offenders: string[] = []
    for (const e of videoEntries.filter((x) => lengthPriced(x.id))) {
      for (const nodeType of ["image-to-video", "text-to-video"] as const) {
        const omitted = buildVideoCreditModelIdentifier(e.id, undefined, undefined, nodeType)
        const explicit = buildVideoCreditModelIdentifier(e.id, e.defaultDuration, undefined, nodeType)
        if (omitted !== explicit) offenders.push(`${e.id} (${nodeType}): omitted → ${omitted}, ${e.defaultDuration}s → ${explicit}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("the length a request is priced at is the length the runner snaps it to, for every length 1-30s", () => {
    const offenders: string[] = []
    for (const e of videoEntries.filter((x) => lengthPriced(x.id))) {
      for (const cfg of kieConfigs(e.id)) {
        if (!cfg.allowedDurations) continue
        for (let d = 1; d <= 30; d++) {
          const rendered = snapToNearestDuration(d, cfg.allowedDurations)
          const priced = pricedOutputDurationSec(e.id, d)
          if (priced !== rendered) offenders.push(`${e.id}: ${d}s renders ${rendered}s, priced ${priced}s`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("the request norm carries the charged length to the wire for a length-priced model, so price and render cannot differ", () => {
    for (const e of videoEntries.filter((x) => lengthPriced(x.id))) {
      expect(resolveVideoRequestNorm({ provider: e.id }).duration, e.id).toBe(e.defaultDuration)
    }
  })

  it("the listing never lists a generation below the length its run is charged at (no duration set)", () => {
    for (const e of videoEntries.filter((x) => lengthPriced(x.id) && x.modes.includes("i2v") && x.modes.includes("t2v"))) {
      const listed = generatedVideoLengthSec({ type: "generate-video", data: { provider: e.id } })
      expect(listed, e.id).toBeGreaterThanOrEqual(e.defaultDuration!)
    }
  })
})
