import { describe, it, expect, vi } from "vitest"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: vi.fn(() => ({ characterDefinitions: [], nodes: [], edges: [] })),
    setState: vi.fn(),
  },
}))

vi.mock("@/lib/prompt-builder", () => ({
  buildScenePrompt: vi.fn(() => "mock scene prompt"),
}))

import { NODE_MAPPABLE_FIELDS } from "@nodaro-shared/node-mappable-fields"

describe("cinematography is no longer a field-mapping concern on AI gen consumers", () => {
  it("image-to-video's mappable fields do not include cinematography dimension names", () => {
    const mappableFields = NODE_MAPPABLE_FIELDS["image-to-video"] ?? []
    expect(mappableFields).not.toContain("framing")
    expect(mappableFields).not.toContain("cameraMotion")
    expect(mappableFields).not.toContain("lens")
    expect(mappableFields).not.toContain("cameraFormat")
    expect(mappableFields).not.toContain("colorLook")
    expect(mappableFields).not.toContain("atmosphere")
    expect(mappableFields).not.toContain("temporal")
  })

  it("generate-image's mappable fields drop lens/cameraFormat/colorLook/atmosphere", () => {
    const mappableFields = NODE_MAPPABLE_FIELDS["generate-image"] ?? []
    expect(mappableFields).not.toContain("lens")
    expect(mappableFields).not.toContain("cameraFormat")
    expect(mappableFields).not.toContain("colorLook")
    expect(mappableFields).not.toContain("atmosphere")
    // prompt/style/negativePrompt are still mappable
    expect(mappableFields).toContain("prompt")
    expect(mappableFields).toContain("style")
    expect(mappableFields).toContain("negativePrompt")
  })
})
