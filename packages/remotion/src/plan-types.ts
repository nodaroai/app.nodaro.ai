// ── After Effects Plan Types ──────────────────────────────────────────

export interface ColorGradeEffect {
  readonly type: "color-grade"
  readonly brightness: number   // 0.5 - 2.0 (1.0 = normal)
  readonly contrast: number     // 0.5 - 2.0 (1.0 = normal)
  readonly saturation: number   // 0 - 3.0 (1.0 = normal)
  readonly temperature: number  // -100 to 100 (0 = neutral, negative = cool, positive = warm)
}

export interface VignetteEffect {
  readonly type: "vignette"
  readonly intensity: number  // 0 - 1
  readonly radius: number     // 0.2 - 1.0 (smaller = tighter vignette)
}

export interface FilmGrainEffect {
  readonly type: "film-grain"
  readonly intensity: number  // 0 - 1
  readonly size: number       // 1 - 4 (pixel size of grain)
  readonly seed?: number
}

export interface NoiseOverlayEffect {
  readonly type: "noise-overlay"
  readonly opacity: number    // 0 - 0.5
  readonly scale: number      // 0.001 - 0.01
  readonly animated: boolean
}

export interface LetterboxEffect {
  readonly type: "letterbox"
  readonly ratio: number  // target aspect ratio as decimal (e.g. 2.35 for 2.35:1)
  readonly color: string  // bar color, default "#000000"
}

export interface MotionBlurEffect {
  readonly type: "motion-blur"
  readonly shutterAngle: number  // 0 - 360
  readonly samples: number       // 1 - 16
}

export type AfterEffect =
  | ColorGradeEffect
  | VignetteEffect
  | FilmGrainEffect
  | NoiseOverlayEffect
  | LetterboxEffect
  | MotionBlurEffect

export interface AfterEffectsTextOverlay {
  readonly id: string
  readonly text: string
  readonly startFrame: number
  readonly durationInFrames: number
  readonly position: "top" | "center" | "bottom"
  readonly fontSize: number
  readonly fontFamily?: string
  readonly color: string
  readonly animation: "fade" | "slide-up" | "typewriter" | "none"
}

export interface AfterEffectsPlan {
  readonly planType: "after-effects"
  readonly fps: number
  readonly width: number
  readonly height: number
  readonly durationInFrames: number
  readonly sourceVideo: string
  readonly effects: AfterEffect[]
  readonly textOverlays?: AfterEffectsTextOverlay[]
}

// Union type for all composer plans (extend as more composers are added)
export type ComposerPlanType = "scene-graph" | "after-effects"
