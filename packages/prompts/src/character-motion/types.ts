import type { CharacterMotionMetadata } from "@nodaro/shared/types"
export type { CharacterMotionMetadata } from "@nodaro/shared/types"

/**
 * Types for the Character Motion catalog. The entry arrays live one file per
 * category under this directory; `../character-motion.ts` aggregates them and
 * owns the getters, the timing scales and the composer. Kept apart so no file
 * in the catalog passes the repo's 800-line ceiling.
 */

export type CharacterMotionCategory =
  | "entrances-exits"
  | "turns-looks"
  | "head-gestures"
  | "walks-runs"
  | "runway"
  | "dance"
  | "face-expression"
  | "gestures"
  | "camera-interaction"
  | "combat-weapons"
  | "athletic-stunts"
  | "evasive-falls"
  | "posture-shifts"
  | "everyday-actions"
  | "vehicles-mounts"
  | "animals-pets"
  | "two-person"
  | "idle-ambient"
  | "stage-performance"
  | "unnatural-horror"

export interface CharacterMotion extends CharacterMotionMetadata {
  readonly id: string
  readonly label: string
  readonly category: CharacterMotionCategory
  readonly description: string
  readonly promptHint: string
  /** Authored compact term (see `../term.ts`); every injecting entry authors one. */
  readonly term?: string
  /** Minor-age floor flag (see `../pose.ts`). Hand-curated; never on neutral movement. */
  readonly adultOnly?: true
  /** The move needs a second person; the hint contains the literal words "the partner". */
  readonly twoPerson?: true
}
