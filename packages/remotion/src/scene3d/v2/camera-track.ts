/**
 * The baked camera sidecar: decode, validate against the manifest, sample.
 *
 * The VALIDATION is the contract's (`@nodaro/shared`) — projection shape,
 * quaternion norm, near/far ordering, sample count, and the cross-check that
 * the track's fps and aspect match the plan it belongs to. This module adds
 * only what is renderer-side: the byte gate before `JSON.parse`, the mapping
 * from contract issues onto the renderer's stable failure codes, and the
 * clamped per-frame lookup.
 *
 * The rule that makes v2 cameras trustworthy is that the exporter's evaluated
 * world position, quaternion and projection matrix ARE the answer:
 *  - no `lookAt()` — `target` is inspection metadata, and re-aiming from it
 *    would quietly discard roll and any handheld component;
 *  - no FOV from `focalLengthMm` — sensor fit and lens shift live in the
 *    projection matrix and cannot be recovered from a focal length;
 *  - no interpolation — at integer frame `f` the sample IS index `f`, which is
 *    what makes a hard cut hard and backward scrubbing exact.
 */
import {
  SCENE3D_V2_LIMITS,
  parseScene3DCameraTrackJson,
  scene3DCameraTrackPlanIssues,
  scene3DSampleForFrame,
  type Scene3DCameraSample,
  type Scene3DCameraTrackV1,
  type Scene3DPlanV2,
} from "@nodaro/shared"
import { check, fail } from "./errors"

export type { Scene3DCameraSample, Scene3DCameraTrackV1 }

interface Issue {
  path: (string | number)[]
  message: string
}

function describe(issues: readonly Issue[]): string {
  return issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")
}

/**
 * Decode, validate and cross-check a camera-track asset.
 *
 * An orthographic projection gets `SCENE_EXPORT_UNSUPPORTED` rather than
 * `SCENE_CAMERA_TRACK_INVALID`: it is a future explicit capability, not a
 * malformed file, and the difference is what a support answer hangs on.
 */
export function decodeScene3DCameraTrack(
  bytes: ArrayBuffer,
  plan: Scene3DPlanV2,
  assetId: string,
): Scene3DCameraTrackV1 {
  check(
    bytes.byteLength <= SCENE3D_V2_LIMITS.maxCameraTrackBytes,
    "SCENE_RESOURCE_LIMIT",
    `camera track is ${bytes.byteLength} bytes, over the ${SCENE3D_V2_LIMITS.maxCameraTrackBytes} limit`,
    assetId,
  )

  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return fail("SCENE_CAMERA_TRACK_INVALID", "camera track is not valid UTF-8", assetId)
  }

  const parsed = parseScene3DCameraTrackJson(text)
  if (!parsed.ok) {
    const message = describe(parsed.issues)
    return fail(
      /orthographic/i.test(message) ? "SCENE_EXPORT_UNSUPPORTED" : "SCENE_CAMERA_TRACK_INVALID",
      message,
      assetId,
    )
  }

  // Fps, frame count and projected aspect must match the manifest. Changing
  // either requires an explicit resample and a NEW revision, so a mismatched
  // pair is a mismatched pair — never something to stretch at render time.
  const planIssues = scene3DCameraTrackPlanIssues(parsed.value, plan)
  if (planIssues.length > 0) {
    return fail("SCENE_CAMERA_TRACK_INVALID", describe(planIssues), assetId)
  }

  return parsed.value
}

/**
 * The sample for an integer frame.
 *
 * Out-of-range frames CLAMP rather than throw: Remotion can ask for the last
 * frame twice and a preview can be scrubbed past the end, and neither is a
 * scene defect. Non-integers are floored, never interpolated — interpolation
 * could blend across a cut.
 */
export function sampleBakedCamera(
  track: Scene3DCameraTrackV1,
  frame: number,
): Scene3DCameraSample {
  const f = Number.isFinite(frame) ? Math.floor(frame) : 0
  const clamped = f < 0 ? 0 : f >= track.frameCount ? track.frameCount - 1 : f
  const sample = scene3DSampleForFrame(track, clamped)
  // The track was validated to hold exactly `frameCount` samples, so this only
  // fires if a caller mutated it after load.
  check(!!sample, "SCENE_CAMERA_TRACK_INVALID", `no sample for frame ${clamped}`)
  return sample
}
