// frontend/src/lib/__tests__/studio.test.ts
import { describe, it, expect } from "vitest"
import { isStudioWorkflowSettings, isStudioProject, studioWorkflowUrl } from "@/lib/studio"

describe("studio helpers", () => {
  it("detects studio workflow settings (object marker)", () => {
    expect(isStudioWorkflowSettings({ studio: { shots: [] } })).toBe(true)
    expect(isStudioWorkflowSettings({ studio: true })).toBe(true)
    expect(isStudioWorkflowSettings({ flowPromptTemplates: {} })).toBe(false)
    expect(isStudioWorkflowSettings(null)).toBe(false)
    expect(isStudioWorkflowSettings(undefined)).toBe(false)
  })

  it("detects studio project but never the default project", () => {
    expect(isStudioProject({ settings: { studio: true }, isDefault: false })).toBe(true)
    expect(isStudioProject({ settings: { studio: true }, isDefault: true })).toBe(false)
    expect(isStudioProject({ settings: {}, isDefault: false })).toBe(false)
    expect(isStudioProject({ isDefault: false })).toBe(false)
  })

  it("builds the studio deep link from the workflow id", () => {
    expect(studioWorkflowUrl("abc-123")).toBe("https://studio.nodaro.ai/project/abc-123")
  })
})
