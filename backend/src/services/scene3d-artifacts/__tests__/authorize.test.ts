import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Who may read a scene, and its bytes.
 *
 * The rule under test is one sentence — "ask the workflow access seam, always,
 * by id" — and every test here is a way of getting that sentence wrong that
 * would look harmless in review:
 *
 *   - short-circuiting for the creator (the suspended-member case);
 *   - treating "may watch" and "may download the project" as one permission;
 *   - authorizing the ARTIFACT instead of the revision that pins it;
 *   - excluding the private kinds with a deny-list that the next kind escapes.
 */

const { fake } = vi.hoisted(() => ({ fake: { current: null as unknown } }))

vi.mock("@/lib/supabase.js", () => ({
  get supabase() {
    return (fake.current as { from: unknown; rpc: unknown }).from
      ? (fake.current as { from: unknown; rpc: unknown })
      : { from: () => ({}), rpc: () => ({}) }
  },
}))

vi.mock("@/lib/workflow-access.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/workflow-access.js")>()
  return { ...actual, workflowAccess: vi.fn() }
})

import { workflowAccess } from "../../../lib/workflow-access.js"
import { createFakeSupabase } from "./fake-supabase.js"
import {
  SCENE3D_ARTIFACT_KINDS,
  SCENE3D_ARTIFACT_KIND_USAGE,
  SCENE3D_ARTIFACT_USAGES,
} from "../types.js"
import { authorizeScene3DArtifact, authorizeScene3DRevision, scene3DIsReadable } from "../authorize.js"
import { authorizeScene3DInputArtifact } from "../../../lib/private-plugins/scene3d-input-authority.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-0000000000ff"
const WF = "00000000-0000-4000-8000-000000000020"
const REV = "00000000-0000-4000-8000-000000000030"
const PERSONAL_REV = "00000000-0000-4000-8000-000000000031"
const OTHER_REV = "00000000-0000-4000-8000-000000000032"
const GLB = "00000000-0000-4000-8000-000000000040"
const BLEND = "00000000-0000-4000-8000-000000000041"
const RECIPE = "00000000-0000-4000-8000-000000000042"
const INPUT = "00000000-0000-4000-8000-000000000043"

function artifact(id: string, kind: string) {
  return {
    id,
    user_id: OWNER,
    kind,
    bucket: "private-scenes",
    object_key: `scene3d/${OWNER}/${REV}/${id}`,
    sha256: "a".repeat(64),
    byte_length: 1024,
    etag: "tag",
    expires_at: null,
    created_at: "2026-01-01T00:00:00Z",
  }
}

function revision(id: string, workflowId: string | null) {
  return {
    id,
    user_id: OWNER,
    workflow_id: workflowId,
    source_job_id: null,
    parent_revision_id: null,
    plan: { planType: "3d-scene", schemaVersion: 1, revisionId: id },
    plan_sha256: "c".repeat(64),
    created_at: "2026-01-01T00:00:00Z",
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  fake.current = createFakeSupabase({
    scene3d_revisions: [revision(REV, WF), revision(PERSONAL_REV, null)],
    scene3d_artifacts: [artifact(GLB, "glb"), artifact(BLEND, "blend-source"), artifact(RECIPE, "source-json"), artifact(INPUT, "input-glb")],
    scene3d_revision_artifacts: [
      { revision_id: REV, artifact_id: GLB, user_id: OWNER, usage: "playback" },
      { revision_id: REV, artifact_id: BLEND, user_id: OWNER, usage: "source" },
      { revision_id: REV, artifact_id: RECIPE, user_id: OWNER, usage: "checkpoint" },
      { revision_id: REV, artifact_id: INPUT, user_id: OWNER, usage: "checkpoint" },
      { revision_id: PERSONAL_REV, artifact_id: GLB, user_id: OWNER, usage: "playback" },
      { revision_id: OTHER_REV, artifact_id: BLEND, user_id: OWNER, usage: "source" },
    ],
  })
})

describe("private retained inputs", () => {
  it("allows the private engine only with edit access to the exact retained revision", async () => {
    vi.mocked(workflowAccess).mockResolvedValue("edit")
    expect(await authorizeScene3DInputArtifact(OTHER, REV, INPUT)).toMatchObject({ ok: true, artifact: { artifactId: INPUT } })
    expect(await authorizeScene3DInputArtifact(OTHER, OTHER_REV, INPUT)).toMatchObject({ ok: false })
    for (const lane of ["playback", "source"] as const) {
      expect(await authorizeScene3DArtifact(OTHER, REV, INPUT, lane)).toMatchObject({ ok: false })
    }
  })
  it("does not grant retained construction bytes to a viewer or revoked original owner", async () => {
    vi.mocked(workflowAccess).mockResolvedValue("view")
    expect(await authorizeScene3DInputArtifact(OTHER, REV, INPUT)).toMatchObject({ ok: false, reason: "forbidden" })
    expect(await authorizeScene3DInputArtifact(OTHER, REV, GLB)).toMatchObject({ ok: true })
    vi.mocked(workflowAccess).mockResolvedValue("none")
    expect(await authorizeScene3DInputArtifact(OWNER, REV, INPUT)).toMatchObject({ ok: false })
  })
})

describe("workflow-attached revisions ask the access seam", () => {
  it("asks it for the CREATOR too — a suspended member still created their work", async () => {
    vi.mocked(workflowAccess).mockResolvedValue("own")
    const result = await authorizeScene3DRevision(OWNER, REV, "playback")

    expect(result.ok).toBe(true)
    // The whole point: creator + attached workflow still consults the rule.
    expect(workflowAccess).toHaveBeenCalledWith(OWNER, WF)
  })

  it("refuses the creator once the workspace has revoked them", async () => {
    vi.mocked(workflowAccess).mockResolvedValue("none")
    const result = await authorizeScene3DRevision(OWNER, REV, "playback")

    expect(result).toEqual({ ok: false, reason: "not-found" })
  })

  it("lets a collaborator with view watch, and only watch", async () => {
    vi.mocked(workflowAccess).mockResolvedValue("view")

    expect((await authorizeScene3DRevision(OTHER, REV, "playback")).ok).toBe(true)
    expect(await authorizeScene3DRevision(OTHER, REV, "source")).toEqual({
      ok: false,
      reason: "forbidden",
    })
  })

  it("lets an editor take the source", async () => {
    vi.mocked(workflowAccess).mockResolvedValue("edit")
    expect((await authorizeScene3DRevision(OTHER, REV, "source")).ok).toBe(true)
  })
})

describe("revisions with no workflow are owner-only", () => {
  it("answers own for the owner without consulting the seam", async () => {
    const result = await authorizeScene3DRevision(OWNER, PERSONAL_REV, "source")
    expect(result.ok && result.access).toBe("own")
    expect(workflowAccess).not.toHaveBeenCalled()
  })

  it("is a 404 for anybody else", async () => {
    expect(await authorizeScene3DRevision(OTHER, PERSONAL_REV, "playback")).toEqual({
      ok: false,
      reason: "not-found",
    })
  })
})

describe("a deleted revision stops being reachable immediately", () => {
  it("404s once the row is gone, whatever the workflow says", async () => {
    vi.mocked(workflowAccess).mockResolvedValue("own")
    const tables = (fake.current as ReturnType<typeof createFakeSupabase>).tables
    tables.scene3d_revisions.length = 0

    expect(await authorizeScene3DRevision(OWNER, REV, "playback")).toEqual({
      ok: false,
      reason: "not-found",
    })
  })

  it("404s a malformed id without asking the database to cast it", async () => {
    expect(await authorizeScene3DRevision(OWNER, "not-a-uuid", "playback")).toEqual({
      ok: false,
      reason: "not-found",
    })
  })
})

describe("an artifact is reached only through the revision that pins it", () => {
  beforeEach(() => vi.mocked(workflowAccess).mockResolvedValue("own"))

  it("serves an asset this revision pins", async () => {
    const result = await authorizeScene3DArtifact(OWNER, REV, GLB, "playback")
    expect(result.ok && result.artifact.artifactId).toBe(GLB)
  })

  it("404s an asset the owner owns but THIS revision does not use", async () => {
    // BLEND is pinned by OTHER_REV as well; asking for it under PERSONAL_REV
    // must not resolve just because the caller owns the bytes.
    expect(await authorizeScene3DArtifact(OWNER, PERSONAL_REV, BLEND, "source")).toEqual({
      ok: false,
      reason: "not-found",
    })
  })

  it("never serves the private recipe, on either lane", async () => {
    expect(await authorizeScene3DArtifact(OWNER, REV, RECIPE, "playback")).toEqual({
      ok: false,
      reason: "not-found",
    })
    expect(await authorizeScene3DArtifact(OWNER, REV, RECIPE, "source")).toEqual({
      ok: false,
      reason: "not-found",
    })
  })

  it("keeps the source file off the playback lane and the GLB off the source lane", async () => {
    expect(await authorizeScene3DArtifact(OWNER, REV, BLEND, "playback")).toEqual({
      ok: false,
      reason: "not-found",
    })
    expect(await authorizeScene3DArtifact(OWNER, REV, GLB, "source")).toEqual({
      ok: false,
      reason: "not-found",
    })
  })
})

describe("the lane allowlists are total", () => {
  it("places every kind on at most one lane, and the private kinds on none", () => {
    for (const kind of SCENE3D_ARTIFACT_KINDS) {
      const usage = SCENE3D_ARTIFACT_KIND_USAGE[kind]
      const playback = scene3DIsReadable({ kind, usage }, "playback")
      const source = scene3DIsReadable({ kind, usage }, "source")
      expect(playback && source, `${kind} is on both lanes`).toBe(false)
      if (usage === "checkpoint") {
        expect(playback || source, "a private checkpoint is user-readable").toBe(false)
      }
    }
  })

  it("refuses a pin whose usage does not match its kind", () => {
    // Defense in depth: a `source-json` mis-pinned as `playback` must not be
    // served because one of the two columns agreed with the lane.
    for (const usage of SCENE3D_ARTIFACT_USAGES) {
      if (usage === "playback") continue
      expect(scene3DIsReadable({ kind: "glb", usage }, "playback")).toBe(false)
    }
    expect(scene3DIsReadable({ kind: "source-json", usage: "playback" }, "playback")).toBe(false)
  })
})
