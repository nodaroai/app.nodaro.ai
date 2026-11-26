import { describe, expect, it, vi } from "vitest"
import { ALTERNATE_ROUTE_JOB_TYPES } from "../alternate-route-request.js"
import type { PluginAlternateRouteRequest, PluginAlternateRoutesService } from "../private-plugins/types.js"
import { decideVideoRoute, routeViewOf, videoRouteRequestKey, videoRouteServiceOf, videoRouteStamp, videoRouteStampOf, type RouteView } from "../video-route-decision.js"
import {
  ROUTABLE_VIDEO_MODELS,
  defaultVideoRoutePolicy,
  parseVideoRoutePolicy,
  priceFactorKey,
  raisedPriceFactor,
  revertedVideoRoutePolicy,
  videoRouteChoiceFor,
  PRICE_FACTOR_MAX_AUTO_STEP,
  type VideoRoutePolicy,
} from "../video-route-policy.js"

const request = (over: Partial<PluginAlternateRouteRequest> = {}): PluginAlternateRouteRequest => ({
  jobId: "job-1",
  jobType: "image-to-video",
  model: "seedance-2-5",
  parent: null,
  prompt: "a cat",
  draft: false,
  referenceImageUrls: [],
  referenceVideoUrls: [],
  referenceAudioUrls: [],
  ...over,
})

const yesView = (over: Partial<RouteView> = {}): RouteView => ({
  v2: true,
  capable: () => true,
  accepts: () => ({ routeId: "r1" }),
  ...over,
})

const routed = (models: VideoRoutePolicy["models"]): VideoRoutePolicy => ({ ...defaultVideoRoutePolicy(), models })

/** Every service a request can name: the platform lanes, and some plugin parents. */
const SERVICES = [...ALTERNATE_ROUTE_JOB_TYPES, "cast-swap", "generate-video-pro", "ugc-clip"]
const KINDS = ["generate", "draft-finalize"] as const

describe("decideVideoRoute — totality", () => {
  it("is 'default' for every model × service × kind while nothing is saved, and never asks the route", () => {
    const accepts = vi.fn(() => ({ routeId: "r1" }))
    for (const model of ROUTABLE_VIDEO_MODELS) {
      for (const service of SERVICES) {
        for (const kind of KINDS) {
          for (const policy of [null, undefined, defaultVideoRoutePolicy()]) {
            expect(decideVideoRoute(policy, yesView({ accepts }), { model, service, request: request({ model, kind }) })).toEqual({ route: "default", why: "setting" })
          }
        }
      }
    }
    expect(accepts).not.toHaveBeenCalled()
  })

  it("is 'alternate' for every model × service × kind when the model is routed and the route takes it", () => {
    for (const model of ROUTABLE_VIDEO_MODELS) {
      const policy = routed({ [model]: { route: "alternate" } })
      for (const service of SERVICES) {
        for (const kind of KINDS) {
          expect(decideVideoRoute(policy, yesView(), { model, service, request: request({ model, kind }) })).toEqual({ route: "alternate", routeId: "r1", service })
        }
      }
    }
  })

  it("never routes a model outside the Seedance 2.x family, whatever is saved", () => {
    const policy = { ...defaultVideoRoutePolicy(), models: { "kling-3.0": { route: "alternate" as const } } }
    expect(decideVideoRoute(policy, yesView(), { model: "kling-3.0", service: "image-to-video", request: request({ model: "kling-3.0" }) })).toEqual({ route: "default", why: "not-routable" })
  })

  it("follows a per-service override in both directions", () => {
    const policy = routed({ "seedance-2": { route: "alternate", services: { "lip-sync": "default" } }, "seedance-2-fast": { route: "default", services: { ugc: "alternate" } } })
    expect(decideVideoRoute(policy, yesView(), { model: "seedance-2", service: "lip-sync", request: request() }).route).toBe("default")
    expect(decideVideoRoute(policy, yesView(), { model: "seedance-2", service: "extend-video", request: request() }).route).toBe("alternate")
    expect(decideVideoRoute(policy, yesView(), { model: "seedance-2-fast", service: "ugc", request: request() }).route).toBe("alternate")
    expect(decideVideoRoute(policy, yesView(), { model: "seedance-2-fast", service: "cast-swap", request: request() }).route).toBe("default")
  })

  it("stays on the default route where this process's route cannot take it", () => {
    const policy = routed({ "seedance-2-5": { route: "alternate" } })
    const ask = { model: "seedance-2-5", service: "image-to-video", request: request() }
    expect(decideVideoRoute(policy, null, ask)).toEqual({ route: "default", why: "no-route" })
    expect(decideVideoRoute(policy, yesView({ v2: false }), ask)).toEqual({ route: "default", why: "route-v1" })
    expect(decideVideoRoute(policy, yesView({ capable: () => false }), ask)).toEqual({ route: "default", why: "not-capable" })
    expect(decideVideoRoute(policy, yesView({ accepts: () => null }), ask)).toEqual({ route: "default", why: "not-accepted" })
    expect(decideVideoRoute(policy, yesView({ accepts: () => ({ routeId: "" }) }), ask)).toEqual({ route: "default", why: "not-accepted" })
  })

  it("asks accepts with the service and kind set (the admin-routed consult)", () => {
    const accepts = vi.fn((_req: PluginAlternateRouteRequest) => ({ routeId: "r1" }))
    decideVideoRoute(routed({ "seedance-2-5": { route: "alternate" } }), yesView({ accepts }), { model: "seedance-2-5", service: "cast-swap", request: request() })
    expect(accepts.mock.calls[0]![0]).toMatchObject({ service: "cast-swap", kind: "generate" })
  })
})

describe("routeViewOf", () => {
  const base: PluginAlternateRoutesService = { accepts: () => ({ routeId: "r" }), start: async () => ({ taskRef: "t" }), poll: async () => ({ state: "running" }) }

  it("is null with no service, and v1 without prices()", () => {
    expect(routeViewOf(undefined, null)).toBeNull()
    expect(routeViewOf(base, null)!.v2).toBe(false)
    expect(routeViewOf({ ...base, prices: () => [] }, {})!.v2).toBe(true)
  })

  it("reads capable from the plugin, else from the models its prices name", () => {
    expect(routeViewOf({ ...base, prices: () => [], capable: (m) => m === "seedance-2" }, {})!.capable("seedance-2")).toBe(true)
    const byPrices = routeViewOf({ ...base, prices: () => [] }, { "seedance-2-5:8s:720p": 0.2 })!
    expect(byPrices.capable("seedance-2-5")).toBe(true)
    expect(byPrices.capable("seedance-2")).toBe(false)
  })

  it("turns a throw into a no", () => {
    const view = routeViewOf({ ...base, prices: () => [], capable: () => { throw new Error("x") }, accepts: () => { throw new Error("y") } }, {})!
    expect(view.capable("seedance-2")).toBe(false)
    expect(view.accepts(request())).toBeNull()
  })
})

describe("the policy", () => {
  it("parses entry by entry, dropping non-routable models and bad entries", () => {
    const p = parseVideoRoutePolicy({
      models: { "seedance-2": { route: "alternate" }, "kling-3.0": { route: "alternate" }, "seedance-2-5": { route: "sideways" } },
      routeBalanceAlertUsd: 50,
      spendDriftAlertPercent: "x",
    })!
    expect(p.models).toEqual({ "seedance-2": { route: "alternate" } })
    expect(p.routeBalanceAlertUsd).toBe(50)
    expect(p.spendDriftAlertPercent).toBe(3)
    expect(parseVideoRoutePolicy("nope")).toBeNull()
  })

  it("reverts every model to default and keeps the thresholds", () => {
    const p = { ...routed({ "seedance-2": { route: "alternate" } }), routeBalanceAlertUsd: 10 }
    const r = revertedVideoRoutePolicy(p)
    expect(r.models).toEqual({})
    expect(r.routeBalanceAlertUsd).toBe(10)
    expect(videoRouteChoiceFor(r, "seedance-2", "image-to-video")).toBe("default")
  })

  it("raises a factor only up, at most one step at a time", () => {
    expect(raisedPriceFactor(1, 0.8)).toBe(1)
    expect(raisedPriceFactor(1.2, 1.1)).toBe(1.2)
    expect(raisedPriceFactor(1, 1.1)).toBe(1.1)
    expect(raisedPriceFactor(1, 3)).toBe(PRICE_FACTOR_MAX_AUTO_STEP)
    expect(raisedPriceFactor(1.25, 3)).toBeCloseTo(1.25 * PRICE_FACTOR_MAX_AUTO_STEP, 3)
    // The absolute ceiling: never past it automatically.
    expect(raisedPriceFactor(1.9, 5)).toBe(2)
    expect(raisedPriceFactor(2, 5)).toBe(2)
  })

  it("keys a factor by model, resolution, reference video and kind", () => {
    expect(priceFactorKey({ model: "seedance-2-5", resolution: "720p", hasRefVideo: true, kind: "generate" })).toBe("seedance-2-5:720p:ref:generate")
  })
})

describe("the service and the stamp", () => {
  it("names a child job by its parent's type, else by its own", () => {
    expect(videoRouteServiceOf({ jobType: "image-to-video", parentJobType: "cast-swap" })).toBe("cast-swap")
    expect(videoRouteServiceOf({ jobType: "extend-video", parentJobType: null })).toBe("extend-video")
  })

  it("round-trips the stored decision and rejects a malformed one", () => {
    const stamp = videoRouteStamp("job-1", { route: "alternate", routeId: "r1", service: "image-to-video" }, { model: "seedance-2", priceId: "seedance-2:8s:720p", requestKey: "rk", quotedUsd: 0.5, quotedSec: 8, factor: 1, factorKey: "k", now: new Date(0) })
    const { sig: _sig, ...fields } = stamp
    expect(videoRouteStampOf({ __videoRoute: stamp }, "job-1")).toEqual(fields)
    expect(videoRouteStampOf({ __videoRoute: { ...stamp, quotedUsd: -1 } }, "job-1")).toBeUndefined()
    expect(videoRouteStampOf({}, "job-1")).toBeUndefined()
  })

  it("honours a decision only where the server signed it, for that job", () => {
    const stamp = videoRouteStamp("job-1", { route: "alternate", routeId: "r1", service: "image-to-video" }, { model: "seedance-2", priceId: "seedance-2:8s:720p", requestKey: "rk", quotedUsd: 0.5, quotedSec: 8, factor: 1, factorKey: "k" })
    // Unsigned (a caller's own), a field changed, or a stamp copied from another job: no decision.
    const { sig: _sig, ...unsigned } = stamp
    expect(videoRouteStampOf({ __videoRoute: unsigned }, "job-1")).toBeUndefined()
    expect(videoRouteStampOf({ __videoRoute: { ...stamp, quotedUsd: 0.01 } }, "job-1")).toBeUndefined()
    expect(videoRouteStampOf({ __videoRoute: { ...stamp, factor: 3 } }, "job-1")).toBeUndefined()
    expect(videoRouteStampOf({ __videoRoute: stamp }, "job-2")).toBeUndefined()
    // Bound to its price and request: a changed price id or inputs key no longer verifies.
    expect(videoRouteStampOf({ __videoRoute: { ...stamp, priceId: "seedance-2:4s:480p" } }, "job-1")).toBeUndefined()
    expect(videoRouteStampOf({ __videoRoute: { ...stamp, requestKey: "other" } }, "job-1")).toBeUndefined()
  })

  it("keys the priced inputs: a change to one of them changes the key", () => {
    const input = { provider: "seedance-2-5", duration: 8, resolution: "720p", referenceVideoUrls: ["u"], refVideoDurationsSec: [6] }
    expect(videoRouteRequestKey(input)).toBe(videoRouteRequestKey({ ...input, prompt: "other words" }))
    expect(videoRouteRequestKey(input)).not.toBe(videoRouteRequestKey({ ...input, duration: 12 }))
    expect(videoRouteRequestKey(input)).not.toBe(videoRouteRequestKey({ ...input, refVideoDurationsSec: [9] }))
  })
})
