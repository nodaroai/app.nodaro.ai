import { describe, it, expect } from "vitest"
import { stripExportContent } from "../workflow-export.js"
import { EXECUTION_DATA_KEYS } from "../node-runtime-keys.js"
import type { GenericNode } from "../types.js"

/**
 * Invariant guard for the template-export leak class (audit R2-H4): a
 * "shareable" template export must never carry runtime/result fields —
 * generated media URLs, internal job ids, trained-LoRA identity, etc. Those
 * are enumerated in EXECUTION_DATA_KEYS (the single source of truth), and
 * GENERATED_FIELDS is built from it, so this test fails the moment a new
 * runtime key is added without being covered.
 */
describe("stripExportContent — template export hygiene", () => {
  // `shots` lives in EXECUTION_DATA_KEYS but is user config (Kling-3.0
  // storyboard) — it must SURVIVE a template export, not be stripped.
  const CONFIG_KEPT = new Set(["shots"])

  it("strips runtime/result EXECUTION_DATA_KEYS while keeping config fields", () => {
    const data: Record<string, unknown> = {}
    for (const key of EXECUTION_DATA_KEYS) data[key] = "SENSITIVE_RUNTIME_VALUE"
    data.prompt = "keep me" // a real config field — must survive the strip
    data.provider = "veo3.1"

    const node: GenericNode = { id: "n1", type: "generate-video", data }
    const [out] = stripExportContent([node])
    const outData = out.data as Record<string, unknown>

    for (const key of EXECUTION_DATA_KEYS) {
      if (CONFIG_KEPT.has(key)) continue
      expect(outData[key], `${key} must be stripped from a template export`).toBeUndefined()
    }
    expect(outData.prompt).toBe("keep me")
    expect(outData.provider).toBe("veo3.1")
    // Regression guard: Kling-3.0 multishot config must survive template export.
    expect(outData.shots, "shots (Kling-3 config) must NOT be stripped").toBe("SENSITIVE_RUNTIME_VALUE")
  })

  it("clears faceDbId / referencedWorkflowId on face + sub-workflow template nodes", () => {
    const face: GenericNode = { id: "f1", type: "face", data: { faceDbId: "exporter-face-id", name: "Hero" } }
    const sub: GenericNode = { id: "s1", type: "sub-workflow", data: { referencedWorkflowId: "exporter-wf-id" } }
    const [outFace, outSub] = stripExportContent([face, sub])
    expect((outFace.data as Record<string, unknown>).faceDbId).toBeUndefined()
    expect((outSub.data as Record<string, unknown>).referencedWorkflowId).toBeUndefined()
  })
})
