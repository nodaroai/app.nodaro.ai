import { describe, it, expect } from "vitest"
import {
  MINIMAX_H3_PROVIDERS,
  MODEL_CATALOG,
  VIDEO_GEN_PROVIDERS,
  isGeminiOmniProvider,
  isVeoProvider,
  isWan3Provider,
} from "@nodaro/shared"
import {
  KIE_TEXT_TO_VIDEO_MODELS,
  KIE_VIDEO_MODELS,
  RESOLUTION_CONSUMING_PARAM_ADAPTERS,
  kieModelAcceptsResolution,
} from "../models.js"

describe("kieModelAcceptsResolution", () => {
  it("is false for a SKU with no resolution lever (kling-turbo — the Operation-not-found row)", () => {
    expect(kieModelAcceptsResolution("kling-turbo", KIE_TEXT_TO_VIDEO_MODELS["kling-turbo"])).toBe(false)
    expect(kieModelAcceptsResolution("kling-turbo", KIE_VIDEO_MODELS["kling-turbo"])).toBe(false)
  })

  it("is true for a SKU that declares one by pinning a default in extraParams", () => {
    expect(kieModelAcceptsResolution("grok", KIE_TEXT_TO_VIDEO_MODELS["grok"])).toBe(true)
    expect(kieModelAcceptsResolution("wan", KIE_TEXT_TO_VIDEO_MODELS["wan"])).toBe(true)
  })

  // R2: minimax-h3 declares NO lever in extraParams, but applyMinimaxH3Params
  // reads input.resolution — stripping it silently renders 2K while billing
  // the 768P anchor.
  it("is true for minimax-h3 even though its config declares no lever", () => {
    expect(kieModelAcceptsResolution("minimax-h3", KIE_VIDEO_MODELS["minimax-h3"])).toBe(true)
    expect(kieModelAcceptsResolution("minimax-h3", KIE_TEXT_TO_VIDEO_MODELS["minimax-h3"])).toBe(true)
  })

  it("is false for an unknown model", () => {
    expect(kieModelAcceptsResolution("nope", undefined)).toBe(false)
  })

  // `resolutionMap` / `defaultResolution` are LIP-SYNC fields: they are read by
  // buildLipSyncInput and never by the video builders. Honouring them in the
  // video guard would hand a future lip-sync-shaped SKU exactly the payload
  // that produced "Operation not found".
  it("ignores the lip-sync resolutionMap/defaultResolution fields", () => {
    expect(kieModelAcceptsResolution("x", { model: "m", cost: 0, credits: 0, resolutionMap: { "720p": "720" } })).toBe(false)
    expect(kieModelAcceptsResolution("x", { model: "m", cost: 0, credits: 0, defaultResolution: "720" })).toBe(false)
  })

  // Totality: every adapter that consumes input.resolution must be marked, or
  // the guard silently drops the value the adapter is waiting for.
  it("every provider whose params adapter reads input.resolution is accepted by the guard", () => {
    for (const id of RESOLUTION_CONSUMING_PARAM_ADAPTERS) {
      const cfg = KIE_VIDEO_MODELS[id] ?? KIE_TEXT_TO_VIDEO_MODELS[id]
      expect(cfg, `${id} is listed as a resolution-consuming adapter but has no KIE model config`).toBeDefined()
      expect(kieModelAcceptsResolution(id, cfg)).toBe(true)
    }
  })

  // The H3 dispatch is keyed on isMinimaxH3Provider, so a FUTURE H3 SKU joining
  // MINIMAX_H3_PROVIDERS would route through applyMinimaxH3Params (which reads
  // input.resolution) while the rescue set still named only "minimax-h3" — R2
  // re-opening silently. The rescue set must be a superset of the family.
  it("covers every minimax-h3 family member (the adapter dispatches on the family, not the id)", () => {
    for (const id of MINIMAX_H3_PROVIDERS) {
      expect(
        RESOLUTION_CONSUMING_PARAM_ADAPTERS.has(id),
        `${id} routes through applyMinimaxH3Params (isMinimaxH3Provider) but is not in RESOLUTION_CONSUMING_PARAM_ADAPTERS — it would render the 2K default while billed off the request's 768P anchor`,
      ).toBe(true)
    }
  })
})

/**
 * The docs.kie.ai audit of every SKU that reaches the generic forwarder, as
 * executable evidence. `false` = the KIE OpenAPI schema for that model has no
 * `resolution` property, so sending one makes the market operation
 * `Market_<model>_<resolution>_<duration>` unresolvable (app-reports 11.3).
 * `true` = the schema DOES declare it, so the lever must keep reaching the wire.
 */
describe("the generic-forwarder SKUs, audited against docs.kie.ai", () => {
  it.each([
    ["minimax", "hailuo/02-text-to-video-pro"],
    ["kling", "kling-2.6/text-to-video"],
    ["kling-turbo", "kling/v2-5-turbo-text-to-video-pro"],
    ["hailuo-standard", "hailuo/02-text-to-video-standard"],
  ])("t2v %s (%s) has no resolution in its KIE schema → suppressed", (id) => {
    expect(kieModelAcceptsResolution(id, KIE_TEXT_TO_VIDEO_MODELS[id])).toBe(false)
  })

  it.each([
    ["minimax", "hailuo/02-image-to-video-pro"],
    ["kling", "kling-2.6/image-to-video"],
    ["kling-turbo", "kling/v2-5-turbo-image-to-video-pro"],
    ["kling-master", "kling/v2-1-master-image-to-video"],
  ])("i2v %s (%s) has no resolution in its KIE schema → suppressed", (id) => {
    expect(kieModelAcceptsResolution(id, KIE_VIDEO_MODELS[id])).toBe(false)
  })

  it("grok-i2v / wan-2.7 DO declare a resolution — the lever must survive the guard", () => {
    expect(kieModelAcceptsResolution("grok-i2v", KIE_VIDEO_MODELS["grok-i2v"])).toBe(true)
    expect(kieModelAcceptsResolution("wan-2.7-i2v", KIE_VIDEO_MODELS["wan-2.7-i2v"])).toBe(true)
    expect(kieModelAcceptsResolution("wan-2.7-t2v", KIE_TEXT_TO_VIDEO_MODELS["wan-2.7-t2v"])).toBe(true)
  })

  // `acceptsResolution` is a SCHEMA FACT and nothing more. It must never grow a
  // pinned value in extraParams by accident: a request that carried no
  // `resolution` key before the lever guard existed must still carry none.
  it.each([
    ["grok-i2v", KIE_VIDEO_MODELS],
    ["wan-2.7-i2v", KIE_VIDEO_MODELS],
    ["wan-2.7-t2v", KIE_TEXT_TO_VIDEO_MODELS],
  ] as const)("%s declares the param without pinning a default (intent-less request unchanged)", (id, map) => {
    const cfg = map[id]
    expect(cfg?.acceptsResolution).toBe(true)
    expect(
      cfg?.extraParams === undefined || !("resolution" in cfg.extraParams),
      `${id} pins a resolution in extraParams — that value now rides EVERY request, which is a render/default change, not a lever declaration. Use acceptsResolution unless the pin is deliberate and verified.`,
    ).toBe(true)
  })
})

/**
 * Bespoke runners: these providers are dispatched into their own builder
 * (runVeoTask / runKling3 / runRunwayTask / runGeminiOmni / runWan3) BEFORE the
 * generic forwarder, so `kieModelAcceptsResolution` never governs them and each
 * handles its own resolution. Expressed with the same predicates video.ts
 * dispatches on, so a new family member is covered without editing this list.
 */
const BESPOKE_RESOLUTION_RUNNERS = (provider: string): boolean =>
  isVeoProvider(provider) ||
  isGeminiOmniProvider(provider) ||
  isWan3Provider(provider) ||
  provider === "kling-3.0" ||
  provider === "runway-kie"

/**
 * Catalog-only levers: the MODEL_CATALOG entry offers a resolution the KIE SKU
 * for THAT lane cannot honour. The catalog is keyed per model id, not per mode,
 * so a two-mode entry states the union of both modes' capabilities.
 *
 * hailuo-standard: the i2v SKU (`hailuo/02-image-to-video-standard`) takes
 * `resolution` and pins 768P; the t2v SKU (`hailuo/02-text-to-video-standard`)
 * has NO resolution property at all (verified against its docs.kie.ai page), so
 * the catalog's 512P/768P is honest for i2v only. Suppressing it on t2v is the
 * fix, not a gap — forwarding it is precisely the incident shape.
 */
const CATALOG_ONLY_RESOLUTION_LEVERS = new Set<string>(["hailuo-standard:t2v"])

/**
 * Inverse invariant. The guard is a hard gate on the wire, so any model whose
 * catalog entry advertises a resolution picker MUST be recognised for the lanes
 * it actually serves — otherwise the UI offers a lever the request silently
 * drops. A new lever-bearing KIE model added without `acceptsResolution` (or a
 * pinned `extraParams.resolution`) fails here.
 */
describe("every catalog-advertised resolution lever survives the guard", () => {
  const cases: Array<[string, "i2v" | "t2v"]> = []
  for (const id of VIDEO_GEN_PROVIDERS) {
    if (!MODEL_CATALOG[id]?.resolutions?.length) continue
    if (BESPOKE_RESOLUTION_RUNNERS(id)) continue
    if (KIE_VIDEO_MODELS[id]) cases.push([id, "i2v"])
    if (KIE_TEXT_TO_VIDEO_MODELS[id]) cases.push([id, "t2v"])
  }

  it("the sweep actually has models to check", () => {
    expect(cases.length).toBeGreaterThan(5)
  })

  it.each(cases)("%s (%s) advertises resolutions in MODEL_CATALOG", (id, lane) => {
    if (CATALOG_ONLY_RESOLUTION_LEVERS.has(`${id}:${lane}`)) return
    const cfg = lane === "i2v" ? KIE_VIDEO_MODELS[id] : KIE_TEXT_TO_VIDEO_MODELS[id]
    expect(
      kieModelAcceptsResolution(id, cfg),
      `MODEL_CATALOG["${id}"].resolutions offers the user a resolution picker, but the ${lane} KIE config does not declare the param, so kieModelAcceptsResolution drops it before it reaches the wire. If the SKU's docs.kie.ai schema lists "resolution", set acceptsResolution: true on that config (or pin a verified default in extraParams). If the SKU genuinely has no such param in this lane, add "${id}:${lane}" to CATALOG_ONLY_RESOLUTION_LEVERS with the doc citation.`,
    ).toBe(true)
  })

  it("every CATALOG_ONLY_RESOLUTION_LEVERS entry is still a real, still-failing pair", () => {
    for (const entry of CATALOG_ONLY_RESOLUTION_LEVERS) {
      const [id, lane] = entry.split(":") as [string, "i2v" | "t2v"]
      const cfg = lane === "i2v" ? KIE_VIDEO_MODELS[id] : KIE_TEXT_TO_VIDEO_MODELS[id]
      expect(cfg, `${entry} names no KIE model config — stale allowlist entry`).toBeDefined()
      expect(
        kieModelAcceptsResolution(id, cfg),
        `${entry} is allowlisted as a catalog-only lever but the config now declares the param — remove it from CATALOG_ONLY_RESOLUTION_LEVERS`,
      ).toBe(false)
    }
  })
})
