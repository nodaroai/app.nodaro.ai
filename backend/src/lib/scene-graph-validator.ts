import { z } from "zod"

// ── Zod schema matching the scene graph types ──────────────────────────

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
  fontFamily: z.string().optional(),
  animation: z.string(), // validated and auto-fixed post-parse
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

export interface ValidationResult {
  valid: boolean
  sceneGraph: z.infer<typeof sceneGraphSchema> | null
  errors: string[]
  autoFixed: string[]
}

/**
 * Validate and auto-fix an AI-generated scene graph.
 * Returns structured errors if the JSON is fundamentally invalid.
 */
export function validateSceneGraph(
  raw: unknown,
  expectedAssetUrls: string[],
  expectedDurationFrames: number,
  expectedFps: number,
): ValidationResult {
  const errors: string[] = []
  const autoFixed: string[] = []

  // 1. Zod parse
  const parsed = sceneGraphSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      valid: false,
      sceneGraph: null,
      errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      autoFixed: [],
    }
  }

  const sg = { ...parsed.data } as z.infer<typeof sceneGraphSchema> & {
    fps: number
    durationInFrames: number
  }

  // 2. Auto-fix invalid text animation values
  const VALID_TEXT_ANIMATIONS = new Set(["fade", "slide-up", "typewriter", "word-highlight", "none"])
  for (const track of sg.tracks) {
    if (track.type !== "text") continue
    for (const seg of track.segments) {
      if (!VALID_TEXT_ANIMATIONS.has(seg.animation)) {
        autoFixed.push(`Fixed text animation "${seg.animation}" to "fade" for segment ${seg.id}`)
        ;(seg as { animation: string }).animation = "fade"
      }
    }
  }

  // 3. Auto-fix fps if slightly off
  if (sg.fps !== expectedFps) {
    autoFixed.push(`Fixed fps from ${sg.fps} to ${expectedFps}`)
    sg.fps = expectedFps
  }

  // 4. Auto-fix total duration if within 10% tolerance
  const durationDiff = Math.abs(sg.durationInFrames - expectedDurationFrames)
  const tolerance = Math.ceil(expectedDurationFrames * 0.1)
  if (durationDiff > 0 && durationDiff <= tolerance) {
    autoFixed.push(`Fixed durationInFrames from ${sg.durationInFrames} to ${expectedDurationFrames}`)
    sg.durationInFrames = expectedDurationFrames
  } else if (durationDiff > tolerance) {
    errors.push(`Total duration ${sg.durationInFrames} frames differs from expected ${expectedDurationFrames} by more than 10%`)
  }

  // 5. Check that all assets are referenced
  const referencedSrcs = new Set<string>()
  for (const track of sg.tracks) {
    if (track.type === "media") {
      for (const seg of track.segments) {
        referencedSrcs.add(seg.src)
      }
    } else if (track.type === "audio") {
      referencedSrcs.add(track.src)
    }
  }

  for (const url of expectedAssetUrls) {
    if (!referencedSrcs.has(url)) {
      errors.push(`Asset not referenced in scene graph: ${url}`)
    }
  }

  // 6. Check for segment overlaps within media tracks
  for (const track of sg.tracks) {
    if (track.type !== "media") continue
    const sorted = [...track.segments].sort((a, b) => a.startFrame - b.startFrame)
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]
      const curr = sorted[i]
      if (curr.startFrame < prev.startFrame + prev.durationInFrames) {
        errors.push(
          `Segment overlap in track ${track.id}: ${prev.id} ends at frame ${prev.startFrame + prev.durationInFrames} but ${curr.id} starts at frame ${curr.startFrame}`,
        )
      }
    }
  }

  // 7. Round all frame numbers to integers
  for (const track of sg.tracks) {
    if (track.type === "media") {
      for (const seg of track.segments) {
        const origStart = seg.startFrame
        const origDur = seg.durationInFrames
        ;(seg as { startFrame: number }).startFrame = Math.round(seg.startFrame)
        ;(seg as { durationInFrames: number }).durationInFrames = Math.round(seg.durationInFrames)
        if (seg.startFrame !== origStart || seg.durationInFrames !== origDur) {
          autoFixed.push(`Rounded frames for segment ${seg.id}`)
        }
      }
    } else if (track.type === "text") {
      for (const seg of track.segments) {
        ;(seg as { startFrame: number }).startFrame = Math.round(seg.startFrame)
        ;(seg as { durationInFrames: number }).durationInFrames = Math.round(seg.durationInFrames)
      }
    }
  }

  return {
    valid: errors.length === 0,
    sceneGraph: sg,
    errors,
    autoFixed,
  }
}
