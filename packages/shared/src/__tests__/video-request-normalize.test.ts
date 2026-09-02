import { describe, it, expect } from "vitest"
import {
  normalizeVideoRequestParams,
  pricedVideoSelection,
  buildVideoCreditModelIdentifier,
  MODEL_CATALOG,
  VIDEO_GEN_PROVIDERS,
} from "../index.js"

describe("normalizeVideoRequestParams", () => {
  // R6: NEAREST, not allowed[0]. A portrait request must not become landscape.
  it("snaps an off-list ratio to the NEAREST member of the model's list", () => {
    const r = normalizeVideoRequestParams("seedance-2-5", { aspectRatio: "9:21" })
    expect(r.aspectRatio).toBe("9:16")
    expect(r.adjustments).toHaveLength(1)
  })
  it("snaps 4:5 and 5:4 the same way the provider adapter does", () => {
    expect(normalizeVideoRequestParams("seedance-2-5", { aspectRatio: "4:5" }).aspectRatio).toBe("3:4")
    expect(normalizeVideoRequestParams("seedance-2-5", { aspectRatio: "5:4" }).aspectRatio).toBe("4:3")
  })

  it("passes 'Auto' and 'adaptive' through untouched (the provider decides)", () => {
    expect(normalizeVideoRequestParams("seedance-2-5", { aspectRatio: "Auto" }).aspectRatio).toBe("Auto")
    expect(normalizeVideoRequestParams("seedance-2-5", { aspectRatio: "adaptive" }).aspectRatio).toBe("adaptive")
  })

  // R7: nearest band, not the cheapest. A 4k request on a 1080p-max model is
  // 1080p, never 480p.
  it("snaps an off-list resolution to the NEAREST declared band", () => {
    expect(normalizeVideoRequestParams("seedance-2-5", { resolution: "4k" }).resolution).toBe("1080p")
    expect(normalizeVideoRequestParams("seedance-2-5", { resolution: "2k" }).resolution).toBe("1080p")
    expect(normalizeVideoRequestParams("seedance-2-5", { resolution: "360p" }).resolution).toBe("480p")
  })

  // §11.3 log-pull: two t2v rows failed createTask with "resolution is not
  // within the range of allowed options". KIE exposes only 480p/720p/1080p for
  // seedance-2-5 (providers/kie/models.ts:664-680, live probes 2026-08-08 and
  // 08-17) while the route types `resolution` as a bare string. Asserts the
  // exact snapped value, not membership — R7: the nearest band is 1080p, and a
  // `toContain` pin would have hidden a silent downgrade to 480p.
  it("snaps the off-list seedance-2-5 resolutions the t2v route admits, to the NEAREST band", () => {
    for (const bad of ["2k", "4k", "1440p"]) {
      expect(normalizeVideoRequestParams("seedance-2-5", { resolution: bad }).resolution).toBe("1080p")
    }
  })

  // R3: the one place a case variant is canonicalised, upstream of every
  // credit identifier (which key their tables case-sensitively).
  it("canonicalises a case variant to the catalog's own spelling", () => {
    expect(normalizeVideoRequestParams("ltx-2.3-fast", { resolution: "4K" }).resolution).toBe("4k")
    expect(normalizeVideoRequestParams("ltx-2.3-fast", { resolution: "1080P" }).resolution).toBe("1080p")
  })

  it("snaps a resolution onto the model's own list", () => {
    expect(normalizeVideoRequestParams("ltx-2.3-fast", { resolution: "720p" }).resolution).toBe("1080p")
  })

  it("NEVER drops a resolution for a model that declares none — dropping would lower the reserved tier", () => {
    const r = normalizeVideoRequestParams("kling-turbo", { resolution: "1080p" })
    expect(r.resolution).toBe("1080p")
    expect(r.adjustments).toEqual([])
  })

  it("leaves an unknown model completely alone", () => {
    const r = normalizeVideoRequestParams("not-a-model", { aspectRatio: "9:21", resolution: "720p" })
    expect(r).toMatchObject({ aspectRatio: "9:21", resolution: "720p", adjustments: [] })
  })

  it("is idempotent", () => {
    const once = normalizeVideoRequestParams("seedance-2-5", { aspectRatio: "9:21", resolution: "1080p" })
    const twice = normalizeVideoRequestParams("seedance-2-5", once)
    expect(twice.aspectRatio).toBe(once.aspectRatio)
    expect(twice.resolution).toBe(once.resolution)
    expect(twice.adjustments).toEqual([])
  })

  // The normalizer runs in the creditGuard preHandler (BEFORE the route's Zod
  // parse) and in every buildPayload branch (whose `data` is unvalidated
  // persisted workflow JSON, and whose aspectRatio can be FieldMapping-injected
  // at run time). A non-string lever must therefore coerce, never throw: a throw
  // is a 500 where the route used to return a clean Zod 400, and in the DAG it
  // takes the whole run down after sibling nodes have already reserved.
  it("coerces a NUMERIC lever exactly like its string form, instead of throwing", () => {
    expect(normalizeVideoRequestParams("seedance-2-5", { resolution: 1080 as never }).resolution)
      .toBe(normalizeVideoRequestParams("seedance-2-5", { resolution: "1080" }).resolution)
    expect(normalizeVideoRequestParams("seedance-2-5", { aspectRatio: 16 as never }).aspectRatio)
      .toBe(normalizeVideoRequestParams("seedance-2-5", { aspectRatio: "16" }).aspectRatio)
    // "1080" is not "1080p", so it snaps to the nearest band rather than matching.
    expect(normalizeVideoRequestParams("seedance-2-5", { resolution: 1080 as never }).resolution).toBe("1080p")
  })

  it("snaps a non-string lever FAIL-SAFE rather than throwing", () => {
    for (const junk of [{}, [1, 2], true, () => {}]) {
      const r = () => normalizeVideoRequestParams("seedance-2-5", { resolution: junk as never, aspectRatio: junk as never })
      expect(r, `resolution/aspectRatio = ${String(junk)}`).not.toThrow()
      const out = r()
      // Unparseable ⇒ the highest declared band (never the cheapest, R7) and a
      // concrete ratio — always a value the model actually accepts.
      expect(MODEL_CATALOG["seedance-2-5"]!.resolutions).toContain(out.resolution)
      expect(MODEL_CATALOG["seedance-2-5"]!.aspectRatios).toContain(out.aspectRatio)
    }
  })

  it("reads null / blank as ABSENT, and never hands the raw value back", () => {
    // The return type promises `string | undefined` and its callers feed it
    // straight to the credit identifier and the provider wire, so a `null` or
    // `""` must come back as `undefined` (the priced fill then supplies the band
    // the identifier assumes) rather than as the caller's own value.
    for (const blank of [null, "", "   "]) {
      const r = normalizeVideoRequestParams("seedance-2-5", { resolution: blank as never, aspectRatio: blank as never })
      expect(r.resolution, `resolution = ${JSON.stringify(blank)}`).toBeUndefined()
      expect(r.aspectRatio, `aspectRatio = ${JSON.stringify(blank)}`).toBeUndefined()
      expect(r.adjustments).toEqual([])
    }
  })

  it("never returns a non-string lever, even for an unknown model", () => {
    const r = normalizeVideoRequestParams("not-a-model", { resolution: 1080 as never, aspectRatio: 16 as never })
    expect(r.resolution).toBe("1080")
    expect(r.aspectRatio).toBe("16")
  })

  it("leaves an omitted lever omitted — the pricing fill is a separate, deliberate step", () => {
    const r = normalizeVideoRequestParams("ltx-2.3-pro", {})
    expect(r.resolution).toBeUndefined()
    expect(r.aspectRatio).toBeUndefined()
    expect(r.adjustments).toEqual([])
  })
})

describe("pricedVideoSelection", () => {
  // (A) The identifier prices an ABSENT resolution as a concrete band. Where
  // that band is the platform's DECLARED provider default, it must also be the
  // value we send — reserving 1080p and sending no key at all let Replicate
  // pick its own undocumented default.
  it("fills the declared default band for LTX", () => {
    expect(pricedVideoSelection({ provider: "ltx-2.3-pro" }).resolution).toBe("1080p")
    expect(pricedVideoSelection({ provider: "ltx-2.3-fast" }).resolution).toBe("1080p")
  })

  it("fills the declared default band for the providers that declare one", () => {
    expect(pricedVideoSelection({ provider: "seedance-2-5" }).resolution).toBe("720p")
    expect(pricedVideoSelection({ provider: "wan-3" }).resolution).toBe("720p")
    expect(pricedVideoSelection({ provider: "wan-3-prime" }).resolution).toBe("720p")
  })

  it("fills NOTHING for a provider with no declared default — its identifier fallback is a hedge, not a verified provider default", () => {
    // seedance-2 / -fast / -mini pin resolution 720p KIE-side but have no
    // PRICING_DEFAULT_RESOLUTION row, so the identifier prices 480p. Filling
    // 480p on the wire would DOWNGRADE the render to match a known-wrong price.
    expect(pricedVideoSelection({ provider: "seedance-2" }).resolution).toBeUndefined()
    expect(pricedVideoSelection({ provider: "seedance-2-mini" }).resolution).toBeUndefined()
    expect(pricedVideoSelection({ provider: "kling-turbo" }).resolution).toBeUndefined()
    expect(pricedVideoSelection({ provider: "veo3" }).resolution).toBeUndefined()
  })

  it("never overrides an explicit resolution", () => {
    expect(pricedVideoSelection({ provider: "ltx-2.3-pro", resolution: "4k" }).resolution).toBe("4k")
    expect(pricedVideoSelection({ provider: "seedance-2-5", resolution: "480p" }).resolution).toBe("480p")
  })

  // (B) LTX duration: the identifier snaps onto a SEEDED per-band tier, so the
  // wire must carry that tier. 7s prices as 6s — send 6s.
  it("carries the seeded LTX duration tier the identifier priced", () => {
    expect(pricedVideoSelection({ provider: "ltx-2.3-pro", duration: 7 }).duration).toBe(6)
    expect(pricedVideoSelection({ provider: "ltx-2.3-pro", resolution: "4k", duration: 20 }).duration).toBe(10)
    expect(pricedVideoSelection({ provider: "ltx-2.3-fast", duration: 20 }).duration).toBe(20)
    // 20s exists only at 1080p — a 2k request snaps back onto that band's ladder.
    expect(pricedVideoSelection({ provider: "ltx-2.3-fast", resolution: "2k", duration: 20 }).duration).toBe(10)
  })

  it("reports the LTX duration snap as an adjustment, but never the omitted-value fill", () => {
    expect(pricedVideoSelection({ provider: "ltx-2.3-pro", duration: 7 }).adjustments).toHaveLength(1)
    expect(pricedVideoSelection({ provider: "ltx-2.3-pro", duration: 6 }).adjustments).toEqual([])
    expect(pricedVideoSelection({ provider: "ltx-2.3-pro" }).adjustments).toEqual([])
  })

  it("leaves duration alone for every non-LTX provider (legality is not a flat catalog list)", () => {
    expect(pricedVideoSelection({ provider: "seedance-2-5", duration: 7 }).duration).toBeUndefined()
    expect(pricedVideoSelection({ provider: "kling-3.0", duration: 7 }).duration).toBeUndefined()
  })
})

/**
 * The invariant that makes the FILL safe: carrying the priced selection to the
 * wire can never move the reserved tier. (The catalog snap that runs before it
 * legitimately can — an off-list "4K" on a 1080p-max model is priced at the
 * band we will actually render, which is the whole point. This pins the second
 * step only: given the snapped value, filling what the identifier assumed is a
 * disclosure of the price already being charged, never a repricing.)
 */
describe("pricedVideoSelection cannot move the credit identifier", () => {
  const RESOLUTIONS = [undefined, "480p", "720p", "1080p", "2k", "4k", "4K", "720P"]
  const DURATIONS = [undefined, 4, 5, 6, 7, 8, 10, 12, 20, 30]

  it("covers every catalogued video provider", () => {
    expect(VIDEO_GEN_PROVIDERS.length).toBeGreaterThan(20)
  })

  for (const nodeType of ["text-to-video", "image-to-video"] as const) {
    it(`${nodeType}: id(priced) === id(raw) for every provider × resolution × duration`, () => {
      const drift: string[] = []
      for (const provider of VIDEO_GEN_PROVIDERS) {
        for (const rawRes of RESOLUTIONS) {
          for (const rawDur of DURATIONS) {
            for (const hasVideoRef of [false, true]) {
              const norm = normalizeVideoRequestParams(provider, { resolution: rawRes })
              const priced = pricedVideoSelection({ provider, resolution: norm.resolution, duration: rawDur })
              const rawId = buildVideoCreditModelIdentifier(provider, rawDur, undefined, nodeType, undefined, norm.resolution, hasVideoRef)
              const pricedId = buildVideoCreditModelIdentifier(
                provider,
                priced.duration ?? rawDur,
                undefined,
                nodeType,
                undefined,
                norm.resolution ?? priced.resolution,
                hasVideoRef,
              )
              if (rawId !== pricedId) {
                drift.push(`${provider} res=${rawRes} dur=${rawDur} ref=${hasVideoRef}: ${rawId} → ${pricedId}`)
              }
            }
          }
        }
      }
      expect(drift, `the normalize+fill pair moved the reserved tier:\n${drift.join("\n")}`).toEqual([])
    })
  }

  it("only fills a resolution the model's own catalog declares", () => {
    for (const provider of VIDEO_GEN_PROVIDERS) {
      const filled = pricedVideoSelection({ provider }).resolution
      if (filled === undefined) continue
      const declared = MODEL_CATALOG[provider]?.resolutions as readonly string[] | undefined
      expect(declared, `${provider} fills "${filled}" but declares no resolutions`).toBeDefined()
      expect(declared, `${provider} fills "${filled}", which is not in its catalog list`).toContain(filled)
    }
  })
})
