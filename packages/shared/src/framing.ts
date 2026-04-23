/**
 * Canonical catalog of framing / shot composition choices.
 *
 * Complements `camera-motions.ts`: motion is HOW the camera moves, framing is
 * WHAT the camera sees and from WHICH angle. They're independent dimensions
 * of a shot — users can pick both (e.g. "Dolly In" + "Medium Close-up").
 *
 * Shared between the picker UI and the prompt-hint injection on both the
 * frontend DAG executor and the backend orchestrator.
 */

export type FramingCategory =
  | "shot-size"
  | "angle"
  | "coverage"
  | "composition"
  | "vantage"

export interface Framing {
  readonly id: string
  readonly label: string
  readonly category: FramingCategory
  readonly description: string
  readonly promptHint: string
}

export const FRAMINGS: ReadonlyArray<Framing> = [
  // Shot size (how much of the subject is in frame)
  {
    id: "extreme-wide-shot",
    label: "Extreme Wide Shot",
    category: "shot-size",
    description: "Subject tiny in vast environment",
    promptHint: "extreme wide shot, subject very small within a vast landscape, environment dominates",
  },
  {
    id: "wide-shot",
    label: "Wide Shot",
    category: "shot-size",
    description: "Full body with surroundings",
    promptHint: "wide shot, full body of the subject with visible surroundings",
  },
  {
    id: "medium-wide-shot",
    label: "Medium Wide",
    category: "shot-size",
    description: "Subject from the knees up",
    promptHint: "medium wide shot, subject framed from the knees up",
  },
  {
    id: "medium-shot",
    label: "Medium Shot",
    category: "shot-size",
    description: "Subject from the waist up",
    promptHint: "medium shot, subject framed from the waist up",
  },
  {
    id: "medium-close-up",
    label: "Medium Close-up",
    category: "shot-size",
    description: "Subject from the chest up",
    promptHint: "medium close-up, subject framed from the chest up",
  },
  {
    id: "close-up",
    label: "Close-up",
    category: "shot-size",
    description: "Subject's face filling frame",
    promptHint: "close-up shot, the subject's face fills the frame",
  },
  {
    id: "extreme-close-up",
    label: "Extreme Close-up",
    category: "shot-size",
    description: "Tight detail of face feature",
    promptHint: "extreme close-up, tight on a single feature of the face such as the eyes or mouth",
  },
  {
    id: "insert",
    label: "Insert",
    category: "shot-size",
    description: "Detail shot of an object",
    promptHint: "insert shot, tight on a specific object or detail relevant to the scene",
  },
  {
    id: "macro",
    label: "Macro",
    category: "shot-size",
    description: "Extreme close detail of a small subject",
    promptHint: "macro shot, extreme close-up of fine detail filling the frame, magnifying small subject features",
  },
  {
    id: "full-shot",
    label: "Full Shot",
    category: "shot-size",
    description: "Whole body head-to-toe in frame",
    promptHint: "full shot, the subject's entire body framed head to toe with minimal headroom and footroom",
  },

  // Angle (camera height / orientation)
  {
    id: "eye-level",
    label: "Eye Level",
    category: "angle",
    description: "Camera at subject's eye height",
    promptHint: "eye level shot, camera at the same height as the subject's eyes, neutral perspective",
  },
  {
    id: "high-angle",
    label: "High Angle",
    category: "angle",
    description: "Camera above subject looking down",
    promptHint: "high angle shot, camera positioned above the subject looking down at them",
  },
  {
    id: "low-angle",
    label: "Low Angle",
    category: "angle",
    description: "Camera below subject looking up",
    promptHint: "low angle shot, camera positioned below the subject looking up, making them feel powerful",
  },
  {
    id: "overhead",
    label: "Overhead",
    category: "angle",
    description: "Direct top-down god's eye view",
    promptHint: "overhead shot, direct top-down god's eye view looking straight down at the scene",
  },
  {
    id: "worms-eye-angle",
    label: "Worm's Eye",
    category: "angle",
    description: "Extreme low angle from the ground",
    promptHint: "worm's eye view, extreme low angle from ground level looking up",
  },
  {
    id: "dutch-angle",
    label: "Dutch Angle",
    category: "angle",
    description: "Tilted canted horizon",
    promptHint: "Dutch angle shot, the camera rolled so the horizon is canted, conveying tension or unease",
  },
  {
    id: "birds-eye",
    label: "Bird's Eye",
    category: "angle",
    description: "High aerial overhead view",
    promptHint: "bird's eye view, high aerial perspective looking down on the scene from far above",
  },

  // Coverage (dialog / multi-subject framing)
  {
    id: "single",
    label: "Single",
    category: "coverage",
    description: "Clean shot of one subject",
    promptHint: "single shot, clean framing of one subject with nothing else in frame",
  },
  {
    id: "two-shot",
    label: "Two-Shot",
    category: "coverage",
    description: "Both subjects in frame",
    promptHint: "two-shot, both subjects in frame at roughly equal prominence",
  },
  {
    id: "three-shot",
    label: "Three-Shot",
    category: "coverage",
    description: "Three subjects in frame",
    promptHint: "three-shot, three subjects in the same frame",
  },
  {
    id: "over-the-shoulder-framing",
    label: "Over The Shoulder",
    category: "coverage",
    description: "Past one subject's shoulder onto another",
    promptHint: "over the shoulder framing, camera looks past one character's shoulder onto the subject opposite them",
  },
  {
    id: "reverse-shot",
    label: "Reverse Shot",
    category: "coverage",
    description: "Opposite POV to previous shot",
    promptHint: "reverse shot, camera on the opposite side of the conversation from the previous framing",
  },
  {
    id: "pov-framing",
    label: "POV",
    category: "coverage",
    description: "Through subject's eyes",
    promptHint: "POV framing, scene viewed through the subject's own eyes, first person perspective",
  },

  // Composition (where the subject sits in the frame)
  {
    id: "rule-of-thirds",
    label: "Rule of Thirds",
    category: "composition",
    description: "Subject on a thirds intersection",
    promptHint: "rule of thirds composition, subject placed on a thirds intersection for natural balance",
  },
  {
    id: "centered",
    label: "Centered",
    category: "composition",
    description: "Subject dead center, symmetrical",
    promptHint: "centered composition, subject positioned exactly in the middle of the frame, symmetrical",
  },
  {
    id: "headroom-tight",
    label: "Headroom Tight",
    category: "composition",
    description: "Subject's head near top of frame",
    promptHint: "tight headroom, subject's head positioned near the top of the frame with little space above",
  },
  {
    id: "negative-space",
    label: "Negative Space",
    category: "composition",
    description: "Subject offset with empty space",
    promptHint: "negative space composition, subject offset to one side with a large area of empty space opposite",
  },
  {
    id: "leading-lines",
    label: "Leading Lines",
    category: "composition",
    description: "Lines draw eye to subject",
    promptHint: "leading lines composition, environmental lines converge toward the subject to draw the viewer's eye",
  },

  // Vantage (horizontal camera direction — azimuth around subject)
  {
    id: "front-on",
    label: "Front-on",
    category: "vantage",
    description: "Subject facing camera",
    promptHint: "front-on shot, subject facing the camera directly",
  },
  {
    id: "three-quarter-front",
    label: "Three-Quarter Front",
    category: "vantage",
    description: "Slightly off-axis from front",
    promptHint: "three-quarter view of the subject, camera slightly off-axis from the front",
  },
  {
    id: "profile-left",
    label: "Profile Left",
    category: "vantage",
    description: "Side view, subject's left",
    promptHint: "profile shot from the subject's left side",
  },
  {
    id: "profile-right",
    label: "Profile Right",
    category: "vantage",
    description: "Side view, subject's right",
    promptHint: "profile shot from the subject's right side",
  },
  {
    id: "three-quarter-back",
    label: "Three-Quarter Back",
    category: "vantage",
    description: "Off-axis from behind",
    promptHint: "three-quarter view from behind, camera angled off-axis from the rear",
  },
  {
    id: "behind",
    label: "Behind",
    category: "vantage",
    description: "Direct rear view",
    promptHint: "shot from directly behind the subject, looking at their back",
  },
]

export const FRAMING_CATEGORY_ORDER: ReadonlyArray<FramingCategory> = [
  "shot-size",
  "angle",
  "coverage",
  "composition",
  "vantage",
]

export const FRAMING_CATEGORY_LABELS: Record<FramingCategory, string> = {
  "shot-size": "Shot Size",
  angle: "Angle",
  coverage: "Coverage",
  composition: "Composition",
  vantage: "Vantage",
}

const framingById = new Map<string, Framing>(FRAMINGS.map((f) => [f.id, f]))

export function getFraming(id: string | undefined | null): Framing | undefined {
  if (!id) return undefined
  return framingById.get(id)
}

export function getFramingLabel(id: string | undefined | null, fallback?: string): string {
  const f = getFraming(id)
  if (f) return f.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getFramingPromptHint(id: string | undefined | null): string {
  return getFraming(id)?.promptHint ?? ""
}

export const FRAMING_IDS: ReadonlyArray<string> = FRAMINGS.map((f) => f.id)

export function isVantageFraming(id: string | undefined | null): boolean {
  return getFraming(id)?.category === "vantage"
}

/**
 * Maps each FramingCategory to the consumer data field name that holds the
 * selected entry id for that category. Multi-category framing: a consumer
 * (image/video) can independently set a value in each of the 5 dimensions.
 */
export const FRAMING_FIELD_BY_CATEGORY: Record<
  FramingCategory,
  "shotSize" | "angle" | "coverage" | "composition" | "vantage"
> = {
  "shot-size": "shotSize",
  angle: "angle",
  coverage: "coverage",
  composition: "composition",
  vantage: "vantage",
}

/**
 * Shape of the per-category framing fields on FramingData and all 9 consumer
 * data types. All fields optional — user may set zero, one, or all categories.
 */
export interface FramingValue {
  shotSize?: string
  angle?: string
  coverage?: string
  composition?: string
  vantage?: string
}

/**
 * Aggregate all enabled per-category framing prompt hints from a consumer's
 * data, in canonical category order (shot-size, angle, coverage, composition,
 * vantage).
 *
 * Accepts a loosely typed record (the helper is shared between strongly typed
 * frontend node data and the backend's `Record<string, unknown>` workflow
 * data). Non-string values are ignored.
 *
 * @param data the consumer data record (must include optional shotSize / angle
 *   / coverage / composition / vantage fields)
 * @param skipVantage when true, skip the vantage hint (used by video consumers
 *   where camera-motion v2 already declares spatial positioning — keeps the
 *   pre-existing conflict-resolution behavior identical).
 */
export function buildFramingHints(
  data: Record<string, unknown> & {
    shotSize?: unknown
    angle?: unknown
    coverage?: unknown
    composition?: unknown
    vantage?: unknown
  },
  skipVantage = false,
): string[] {
  const hints: string[] = []
  for (const category of FRAMING_CATEGORY_ORDER) {
    if (category === "vantage" && skipVantage) continue
    const field = FRAMING_FIELD_BY_CATEGORY[category]
    const id = data[field]
    if (typeof id !== "string" || id.length === 0) continue
    const hint = getFramingPromptHint(id)
    if (hint) hints.push(hint)
  }
  return hints
}
