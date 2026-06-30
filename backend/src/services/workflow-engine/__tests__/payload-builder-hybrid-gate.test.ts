import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge, ResolvedInputs } from "../types.js"

// ---------------------------------------------------------------------------
// Orchestrator image-assembly hybrid gate (Reference Roles Phase E, Task 1)
//
// The two `assembleImageInput(...)` call sites in `payload-builder.ts` (the
// connected-refs branch and the flat-extra-refs branch) thread
// `referenceFormat: "hybrid"` ONLY when `backendHybridRoles()` is true — the
// SAME env signal the single-node route (`routes/generate-image.ts`) and the
// video path already gate on. This guards the gate end-to-end:
//
//   • default test env (NODE_ENV=test)        → gate false → LEGACY block
//     ("Use these characters:" directive), workflow-run images stay legacy.
//   • simulated staging (NODE_ENV non-prod +   → gate true  → HYBRID role phrase
//     IMAGE_REFERENCE_FORMAT=hybrid)              ("the … from reference image A").
//
// Mirrors the helper style of payload-builder-mentions.test.ts.
// ---------------------------------------------------------------------------

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}

function edge(
  source: string,
  target: string,
  sourceHandle?: string | null,
  targetHandle?: string | null,
): SimpleEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    sourceHandle: sourceHandle ?? null,
    targetHandle: targetHandle ?? null,
  }
}

// A wired character → connected-refs assembly branch (the line ~1794 call site).
function charNode(id: string): SimpleNode {
  return node(id, "character", {
    label: "Victoria",
    characterName: "Victoria",
    sourceImageUrl: "https://r2/victoria-source.png",
    description: "young woman with warm smile",
    canonicalDescription:
      "young woman, brown eyes, auburn shoulder-length hair, athletic build",
    defaultAssetUrl: "https://r2/victoria-portrait.png",
    expressions: [],
    poses: [],
    motions: [],
    angles: [],
    bodyAngles: [],
    lightingVariations: [],
  })
}

function buildWiredCharacterImagePayload() {
  const character = charNode("char-1")
  // UNMENTIONED wired character (no @victoria token) → canonical fallback path.
  const generateImage = node("gen-1", "generate-image", {
    prompt: "a cinematic portrait",
    provider: "nano-banana-pro",
  })
  const nodes = [character, generateImage]
  const edges = [edge("char-1", "gen-1")] // default (identity) handle → wired char
  const inputs: ResolvedInputs = {
    referenceImageUrls: ["https://r2/victoria-portrait.png"],
  }
  return buildPayload(generateImage, "job-1", inputs, undefined, {
    nodes,
    edges,
    nodeStates: {},
  })
}

describe("payload-builder: orchestrator image-assembly hybrid gate", () => {
  it("default test env (gate dark) → LEGACY 'Use these characters:' block, no hybrid role phrase", () => {
    // NODE_ENV=test under vitest → backendHybridRoles() === false.
    expect(process.env.NODE_ENV).toBe("test")

    const result = buildWiredCharacterImagePayload()
    const prompt = result.payload.prompt as string

    expect(result.jobName).toBe("generate-image")
    // Legacy directive block is present…
    expect(prompt).toContain("Use these characters:")
    // …and the hybrid role phrase is NOT.
    expect(prompt).not.toMatch(/from reference image [A-Z]/)
  })

  it("simulated staging env (gate live) → HYBRID 'the … from reference image A' phrase, no legacy block", () => {
    const prevNodeEnv = process.env.NODE_ENV
    const prevFmt = process.env.IMAGE_REFERENCE_FORMAT
    try {
      // Make backendHybridRoles() return true: non-test, non-production, and an
      // explicit hybrid opt-in (belt-and-suspenders vs the env default).
      process.env.NODE_ENV = "development"
      process.env.IMAGE_REFERENCE_FORMAT = "hybrid"

      const result = buildWiredCharacterImagePayload()
      const prompt = result.payload.prompt as string

      expect(result.jobName).toBe("generate-image")
      // Hybrid role phrase is present…
      expect(prompt).toMatch(/from reference image A/)
      // …and the legacy directive block is NOT.
      expect(prompt).not.toContain("Use these characters:")
      // The reference URL still rides along (assembly unchanged otherwise).
      expect(result.payload.referenceImageUrls as string[]).toContain(
        "https://r2/victoria-portrait.png",
      )
    } finally {
      // Restore env so no other test in this file/worker sees the override.
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevFmt === undefined) delete process.env.IMAGE_REFERENCE_FORMAT
      else process.env.IMAGE_REFERENCE_FORMAT = prevFmt
    }
  })

  it("the legacy↔hybrid flip is driven SOLELY by the env gate (same wiring both ways)", () => {
    // Same node graph, two env states, opposite assembly — proves the gate is
    // the only lever (no node-data difference).
    const legacy = buildWiredCharacterImagePayload()
    expect((legacy.payload.prompt as string)).toContain("Use these characters:")

    const prevNodeEnv = process.env.NODE_ENV
    const prevFmt = process.env.IMAGE_REFERENCE_FORMAT
    try {
      process.env.NODE_ENV = "development"
      process.env.IMAGE_REFERENCE_FORMAT = "hybrid"
      const hybrid = buildWiredCharacterImagePayload()
      expect((hybrid.payload.prompt as string)).toMatch(/from reference image A/)
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = prevNodeEnv
      if (prevFmt === undefined) delete process.env.IMAGE_REFERENCE_FORMAT
      else process.env.IMAGE_REFERENCE_FORMAT = prevFmt
    }
  })
})
