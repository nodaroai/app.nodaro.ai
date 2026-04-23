/**
 * Canonical catalog of Pose / posture + action choices.
 *
 * Single-pick parameter node — user picks ONE pose that describes the
 * subject's body position + action. Covers both static poses ("standing
 * upright") and dynamic action ("mid-stride, running").
 *
 * Separate from:
 *  - Framing → Vantage (azimuth of camera around subject, not subject pose)
 *  - Camera Motion (how the camera moves, not the subject)
 *
 * Applies to both image and video consumers (pose describes the subject,
 * not video-specific). Not in STILL_IMAGE_EXCLUDE_TYPES.
 *
 * Includes pre/post free-text fields (same pattern as Person) for
 * specifics the catalog can't express ("mid-fall, arms flailing", etc.).
 *
 * Shared between the picker UI, the standalone Pose parameter node, and
 * the prompt-hint injection on both the frontend DAG executor and the
 * backend orchestrator.
 */

export type PoseCategory =
  | "standing"
  | "seated"
  | "movement"
  | "action"
  | "resting"

export interface Pose {
  readonly id: string
  readonly label: string
  readonly category: PoseCategory
  readonly description: string
  readonly promptHint: string
}

export const POSES: ReadonlyArray<Pose> = [
  // -------------------- Standing --------------------
  { id: "standing-upright",   label: "Standing Upright",   category: "standing", description: "Relaxed standing posture",    promptHint: "standing upright in a relaxed natural posture" },
  { id: "confident-stance",   label: "Confident Stance",   category: "standing", description: "Feet apart, shoulders back",  promptHint: "standing in a confident stance with feet apart, shoulders back, and head up" },
  { id: "hands-on-hips",      label: "Hands on Hips",      category: "standing", description: "Hands on hips",               promptHint: "standing with hands on hips" },
  { id: "arms-crossed",       label: "Arms Crossed",       category: "standing", description: "Arms folded across chest",    promptHint: "standing with arms crossed over the chest" },
  { id: "leaning",            label: "Leaning",            category: "standing", description: "Leaning against something",   promptHint: "leaning casually against a wall or surface" },
  { id: "hero-pose",          label: "Hero Pose",          category: "standing", description: "Dramatic heroic stance",      promptHint: "standing in a dramatic heroic pose, chest out, looking forward with purpose" },

  // -------------------- Seated --------------------
  { id: "sitting",            label: "Sitting",            category: "seated",   description: "Sitting naturally",           promptHint: "sitting naturally" },
  { id: "cross-legged",       label: "Cross-legged",       category: "seated",   description: "Seated cross-legged on floor", promptHint: "sitting cross-legged on the ground" },
  { id: "kneeling",           label: "Kneeling",           category: "seated",   description: "Kneeling on the ground",      promptHint: "kneeling on one or both knees" },
  { id: "crouching",          label: "Crouching",          category: "seated",   description: "Crouched low",                promptHint: "crouched low with knees bent" },
  { id: "lounging",           label: "Lounging",           category: "seated",   description: "Reclined, relaxed sitting",   promptHint: "lounging in a relaxed, reclined position" },

  // -------------------- Movement --------------------
  { id: "walking",            label: "Walking",            category: "movement", description: "Mid-stride walking",          promptHint: "walking, caught mid-stride" },
  { id: "running",            label: "Running",            category: "movement", description: "Mid-run, in motion",          promptHint: "running, caught mid-stride in motion" },
  { id: "jumping",            label: "Jumping",            category: "movement", description: "Airborne, mid-jump",          promptHint: "mid-jump, suspended in the air" },
  { id: "dancing",            label: "Dancing",            category: "movement", description: "Caught mid-dance",            promptHint: "dancing, caught in mid-movement with fluid grace" },
  { id: "climbing",           label: "Climbing",           category: "movement", description: "Climbing, gripping upward",   promptHint: "climbing with arms extended, gripping upward" },

  // -------------------- Action --------------------
  { id: "fighting-stance",    label: "Fighting Stance",    category: "action",   description: "Combat-ready stance",         promptHint: "in a combat-ready fighting stance, tensed and focused" },
  { id: "reaching",           label: "Reaching",           category: "action",   description: "Reaching outward",            promptHint: "reaching outward with one arm extended" },
  { id: "throwing",           label: "Throwing",           category: "action",   description: "Mid-throw motion",            promptHint: "caught mid-throw, body coiled and releasing" },
  { id: "leaping",            label: "Leaping",            category: "action",   description: "Leaping forward dynamically", promptHint: "leaping forward dynamically with body extended" },
  { id: "dramatic-action",    label: "Dramatic Action",    category: "action",   description: "Exaggerated action pose",     promptHint: "in a dramatic, exaggerated action pose full of motion" },

  // -------------------- Resting --------------------
  { id: "lying-down",         label: "Lying Down",         category: "resting",  description: "Lying flat",                  promptHint: "lying down flat, relaxed" },
  { id: "sleeping",           label: "Sleeping",           category: "resting",  description: "Eyes closed, sleeping",       promptHint: "sleeping peacefully with eyes closed" },
  { id: "hugging",            label: "Hugging",            category: "resting",  description: "Embracing another",           promptHint: "hugging or embracing another person" },
  { id: "looking-away",       label: "Looking Away",       category: "resting",  description: "Head turned, looking away",   promptHint: "head turned, looking off away from the camera" },
] as const

const poseById = new Map<string, Pose>(POSES.map((p) => [p.id, p]))

export function getPose(id: string | undefined | null): Pose | undefined {
  if (!id) return undefined
  return poseById.get(id)
}

export function getPoseLabel(id: string | undefined | null, fallback?: string): string {
  const p = getPose(id)
  if (p) return p.label
  if (fallback !== undefined) return fallback
  return (id ?? "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getPosePromptHint(id: string | undefined | null): string {
  return getPose(id)?.promptHint ?? ""
}

export const POSE_IDS: ReadonlyArray<string> = POSES.map((p) => p.id)

export const POSE_CATEGORY_LABELS: Readonly<Record<PoseCategory, string>> = {
  standing: "Standing",
  seated: "Seated",
  movement: "Movement",
  action: "Action",
  resting: "Resting",
}

export const POSE_CATEGORY_ORDER: ReadonlyArray<PoseCategory> = [
  "standing",
  "seated",
  "movement",
  "action",
  "resting",
]

/**
 * Shape of Pose parameter data. Single-pick + optional pre/post free text.
 */
export interface PoseValue {
  pose?: string
  preText?: string
  postText?: string
}

/**
 * Build prompt hints from PoseData: optional pre-text, the selected pose's
 * hint, optional post-text. Returns array — caller joins with ", ".
 */
export function buildPoseHints(
  data: Record<string, unknown> & PoseValue,
): string[] {
  const hints: string[] = []

  const pre = typeof data.preText === "string" ? data.preText.trim() : ""
  if (pre) hints.push(pre)

  const poseId = typeof data.pose === "string" ? data.pose : ""
  const poseHint = getPosePromptHint(poseId)
  if (poseHint) hints.push(poseHint)

  const post = typeof data.postText === "string" ? data.postText.trim() : ""
  if (post) hints.push(post)

  return hints
}
