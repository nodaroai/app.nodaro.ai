import { config } from "../config.js"
import { createS3ObjectStore, resolveScene3DPrivateStorageConfig, type Scene3DObjectStore } from "../../services/scene3d-artifacts/object-store.js"

let store: Scene3DObjectStore | null | undefined
/** Reading retained scenes remains available when new authoring is disabled. */
export function scene3DPrivateStore(): Scene3DObjectStore | null {
  if (store !== undefined) return store
  const cfg = resolveScene3DPrivateStorageConfig(process.env, config.R2_BUCKET_NAME)
  store = cfg ? createS3ObjectStore(cfg) : null
  return store
}
