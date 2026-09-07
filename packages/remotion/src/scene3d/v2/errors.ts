/**
 * Stable failure codes for the v2 playback path.
 *
 * Every one of these FAILS the render. The spec is explicit: "WebGL failure,
 * missing mesh, failed asset download, unsupported decoder or context loss
 * fails the render; no placeholder MP4 is allowed." So there is no
 * "degrade and continue" branch anywhere below — the only softening is
 * `Scene3DReadinessWarning`, which never affects pixels.
 *
 * The codes mirror the runtime codes the contract names
 * (`SCENE_ASSET_INVALID`, `SCENE_RESOURCE_LIMIT`, `SCENE_EXPORT_UNSUPPORTED`,
 * `SCENE_CAPABILITY_UNAVAILABLE`) so the backend can map a renderer failure
 * onto a job error without string-matching a message.
 */
export type Scene3DErrorCode =
  /** Bytes did not match the manifest, or the container is malformed. */
  | "SCENE_ASSET_INVALID"
  /** Asset could not be fetched / no resolver / non-http URL. */
  | "SCENE_ASSET_UNAVAILABLE"
  /** A declared entity root / material / clip is absent from the asset. */
  | "SCENE_ASSET_BINDING"
  /** A documented v2 ceiling was exceeded. */
  | "SCENE_RESOURCE_LIMIT"
  /** A glTF/Blender feature that is capability-gated and not granted. */
  | "SCENE_EXPORT_UNSUPPORTED"
  /** Camera sidecar failed validation. */
  | "SCENE_CAMERA_TRACK_INVALID"
  /** Shots do not tile [0, durationInFrames) exactly once. */
  | "SCENE_SHOT_COVERAGE"
  /** An override refers to something that does not exist. */
  | "SCENE_OVERRIDE_INVALID"
  /** Plan shape the renderer cannot play at all. */
  | "SCENE_PLAN_INVALID"
  /** WebGL context unavailable or lost. */
  | "SCENE_WEBGL_UNAVAILABLE"

export class Scene3DError extends Error {
  readonly code: Scene3DErrorCode
  /** Asset id / entity id / shot id the failure is attributable to. */
  readonly subject?: string

  constructor(code: Scene3DErrorCode, message: string, subject?: string) {
    super(subject ? `[${code}] ${message} (${subject})` : `[${code}] ${message}`)
    this.name = "Scene3DError"
    this.code = code
    this.subject = subject
  }
}

export function isScene3DError(error: unknown): error is Scene3DError {
  return error instanceof Scene3DError
}

/** Non-fatal: reported to the host, never changes what is drawn. */
export interface Scene3DReadinessWarning {
  code: string
  message: string
  subject?: string
}

export function fail(code: Scene3DErrorCode, message: string, subject?: string): never {
  throw new Scene3DError(code, message, subject)
}

/** `condition` false → throw. Keeps validators readable and exhaustive. */
export function check(
  condition: unknown,
  code: Scene3DErrorCode,
  message: string,
  subject?: string,
): asserts condition {
  if (!condition) fail(code, message, subject)
}
