/**
 * Which frames a delivery owes a still — the platform's own answer.
 *
 * The producer decides how a still is rendered; it does not get to decide
 * WHICH stills a composition has. That is a property of the composition
 * itself: one still per shot, at the shot's own first frame, in shot order.
 * Deriving it here means a delivery whose pins disagree with the manifest it
 * claims to describe is refused before any of it is published — rather than
 * discovered later by a reader that finds two "shot 0"s, or a shot with none.
 *
 * A v1 (Basic) scene has no `shots` array because it IS one shot; its single
 * still is at frame 0. Saying so here, once, is what keeps every reader from
 * having to special-case the schema version.
 */
import { Scene3DArtifactError } from "./types.js"

/** One still a delivery owes: the shot's 0-based index and its first frame. */
export interface Scene3DShotStillSlot {
  shotIndex: number
  frame: number
}

/** What a caller claims it pinned, before the platform has agreed. */
export interface Scene3DShotStillClaim {
  shotIndex: number
  frame: number
  width?: number
  height?: number
}

function invalid(message: string): never {
  throw new Scene3DArtifactError("SCENE_ASSET_INVALID", message)
}

function positiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function frameIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

/**
 * The stills this composition owes, in shot order.
 *
 * Throws rather than returning a partial answer: a composition whose shots
 * cannot each own one artifact is not a composition this platform can deliver
 * stills for, and silently dropping one would publish a `shotStills` list that
 * lies about which shot a still shows.
 */
export function scene3DShotStillSlots(plan: unknown): Scene3DShotStillSlot[] {
  const record = (plan ?? {}) as { schemaVersion?: unknown; durationInFrames?: unknown; shots?: unknown }
  const duration = frameIndex(record.durationInFrames) ? record.durationInFrames : 0
  // v1 is a single shot by construction — it has no `shots` array to read.
  if (record.schemaVersion !== 2) return [{ shotIndex: 0, frame: 0 }]
  const shots = record.shots
  if (!Array.isArray(shots) || shots.length === 0) {
    invalid("A v2 composition must declare its shots before it can deliver stills")
  }
  const slots = shots.map((shot, shotIndex) => {
    const frame = (shot as { startFrame?: unknown } | null)?.startFrame
    if (!frameIndex(frame) || (duration > 0 && frame >= duration)) {
      invalid("Every shot must start on a frame inside the composition")
    }
    return { shotIndex, frame }
  })
  if (new Set(slots.map((slot) => slot.frame)).size !== slots.length) {
    invalid("Shots must have distinct first frames to each own one still")
  }
  return slots
}

/**
 * Agree, exactly, on what was pinned.
 *
 * An EMPTY claim is accepted: stills are additive, and a producer that does
 * not render them yet still delivers a valid poster and report. A non-empty
 * claim must be the composition's whole slot set — a partial contact sheet
 * that looks complete is worse than none.
 */
export function assertScene3DShotStillClaims(
  plan: unknown,
  claims: readonly Scene3DShotStillClaim[],
): void {
  if (claims.length === 0) return
  const slots = scene3DShotStillSlots(plan)
  const ordered = [...claims].sort((a, b) => a.shotIndex - b.shotIndex)
  const same =
    ordered.length === slots.length &&
    ordered.every((claim, index) =>
      claim.shotIndex === slots[index].shotIndex && claim.frame === slots[index].frame)
  if (!same) invalid("Shot stills do not match the delivered composition")
}

/**
 * The pixel size to record for a still.
 *
 * The producer may state it; when it does not, the composition's own frame
 * size is the answer, because that is what the render was asked to produce.
 * Never a guess and never zero: a recorded size a reader cannot trust is worse
 * than no column at all.
 */
export function scene3DShotStillDimensions(
  plan: unknown,
  claim: { width?: number; height?: number },
): { width: number; height: number } {
  const record = (plan ?? {}) as { width?: unknown; height?: unknown }
  const width = claim.width ?? record.width
  const height = claim.height ?? record.height
  if (!positiveInt(width) || !positiveInt(height)) {
    invalid("A shot still must have a pixel size, from its claim or its composition")
  }
  return { width, height }
}
