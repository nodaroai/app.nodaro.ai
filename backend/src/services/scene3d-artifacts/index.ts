/**
 * The Scene3D artifact store: immutable revisions, owner-scoped binary
 * artifacts, authorized reads, atomic publication and durable cleanup.
 *
 * Generic wire and storage only — no planner, no recipe, no solver. See
 * `types.ts` for why that boundary is where it is.
 */
export {
  SCENE3D_ARTIFACT_CONTENT_TYPES,
  SCENE3D_ARTIFACT_KINDS,
  SCENE3D_ARTIFACT_KIND_USAGE,
  SCENE3D_ARTIFACT_USAGES,
  SCENE3D_PLAYBACK_KINDS,
  SCENE3D_SOURCE_KINDS,
  Scene3DArtifactError,
  isScene3DArtifactError,
  scene3DLaneKinds,
  type Scene3DArtifactErrorCode,
  type Scene3DArtifactKind,
  type Scene3DArtifactPublishInput,
  type Scene3DArtifactRecord,
  type Scene3DArtifactUsage,
  type Scene3DAssetDescriptor,
  type Scene3DPinnedArtifact,
  type Scene3DPublishInput,
  type Scene3DPublishResult,
  type Scene3DReadLane,
  type Scene3DRevisionRecord,
  type Scene3DUploadIntent,
  type Scene3DUploadReceipt,
} from "./types.js"

export {
  createS3ObjectStore,
  normalizeEtag,
  resolveScene3DPrivateStorageConfig,
  type Scene3DObjectRange,
  type Scene3DObjectRead,
  type Scene3DObjectStore,
  type Scene3DPrivateStorageConfig,
} from "./object-store.js"

export {
  SCENE3D_OBJECT_PREFIX,
  assertScene3DArtifactObjectKey,
  isScene3DId,
  scene3DArtifactObjectKey,
} from "./object-keys.js"

export {
  SCENE3D_JSON_RECEIPT_MAX_BYTES,
  SCENE3D_MAX_ARTIFACT_BYTES,
  assertScene3DArtifactMagic,
  inspectScene3DObject,
  isSyntheticEtag,
  verifyScene3DArtifactBytes,
  type Scene3DObjectInspection,
  type Scene3DReceipt,
  type Scene3DReceiptExpectation,
} from "./receipt.js"

export {
  SCENE3D_UPLOAD_GRACE_SECONDS,
  SCENE3D_UPLOAD_TTL_SECONDS,
  receiveScene3DUpload,
  reserveScene3DUploadIntent,
  scene3DUploadIntent,
  type Scene3DUploadReservation,
} from "./upload-intents.js"

export {
  SCENE3D_PLAYBACK_MIN_ACCESS,
  SCENE3D_SOURCE_MIN_ACCESS,
  authorizeScene3DArtifact,
  authorizeScene3DRevision,
  scene3DIsReadable,
  scene3DLaneMinAccess,
  scene3DRevisionAccess,
  type Scene3DArtifactAuthorization,
  type Scene3DRevisionAuthorization,
} from "./authorize.js"

export {
  openScene3DArtifactStream,
  parseScene3DRange,
  scene3DRevisionAssetDescriptors,
  scene3DRevisionSourceArtifact,
  type Scene3DArtifactStream,
  type Scene3DRangeRequest,
} from "./read.js"

export { translateScene3DSqlError } from "./sql-errors.js"

export {
  canonicalScene3DJson,
  publishScene3DRevision,
  scene3DPlanDigest,
  translatePublishError,
} from "./publish.js"

export {
  SCENE3D_GC_DEFAULT_LIMIT,
  SCENE3D_GC_DEFAULT_RETRY_AFTER,
  runScene3DArtifactGcBatch,
  sweepExpiredScene3DArtifacts,
  sweepExpiredScene3DUploadIntents,
  type Scene3DGcOutcome,
} from "./gc.js"

export {
  loadScene3DPinnedArtifact,
  loadScene3DRevision,
  loadScene3DRevisionArtifacts,
  type Scene3DGcTask,
} from "./db.js"
