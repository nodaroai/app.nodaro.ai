import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { renderQueue } from "../lib/render-queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"

const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:5"] as const

const ASPECT_DIMENSIONS: Record<typeof ASPECT_RATIOS[number], { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
}

// ── Scene Graph Zod schema ─────────────────────────────────────────────

const transitionSchema = z.object({
  type: z.enum(["fade", "slide-left", "slide-right", "slide-up", "slide-down", "dissolve", "zoom-in", "zoom-out", "none"]),
  durationFrames: z.number().min(0).max(120),
})

const effectSchema = z.object({
  type: z.enum(["ken-burns", "scale", "opacity", "blur"]),
  startValue: z.number(),
  endValue: z.number(),
})

const segmentLayoutSchema = z.object({
  mode: z.enum(["fullscreen", "positioned"]),
  x: z.number().min(0).max(100).optional(),
  y: z.number().min(0).max(100).optional(),
  width: z.number().min(0).max(100).optional(),
  height: z.number().min(0).max(100).optional(),
  objectFit: z.enum(["cover", "contain", "fill"]).optional(),
})

const mediaSegmentSchema = z.object({
  id: z.string(),
  src: z.string(),
  mediaType: z.enum(["image", "video", "gif"]),
  startFrame: z.number().min(0),
  durationInFrames: z.number().min(1),
  layout: segmentLayoutSchema,
  transitionIn: transitionSchema.optional(),
  transitionOut: transitionSchema.optional(),
  effects: z.array(effectSchema).default([]),
})

const textSegmentSchema = z.object({
  id: z.string(),
  text: z.string(),
  startFrame: z.number().min(0),
  durationInFrames: z.number().min(1),
  position: z.enum(["top", "center", "bottom"]),
  fontSize: z.number().min(8).max(200),
  color: z.string(),
  fontWeight: z.number().optional(),
  fontStyle: z.enum(["normal", "italic"]).optional(),
  animation: z.enum(["fade", "slide-up", "typewriter", "word-highlight", "none"]),
})

const mediaTrackSchema = z.object({
  type: z.literal("media"),
  id: z.string(),
  zIndex: z.number(),
  segments: z.array(mediaSegmentSchema).min(1),
})

const audioTrackSchema = z.object({
  type: z.literal("audio"),
  id: z.string(),
  src: z.string(),
  volume: z.number().min(0).max(1),
  fadeInFrames: z.number().min(0),
  fadeOutFrames: z.number().min(0),
  startFrame: z.number().min(0).optional(),
})

const textTrackSchema = z.object({
  type: z.literal("text"),
  id: z.string(),
  zIndex: z.number(),
  segments: z.array(textSegmentSchema).min(1),
})

const trackSchema = z.discriminatedUnion("type", [mediaTrackSchema, audioTrackSchema, textTrackSchema])

const sceneGraphSchema = z.object({
  fps: z.number().min(15).max(60),
  width: z.number().min(100).max(3840),
  height: z.number().min(100).max(3840),
  durationInFrames: z.number().min(1),
  backgroundColor: z.string(),
  tracks: z.array(trackSchema).min(1),
})

// ── Legacy template schema ─────────────────────────────────────────────

const renderVideoBody = z.object({
  template: z.enum(["slideshow", "explainer", "social-reel", "documentary"]),
  fps: z.number().min(15).max(60).default(30),
  aspectRatio: z.enum(ASPECT_RATIOS).default("16:9"),
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

// ── Scene graph render schema ──────────────────────────────────────────

const renderSceneGraphBody = z.object({
  sceneGraph: sceneGraphSchema,
  userId: z.string().uuid().optional(),
})

// ── Generic plan render schema ────────────────────────────────────────

const renderPlanBody = z.object({
  planType: z.enum(["after-effects", "lottie-overlay", "3d-title", "motion-graphics"]),
  plan: z.record(z.unknown()),
  userId: z.string().uuid().optional(),
})

export async function renderVideoRoutes(app: FastifyInstance) {
  // Legacy template-based render
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

    const body = parsed.data

    if (!body.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "userId is required" },
      })
    }

    const dimensions = ASPECT_DIMENSIONS[body.aspectRatio]
    const durationInFrames = Math.round(body.durationSeconds * body.fps)

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: body.userId,
        status: "pending",
        input_data: {
          type: "render-video",
          template: body.template,
          fps: body.fps,
          aspectRatio: body.aspectRatio,
          durationSeconds: body.durationSeconds,
          transitionStyle: body.transitionStyle,
          transitionDurationFrames: body.transitionDurationFrames,
          mediaAssets: body.mediaAssets,
          audioTrackUrl: body.audioTrackUrl,
          textOverlays: body.textOverlays,
          captions: body.captions,
          backgroundColor: body.backgroundColor,
          kenBurnsEnabled: body.kenBurnsEnabled,
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
    const reservation = await reserveCreditsForJob(req, reply, job.id, "render-video")
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await renderQueue.add("render-video", {
      jobId: job.id,
      template: body.template,
      fps: body.fps,
      width: dimensions.width,
      height: dimensions.height,
      durationInFrames,
      transitionStyle: body.transitionStyle,
      transitionDurationFrames: body.transitionDurationFrames,
      mediaAssets: body.mediaAssets,
      audioTrackUrl: body.audioTrackUrl,
      textOverlays: body.textOverlays,
      captions: body.captions,
      backgroundColor: body.backgroundColor,
      kenBurnsEnabled: body.kenBurnsEnabled,
      usageLogId,
    })

    return { jobId: job.id }
  })

  // Scene graph render
  app.post("/v1/render-video/scene-graph", { preHandler: creditGuard(() => "render-video") }, async (req, reply) => {
    const parsed = renderSceneGraphBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { sceneGraph, userId } = parsed.data

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "userId is required" },
      })
    }

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId,
        status: "pending",
        input_data: {
          type: "render-video",
          mode: "scene-graph",
          sceneGraph,
        },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, "render-video")
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await renderQueue.add("render-video", {
      jobId: job.id,
      sceneGraph,
      usageLogId,
    })

    return { jobId: job.id }
  })

  // Generic plan-based render (after-effects, future composers)
  app.post("/v1/render-video/plan", { preHandler: creditGuard(() => "render-video") }, async (req, reply) => {
    const parsed = renderPlanBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { planType, plan, userId } = parsed.data

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "userId is required" },
      })
    }

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId,
        status: "pending",
        input_data: {
          type: "render-video",
          mode: "plan",
          planType,
          plan,
        },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, "render-video")
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await renderQueue.add("render-video", {
      jobId: job.id,
      planType,
      plan,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
