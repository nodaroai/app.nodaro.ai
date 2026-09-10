import { beforeEach, describe, expect, it, vi } from "vitest"
const { fake } = vi.hoisted(() => ({ fake: { current: null as unknown } }))
vi.mock("@/lib/supabase.js", () => ({ get supabase() { return fake.current } }))
vi.mock("@/lib/workflow-access.js", async (original) => ({
  ...await original<typeof import("../../../lib/workflow-access.js")>(), workflowAccess: vi.fn(),
}))
import { workflowAccess } from "../../../lib/workflow-access.js"
import { publishScene3DDelivery } from "../delivery-publish.js"
import { scene3DArtifactObjectKey } from "../object-keys.js"
import { deliveryFixture, OWNER, JOB, REV, sha } from "./delivery-fixture.js"

/** A real PNG head, because receipt verification refuses anything else. */
const STILL_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)])
const STILL = "00000000-0000-4000-8000-0000000000b1"

let fixture: ReturnType<typeof deliveryFixture>

/** Reserve and upload one shot still for the fixture's v1 (single-shot) scene. */
function withStill(overrides: Record<string, unknown> = {}) {
  const objectKey = scene3DArtifactObjectKey(OWNER, REV, STILL, "shot-still")
  fixture.objects.set(objectKey, STILL_BYTES)
  fixture.db.tables.scene3d_upload_intents.push({ artifact_id: STILL, user_id: OWNER, job_id: JOB,
    revision_id: REV, kind: "shot-still", bucket: "private-scenes", object_key: objectKey,
    receipt_sha256: sha(STILL_BYTES), receipt_byte_length: STILL_BYTES.length, receipt_etag: "tag" })
  fixture.input.artifacts.push({ artifactId: STILL, kind: "shot-still", sha256: sha(STILL_BYTES),
    byteLength: STILL_BYTES.length, objectKey, shotIndex: 0, frame: 0, ...overrides })
  return fixture.input.artifacts[fixture.input.artifacts.length - 1]
}

const run = () => publishScene3DDelivery(fixture.input, fixture)
const stillRow = () => (vi.mocked(fixture.db.rpc).mock.calls[0][1] as { payload: { artifacts: Array<Record<string, unknown>> } })
  .payload.artifacts.find((row) => row.kind === "shot-still")

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(workflowAccess).mockResolvedValue("own")
  fixture = deliveryFixture()
  fake.current = fixture.db
})

describe("publishing a delivery's shot stills", () => {
  it("pins the still beside the poster and report, with the composition's frame size", async () => {
    withStill()
    await expect(run()).resolves.toMatchObject({ status: "created" })
    expect(stillRow()).toEqual(expect.objectContaining({
      artifact_id: STILL, usage: "shot-still", kind: "shot-still",
      shot_index: 0, frame: 0, width: 640, height: 360, via_revision_id: null,
    }))
    // Its bytes were verified like every other delivered artifact.
    expect(fixture.store.get).toHaveBeenCalledTimes(3)
  })

  it("records the producer's own pixel size when it states one", async () => {
    withStill({ width: 320, height: 180 })
    await expect(run()).resolves.toMatchObject({ status: "created" })
    expect(stillRow()).toMatchObject({ width: 320, height: 180 })
  })

  it("still publishes a delivery that renders no stills at all", async () => {
    await expect(run()).resolves.toMatchObject({ status: "created" })
    expect(stillRow()).toBeUndefined()
  })

  it("refuses a still whose shot or frame the composition does not have", async () => {
    withStill({ frame: 1 })
    await expect(run()).rejects.toThrow(/do not match the delivered composition/)
    expect(fixture.db.rpc).not.toHaveBeenCalled()
    fixture = deliveryFixture(); fake.current = fixture.db
    withStill({ shotIndex: 1 })
    await expect(run()).rejects.toThrow(/do not match the delivered composition/)
    expect(fixture.db.rpc).not.toHaveBeenCalled()
  })

  it("refuses a still with no shot identity, and a poster wearing one", async () => {
    withStill({ shotIndex: undefined })
    await expect(run()).rejects.toThrow(/must name its shot index and its frame/)
    fixture = deliveryFixture(); fake.current = fixture.db
    Object.assign(fixture.input.artifacts[0], { shotIndex: 0, frame: 0 })
    await expect(run()).rejects.toThrow(/Only a shot still carries a shot identity/)
    expect(fixture.db.rpc).not.toHaveBeenCalled()
  })

  it("refuses to reuse a still from the source revision", async () => {
    withStill({ reuseFromRevisionId: REV })
    await expect(run()).rejects.toThrow(/cannot be reused from a revision/)
    expect(fixture.store.get).not.toHaveBeenCalled()
  })

  it("replays an identical stills delivery, and refuses one that moved a still", async () => {
    const still = withStill()
    // The published state, written the way the RPC would have: the delivery,
    // every artifact row, and one pin per artifact carrying its own identity.
    fixture.db.tables.scene3d_deliveries.push({ ...fixture.delivery })
    fixture.db.tables.scene3d_artifacts.push(...fixture.assetRows.map((row) => ({ ...row })),
      { id: STILL, user_id: OWNER, kind: "shot-still", sha256: sha(STILL_BYTES),
        byte_length: STILL_BYTES.length, bucket: "private-scenes", object_key: still.objectKey,
        etag: "tag", created_at: "2026-09-08T00:00:00Z", expires_at: null })
    fixture.db.tables.scene3d_delivery_artifacts.push(
      { job_id: JOB, artifact_id: fixture.input.artifacts[0].artifactId, artifact_owner_id: OWNER,
        usage: "poster", via_revision_id: null },
      { job_id: JOB, artifact_id: fixture.input.artifacts[1].artifactId, artifact_owner_id: OWNER,
        usage: "validation", via_revision_id: null },
      { job_id: JOB, artifact_id: STILL, artifact_owner_id: OWNER, usage: "shot-still",
        via_revision_id: null, shot_index: 0, frame: 0, width: 640, height: 360 })
    fixture.db.tables.scene3d_upload_intents.length = 0
    await expect(run()).resolves.toMatchObject({ status: "unchanged" })
    fixture.db.tables.scene3d_delivery_artifacts.at(-1)!.frame = 4
    await expect(run()).rejects.toThrow(/different artifacts/)
  })
})
