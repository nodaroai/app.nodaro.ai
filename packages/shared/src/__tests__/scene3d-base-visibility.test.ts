import { describe, expect, it } from "vitest"
import { scene3DPlanV2Schema } from "../scene3d-v2-plan.js"
import { applyScene3DV2EditOperations } from "../scene3d-v2-edit.js"
import { computeScene3DPlanV2ContentHash, verifyScene3DPlanV2ContentHash } from "../scene3d-v2-resources.js"
import { planV2 } from "./scene3d-v2-fixtures.js"

describe("baked entity visibility", () => {
  it("round-trips false without adding a default to existing revisions", async () => {
    const original = planV2()
    const hidden = { ...original, objects: original.objects.map(e => ({ ...e, visible: false })) }
    expect(scene3DPlanV2Schema.parse(hidden).objects.every(e => e.visible === false)).toBe(true)
    expect(scene3DPlanV2Schema.parse(original).objects.every(e => !("visible" in e))).toBe(true)
    expect(await computeScene3DPlanV2ContentHash(hidden)).not.toBe(await computeScene3DPlanV2ContentHash(original))
    expect(scene3DPlanV2Schema.safeParse({ ...hidden, objects: hidden.objects.map(e => ({ ...e, visible: "false" })) }).success).toBe(false)
  })

  it("keeps baked visibility when a temporary show override is added and removed", async () => {
    const original = planV2()
    const hidden = { ...original, overrides: [], objects: original.objects.map(e => ({ ...e, visible: e.id !== "e2" })) }
    hidden.provenance = { ...hidden.provenance, contentHash: await computeScene3DPlanV2ContentHash(hidden) }
    const shown = await applyScene3DV2EditOperations(hidden, [{ op: "set-override", override: {
      kind: "entity-visibility", entityId: "e2", visible: true,
    } }], { expectedRevisionId: hidden.revisionId })
    expect(shown.ok).toBe(true)
    if (!shown.ok) return
    const override = shown.plan.overrides!.find(o => o.kind === "entity-visibility")!
    const reset = await applyScene3DV2EditOperations(shown.plan, [{ op: "remove-override", overrideId: override.id }], {
      expectedRevisionId: shown.plan.revisionId,
    })
    expect(reset.ok).toBe(true)
    if (!reset.ok) return
    expect(reset.plan.objects.find(e => e.id === "e2")?.visible).toBe(false)
    expect(reset.plan.overrides).toEqual([])
    expect(await verifyScene3DPlanV2ContentHash(reset.plan)).toBe(true)
  })
})
