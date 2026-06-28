import type { AlignmentWord } from "../../providers/elevenlabs/forced-alignment.js"
import { validatePlanByType, type ShotSequencePlan } from "../../lib/plan-schemas.js"
import { alignCues, type CueSpan } from "./aligner.js"
import type { ShotSequenceBrief, BriefReveal } from "./brief-schema.js"

const MAX_FRAMES = 54000

/** Thrown when a cue-anchored brief has no usable word timings (→ route 4xx). */
export class EmptyAlignmentError extends Error {
  constructor(message = "No narration word timings matched any cue; cannot bake cue-anchored reveals.") {
    super(message)
    this.name = "EmptyAlignmentError"
  }
}

/** Thrown when scene windows overlap after baking (→ route 4xx). */
export class SceneOverlapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SceneOverlapError"
  }
}

export interface BakeOptions {
  /** True audio length in ms (e.g. ffprobe). Falls back to the last word's end. */
  audioDurationMs?: number
}

interface BakedReveal {
  reveal: BriefReveal
  frameAbs: number
  endAbs: number
}

function clampFrame(frame: number): number {
  return Math.max(0, Math.min(MAX_FRAMES, Math.round(frame)))
}

function anchorMs(reveal: BriefReveal, spans: Record<string, CueSpan>): number | null {
  if (reveal.revealAt.kind === "frame") return null
  const span = spans[reveal.revealAt.cueId]
  if (!span) return null
  const base = reveal.revealAt.edge === "end" ? span.endMs : span.startMs
  return base + (reveal.revealAt.offsetMs ?? 0)
}

export function bakeShotSequence(
  brief: ShotSequenceBrief,
  alignment: AlignmentWord[],
  audioUrl: string,
  opts?: BakeOptions,
): { plan: ShotSequencePlan; warnings: string[] } {
  const { spans, warnings } = alignCues(brief.narration.cues, alignment)

  // Empty-alignment guard: if the brief uses cue anchors but nothing matched
  // (e.g. provider returned []), fail loudly instead of collapsing to frame 0.
  const usesCueAnchors = brief.scenes.some((s) => s.shots.some((sh) => sh.reveals.some((r) => r.revealAt.kind === "cue")))
  const matchedCount = brief.narration.cues.length - warnings.length
  if (usesCueAnchors && matchedCount === 0) {
    throw new EmptyAlignmentError()
  }

  const fps = brief.fps

  // 1. Bake each reveal to an ABSOLUTE frame + compute its end.
  const sceneWindows = brief.scenes.map((scene) => {
    const baked: BakedReveal[] = []
    // reveal → baked lookup for the scene-relative rebase pass (step 5). A scene
    // may hold up to 200 shots × 500 reveals = 100k reveals; a per-reveal find()
    // would make that pass O(R²), so we index by object reference once here.
    const bakedByReveal = new Map<BriefReveal, BakedReveal>()
    for (const shot of scene.shots) {
      for (const reveal of shot.reveals) {
        let frameAbs: number
        if (reveal.revealAt.kind === "frame") {
          frameAbs = clampFrame(reveal.revealAt.frame)
        } else {
          const ms = anchorMs(reveal, spans)
          // anchorMs only returns null for a missing span; alignCues always
          // writes a (fallback) span for every cue, so ms is non-null here.
          frameAbs = clampFrame(((ms ?? 0) / 1000) * fps)
        }
        const endAbs = clampFrame(frameAbs + reveal.enter.durationFrames + (reveal.hold ?? 0) + (reveal.exit?.durationFrames ?? 0))
        const entry: BakedReveal = { reveal, frameAbs, endAbs }
        baked.push(entry)
        bakedByReveal.set(reveal, entry)
      }
    }
    // `baked` is never empty (schema guarantees ≥1 shot, each with ≥1 reveal), so
    // these seeded reduces are safe — and avoid Math.min(...bigArray) throwing a
    // RangeError once a scene exceeds the V8 spread-argument limit.
    const startAbs = baked.reduce((m, b) => Math.min(m, b.frameAbs), Infinity)
    const rawEndAbs = baked.reduce((m, b) => Math.max(m, b.endAbs), 0)
    return { scene, bakedByReveal, startAbs, endAbs: Math.min(MAX_FRAMES, Math.max(rawEndAbs, startAbs + 1)) }
  })

  // 2. Sort scenes by start frame (array order == paint order == time order).
  sceneWindows.sort((a, b) => a.startAbs - b.startAbs)

  // 3. Reject overlapping windows (the directly-supplied-plan guard lives in
  //    the schema superRefine; this gives a friendlier baker-side error).
  for (let i = 1; i < sceneWindows.length; i++) {
    if (sceneWindows[i].startAbs < sceneWindows[i - 1].endAbs) {
      throw new SceneOverlapError(
        `Scene "${sceneWindows[i].scene.id}" starts at frame ${sceneWindows[i].startAbs} but scene ` +
          `"${sceneWindows[i - 1].scene.id}" runs until ${sceneWindows[i - 1].endAbs}. ` +
          `Reveal cue spans must not interleave across scenes.`,
      )
    }
  }

  // 4. Composition duration: narration tail (or supplied audio length) vs the
  //    last scene's end, + a 1s held read; then extend the last scene to fill.
  const lastWord = alignment.length > 0 ? alignment[alignment.length - 1] : null
  const narrationDurationMs = opts?.audioDurationMs ?? (lastWord ? lastWord.end * 1000 : 0)
  const TAIL_FRAMES = fps
  const maxSceneEnd = sceneWindows.length > 0 ? Math.max(...sceneWindows.map((s) => s.endAbs)) : 1
  const durationInFrames = Math.max(
    1,
    Math.min(MAX_FRAMES, Math.max(Math.round((narrationDurationMs / 1000) * fps) + TAIL_FRAMES, maxSceneEnd)),
  )

  // 5. Build the resolved scenes (scene-relative reveal frames, revealAt stripped).
  const scenes = sceneWindows.map((win, idx) => {
    const isLast = idx === sceneWindows.length - 1
    const sceneEnd = isLast ? durationInFrames : win.endAbs
    return {
      id: win.scene.id,
      startFrame: win.startAbs,
      durationInFrames: Math.max(1, sceneEnd - win.startAbs),
      ...(win.scene.background ? { background: win.scene.background } : {}),
      shots: win.scene.shots.map((shot) => ({
        id: shot.id,
        reveals: shot.reveals.map((reveal) => {
          const bakedReveal = win.bakedByReveal.get(reveal)!
          return {
            id: reveal.id,
            element: reveal.element,
            frame: bakedReveal.frameAbs - win.startAbs, // rebase scene-relative
            enter: reveal.enter,
            ...(reveal.hold !== undefined ? { hold: reveal.hold } : {}),
            ...(reveal.exit ? { exit: reveal.exit } : {}),
          }
        }),
      })),
    }
  })

  const plan = {
    planType: "shot-sequence" as const,
    fps,
    width: brief.width,
    height: brief.height,
    durationInFrames,
    backgroundColor: brief.backgroundColor,
    audio: { src: audioUrl },
    scenes,
  }

  // 6. Defensive: parse through the real schema (catches any invariant slip).
  const validated = validatePlanByType("shot-sequence", plan) as ShotSequencePlan
  return { plan: validated, warnings }
}
