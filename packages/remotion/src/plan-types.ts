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
  readonly noiseType?: "perlin" | "simplex"
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

export interface AnimatedBlurEffect {
  readonly type: "animated-blur"
  readonly startBlur: number       // 0-50 pixels
  readonly endBlur: number         // 0-50 pixels
  readonly startFrame: number
  readonly durationFrames: number
  readonly easing?: "linear" | "easeIn" | "easeOut" | "easeInOut"
}

export interface TrailEffect {
  readonly type: "trail"
  readonly layers: number        // 1-10 integer
  readonly lagInFrames: number   // 0.5-5
  readonly trailOpacity: number  // 0-1
}

export type AfterEffect =
  | ColorGradeEffect
  | VignetteEffect
  | FilmGrainEffect
  | NoiseOverlayEffect
  | LetterboxEffect
  | MotionBlurEffect
  | AnimatedBlurEffect
  | TrailEffect

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

// ── Lottie Overlay Plan Types ─────────────────────────────────────────

export interface LottieOverlayPosition {
  readonly x: number      // 0–100 (left %)
  readonly y: number      // 0–100 (top %)
  readonly width: number   // 0–100 (% of composition width)
  readonly height: number  // 0–100 (% of composition height)
}

export interface LottieOverlayItem {
  readonly id: string
  readonly src: string
  readonly startFrame: number
  readonly durationInFrames: number
  readonly position: LottieOverlayPosition
  readonly opacity: number        // 0–1
  readonly playbackRate: number   // 0.1–3.0
  readonly loop: boolean
  readonly renderer?: "svg" | "canvas" | "html"
}

export interface LottieOverlayPlan {
  readonly planType: "lottie-overlay"
  readonly fps: number
  readonly width: number
  readonly height: number
  readonly durationInFrames: number
  readonly sourceVideo: string
  readonly overlays: LottieOverlayItem[]
}

// ── 3D Title Plan Types ──────────────────────────────────────────────

export interface ThreeDTitleCameraAnimation {
  readonly type: "orbit" | "dolly" | "static"
  readonly startPosition: [number, number, number]
  readonly endPosition: [number, number, number]
  readonly easing?: string
}

export interface ThreeDTitleCamera {
  readonly fov: number
  readonly position: [number, number, number]
  readonly lookAt: [number, number, number]
  readonly animation?: ThreeDTitleCameraAnimation
}

export interface ThreeDTitleAmbientLight {
  readonly intensity: number
  readonly color: string
}

export interface ThreeDTitleDirectionalLight {
  readonly intensity: number
  readonly color: string
  readonly position: [number, number, number]
}

export interface ThreeDTitleLighting {
  readonly ambient: ThreeDTitleAmbientLight
  readonly directional: ThreeDTitleDirectionalLight[]
}

export interface ThreeDTextMaterial {
  readonly type: "metallic" | "glass" | "emissive" | "standard"
  readonly color: string
  readonly metalness?: number
  readonly roughness?: number
  readonly emissiveIntensity?: number
}

export interface ThreeDTextAnimation {
  readonly type: "rotate-in" | "scale-up" | "fade-in" | "slide-in" | "none"
  readonly axis?: "x" | "y" | "z"
  readonly startFrame: number
  readonly durationFrames: number
  readonly easing?: string
}

export interface ThreeDTextObject {
  readonly id: string
  readonly type: "3d-text"
  readonly text: string
  readonly font: string
  readonly size: number
  readonly depth: number
  readonly material: ThreeDTextMaterial
  readonly position: [number, number, number]
  readonly animation: ThreeDTextAnimation
}

export interface ParticleSystemObject {
  readonly id: string
  readonly type: "particle-system"
  readonly count: number
  readonly size: number
  readonly color: string
  readonly spread: [number, number, number]
  readonly speed: number
  readonly opacity: number
}

export type ThreeDTitleObject = ThreeDTextObject | ParticleSystemObject

export interface ThreeDTitlePlan {
  readonly planType: "3d-title"
  readonly fps: number
  readonly width: number
  readonly height: number
  readonly durationInFrames: number
  readonly backgroundColor: string
  readonly backgroundMedia?: string
  readonly camera: ThreeDTitleCamera
  readonly lighting: ThreeDTitleLighting
  readonly objects: ThreeDTitleObject[]
}

// ── Motion Graphics Plan Types ──────────────────────────────────────

export interface MGElementAnimation {
  readonly type: "wipe-in" | "scale-up" | "fade" | "draw-path" | "slide-up" | "slide-down" | "slide-left" | "slide-right" | "none"
  readonly direction?: "left" | "right" | "up" | "down"
  readonly startFrame: number
  readonly durationFrames: number
  readonly easing?: "linear" | "easeIn" | "easeOut" | "easeInOut" | "spring"
}

export interface MGShapeElement {
  readonly id: string
  readonly type: "shape"
  readonly shape: "rectangle" | "circle" | "line"
  readonly fill?: string
  readonly stroke?: string
  readonly strokeWidth?: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly cornerRadius?: number
  readonly opacity?: number
  readonly animation: MGElementAnimation
}

export interface MGTextElement {
  readonly id: string
  readonly type: "text"
  readonly text: string
  readonly fontFamily: string
  readonly fontSize: number
  readonly fontWeight?: number
  readonly color: string
  readonly x: number
  readonly y: number
  readonly letterSpacing?: number
  readonly opacity?: number
  readonly animation: MGElementAnimation
}

export interface MGSvgPathElement {
  readonly id: string
  readonly type: "svg-path"
  readonly path: string
  readonly stroke: string
  readonly strokeWidth: number
  readonly fill?: string
  readonly x: number
  readonly y: number
  readonly opacity?: number
  readonly animation: MGElementAnimation
}

export type MGElement = MGShapeElement | MGTextElement | MGSvgPathElement

export interface MGExitAnimation {
  readonly type: "fade" | "slide-down" | "slide-up" | "slide-left" | "slide-right" | "none"
  readonly startFrame: number
  readonly durationFrames: number
}

export interface MotionGraphicsPlan {
  readonly planType: "motion-graphics"
  readonly fps: number
  readonly width: number
  readonly height: number
  readonly durationInFrames: number
  readonly backgroundColor: string
  readonly elements: MGElement[]
  readonly exitAnimation?: MGExitAnimation
}

// Union type for all composer plans (extend as more composers are added)
export type ComposerPlanType = "scene-graph" | "after-effects" | "lottie-overlay" | "3d-title" | "motion-graphics"
