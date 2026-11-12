import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"
const pricing=vi.hoisted(()=>vi.fn())
vi.mock("../../billing/generate-video-pro-credits.js",()=>({computeGenerateVideoProPricing:pricing}))
vi.mock("../../../lib/app-settings.js",()=>({getAppSettings:async()=>({cost_markup_percent:10})}))
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
