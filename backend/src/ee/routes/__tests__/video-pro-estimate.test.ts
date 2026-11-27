import { afterEach, it, expect, vi } from "vitest"
import Fastify from "fastify"
import { CREDIT_BASE_USD } from "@nodaro/shared/models"
import { defaultVideoRoutePolicy } from "../../../lib/video-route-policy.js"
import { _resetPluginServicesForTests, setPluginServices } from "../../../lib/private-plugins/services-registry.js"

const { pricing, settings } = vi.hoisted(() => ({
  pricing: vi.fn(),
  settings: { cost_markup_percent: 10 } as Record<string, unknown>,
}))
afterEach(() => {
  delete settings.video_route_policy
  _resetPluginServicesForTests()
})
vi.mock("../../billing/generate-video-pro-credits.js",()=>({computeGenerateVideoProPricing:pricing}))
vi.mock("../../../lib/app-settings.js",()=>({getAppSettings:async()=>settings}))
import { registerVideoProEstimate } from "../video-pro-estimate.js"
it("quotes the same upper reservation with markup once and without creating a job",async()=>{
  pricing.mockResolvedValue({reserveBase:600,feeBase:100,segmentPlanning:{mode:"short"}})
  const app=Fastify();registerVideoProEstimate(app)
  const res=await app.inject({method:"POST",url:"/v1/credits/video-pro-estimate",payload:{provider:"gemini-omni-flash",duration:12,segmentMode:"short",renderMethod:"keyframes"}})
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({data:{credits:660,upperBound:true}})
  expect(pricing).toHaveBeenCalledWith(expect.objectContaining({segmentMode:"short",durationSec:12,aspectRatio:"16:9"}))
  const plan=await app.inject({method:"POST",url:"/v1/credits/video-pro-estimate",payload:{provider:"gemini-omni-flash",duration:12,segmentMode:"short",renderMethod:"keyframes",planOnly:true}})
  // feeBase 100 + 10% markup = 110 (integer-domain ceil; the float 100*1.1
  // lands at 110.00000000000001, which the old formula over-charged to 111).
  expect(plan.json()).toEqual({data:{credits:110,upperBound:false}})
})
it("rejects malformed quotes before reading prices",async()=>{
  pricing.mockClear();const app=Fastify();registerVideoProEstimate(app)
  const res=await app.inject({method:"POST",url:"/v1/credits/video-pro-estimate",payload:{duration:-1,segmentMode:"nonsense"}})
  expect(res.statusCode).toBe(400);expect(pricing).not.toHaveBeenCalled()
})
it("passes the run's audio to the pricing, which reads it where the model's price follows it (PixVerse V6 Max)",async()=>{
  pricing.mockClear();pricing.mockResolvedValue({reserveBase:600,feeBase:100})
  const app=Fastify();registerVideoProEstimate(app)
  for (const generateAudio of [true,false]) {
    const res=await app.inject({method:"POST",url:"/v1/credits/video-pro-estimate",payload:{provider:"pixverse-v6-max",duration:23,renderMethod:"keyframes",generateAudio}})
    expect(res.statusCode).toBe(200)
    expect(pricing).toHaveBeenLastCalledWith(expect.objectContaining({provider:"pixverse-v6-max",generateAudio}))
  }
  await app.inject({method:"POST",url:"/v1/credits/video-pro-estimate",payload:{provider:"pixverse-v6-max",duration:23,renderMethod:"keyframes"}})
  expect(pricing.mock.lastCall?.[0]?.generateAudio).toBeUndefined()
})

it("prices the editor run using its audio and each segment's actual planned reference seconds", async () => {
  settings.video_route_policy = {
    ...defaultVideoRoutePolicy(),
    models: { "seedance-2-5": { route: "default", services: { "generate-video-pro": "alternate" } } },
  }
  pricing.mockResolvedValue({ segmentDurations: [10, 9], tailSec: 3, reserveBase: 600, feeBase: 10, resolution: "720p" })
  setPluginServices({
    alternateRoutes: {
      accepts: () => null,
      start: async () => { throw new Error("A read-only estimate cannot start a job") },
      poll: async () => ({ state: "running" }),
      quotePlan: (plan) => {
        if (plan.model !== "seedance-2-5" || plan.service !== "generate-video-pro"
          || plan.resolution !== "720p" || plan.generateAudio !== false) return null
        if (plan.outputSec === 10 && !plan.referenceVideoDurationsSec.length) return { routeId: "first", usd: 10 * CREDIT_BASE_USD, billedSeconds: 10 }
        if (plan.outputSec === 9 && plan.referenceVideoDurationsSec.join() === "3") return { routeId: "next", usd: 20 * CREDIT_BASE_USD, billedSeconds: 12 }
        return null
      },
    },
  })
  const app = Fastify()
  registerVideoProEstimate(app)
  const body = { provider: "seedance-2-5", duration: 18, renderMethod: "extend", generateAudio: false }
  const call = (payload: typeof body & { planOnly?: boolean }) => app.inject({ method: "POST", url: "/v1/credits/video-pro-estimate", payload })
  expect((await call(body)).json()).toEqual({ data: { credits: 44, upperBound: false } })
  expect((await call({ ...body, generateAudio: true })).statusCode).toBe(503)
  expect((await call({ ...body, planOnly: true })).json()).toEqual({ data: { credits: 11, upperBound: false } })
  await app.close()
})
