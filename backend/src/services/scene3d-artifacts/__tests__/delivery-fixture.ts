import { createHash } from "node:crypto"
import { Readable } from "node:stream"
import { vi } from "vitest"
import { createFakeSupabase, type Row } from "./fake-supabase.js"
import { scene3DPlanDigest } from "../publish.js"
import { scene3DArtifactObjectKey } from "../object-keys.js"
import type { Scene3DDeliveryPublishInput } from "../delivery-types.js"
import type { Scene3DObjectStore } from "../object-store.js"

export const OWNER = "00000000-0000-4000-8000-000000000001"
export const OTHER = "00000000-0000-4000-8000-000000000002"
export const JOB = "00000000-0000-4000-8000-000000000050"
export const SOURCE = "00000000-0000-4000-8000-000000000051"
export const REV = "00000000-0000-4000-8000-000000000030"
export const WF = "00000000-0000-4000-8000-000000000020"
export const SOURCE_WF = "00000000-0000-4000-8000-000000000021"
export const POSTER = "00000000-0000-4000-8000-0000000000a1"
export const REPORT = "00000000-0000-4000-8000-0000000000a2"
export const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")

export function deliveryFixture() {
  const plan = {
    planType: "3d-scene", schemaVersion: 1, revisionId: REV,
    width: 640, height: 360, fps: 24, durationInFrames: 24, backgroundColor: "#101014",
    camera: { position: [0, 1.5, 4], target: [0, 1, 0], focalLengthMm: 35, sensorWidthMm: 36 },
    objects: [{ id: "o1", name: "Box", primitive: "box", dimensions: [1, 1, 1],
      position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: "#22cc88" }],
    lighting: { ambientIntensity: 0.6, keyIntensity: 2.4, keyPosition: [4, 6, 3] },
  }
  const bytes = [Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]),
    Buffer.from(JSON.stringify({ status: "passed", frameCount: 24 }))]
  const artifacts: Scene3DDeliveryPublishInput["artifacts"] = ["poster", "validation-report"].map((kind, i) => {
    const artifactId = [POSTER, REPORT][i]
    const typedKind = kind as "poster" | "validation-report"
    return { artifactId, kind: typedKind, sha256: sha(bytes[i]), byteLength: bytes[i].length,
      objectKey: scene3DArtifactObjectKey(OWNER, REV, artifactId, typedKind) }
  })
  const input: Scene3DDeliveryPublishInput = { jobId: JOB, userId: OWNER, revisionId: REV,
    source: { kind: "retained-revision" }, mode: "render-only", plan, artifacts }
  const db = createFakeSupabase({
    scene3d_revisions: [{ id: REV, user_id: OWNER, workflow_id: SOURCE_WF, source_job_id: SOURCE,
      parent_revision_id: null, plan, plan_sha256: scene3DPlanDigest(plan), created_at: "2026-09-08T00:00:00Z" }],
    jobs: [{ id: SOURCE, user_id: OWNER, workflow_id: SOURCE_WF, status: "completed", output_data: { scenePlan: plan } }],
    scene3d_upload_intents: artifacts.map((a) => ({ artifact_id: a.artifactId, user_id: OWNER,
      job_id: JOB, revision_id: REV, kind: a.kind, bucket: "private-scenes", object_key: a.objectKey,
      receipt_sha256: a.sha256, receipt_byte_length: a.byteLength, receipt_etag: "tag" })),
  })
  db.rpc.mockResolvedValue({ data: "created", error: null })
  const objects = new Map(artifacts.map((a, i) => [a.objectKey!, bytes[i]]))
  const store: Scene3DObjectStore = { bucket: "private-scenes", get: vi.fn(async (key, range) => {
    const bytes = objects.get(key)!
    const selected = range ? bytes.subarray(range.start, range.endInclusive + 1) : bytes
    return { body: Readable.from([selected]), contentLength: selected.length, etag: "tag" }
  }), delete: vi.fn() }
  const authorizeJob = vi.fn(async () => ({ workflowId: WF }))
  const delivery: Row = { job_id: JOB, user_id: OWNER, workflow_id: WF,
    source_kind: "retained-revision", source_revision_id: REV, source_plan_sha256: scene3DPlanDigest(plan),
    source_content_hash: null, source_job_id: SOURCE, source_owner_id: OWNER, source_workflow_id: SOURCE_WF,
    mode: "render-only", created_at: "2026-09-08T00:00:00Z" }
  const assetRows = artifacts.map((a) => ({ id: a.artifactId, user_id: OWNER, kind: a.kind,
    sha256: a.sha256, byte_length: a.byteLength, object_key: a.objectKey,
    bucket: store.bucket, etag: "tag", created_at: "2026-09-08T00:00:00Z", expires_at: null }))
  function published() {
    db.tables.scene3d_deliveries.push({ ...delivery })
    db.tables.scene3d_artifacts.push(...assetRows.map((a) => ({ ...a })))
    db.tables.scene3d_delivery_artifacts.push(...artifacts.map((a) => ({ job_id: JOB,
      artifact_id: a.artifactId, artifact_owner_id: OWNER, usage: a.kind === "poster" ? "poster" : "validation",
      via_revision_id: null })))
    db.tables.scene3d_upload_intents.length = 0
  }
  return { input, db, store, authorizeJob, objects, delivery, assetRows, published }
}
