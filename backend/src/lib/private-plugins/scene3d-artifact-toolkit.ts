import { createHash } from "node:crypto"
import { supabase } from "../supabase.js"
import { config } from "../config.js"
import { accessAtLeast, workflowAccess } from "../workflow-access.js"
import { resolveScene3DPrivateStorageConfig, type Scene3DObjectStore } from "../../services/scene3d-artifacts/object-store.js"
import { reserveScene3DUploadIntent, receiveScene3DUpload, scene3DUploadIntent } from "../../services/scene3d-artifacts/upload-intents.js"
import { publishScene3DRevision } from "../../services/scene3d-artifacts/publish.js"
import { Scene3DArtifactError, type Scene3DUploadIntent } from "../../services/scene3d-artifacts/types.js"
import { scene3DPrivateStore } from "./scene3d-storage.js"
import { createScene3DUploadGranter } from "./scene3d-upload-grants.js"
import type { PluginSceneArtifactScope, PluginSceneArtifactToolkit } from "./scene3d-artifact-contract.js"

export async function authorizeScene3DJob(scope: { jobId: string; userId: string }): Promise<{ workflowId: string | null }> {
  const { data, error } = await supabase.from("jobs").select("status, workflow_id")
    .eq("id", scope.jobId).eq("user_id", scope.userId).maybeSingle()
  if (error) throw new Scene3DArtifactError("SCENE_STORAGE_FAILED", "Could not authorize scene job")
  if (!data || (data.status !== "pending" && data.status !== "processing")) {
    throw new Scene3DArtifactError("SCENE_JOB_INVALID", "Scene job is no longer active")
  }
  const workflowId: string | null = data.workflow_id ?? null
  if (workflowId && !accessAtLeast(await workflowAccess(scope.userId, workflowId), "edit")) {
    throw new Scene3DArtifactError("SCENE_JOB_INVALID", "Scene job no longer has access to its workflow")
  }
  return { workflowId }
}

async function ownedIntent(store: Scene3DObjectStore, scope: PluginSceneArtifactScope & { artifactId: string }): Promise<Scene3DUploadIntent> {
  await authorizeScene3DJob(scope)
  const intent = await scene3DUploadIntent(scope.artifactId, scope.userId)
  if (!intent || intent.jobId !== scope.jobId || intent.revisionId !== scope.revisionId || intent.bucket !== store.bucket) {
    throw new Scene3DArtifactError("SCENE_ASSET_MISSING", "Scene artifact is not reserved by this job and revision")
  }
  return intent
}

/** The producer can request bytes only by an owned reservation, never by an arbitrary object key. */
export function createScene3DArtifactToolkit(): PluginSceneArtifactToolkit | undefined {
  const cfg = resolveScene3DPrivateStorageConfig(process.env, config.R2_BUCKET_NAME)
  if (!cfg) return undefined
  const store = scene3DPrivateStore()
  if (!store) return undefined
  const grant = createScene3DUploadGranter(cfg, config.R2_BUCKET_NAME,
    async (scope) => { await authorizeScene3DJob(scope) },
    async (input) => { await reserveScene3DUploadIntent(store, { ...input, ttlSeconds: input.ttlSeconds }) })
  return {
    async grant(input) {
      const result = await grant(input)
      return { ...result.upload, key: result.key, verifyUrl: result.verifyUrl,
        verifyHeaders: result.verifyHeaders, expiresAt: result.expiresAt }
    },
    async receive(input) {
      const intent = await ownedIntent(store, input)
      const receipt = await receiveScene3DUpload(store, input)
      await authorizeScene3DJob(input)
      return { artifactId: input.artifactId, kind: intent.kind, objectKey: intent.objectKey,
        sha256: receipt.sha256, byteLength: receipt.byteLength, etag: receipt.etag }
    },
    async read(input, options) {
      options?.signal?.throwIfAborted()
      const intent = await ownedIntent(store, input)
      if (!intent.receipt) throw new Scene3DArtifactError("SCENE_ASSET_INVALID", "Scene artifact has not been received")
      const limit = intent.kind === "glb" ? 64 * 1024 * 1024 : 8 * 1024 * 1024
      if (intent.kind === "blend-source" || intent.receipt.byteLength > limit) {
        throw new Scene3DArtifactError("SCENE_ASSET_INVALID", "Scene artifact exceeds the buffered read limit")
      }
      const read = await store.get(intent.objectKey)
      const abort = () => read.body.destroy(new Error("Scene artifact read aborted"))
      options?.signal?.addEventListener("abort", abort, { once: true })
      if (options?.signal?.aborted) abort()
      const chunks: Buffer[] = []
      const hash = createHash("sha256")
      let length = 0
      try {
        if (read.contentLength !== null && read.contentLength !== intent.receipt.byteLength) {
          throw new Scene3DArtifactError("SCENE_ASSET_INVALID", "Scene artifact length changed after receipt")
        }
        for await (const chunk of read.body) {
          options?.signal?.throwIfAborted()
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          length += bytes.length
          if (length > intent.receipt.byteLength || length > limit) {
            throw new Scene3DArtifactError("SCENE_ASSET_INVALID", "Scene artifact exceeds its received length")
          }
          hash.update(bytes)
          chunks.push(bytes)
        }
        if (length !== intent.receipt.byteLength || hash.digest("hex") !== intent.receipt.sha256) {
          throw new Scene3DArtifactError("SCENE_ASSET_INVALID", "Scene artifact changed after receipt")
        }
        await ownedIntent(store, input)
        options?.signal?.throwIfAborted()
        return Buffer.concat(chunks, length)
      } finally {
        options?.signal?.removeEventListener("abort", abort)
        read.body.destroy()
      }
    },
    async publish(input) {
      const job = await authorizeScene3DJob(input)
      return publishScene3DRevision({ ...input, sourceJobId: input.jobId, workflowId: job.workflowId,
        requireIntents: true }, { store })
    },
  }
}
