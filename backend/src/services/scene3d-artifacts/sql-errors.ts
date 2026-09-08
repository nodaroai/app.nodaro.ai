import { Scene3DArtifactError } from "./types.js"

/**
 * The database's verdicts, as codes a caller can act on.
 *
 * The `550xx` states are raised by this feature's own functions; the `23xxx`
 * ones are the schema's constraints firing, which is the backstop for anything
 * a pre-check did not think of. A code nobody recognises is a storage failure,
 * not a silent success.
 */
const BY_SQLSTATE: Record<string, Scene3DArtifactError["code"]> = {
  "55010": "SCENE_REVISION_CONFLICT",
  "55011": "SCENE_ASSET_INVALID",
  "55012": "SCENE_REVISION_CONFLICT",
  "55013": "SCENE_ASSET_MISSING",
  "55014": "SCENE_ASSET_INVALID",
  "55015": "SCENE_ASSET_INVALID",
  "55016": "SCENE_JOB_INVALID",
  "55017": "SCENE_REVISION_CONFLICT",
  "55018": "SCENE_ASSET_MISSING",
  "55019": "SCENE_ASSET_RETIRED",
  "55020": "SCENE_REVISION_CONFLICT",
  "55021": "SCENE_REVISION_CONFLICT",
  "55023": "SCENE_ASSET_MISSING",
  "55024": "SCENE_ASSET_INVALID",
  "23503": "SCENE_ASSET_INVALID",
  "23505": "SCENE_REVISION_CONFLICT",
  "23514": "SCENE_PLAN_INVALID",
}

export function translateScene3DSqlError(error: unknown, fallback: string): Scene3DArtifactError {
  if (error instanceof Scene3DArtifactError) return error
  const code = (error as { code?: string } | null)?.code ?? ""
  const message = (error as { message?: string } | null)?.message ?? fallback
  const mapped = BY_SQLSTATE[code]
  if (mapped) return new Scene3DArtifactError(mapped, message)
  return new Scene3DArtifactError("SCENE_STORAGE_FAILED", fallback, message)
}
