import { createHash, randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { createReadStream, createWriteStream } from "node:fs"
import { join } from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import {
  scene3DPlanV2Schema, verifyScene3DPlanV2ContentHash,
  type Scene3DPlanV2,
} from "@nodaro/shared"
import { authorizeScene3DArtifact, authorizeScene3DRevision } from "../services/scene3d-artifacts/authorize.js"
import type { Scene3DObjectStore } from "../services/scene3d-artifacts/object-store.js"

export class Scene3DRenderPlanError extends Error {
  constructor(message: string, readonly statusCode: 404 | 409) { super(message); this.name = "Scene3DRenderPlanError" }
}

interface LocalAsset { path: string; bytes: number; mime: string }

/** Only the explicitly downloaded playback files are reachable, behind a job-local token. */
function serveAssets(files: ReadonlyMap<string, LocalAsset>): Promise<{ assetUrls: Record<string, string>; close(): void }> {
  const token = randomUUID()
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      let path: string
      try { path = new URL(request.url ?? "", "http://localhost").pathname }
      catch { response.writeHead(400).end(); return }
      const prefix = `/${token}/`
      const asset = path.startsWith(prefix) ? files.get(path.slice(prefix.length)) : undefined
      if (!asset) { response.writeHead(404).end(); return }
      if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405).end(); return }
      response.writeHead(200, { "Content-Type": asset.mime, "Content-Length": asset.bytes,
        "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" })
      if (request.method === "HEAD") { response.end(); return }
      void pipeline(createReadStream(asset.path), response).catch(() => response.destroy())
    })
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") { server.close(); reject(new Error("Scene asset server failed to bind")); return }
      const base = `http://127.0.0.1:${address.port}/${token}`
      resolve({ assetUrls: Object.fromEntries([...files.keys()].map((id) => [id, `${base}/${id}`])),
        close: () => { server.closeAllConnections(); server.close() },
      })
    })
  })
}

/** Must run before a v2 render is admitted or any asset is downloaded. */
export async function authorizeScene3DRenderPlan(userId: string, input: unknown): Promise<Scene3DPlanV2> {
  const plan = scene3DPlanV2Schema.parse(input) as Scene3DPlanV2
  const access = await authorizeScene3DRevision(userId, plan.revisionId, "playback")
  if (!access.ok) throw new Scene3DRenderPlanError("Scene revision is unavailable", 404)
  const stored = scene3DPlanV2Schema.parse(access.revision.plan) as Scene3DPlanV2
  if (stored.provenance.contentHash !== plan.provenance.contentHash || stored.parentRevisionId !== plan.parentRevisionId ||
      !await verifyScene3DPlanV2ContentHash(plan)) throw new Scene3DRenderPlanError("Scene render must use its exact retained revision", 409)
  return plan
}

/**
 * Private assets never become CDN URLs. The worker verifies owned bytes, then
 * exposes only GLB/camera files on its loopback interface for headless Chromium.
 * Source projects and private authoring checkpoints never enter inputProps URLs.
 */
export async function prepareScene3DRenderAssets(options: {
  userId: string; plan: Scene3DPlanV2; workDir: string;
  store: Scene3DObjectStore | null; signal: AbortSignal;
}): Promise<{ assetUrls: Record<string, string>; close(): void }> {
  if (!options.store) throw new Error("Scene private storage is unavailable")
  options.signal.throwIfAborted()
  const plan = await authorizeScene3DRenderPlan(options.userId, options.plan)
  const files = new Map<string, LocalAsset>()
  for (const asset of plan.assets) {
    if (asset.kind !== "glb" && asset.kind !== "camera-track-json") continue
    options.signal.throwIfAborted()
    const access = await authorizeScene3DArtifact(options.userId, plan.revisionId, asset.assetId, "playback")
    if (!access.ok) throw new Error("Scene asset is unavailable")
    const stored = access.artifact
    if (stored.bucket !== options.store.bucket || stored.sha256 !== asset.sha256 || stored.byteLength !== asset.byteLength || stored.kind !== asset.kind) {
      throw new Error("Scene asset receipt does not match the retained revision")
    }
    const source = await options.store.get(stored.objectKey)
    if (source.contentLength !== null && source.contentLength !== asset.byteLength) {
      source.body.destroy()
      throw new Error("Scene asset length changed")
    }
    const hash = createHash("sha256")
    let bytes = 0
    const verifier = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength
      if (bytes > asset.byteLength) { callback(new Error("Scene asset exceeds its declared size")); return }
      hash.update(chunk); callback(null, chunk)
    } })
    const path = join(options.workDir, `scene-${randomUUID()}.bin`)
    await pipeline(source.body, verifier, createWriteStream(path, { flags: "wx", mode: 0o600 }), { signal: options.signal })
    if (bytes !== asset.byteLength || hash.digest("hex") !== asset.sha256) throw new Error("Scene asset bytes do not match their digest")
    files.set(asset.assetId, { path, bytes, mime: asset.kind === "glb" ? "model/gltf-binary" : "application/json" })
  }
  options.signal.throwIfAborted()
  return serveAssets(files)
}
