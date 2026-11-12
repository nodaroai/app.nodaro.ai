import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { openApiRegistry } from "../../lib/openapi-registry.js"
import { getAppSettings } from "../../lib/app-settings.js"
import { formatZodError } from "../../lib/zod-error.js"
import { computeGenerateVideoProPricing } from "../billing/generate-video-pro-credits.js"
import { applyServiceMarkup } from "../billing/service-margin.js"

const estimateBody=z.object({
  provider:z.string().min(1).max(64), resolution:z.string().max(16).default("720p"),
  duration:z.number().int().min(1).max(3600).default(8), aspectRatio:z.string().max(16).optional(),
  segmentMode:z.enum(["short","long","max"]).optional(),
  preferredSegmentSec:z.number().int().min(4).max(15).optional(),
  segmentDurations:z.array(z.number().int().min(1).max(30)).min(1).max(24).optional(),
  sourceSegmentDurations:z.array(z.number().int().min(1).max(30)).min(1).max(24).optional(),
  renderMethod:z.enum(["extend","keyframes"]).optional(),
  anchorMode:z.enum(["upfront","progressive","none"]).optional(),
  contextTailSec:z.number().min(2).max(15).optional(),planOnly:z.boolean().optional(),
  // The run's audio: priced where the model's price follows it (PixVerse V6 Max).
  generateAudio:z.boolean().optional(),
})

/** Read-only estimate through the same pricing and markup as reservation. */
export function registerVideoProEstimate(app:FastifyInstance):void {
  openApiRegistry.registerPath({
    method: "post", path: "/v1/credits/video-pro-estimate",
    description: "Estimate Video Pro credits without creating a job. Short and Long return a pre-plan reservation upper bound.",
    security: [{ bearerAuth: [] }],
    request: { body: { content: { "application/json": { schema: estimateBody } } } },
    responses: { 200: { description: "Credit estimate", content: { "application/json": { schema: z.object({
      data: z.object({ credits: z.number(), upperBound: z.boolean() }),
    }) } } } },
  })
  app.post("/v1/credits/video-pro-estimate",async(req,reply)=>{
    const parsed=estimateBody.safeParse(req.body)
    if(!parsed.success) return reply.code(400).send(formatZodError(parsed.error))
    const p=parsed.data
    try {
      const price=await computeGenerateVideoProPricing({provider:p.provider,resolution:p.resolution,durationSec:p.duration,
        aspectRatio:!p.aspectRatio||p.aspectRatio==="adaptive"?"16:9":p.aspectRatio,
        segmentMode:p.segmentMode,preferredSegmentSec:p.preferredSegmentSec,segmentDurations:p.segmentDurations,sourceSegmentDurations:p.sourceSegmentDurations,
        renderMethod:p.renderMethod,tailSec:p.contextTailSec,anchorsSeeded:p.anchorMode==="none"?true:undefined,
        generateAudio:p.generateAudio,
      })
      const credits=applyServiceMarkup(p.planOnly?Math.max(2,price.feeBase):price.reserveBase,await getAppSettings(),"generate-video-pro")
      return {data:{credits,upperBound:!p.planOnly&&!!price.segmentPlanning}}
    } catch(error) {
      // Pricing validation is public configuration feedback, never a job failure.
      return reply.code(400).send({error:error instanceof Error?error.message:"Unable to estimate this video configuration"})
    }
  })
}
