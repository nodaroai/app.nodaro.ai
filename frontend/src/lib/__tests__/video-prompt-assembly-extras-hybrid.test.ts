import { describe, it, expect, vi } from "vitest"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

// Force the shared reference-format gate to HYBRID (it resolves to "legacy" in
// the default test env). This mounts the hybrid assembly path in
// `resolveVideoPromptMentions`, where first-sight extra `elementInjection`
// surfaces. The legacy path is covered by `video-prompt-assembly.test.ts`.
vi.mock("@/lib/image-reference-format", () => ({
  get IMAGE_REFERENCE_FORMAT() {
    return "hybrid"
  },
}))

import { resolveVideoPromptMentions } from "@/lib/video-prompt-assembly"

function n(id: string, type: string, data: Record<string, unknown>): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data } as unknown as WorkflowNode
}
function e(source: string, target: string, targetHandle?: string): WorkflowEdge {
  return { id: `${source}->${target}`, source, target, targetHandle } as unknown as WorkflowEdge
}

// FE mirror of the backend payload-builder Reference Roles F3 guard: a first-sight
// character extra whose slug has a wired scene-composition element (held-prop)
// must surface that injection in the video HYBRID output — the FE extras builder
// now populates `VideoExtraRef.elementInjection` from the same map the
// mention/canonical paths use (`collectCharacterElementInjections`).
describe("resolveVideoPromptMentions — first-sight extra elementInjection (hybrid, F3)", () => {
  it("surfaces the wired held-prop of a first-sight extra character", () => {
    const character = n("char-shira", "character", {
      label: "shira",
      characterName: "shira",
      sourceImageUrl: "http://shira/portrait.png",
      defaultAssetUrl: "http://shira/portrait.png",
      canonicalDescription: "young woman, brown eyes",
    })
    const heldProp = n("hp-1", "held-prop", { heldProp: "smartphone" })
    const nodes = [character, heldProp, n("v1", "text-to-video", {})]
    const edges = [
      e("hp-1", "char-shira", "assets"), // held-prop → character
      e("char-shira", "v1"), // character → consumer (canonical suppressed below)
    ]
    const out = resolveVideoPromptMentions(
      "a neon-lit street",
      "v1",
      nodes,
      edges,
      // The extra references shira; suppress shira's canonical so the extra is
      // FIRST-SIGHT (not a pair-back), exercising the element-injection branch.
      [{ url: "http://shira/alt.png", description: "leaning on a railing", characterSlug: "shira", variantSlug: "alt" }],
      { suppressedCanonicalCharacterIds: ["shira"] },
    )
    // Held-prop rides the first-sight extra as a trailing scene directive.
    expect(out.prompt?.toLowerCase()).toContain("smartphone")
    // Hybrid (no legacy block) + first-sight (not a pair-back).
    expect(out.prompt).not.toContain("Use these characters:")
    expect(out.prompt).not.toContain("is the same subject as")
    // Extra URL rode along.
    expect(out.additionalUrls).toContain("http://shira/alt.png")
  })
})
