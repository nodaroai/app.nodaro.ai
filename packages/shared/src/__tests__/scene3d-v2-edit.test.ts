import { describe, expect, it } from "vitest"
import { applyScene3DV2EditOperations } from "../scene3d-v2-edit.js"
import { computeScene3DPlanV2ContentHash, verifyScene3DPlanV2ContentHash } from "../scene3d-v2-resources.js"
import { planV2 } from "./scene3d-v2-fixtures.js"

async function fixture() {
  const p = planV2()
  return { ...p, provenance: { ...p.provenance, contentHash: await computeScene3DPlanV2ContentHash(p) } }
}
const move = { op: "set-override" as const, override: { kind: "entity-transform" as const, entityId: "e2", space: "world" as const, position: [4, 0, 0] as [number, number, number] } }
const revision = "c94b9f2f-4f10-48a6-a0bf-3ca4c2653b5a"

describe("baked scene edits", () => {
  it("preserves unrelated state, stamps an immutable revision, and withdraws a stale native download", async () => {
    const p = await fixture()
    const before = JSON.stringify(p)
    const result = await applyScene3DV2EditOperations(p, [move], { expectedRevisionId: p.revisionId, newRevisionId: revision })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.revisionId).toBe(revision)
    expect(result.plan.parentRevisionId).toBe(p.revisionId)
    expect(result.plan.objects).toEqual(p.objects)
    expect(result.plan.assets).toEqual(p.assets.filter((a) => a.kind === "glb" || a.kind === "camera-track-json").map((a) => ({ ...a, originRevisionId: a.originRevisionId ?? p.revisionId })))
    expect(result.plan.provenance.sourceArtifactId).toBeUndefined()
    expect(result.plan.overrides?.find((o) => o.kind === "entity-color")).toEqual(p.overrides?.find((o) => o.kind === "entity-color"))
    expect(result.plan.overrides?.find((o) => o.kind === "entity-transform")).toMatchObject({ position: [4, 0, 0], sourceRevisionId: p.revisionId, sourceContentHash: p.provenance.contentHash })
    expect(await verifyScene3DPlanV2ContentHash(result.plan)).toBe(true)
    expect(JSON.stringify(p)).toBe(before)
  })
  it("replays identically with an admission-allocated revision", async () => {
    const p = await fixture()
    const options = { expectedRevisionId: p.revisionId, newRevisionId: revision }
    expect(await applyScene3DV2EditOperations(p, [move], options)).toEqual(await applyScene3DV2EditOperations(p, [move], options))
  })
  it("withdraws images and validation that describe the previous revision", async () => {
    const p = await fixture()
    p.assets.push(
      { assetId: "12b3a7d6-3aef-4e5f-b388-e6b96dcaa0f1", kind: "poster", role: "poster", sha256: "a".repeat(64), byteLength: 100 },
      { assetId: "12b3a7d6-3aef-4e5f-b388-e6b96dcaa0f2", kind: "validation-report", role: "validation-report", sha256: "b".repeat(64), byteLength: 100 },
    )
    p.provenance.contentHash = await computeScene3DPlanV2ContentHash(p)
    const result = await applyScene3DV2EditOperations(p, [move], { expectedRevisionId: p.revisionId })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.plan.assets.every((a) => a.kind === "glb" || a.kind === "camera-track-json")).toBe(true)
  })
  it("rejects stale identity and content, and tampered manifests", async () => {
    const p = await fixture()
    expect(await applyScene3DV2EditOperations(p, [move], { expectedRevisionId: revision })).toMatchObject({ ok: false, code: "stale_revision" })
    expect(await applyScene3DV2EditOperations(p, [move], { expectedRevisionId: p.revisionId, expectedContentHash: "a".repeat(64) })).toMatchObject({ ok: false, code: "stale_revision" })
    expect(await applyScene3DV2EditOperations({ ...p, backgroundColor: "#ffffff" }, [move], { expectedRevisionId: p.revisionId })).toMatchObject({ ok: false, code: "invalid_plan" })
  })
  it("blocks changes and removal of changes on locked entities", async () => {
    const p = await fixture()
    const options = { expectedRevisionId: p.revisionId, lockedObjectIds: ["e2"] }
    expect(await applyScene3DV2EditOperations(p, [move], options)).toMatchObject({ ok: false, code: "locked" })
    expect(await applyScene3DV2EditOperations(p, [{ op: "remove-override", overrideId: "ov-1" }], options)).toMatchObject({ ok: false, code: "locked" })
  })
  it("cannot evade a descendant lock by moving or hiding its parent", async () => {
    const p = await fixture()
    const options = { expectedRevisionId: p.revisionId, lockedObjectIds: ["e2"] }
    expect(await applyScene3DV2EditOperations(p, [{ ...move, override: { ...move.override, entityId: "e1" } }], options)).toMatchObject({ ok: false, code: "locked" })
    expect(await applyScene3DV2EditOperations(p, [{ op: "set-override", override: { kind: "entity-visibility", entityId: "e1", visible: false } }], options)).toMatchObject({ ok: false, code: "locked" })
  })
  it("preserves edited pose components when another component changes", async () => {
    const p = await fixture()
    const result = await applyScene3DV2EditOperations(p, [move, { ...move, override: { kind: "entity-transform", entityId: "e2", space: "world", rotation: [0, 1, 0] } }], { expectedRevisionId: p.revisionId })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.plan.overrides?.find((o) => o.kind === "entity-transform")).toMatchObject({ position: [4, 0, 0], rotation: [0, 1, 0] })
  })
  it("does not carry coordinates across a space change", async () => {
    const p = await fixture()
    const result = await applyScene3DV2EditOperations(p, [{ ...move, override: { kind: "entity-transform", entityId: "e2", space: "local", rotation: [0, 1, 0] } }], { expectedRevisionId: p.revisionId })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.plan.overrides?.find((o) => o.kind === "entity-transform")).not.toHaveProperty("position")
  })
  it("rejects missing targets, unknown material roles, and invalid later operations atomically", async () => {
    const p = await fixture()
    const before = JSON.stringify(p)
    expect(await applyScene3DV2EditOperations(p, [move, { op: "set-override", override: { kind: "entity-color", entityId: "e2", materialRole: "chair", color: "#ffffff" } }], { expectedRevisionId: p.revisionId })).toMatchObject({ ok: false, code: "invalid_operations" })
    expect(await applyScene3DV2EditOperations(p, [{ op: "remove-override", overrideId: "missing" }], { expectedRevisionId: p.revisionId })).toMatchObject({ ok: false, code: "invalid_operations" })
    expect(JSON.stringify(p)).toBe(before)
  })
})
