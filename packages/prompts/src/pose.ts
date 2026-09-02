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

import { resolveTerm, type PickerHintMode } from "./term.js"
import { overlayEntry } from "./catalog-overlay.js"

export type PoseCategory =
  | "standing"
  | "seated"
  | "movement"
  | "action"
  | "resting"
  | "hand-position"
  | "body-lean"
  | "head-tilt"
  | "activity"

export interface Pose {
  readonly id: string
  readonly label: string
  readonly category: PoseCategory
  readonly description: string
  readonly promptHint: string
  /**
   * W1-a minor-age floor (spec 2026-09-01 §3.3). `true` marks an entry whose
   * hint describes body exposure, sheer/wet clothing, swimwear/lingerie, a
   * seductive expression or gaze, or a body-placed tattoo. The fragment
   * collectors DROP flagged entries for a minor subject (`isMinorAge`), the
   * picker hides their tiles, the analyzer never emits them, and the backend
   * policy strips their wording from free text. Hand-curated; the
   * `adult-only-ratchet` test only ratchets. Never set on neutral defaults.
   */
  readonly adultOnly?: true
  /**
   * Compact professional term injected instead of `promptHint` in compact hint
   * mode. Authored only where the lowercased label is not what a photographer
   * would write for the pose — bare sub-dimension modifiers ("Tilted Side"),
   * labels that collide with a different meaning in a generation prompt
   * ("Painting"), and telegraphic UI phrasings ("Head Over Shoulder").
   * Everywhere else the derived label already IS the term.
   */
  readonly term?: string
}

export const POSES: ReadonlyArray<Pose> = [
  // -------------------- Standing --------------------
  { id: "standing-upright",   label: "Standing Upright",   category: "standing", description: "Relaxed standing posture",    promptHint: "standing upright in a relaxed natural posture" },
  { id: "confident-stance",   label: "Confident Stance",   category: "standing", description: "Feet apart, shoulders back",  promptHint: "standing in a confident stance with feet apart, shoulders back, and head up" },
  { id: "hands-on-hips",      label: "Hands on Hips",      category: "standing", description: "Hands on hips",               promptHint: "standing with hands on hips" },
  { id: "arms-crossed",       label: "Arms Crossed",       category: "standing", description: "Arms folded across chest",    promptHint: "standing with arms crossed over the chest" },
  { id: "leaning",            label: "Leaning",            category: "standing", description: "Leaning against something",   promptHint: "leaning casually against a wall or surface", term: "leaning casually against a surface" },
  { id: "hero-pose",          label: "Hero Pose",          category: "standing", description: "Dramatic heroic stance",      promptHint: "standing in a dramatic heroic pose, chest out, looking forward with purpose" },
  { id: "contrapposto",       label: "Contrapposto",       category: "standing", description: "Hip tilted, weight on one leg", promptHint: "standing in contrapposto, weight shifted to one leg with the opposite hip tilted out" },
  { id: "leaning-against-wall", label: "Leaning Against Wall", category: "standing", description: "Casually leaning on a wall", promptHint: "leaning casually against a wall, shoulder or back resting on the surface", term: "leaning against a wall" },
  { id: "hands-behind-head",  label: "Hands Behind Head",  category: "standing", description: "Both hands clasped behind head", promptHint: "standing with both hands clasped behind the head, elbows out", term: "hands clasped behind the head" },
  { id: "hands-behind-back",  label: "Hands Behind Back",  category: "standing", description: "Hands clasped behind back",   promptHint: "standing with hands clasped behind the back, posture upright", term: "hands clasped behind the back" },

  // -------------------- Seated --------------------
  { id: "sitting",            label: "Sitting",            category: "seated",   description: "Sitting naturally",           promptHint: "sitting naturally" },
  { id: "cross-legged",       label: "Cross-legged",       category: "seated",   description: "Seated cross-legged on floor", promptHint: "sitting cross-legged on the ground", term: "sitting cross-legged" },
  { id: "kneeling",           label: "Kneeling",           category: "seated",   description: "Kneeling on the ground",      promptHint: "kneeling on one or both knees" },
  { id: "crouching",          label: "Crouching",          category: "seated",   description: "Crouched low",                promptHint: "crouched low with knees bent" },
  { id: "lounging",           label: "Lounging",           category: "seated",   description: "Reclined, relaxed sitting",   promptHint: "lounging in a relaxed, reclined position" , adultOnly: true },
  { id: "sitting-edge-of-bed", label: "Sitting on Edge of Bed", category: "seated", description: "Perched on the edge of a bed", promptHint: "perched on the edge of a bed, hands resting on the mattress", term: "sitting on the edge of a bed" , adultOnly: true },
  { id: "chair-arm-drape",    label: "Legs Draped Over Chair", category: "seated", description: "Legs draped over chair arm", promptHint: "sitting sideways in a chair with legs draped casually over one arm", term: "legs draped over the chair arm" },
  { id: "elbow-propped",      label: "Cheek on Propped Elbow", category: "seated", description: "Cheek resting on a propped elbow", promptHint: "seated with cheek resting against a propped-up elbow, contemplative", term: "cheek resting on a propped elbow" },
  { id: "lying-on-stomach-reading", label: "Lying Prone Reading", category: "seated", description: "Lying prone, propped on elbows reading", promptHint: "lying on the stomach, propped up on elbows while reading", term: "lying prone propped on elbows, reading" },

  // -------------------- Movement --------------------
  { id: "walking",            label: "Walking",            category: "movement", description: "Mid-stride walking",          promptHint: "walking, caught mid-stride" },
  { id: "running",            label: "Running",            category: "movement", description: "Mid-run, in motion",          promptHint: "running, caught mid-stride in motion" },
  { id: "jumping",            label: "Jumping",            category: "movement", description: "Airborne, mid-jump",          promptHint: "mid-jump, suspended in the air" },
  { id: "dancing",            label: "Dancing",            category: "movement", description: "Caught mid-dance",            promptHint: "dancing, caught in mid-movement with fluid grace" },
  { id: "climbing",           label: "Climbing",           category: "movement", description: "Climbing, gripping upward",   promptHint: "climbing with arms extended, gripping upward" },
  { id: "mid-fall",           label: "Mid-Fall",           category: "movement", description: "Caught mid-fall through the air", promptHint: "caught mid-fall through the air, limbs loose, hair and clothing trailing" },
  { id: "mid-spin",           label: "Mid-Spin",           category: "movement", description: "Twirling, mid-rotation",      promptHint: "twirling mid-spin with hair and clothing fanning outward" },
  { id: "stretching",         label: "Stretching",         category: "movement", description: "Full-body stretch, arms overhead", promptHint: "in a full-body stretch with both arms reaching overhead" },
  { id: "reaching-up",        label: "Reaching Up",        category: "movement", description: "Arms extended overhead",      promptHint: "one or both arms extended overhead, reaching upward" },
  { id: "kissing",            label: "Kissing",            category: "movement", description: "Locked in a kiss",            promptHint: "locked in a kiss, faces close and eyes closed" },
  { id: "riding",             label: "Riding",             category: "movement", description: "Riding a bike, horse, or motorcycle", promptHint: "riding astride a bike, horse, or motorcycle, hands gripping forward", term: "riding astride" },
  { id: "driving",            label: "Driving",            category: "movement", description: "Behind the wheel of a vehicle", promptHint: "behind the wheel of a vehicle, hands on the steering wheel, gaze forward", term: "driving, hands on the wheel" },

  // -------------------- Action --------------------
  { id: "fighting-stance",    label: "Fighting Stance",    category: "action",   description: "Combat-ready stance",         promptHint: "in a combat-ready fighting stance, tensed and focused" },
  { id: "reaching",           label: "Reaching",           category: "action",   description: "Reaching outward",            promptHint: "reaching outward with one arm extended", term: "reaching outward, arm extended" },
  { id: "throwing",           label: "Throwing",           category: "action",   description: "Mid-throw motion",            promptHint: "caught mid-throw, body coiled and releasing", term: "caught mid-throw" },
  { id: "leaping",            label: "Leaping",            category: "action",   description: "Leaping forward dynamically", promptHint: "leaping forward dynamically with body extended" },
  { id: "dramatic-action",    label: "Dramatic Action",    category: "action",   description: "Exaggerated action pose",     promptHint: "in a dramatic, exaggerated action pose full of motion", term: "dramatic exaggerated action pose" },
  { id: "biting-lip",         label: "Biting Lip",         category: "action",   description: "Slight playful lip-bite",     promptHint: "lightly biting the lower lip, a subtle playful expression", term: "biting lower lip" , adultOnly: true },
  { id: "mid-laugh",          label: "Mid-Laugh",          category: "action",   description: "Caught mid-laugh, head back", promptHint: "caught mid-laugh with head tipped back, eyes crinkled" },
  { id: "pointing-at-camera", label: "Pointing at Camera", category: "action",   description: "Pointing directly at camera", promptHint: "pointing one finger directly at the camera, arm extended", term: "pointing directly at the camera" },
  { id: "tongue-out",         label: "Sticking Tongue Out", category: "action",  description: "Playful tongue-out expression", promptHint: "sticking the tongue out playfully" },
  { id: "thinking",           label: "Thinking",           category: "action",   description: "Hand on chin, contemplative", promptHint: "in a thinking pose with hand on chin, gaze contemplative", term: "thinking pose, hand on chin" },

  // -------------------- Resting --------------------
  { id: "lying-down",         label: "Lying Down",         category: "resting",  description: "Lying flat",                  promptHint: "lying down flat, relaxed" , adultOnly: true },
  { id: "sleeping",           label: "Sleeping",           category: "resting",  description: "Eyes closed, sleeping",       promptHint: "sleeping peacefully with eyes closed" },
  { id: "hugging",            label: "Hugging",            category: "resting",  description: "Embracing another",           promptHint: "hugging or embracing another person" },
  { id: "looking-away",       label: "Looking Away",       category: "resting",  description: "Head turned, looking away",   promptHint: "head turned, looking off away from the camera" },
  { id: "looking-up",         label: "Looking Up",         category: "resting",  description: "Gazing up at the sky",        promptHint: "gazing upward at the sky or off-camera, chin slightly raised" },
  { id: "looking-down",       label: "Looking Down",       category: "resting",  description: "Eyes downcast",               promptHint: "eyes downcast, gaze turned softly to the ground" },
  { id: "head-over-shoulder", label: "Head Over Shoulder", category: "resting",  description: "Looking back over shoulder",  promptHint: "head turned to look back over one shoulder toward the camera", term: "looking back over the shoulder" },
  { id: "wading-in-water",    label: "Wading in Water",    category: "resting",  description: "Wading mid-thigh deep in water", promptHint: "wading mid-thigh deep through water, ripples around the legs" },

  // -------------------- Hand Position --------------------
  { id: "hands-in-pockets",        label: "Hands in Pockets",        category: "hand-position", description: "Both hands tucked in pockets",        promptHint: "with both hands tucked into pockets" },
  { id: "hand-on-hip",             label: "Hand on Hip",             category: "hand-position", description: "One hand on hip",                     promptHint: "with one hand resting on the hip" },
  { id: "hand-position-hands-on-hips", label: "Hands on Hips",       category: "hand-position", description: "Both hands on hips",                  promptHint: "with both hands planted on the hips", term: "both hands planted on the hips" },
  { id: "hand-on-chin",            label: "Hand on Chin",            category: "hand-position", description: "Hand resting under the chin",         promptHint: "with one hand resting under the chin, fingers framing the jaw" },
  { id: "hand-on-collarbone",      label: "Hand on Collarbone",      category: "hand-position", description: "Hand resting across collarbone",      promptHint: "with one hand resting lightly across the collarbone" },
  { id: "hand-brushing-hair",      label: "Hand Brushing Hair",      category: "hand-position", description: "Hand running through the hair",       promptHint: "with a hand running through the hair, fingers caught mid-strand", term: "hand running through the hair" },
  { id: "finger-to-lip",           label: "Finger to Lip",           category: "hand-position", description: "Fingertip pressed against lower lip", promptHint: "with one fingertip pressed gently against the lower lip", term: "fingertip pressed to the lower lip" },
  { id: "arms-wrapped-around-self", label: "Arms Wrapped Around Self", category: "hand-position", description: "Self-hug, arms around torso",       promptHint: "arms wrapped around the torso in a self-hug", term: "arms wrapped around the torso" },
  { id: "hands-clasped",           label: "Hands Clasped",           category: "hand-position", description: "Both hands clasped at the front",     promptHint: "with both hands clasped at the front", term: "hands clasped in front" },

  // -------------------- Body Lean --------------------
  { id: "leaning-back",            label: "Leaning Back",            category: "body-lean",     description: "Torso leaning back slightly",         promptHint: "with the torso leaning back at a slight backward angle", term: "torso leaning slightly back" },
  { id: "leaning-forward",         label: "Leaning Forward",         category: "body-lean",     description: "Torso leaning toward camera",         promptHint: "with the torso leaning forward toward the camera", term: "torso leaning forward" },
  { id: "body-lean-contrapposto",  label: "Contrapposto",            category: "body-lean",     description: "Weight on one leg, hip pushed out",   promptHint: "with the weight on one leg and one hip pushed out, classical contrapposto", term: "contrapposto, hip pushed out" },
  { id: "arched-back",             label: "Arched Back",             category: "body-lean",     description: "Back gently arched, chest forward",   promptHint: "with the back gently arched, chest forward" , adultOnly: true },
  { id: "shoulder-rolled-forward", label: "Shoulder Rolled Forward", category: "body-lean",     description: "One shoulder rolled forward",         promptHint: "with one shoulder rolled forward, asymmetric stance", term: "one shoulder rolled forward" },

  // -------------------- Head Tilt --------------------
  { id: "tilted-up",               label: "Tilted Up",               category: "head-tilt",     description: "Head tipped slightly upward",         promptHint: "with the head tipped slightly upward", term: "head tipped slightly up" },
  { id: "tilted-down",             label: "Tilted Down",             category: "head-tilt",     description: "Head tipped slightly downward",       promptHint: "with the head tipped slightly downward", term: "head tipped slightly down" },
  { id: "tilted-side",             label: "Tilted Side",             category: "head-tilt",     description: "Head tilted toward shoulder",         promptHint: "with the head tilted toward one shoulder", term: "head tilted toward one shoulder" },
  { id: "tilted-back",             label: "Tilted Back",             category: "head-tilt",     description: "Head fully back, throat exposed",     promptHint: "with the head tipped fully back, exposing the throat", term: "head tipped fully back" },
  { id: "chin-up",                 label: "Chin Up",                 category: "head-tilt",     description: "Chin lifted, looking down nose",      promptHint: "with the chin lifted, looking down the nose", term: "chin lifted" },
  { id: "chin-tucked",             label: "Chin Tucked",             category: "head-tilt",     description: "Chin tucked toward chest",            promptHint: "with the chin tucked toward the chest" },

  // -------------------- Activity (what the subject is doing in the world) --------------------
  { id: "activity-smoking",            label: "Smoking",            category: "activity",      description: "Holding and smoking a cigarette",     promptHint: "holding and smoking a cigarette, smoke curling up from the lit tip", term: "smoking a cigarette" },
  { id: "activity-drinking",           label: "Drinking",           category: "activity",      description: "Drinking from a glass or cup",        promptHint: "raising a glass or cup to the lips and drinking from it", term: "drinking from a glass" },
  { id: "activity-eating",             label: "Eating",             category: "activity",      description: "Caught mid-bite",                     promptHint: "caught mid-bite, eating with a piece of food halfway to the mouth" },
  { id: "activity-talking-on-phone",   label: "Talking on Phone",   category: "activity",      description: "Phone held to ear, speaking",         promptHint: "holding a phone to one ear and speaking into it, eyes focused mid-conversation", term: "talking on the phone" },
  { id: "activity-texting",            label: "Texting",            category: "activity",      description: "Looking down at phone, thumbs typing", promptHint: "looking down at a phone held in both hands, thumbs busy typing a message" },
  { id: "activity-typing-laptop",      label: "Typing on Laptop",   category: "activity",      description: "Hands on keyboard, focused on screen", promptHint: "typing at a laptop with hands on the keyboard, focused on the glowing screen", term: "typing on a laptop" },
  { id: "activity-reading",            label: "Reading",            category: "activity",      description: "Holding open a book or magazine",     promptHint: "holding open a book or magazine in both hands, eyes following the page" },
  { id: "activity-writing",            label: "Writing",            category: "activity",      description: "Writing in a notebook with a pen",    promptHint: "writing in a notebook, pen in hand, head bent slightly over the page", term: "writing in a notebook" },
  { id: "activity-painting",           label: "Painting",           category: "activity",      description: "Painting on a canvas with a brush",   promptHint: "painting on a canvas, brush in hand mid-stroke, palette held in the other", term: "painting on a canvas" },
  { id: "activity-playing-instrument", label: "Playing Instrument", category: "activity",      description: "Playing a musical instrument",        promptHint: "playing a musical instrument, hands and fingers engaged with strings or keys, fully absorbed in the performance", term: "playing a musical instrument" },
  { id: "activity-cooking",            label: "Cooking",            category: "activity",      description: "Cooking at a kitchen counter or stove", promptHint: "cooking at a kitchen counter or stove, hands actively working with food, steam rising from a pan" },
  { id: "activity-driving",            label: "Driving",            category: "activity",      description: "Behind the wheel, hands gripping",    promptHint: "behind the wheel of a vehicle, both hands on the steering wheel, gaze fixed on the road ahead", term: "behind the wheel of a vehicle" },
] as const

const poseById = new Map<string, Pose>(POSES.map((p) => [p.id, p]))

export function getPose(id: string | undefined | null): Pose | undefined {
  if (!id) return undefined
  return overlayEntry("pose", id, poseById.get(id))
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

/**
 * Compact counterpart of `getPosePromptHint`: the short professional term this
 * pose injects in compact hint mode ("mid-throw" where the hint is the full
 * body-mechanics sentence). Empty string for an unknown id and for any entry
 * that injects no hint at all.
 */
export function getPoseTerm(id: string | undefined | null): string {
  return resolveTerm(getPose(id))
}

export const POSE_IDS: ReadonlyArray<string> = POSES.map((p) => p.id)

export const POSE_CATEGORY_LABELS: Readonly<Record<PoseCategory, string>> = {
  standing: "Standing",
  seated: "Seated",
  movement: "Movement",
  action: "Action",
  resting: "Resting",
  "hand-position": "Hand Position",
  "body-lean": "Body Lean",
  "head-tilt": "Head Tilt",
  activity: "Activity",
}

export const POSE_CATEGORY_ORDER: ReadonlyArray<PoseCategory> = [
  "standing",
  "seated",
  "movement",
  "action",
  "resting",
  "hand-position",
  "body-lean",
  "head-tilt",
  "activity",
]

/**
 * Shape of Pose parameter data. Multi-dimensional: pose + optional
 * orthogonal sub-pickers (hand position / body lean / head tilt) + optional
 * pre/post free text.
 */
export interface PoseValue {
  pose?: string
  /** Optional hand-position pose id (orthogonal to pose). */
  handPosition?: string
  /** Optional body-lean pose id (orthogonal to pose). */
  bodyLean?: string
  /** Optional head-tilt pose id (orthogonal to pose). */
  headTilt?: string
  /** Optional activity pose id — what the subject is DOING in the world
   *  (smoking, eating, texting, driving…). Distinct from posture / movement /
   *  action; orthogonal to the other sub-pickers. */
  activity?: string
  preText?: string
  postText?: string
}

/**
 * Build prompt hints from PoseData: optional pre-text, the selected pose's
 * hint, the orthogonal hand-position / body-lean / head-tilt hints,
 * optional post-text. Returns array — caller joins with ", ".
 */
export function buildPoseHints(
  data: Record<string, unknown> & PoseValue,
  mode: PickerHintMode = "full",
): string[] {
  if (mode === "compact") return buildPoseTerms(data)
  const hints: string[] = []

  const pre = typeof data.preText === "string" ? data.preText.trim() : ""
  if (pre) hints.push(pre)

  const poseId = typeof data.pose === "string" ? data.pose : ""
  const poseHint = getPosePromptHint(poseId)
  if (poseHint) hints.push(poseHint)

  const handPositionId =
    typeof data.handPosition === "string" ? data.handPosition : ""
  const handPositionHint = getPosePromptHint(handPositionId)
  if (handPositionHint) hints.push(handPositionHint)

  const bodyLeanId = typeof data.bodyLean === "string" ? data.bodyLean : ""
  const bodyLeanHint = getPosePromptHint(bodyLeanId)
  if (bodyLeanHint) hints.push(bodyLeanHint)

  const headTiltId = typeof data.headTilt === "string" ? data.headTilt : ""
  const headTiltHint = getPosePromptHint(headTiltId)
  if (headTiltHint) hints.push(headTiltHint)

  const activityId = typeof data.activity === "string" ? data.activity : ""
  const activityHint = getPosePromptHint(activityId)
  if (activityHint) hints.push(activityHint)

  const post = typeof data.postText === "string" ? data.postText.trim() : ""
  if (post) hints.push(post)

  return hints
}

/**
 * Compact counterpart of `buildPoseHints`: the same pre-text → pose →
 * hand-position → body-lean → head-tilt → activity → post-text order, emitted
 * as short professional terms instead of full mechanism sentences
 * ("mid-throw, hands clasped behind the head"). Free-text pre/post fields are
 * user prose and pass through unchanged in both modes.
 */
export function buildPoseTerms(
  data: Record<string, unknown> & PoseValue,
): string[] {
  const terms: string[] = []

  const pre = typeof data.preText === "string" ? data.preText.trim() : ""
  if (pre) terms.push(pre)

  const poseId = typeof data.pose === "string" ? data.pose : ""
  const poseTerm = getPoseTerm(poseId)
  if (poseTerm) terms.push(poseTerm)

  const handPositionId =
    typeof data.handPosition === "string" ? data.handPosition : ""
  const handPositionTerm = getPoseTerm(handPositionId)
  if (handPositionTerm) terms.push(handPositionTerm)

  const bodyLeanId = typeof data.bodyLean === "string" ? data.bodyLean : ""
  const bodyLeanTerm = getPoseTerm(bodyLeanId)
  if (bodyLeanTerm) terms.push(bodyLeanTerm)

  const headTiltId = typeof data.headTilt === "string" ? data.headTilt : ""
  const headTiltTerm = getPoseTerm(headTiltId)
  if (headTiltTerm) terms.push(headTiltTerm)

  const activityId = typeof data.activity === "string" ? data.activity : ""
  const activityTerm = getPoseTerm(activityId)
  if (activityTerm) terms.push(activityTerm)

  const post = typeof data.postText === "string" ? data.postText.trim() : ""
  if (post) terms.push(post)

  return terms
}
