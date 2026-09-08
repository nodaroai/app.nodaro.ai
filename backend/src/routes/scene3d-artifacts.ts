import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { sendInternalError } from "../lib/http-errors.js"
import { authorizeScene3DDelivery, authorizeScene3DDeliveryArtifact, scene3DDeliveryArtifactReadable } from "../services/scene3d-artifacts/delivery-authorize.js"
import { loadScene3DDeliveryArtifacts } from "../services/scene3d-artifacts/delivery-db.js"
import {
  Scene3DArtifactError,
  authorizeScene3DArtifact,
  authorizeScene3DRevision,
  isScene3DArtifactError,
  openScene3DArtifactStream,
  parseScene3DRange,
  scene3DRevisionAssetDescriptors,
  scene3DRevisionSourceArtifact,
  type Scene3DArtifactStream,
  type Scene3DObjectStore,
  type Scene3DPinnedArtifact,
  type Scene3DReadLane,
} from "../services/scene3d-artifacts/index.js"

/**
 * Reading a Scene3D revision and its bytes.
 *
 * There is no write route here: publication is a
 * service function the trusted engine calls, so no caller can hand this API a
 * `.blend` or a GLB as an "import".
 *
 * Bytes are proxied rather than handed out as signed URLs because a signed URL
 * outlives the check that minted it — revoke a membership, delete the
 * revision, and the tab still works until the URL expires. Authorization is
 * re-asked on every read instead, and no user token is ever stored.
 *
 * The object store arrives through plugin options
 * (`register(scene3DArtifactRoutes, { store })`). Without one the metadata
 * route still answers and the binary routes say 503.
 */

const revisionParams = z.object({ revisionId: z.string().min(1).max(64) })
const assetParams = revisionParams.extend({ assetId: z.string().min(1).max(64) })
const deliveryParams = z.object({ jobId: z.string().min(1).max(64) })
const deliveryAssetParams = deliveryParams.extend({ assetId: z.string().min(1).max(64) })

export interface Scene3DArtifactRoutesOptions {
  /** Injected by the composition root; `null` disables the binary lanes. */
  store?: Scene3DObjectStore | null
}

function notFound(reply: FastifyReply) {
  return reply
    .status(404)
    .send({ error: { code: "not_found", message: "Scene revision not found" } })
}

function forbidden(reply: FastifyReply) {
  return reply
    .status(403)
    .send({ error: { code: "forbidden", message: "You do not have permission to do that" } })
}

function unauthorized(reply: FastifyReply) {
  return reply
    .status(401)
    .send({ error: { code: "unauthorized", message: "Authentication required" } })
}

function storageUnconfigured(reply: FastifyReply) {
  return reply.status(503).send({
    error: {
      code: "scene_storage_unconfigured",
      message: "Scene asset storage is not configured on this deployment",
    },
  })
}

/**
 * A read failure, told honestly and without detail.
 *
 * "The bytes at that key are not the bytes we published" is a 502: the request
 * was fine and the store is not, and the caller must not receive the object.
 * The reason stays server-side — a prober learns only that it failed.
 */
function sendArtifactError(
  req: FastifyRequest,
  reply: FastifyReply,
  error: Scene3DArtifactError,
) {
  if (error.code === "SCENE_ASSET_MISSING") {
    return reply
      .status(404)
      .send({ error: { code: "not_found", message: "Scene asset not found" } })
  }
  req.log.error(
    { code: error.code, detail: error.detail },
    `[scene3d-artifacts] ${error.message}`,
  )
  return reply.status(502).send({
    error: { code: "scene_asset_unavailable", message: "The scene asset could not be served" },
  })
}

/** Common headers for every byte we serve out of the private bucket. */
function binaryHeaders(stream: Scene3DArtifactStream, filename?: string): Record<string, string> {
  return {
    "Content-Type": stream.contentType,
    "Content-Length": String(stream.contentLength),
    // Never cached anywhere. Authorization is re-asked per read precisely so a
    // revoked reader stops reading; a shared cache would undo that.
    "Cache-Control": "no-store, private",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    ...(stream.contentRange ? { "Content-Range": stream.contentRange } : {}),
    ...(filename ? { "Content-Disposition": `attachment; filename="${filename}"` } : {}),
  }
}

async function serveArtifact(
  req: FastifyRequest,
  reply: FastifyReply,
  store: Scene3DObjectStore,
  artifact: Scene3DPinnedArtifact,
  filename?: string,
  authorizeAfterRead?: () => Promise<boolean>,
) {
  const range = parseScene3DRange(req.headers.range, artifact.byteLength)
  if (range.kind === "unsatisfiable") {
    return reply
      .status(416)
      .header("Content-Range", `bytes */${artifact.byteLength}`)
      .send({ error: { code: "range_not_satisfiable", message: "Requested range is not valid" } })
  }

  let stream: Scene3DArtifactStream
  try {
    stream = await openScene3DArtifactStream(store, artifact, range)
  } catch (error) {
    if (isScene3DArtifactError(error)) return sendArtifactError(req, reply, error)
    throw error
  }

  if (authorizeAfterRead) {
    try {
      if (!await authorizeAfterRead()) {
        stream.body.destroy()
        return notFound(reply)
      }
    } catch (error) {
      stream.body.destroy()
      throw error
    }
  }
  if (stream.body.errored) {
    return sendArtifactError(req, reply, new Scene3DArtifactError(
      "SCENE_ASSET_INVALID", "The stored scene asset could not be read",
    ))
  }

  // Sent through the reply, not written to the raw socket: the response still
  // passes every onSend hook, so CORS and the error/telemetry paths behave the
  // same here as everywhere else.
  return reply.status(stream.status).headers(binaryHeaders(stream, filename)).send(stream.body)
}

export async function scene3DArtifactRoutes(
  app: FastifyInstance,
  options: Scene3DArtifactRoutesOptions = {},
) {
  const store = options.store ?? null

  /** The manifest: the plan plus opaque asset descriptors. */
  app.get("/v1/3d-scene/revisions/:revisionId", async (req, reply) => {
    if (!req.userId) return unauthorized(reply)
    const params = revisionParams.safeParse(req.params)
    if (!params.success) return notFound(reply)

    try {
      const authorized = await authorizeScene3DRevision(
        req.userId,
        params.data.revisionId,
        "playback",
      )
      if (!authorized.ok) {
        return authorized.reason === "forbidden" ? forbidden(reply) : notFound(reply)
      }
      const assets = await scene3DRevisionAssetDescriptors(authorized.revision.revisionId)
      return reply.header("Cache-Control", "no-store, private").send({
        revisionId: authorized.revision.revisionId,
        parentRevisionId: authorized.revision.parentRevisionId,
        workflowId: authorized.revision.workflowId,
        planSha256: authorized.revision.planSha256,
        createdAt: authorized.revision.createdAt,
        access: authorized.access,
        plan: authorized.revision.plan,
        assets,
      })
    } catch (error) {
      if (isScene3DArtifactError(error)) return sendArtifactError(req, reply, error)
      return sendInternalError(reply, req, error, "Failed to read the scene revision")
    }
  })

  /**
   * Playback bytes. The revision id in the path is not decoration: the pin is
   * looked up as `(revisionId, assetId)`, so an asset the caller owns but
   * which THIS retained revision does not use is a 404.
   */
  app.get("/v1/3d-scene/revisions/:revisionId/assets/:assetId", async (req, reply) => {
    if (!req.userId) return unauthorized(reply)
    const params = assetParams.safeParse(req.params)
    if (!params.success) return notFound(reply)
    if (!store) return storageUnconfigured(reply)

    try {
      const authorized = await authorizeScene3DArtifact(
        req.userId,
        params.data.revisionId,
        params.data.assetId,
        "playback" satisfies Scene3DReadLane,
      )
      if (!authorized.ok) {
        return authorized.reason === "forbidden" ? forbidden(reply) : notFound(reply)
      }
      return await serveArtifact(req, reply, store, authorized.artifact)
    } catch (error) {
      if (isScene3DArtifactError(error)) return sendArtifactError(req, reply, error)
      return sendInternalError(reply, req, error, "Failed to read the scene asset")
    }
  })

  /**
   * The `.blend` export — a separate route because it is a separate
   * permission. Playback needs `view`; this needs `edit`, so a collaborator
   * invited to watch a scene cannot walk off with the editable project.
   */
  app.get("/v1/3d-scene/revisions/:revisionId/source", async (req, reply) => {
    if (!req.userId) return unauthorized(reply)
    const params = revisionParams.safeParse(req.params)
    if (!params.success) return notFound(reply)
    if (!store) return storageUnconfigured(reply)

    try {
      const authorized = await authorizeScene3DRevision(
        req.userId,
        params.data.revisionId,
        "source" satisfies Scene3DReadLane,
      )
      if (!authorized.ok) {
        return authorized.reason === "forbidden" ? forbidden(reply) : notFound(reply)
      }
      const artifact = await scene3DRevisionSourceArtifact(authorized.revision.revisionId)
      if (!artifact) {
        return reply
          .status(404)
          .send({ error: { code: "not_found", message: "This revision retained no source file" } })
      }
      return await serveArtifact(
        req,
        reply,
        store,
        artifact,
        `scene-${authorized.revision.revisionId}.blend`,
      )
    } catch (error) {
      if (isScene3DArtifactError(error)) return sendArtifactError(req, reply, error)
      return sendInternalError(reply, req, error, "Failed to read the scene source")
    }
  })

  app.get("/v1/3d-scene/deliveries/:jobId", async (req, reply) => {
    if (!req.userId) return unauthorized(reply)
    const params = deliveryParams.safeParse(req.params)
    if (!params.success) return notFound(reply)
    try {
      const auth = await authorizeScene3DDelivery(req.userId, params.data.jobId)
      if (!auth.ok) return notFound(reply)
      const assets = (await loadScene3DDeliveryArtifacts(auth.delivery.jobId))
        .filter(scene3DDeliveryArtifactReadable)
        .map((asset) => ({ assetId: asset.artifactId, kind: asset.kind, usage: asset.usage,
          byteLength: asset.byteLength, sha256: asset.sha256, viaRevisionId: asset.viaRevisionId }))
      const currentAuth = await authorizeScene3DDelivery(req.userId, params.data.jobId)
      if (!currentAuth.ok) return notFound(reply)
      const delivery = currentAuth.delivery
      return reply.header("Cache-Control", "no-store, private").send({
        deliveryId: delivery.jobId, sceneRevisionId: delivery.sourceRevisionId,
        sourcePlanSha256: delivery.sourcePlanSha256, sourceContentHash: delivery.sourceContentHash,
        sourceJobId: delivery.sourceJobId, workflowId: delivery.workflowId,
        mode: delivery.mode, createdAt: delivery.createdAt, access: currentAuth.access, assets,
      })
    } catch (error) {
      if (isScene3DArtifactError(error)) return sendArtifactError(req, reply, error)
      return sendInternalError(reply, req, error, "Failed to read the scene delivery")
    }
  })

  app.get("/v1/3d-scene/deliveries/:jobId/assets/:assetId", async (req, reply) => {
    if (!req.userId) return unauthorized(reply)
    const params = deliveryAssetParams.safeParse(req.params)
    if (!params.success) return notFound(reply)
    try {
      const actorId = req.userId
      const { jobId, assetId } = params.data
      const auth = await authorizeScene3DDeliveryArtifact(actorId, jobId, assetId)
      if (!auth.ok) return notFound(reply)
      if (!store) return storageUnconfigured(reply)
      return await serveArtifact(req, reply, store, auth.artifact, undefined,
        async () => (await authorizeScene3DDeliveryArtifact(actorId, jobId, assetId)).ok)
    } catch (error) {
      if (isScene3DArtifactError(error)) return sendArtifactError(req, reply, error)
      return sendInternalError(reply, req, error, "Failed to read the scene delivery asset")
    }
  })
}

export { Scene3DArtifactError }
