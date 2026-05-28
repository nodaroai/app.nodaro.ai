/**
 * Maps our CAMERA_MOTIONS catalog IDs to LTX 2.3's structured camera_motion enum.
 *
 * Catalog entries that don't map → return undefined (caller emits camera_motion:
 * "none" + existing prompt-hint injection takes over).
 */

const LTX_CAMERA_MOTION_MAP: Record<string, string> = {
  "static": "static",
  "dolly-in": "dolly_in",
  "dolly-out": "dolly_out",
  "truck-left": "dolly_left",
  "truck-right": "dolly_right",
  "pedestal-up": "jib_up",
  "pedestal-down": "jib_down",
  "rack-focus": "focus_shift",
}

export interface CameraMotionHint {
  nodeType: string
  data: { cameraMotion?: string }
}

export function ltxCameraMotionFromUpstream(hints: ReadonlyArray<CameraMotionHint>): string | undefined {
  for (const hint of hints) {
    if (hint.nodeType !== "camera-motion") continue
    const id = hint.data.cameraMotion
    if (!id) continue
    const mapped = LTX_CAMERA_MOTION_MAP[id]
    if (mapped) return mapped
  }
  return undefined
}
