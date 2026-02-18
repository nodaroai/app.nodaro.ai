import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { renderQueue } from "../lib/render-queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"

const renderVideoBody = z.object({
  template: z.enum(["slideshow", "explainer", "social-reel", "documentary"]),
  fps: z.number().min(15).max(60).default(30),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:5"]).default("16:9"),
  durationSeconds: z.number().min(1).max(300).default(30),
  transitionStyle: z.enum(["fade", "slide", "dissolve", "zoom", "none"]).default("fade"),
  transitionDurationFrames: z.number().min(0).max(60).default(15),
  mediaAssets: z.array(z.object({
    url: z.string().url(),
    type: z.enum(["image", "video", "audio"]),
    durationSeconds: z.number().optional(),
  })).min(1),
  audioTrackUrl: z.string().url().optional(),
  textOverlays: z.array(z.object({
    text: z.string(),
    position: z.enum(["top", "center", "bottom"]),
    fontSize: z.number(),
    color: z.string(),
    startFrame: z.number(),
    endFrame: z.number(),
  })).default([]),
  captions: z.object({
    enabled: z.boolean(),
    style: z.enum(["subtitle", "word-highlight", "karaoke"]),
    position: z.enum(["bottom", "top", "center"]),
    fontSize: z.number(),
    color: z.string(),
  }).default({ enabled: false, style: "subtitle", position: "bottom", fontSize: 24, color: "#ffffff" }),
  backgroundColor: z.string().default("#000000"),
  kenBurnsEnabled: z.boolean().default(false),
  userId: z.string().uuid().optional(),
})

const ASPECT_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
}

export async function renderVideoRoutes(app: FastifyInstance) {
  app.post("/v1/render-video", { preHandler: creditGuard(() => "render-video") }, async (req, reply) => {
    const parsed = renderVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const {
      template, fps, aspectRatio, durationSeconds, transitionStyle,
      transitionDurationFrames, mediaAssets, audioTrackUrl, textOverlays,
      captions, backgroundColor, kenBurnsEnabled, userId,
    } = parsed.data

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "userId is required" },
      })
    }

    const dimensions = ASPECT_DIMENSIONS[aspectRatio]
    const durationInFrames = Math.round(durationSeconds * fps)

    const modelIdentifier = "render-video"

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId,
        status: "pending",
        input_data: {
          type: "render-video",
          template,
          fps,
          aspectRatio,
          durationSeconds,
          transitionStyle,
          transitionDurationFrames,
          mediaAssets,
          audioTrackUrl,
          textOverlays,
          captions,
          backgroundColor,
          kenBurnsEnabled,
          width: dimensions.width,
          height: dimensions.height,
          durationInFrames,
        },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await renderQueue.add("render-video", {
      jobId: job.id,
      template,
      fps,
      width: dimensions.width,
      height: dimensions.height,
      durationInFrames,
      transitionStyle,
      transitionDurationFrames,
      mediaAssets,
      audioTrackUrl,
      textOverlays,
      captions,
      backgroundColor,
      kenBurnsEnabled,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
