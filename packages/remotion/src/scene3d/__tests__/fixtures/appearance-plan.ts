/**
 * The ONE fixed v1 plan the render-appearance regression test draws.
 *
 * Frozen on purpose: the committed reference frames in `appearance-references/`
 * are pictures of THIS plan, so any edit here invalidates every reference and
 * requires a re-record (see the header of `../render-appearance.test.ts`).
 *
 * Every number is chosen for what it makes MEASURABLE, not for looks:
 *
 *  - 320x180 keeps a reference PNG around 30 KB and a still under a second on
 *    the software renderer, while staying large enough that a 16x9 block
 *    signature averages ~20x20 real pixels per block.
 *  - The ground is a `plane` like the default plan's, but 10x10 rather than
 *    24x24. `createClayShadows` fits one 2048 shadow map to the whole scene
 *    bound, so a wide floor spends that map on empty ground. Shrinking it
 *    REDUCES the shadow acne but does not remove it: a v1 `plane` is
 *    `DoubleSide`, so it writes itself into the shadow map at the depth it is
 *    then shaded at, and the floor keeps a faint moire. That is the real
 *    shipped look for a plane ground, so the fixture keeps it and the portable
 *    gate absorbs it by averaging (see the block signature in the harness):
 *    across a full GL-backend swap the acne moves individual pixels by up to
 *    78 but the block signature by at most 3.28.
 *  - The hero box is keyframed left-to-right so frame 0 and frame 12 are
 *    genuinely different pictures; a mid frame that equalled frame 0 would
 *    prove nothing about the sampler feeding the shading.
 *  - Key intensity 7 against a saturated `#e4a04c` box is deliberately hot, and
 *    the number was found by sweeping. It is the point where the pre-#1328 look
 *    fails and the shipped one does not: with NO tone mapping EVERY pixel of
 *    `HIGHLIGHT_PATCH` has a channel pegged at 255 (measured
 *    `saturatedFraction` 1.0, mean RGB 255/190.6/99.8), while under ACES at
 *    exposure 1.15 the same patch peaks at 238 and pegs nothing (mean RGB
 *    238/208/141.8). Lit conservatively (key 3.5) neither look clips and the
 *    clipping assertion has nothing to detect; lit harder (key 9) ACES itself
 *    climbs to 243 and the margin narrows again.
 *  - `SHADOW_PATCH` / `LIT_PATCH` are mirrored across the box on the same
 *    scanlines, so they sit at the same depth and receive the same ambient and
 *    key contribution. The only thing that differs between them is whether the
 *    box occludes the key light. Measured on frame 0: with shadows ON the
 *    shadow patch reads luma 49.1 and the lit patch 190.6; with shadows OFF
 *    both read 196.4. The shadow assertion therefore has a 4x margin and the
 *    "the darkening is LOCAL, not a global exposure change" assertion a 5.8
 *    drift budget.
 */
import type { Scene3DPlanV1 } from "../../types"

export const APPEARANCE_PLAN: Scene3DPlanV1 = {
  planType: "3d-scene",
  schemaVersion: 1,
  revisionId: "3d5c0a11-0000-4000-8000-00000000a11c",
  width: 320,
  height: 180,
  fps: 24,
  durationInFrames: 24,
  backgroundColor: "#0b0b10",
  camera: {
    position: [0, 3.2, 8],
    target: [0, 1, 0],
    focalLengthMm: 35,
    sensorWidthMm: 36,
  },
  objects: [
    {
      id: "ground",
      name: "Ground",
      primitive: "plane",
      dimensions: [10, 10, 1],
      position: [0, 0, 0],
      rotation: [-Math.PI / 2, 0, 0],
      scale: [1, 1, 1],
      color: "#8a857d",
    },
    {
      id: "hero",
      name: "Hero block",
      primitive: "box",
      dimensions: [2, 2, 2],
      position: [-1.6, 1.2, 0],
      rotation: [0, 0.4, 0],
      scale: [1, 1, 1],
      color: "#e4a04c",
      keyframes: [
        { frame: 0, position: [-1.6, 1.2, 0], rotation: [0, 0.4, 0] },
        { frame: 23, position: [1.6, 1.2, 0], rotation: [0, 1.2, 0] },
      ],
    },
  ],
  lighting: {
    ambientIntensity: 0.3,
    keyIntensity: 7,
    // +X +Z, so the box throws its shadow to screen-left and slightly forward.
    keyPosition: [5, 7, 4],
  },
}

/** The frames the test renders and the reference set stores. */
export const APPEARANCE_FRAMES = [0, 12] as const

/**
 * Pixel rectangles on frame 0, in `[x, y, width, height]`.
 *
 * Re-derive them by eye from `appearance-references/clay-frame-000.png`
 * whenever the plan changes; the recorder prints the mean luma of each patch so
 * a bad rectangle shows up as a shrinking gap rather than as a passing test.
 */
export const FRAME0_PATCHES = {
  /** Floor inside the box's cast shadow, screen-left of and below the box. */
  SHADOW_PATCH: [30, 122, 22, 12] as const,
  /** Floor mirrored to screen-right of the box: same scanlines, no occluder. */
  LIT_PATCH: [190, 122, 22, 12] as const,
  /** The box's brightest lit face — where NoToneMapping clips and ACES does not. */
  HIGHLIGHT_PATCH: [96, 60, 24, 24] as const,
} as const
