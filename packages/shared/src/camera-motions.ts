/**
 * Canonical catalog of camera motions for video / image-to-video generation.
 *
 * Shared between frontend (picker UI, prompt hint injection) and backend
 * (orchestrator payload builder). The `promptHint` is a natural-language
 * cue that gets appended to the user prompt when the node has camera
 * motion enabled.
 */

export type CameraMotionCategory =
  | "default"
  | "pan"
  | "tilt"
  | "zoom"
  | "dolly"
  | "truck"
  | "pedestal"
  | "roll"
  | "orbit"
  | "crane"
  | "tracking"
  | "special"

export interface CameraMotion {
  readonly id: string
  readonly label: string
  readonly category: CameraMotionCategory
  readonly description: string
  readonly promptHint: string
}

export const CAMERA_MOTIONS: ReadonlyArray<CameraMotion> = [
  // Basic
  {
    id: "auto",
    label: "Auto",
    category: "default",
    description: "Let the model choose appropriate camera motion",
    promptHint: "",
  },
  {
    id: "static",
    label: "Static",
    category: "default",
    description: "Fixed camera, no movement",
    promptHint: "locked off static camera, no camera movement",
  },
  {
    id: "handheld",
    label: "Handheld",
    category: "default",
    description: "Natural handheld shake",
    promptHint: "handheld camera with subtle natural shake and micro movements",
  },
  {
    id: "steadicam",
    label: "Steadicam",
    category: "default",
    description: "Smooth stabilized walking shot",
    promptHint: "smooth steadicam shot, gliding stabilized movement through the scene",
  },

  // Pan — rotation on vertical axis
  {
    id: "pan-left",
    label: "Pan Left",
    category: "pan",
    description: "Rotate camera horizontally to the left",
    promptHint: "slow camera pan left, rotating horizontally",
  },
  {
    id: "pan-right",
    label: "Pan Right",
    category: "pan",
    description: "Rotate camera horizontally to the right",
    promptHint: "slow camera pan right, rotating horizontally",
  },
  {
    id: "whip-pan-left",
    label: "Whip Pan Left",
    category: "pan",
    description: "Fast whip pan left with motion blur",
    promptHint: "fast whip pan to the left with heavy motion blur",
  },
  {
    id: "whip-pan-right",
    label: "Whip Pan Right",
    category: "pan",
    description: "Fast whip pan right with motion blur",
    promptHint: "fast whip pan to the right with heavy motion blur",
  },

  // Tilt — rotation on horizontal axis
  {
    id: "tilt-up",
    label: "Tilt Up",
    category: "tilt",
    description: "Tilt camera upward",
    promptHint: "camera tilts upward, revealing upward from the ground",
  },
  {
    id: "tilt-down",
    label: "Tilt Down",
    category: "tilt",
    description: "Tilt camera downward",
    promptHint: "camera tilts downward, revealing downward from above",
  },

  // Zoom — lens only
  {
    id: "zoom-in",
    label: "Zoom In",
    category: "zoom",
    description: "Lens zoom toward subject",
    promptHint: "slow zoom in on the subject, fixed camera position",
  },
  {
    id: "zoom-out",
    label: "Zoom Out",
    category: "zoom",
    description: "Lens zoom away from subject",
    promptHint: "slow zoom out, fixed camera position",
  },
  {
    id: "crash-zoom-in",
    label: "Crash Zoom In",
    category: "zoom",
    description: "Very fast dramatic zoom in",
    promptHint: "fast crash zoom in, sudden dramatic zoom toward subject",
  },
  {
    id: "crash-zoom-out",
    label: "Crash Zoom Out",
    category: "zoom",
    description: "Very fast dramatic zoom out",
    promptHint: "fast crash zoom out, sudden dramatic pull back",
  },

  // Dolly — physical forward/back
  {
    id: "dolly-in",
    label: "Dolly In",
    category: "dolly",
    description: "Push camera toward subject (parallax)",
    promptHint: "dolly in, camera pushes forward toward the subject with natural parallax",
  },
  {
    id: "dolly-out",
    label: "Dolly Out",
    category: "dolly",
    description: "Pull camera away (parallax)",
    promptHint: "dolly out, camera pulls back away from the subject with natural parallax",
  },
  {
    id: "dolly-zoom",
    label: "Dolly Zoom",
    category: "dolly",
    description: "Vertigo effect: dolly opposes zoom",
    promptHint: "dolly zoom vertigo effect, background scale changes while subject stays the same size",
  },
  {
    id: "push-in",
    label: "Push In",
    category: "dolly",
    description: "Slow subtle push toward subject",
    promptHint: "slow push in, gentle forward movement toward the subject",
  },
  {
    id: "pull-out",
    label: "Pull Out",
    category: "dolly",
    description: "Slow subtle pull back from subject",
    promptHint: "slow pull out, gentle backward movement away from the subject",
  },

  // Truck — lateral slide
  {
    id: "truck-left",
    label: "Truck Left",
    category: "truck",
    description: "Slide camera body laterally left",
    promptHint: "truck left, camera slides laterally to the left",
  },
  {
    id: "truck-right",
    label: "Truck Right",
    category: "truck",
    description: "Slide camera body laterally right",
    promptHint: "truck right, camera slides laterally to the right",
  },

  // Pedestal — vertical slide
  {
    id: "pedestal-up",
    label: "Pedestal Up",
    category: "pedestal",
    description: "Raise camera body vertically",
    promptHint: "pedestal up, camera rises vertically while keeping the horizon level",
  },
  {
    id: "pedestal-down",
    label: "Pedestal Down",
    category: "pedestal",
    description: "Lower camera body vertically",
    promptHint: "pedestal down, camera descends vertically while keeping the horizon level",
  },

  // Roll — rotation on lens axis
  {
    id: "roll-left",
    label: "Roll Left",
    category: "roll",
    description: "Rotate camera counterclockwise",
    promptHint: "camera rolls counterclockwise around the lens axis",
  },
  {
    id: "roll-right",
    label: "Roll Right",
    category: "roll",
    description: "Rotate camera clockwise",
    promptHint: "camera rolls clockwise around the lens axis",
  },
  {
    id: "dutch-angle",
    label: "Dutch Angle",
    category: "roll",
    description: "Static tilted frame for tension",
    promptHint: "dutch angle, canted tilted frame for tension",
  },

  // Orbit / Arc
  {
    id: "orbit-left",
    label: "Orbit Left",
    category: "orbit",
    description: "Full circle around subject to the left",
    promptHint: "camera orbits around the subject to the left in a circular path",
  },
  {
    id: "orbit-right",
    label: "Orbit Right",
    category: "orbit",
    description: "Full circle around subject to the right",
    promptHint: "camera orbits around the subject to the right in a circular path",
  },
  {
    id: "arc-left",
    label: "Arc Left",
    category: "orbit",
    description: "Partial arc around subject left",
    promptHint: "camera arcs to the left around the subject",
  },
  {
    id: "arc-right",
    label: "Arc Right",
    category: "orbit",
    description: "Partial arc around subject right",
    promptHint: "camera arcs to the right around the subject",
  },

  // Crane / Jib
  {
    id: "crane-up",
    label: "Crane Up",
    category: "crane",
    description: "Sweeping crane rise revealing scene",
    promptHint: "crane up, camera rises on a jib revealing the wider scene",
  },
  {
    id: "crane-down",
    label: "Crane Down",
    category: "crane",
    description: "Sweeping crane descent",
    promptHint: "crane down, camera descends from above toward the subject",
  },
  {
    id: "boom-up",
    label: "Boom Up",
    category: "crane",
    description: "Boom arm rise",
    promptHint: "boom up, camera lifts on a boom arm while keeping subject framed",
  },
  {
    id: "boom-down",
    label: "Boom Down",
    category: "crane",
    description: "Boom arm descent",
    promptHint: "boom down, camera lowers on a boom arm while keeping subject framed",
  },

  // Tracking / Follow
  {
    id: "tracking-shot",
    label: "Tracking Shot",
    category: "tracking",
    description: "Camera tracks moving subject alongside",
    promptHint: "tracking shot, camera moves alongside the subject keeping them in frame",
  },
  {
    id: "follow",
    label: "Follow",
    category: "tracking",
    description: "Follow subject from behind",
    promptHint: "follow shot, camera trails the subject from behind at a constant distance",
  },
  {
    id: "lead",
    label: "Lead",
    category: "tracking",
    description: "Move ahead of advancing subject",
    promptHint: "lead shot, camera moves backward ahead of the advancing subject",
  },

  // Special angles / rigs
  {
    id: "pov",
    label: "POV",
    category: "special",
    description: "First person point of view",
    promptHint: "POV shot, first person perspective as seen through the subject's eyes",
  },
  {
    id: "over-the-shoulder",
    label: "Over The Shoulder",
    category: "special",
    description: "Frame past a character's shoulder",
    promptHint: "over the shoulder shot, framing past one character's shoulder onto another",
  },
  {
    id: "birds-eye",
    label: "Bird's Eye",
    category: "special",
    description: "Direct top-down overhead view",
    promptHint: "bird's eye view, direct overhead top-down shot looking straight down",
  },
  {
    id: "worms-eye",
    label: "Worm's Eye",
    category: "special",
    description: "Extreme low angle looking up",
    promptHint: "worm's eye view, extreme low angle looking up at the subject",
  },
  {
    id: "aerial",
    label: "Aerial",
    category: "special",
    description: "High altitude drone-style shot",
    promptHint: "aerial drone shot, high altitude slow forward movement over the landscape",
  },
  {
    id: "snorricam",
    label: "Snorricam",
    category: "special",
    description: "Body-mounted camera (subject locked to frame)",
    promptHint: "snorricam body-mounted shot, subject locked in frame while the world moves around them",
  },
]

export const CAMERA_MOTION_CATEGORY_ORDER: ReadonlyArray<CameraMotionCategory> = [
  "default",
  "pan",
  "tilt",
  "zoom",
  "dolly",
  "truck",
  "pedestal",
  "roll",
  "orbit",
  "crane",
  "tracking",
  "special",
]

export const CAMERA_MOTION_CATEGORY_LABELS: Record<CameraMotionCategory, string> = {
  default: "Basic",
  pan: "Pan",
  tilt: "Tilt",
  zoom: "Zoom",
  dolly: "Dolly",
  truck: "Truck",
  pedestal: "Pedestal",
  roll: "Roll",
  orbit: "Orbit & Arc",
  crane: "Crane & Boom",
  tracking: "Tracking",
  special: "Angles & Rigs",
}

const motionById = new Map<string, CameraMotion>(
  CAMERA_MOTIONS.map((m) => [m.id, m]),
)

export function getCameraMotion(id: string | undefined | null): CameraMotion | undefined {
  if (!id) return undefined
  return motionById.get(id)
}

/** Human-readable label for the given motion id. Falls back to the id if unknown. */
export function getCameraMotionLabel(id: string | undefined | null, fallback?: string): string {
  const m = getCameraMotion(id)
  if (m) return m.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Descriptive prompt hint for the given motion id. Empty string when motion is "auto" or unknown. */
export function getCameraMotionPromptHint(id: string | undefined | null): string {
  return getCameraMotion(id)?.promptHint ?? ""
}

export const CAMERA_MOTION_IDS: ReadonlyArray<string> = CAMERA_MOTIONS.map((m) => m.id)
