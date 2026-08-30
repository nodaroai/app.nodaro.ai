import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge, ResolvedInputs } from "../types.js"
import { assembleImageInput } from "@nodaro/prompts"
import type { ConnectedReference } from "@nodaro/shared"

// ---------------------------------------------------------------------------
// P3 — named-image mentions through the ORCHESTRATOR (FE/BE parity).
//
// Two stacked defects this file pins shut:
//
//  1. `buildConnectedRefsForGenerate` stamped `defaultName: id` (`wired_0`, the
//     raw source node id), so an upload node's LABEL never reached the
//     resolver and `@town:1` had nothing to bind to.
//  2. `useConnectedRefs = hasWiredCharacter || extraRefEntries.length > 0` —
//     an images-only graph took the FLAT branch, so `connectedReferences`
//     never reached `buildImagePrompt` AT ALL, while the frontend
//     (`execute-node.ts`) passes them unconditionally. Left unfixed, a mention
//     resolved on a single-node Run and shipped literal text through the
//     identical DAG run.
//
// The widening is scoped to prompts that carry a RESOLVABLE mention and is
// hybrid-gated, so every mention-free graph keeps its exact branch and byte
// output — which is what the second describe block asserts.
//
// Env pattern (save/restore in `finally`) copied from
// `payload-builder-hybrid-gate.test.ts`: NODE_ENV=test forces legacy, so the
// hybrid cases must simulate staging.
// ---------------------------------------------------------------------------

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}

function edge(source: string, target: string): SimpleEdge {
  return { id: `${source}->${target}`, source, target, sourceHandle: null, targetHandle: null }
}

const TOWN_URL = "https://r2/town.png"

/** An images-only graph: a NAMED `upload-image` node wired into generate-image. */
function buildUploadImagePayload(prompt: string) {
  const upload = node("upload-1", "upload-image", { label: "Town", imageUrl: TOWN_URL })
  const generateImage = node("gen-1", "generate-image", {
    prompt,
    provider: "nano-banana-pro",
  })
  const inputs: ResolvedInputs = { referenceImageUrls: [TOWN_URL] }
  return buildPayload(generateImage, "job-1", inputs, undefined, {
    nodes: [upload, generateImage],
    edges: [edge("upload-1", "gen-1")],
    nodeStates: {},
  })
}

function withHybridEnv<T>(fn: () => T): T {
  const prevNodeEnv = process.env.NODE_ENV
  const prevFmt = process.env.IMAGE_REFERENCE_FORMAT
  try {
    process.env.NODE_ENV = "development"
    process.env.IMAGE_REFERENCE_FORMAT = "hybrid"
    return fn()
  } finally {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prevNodeEnv
    if (prevFmt === undefined) delete process.env.IMAGE_REFERENCE_FORMAT
    else process.env.IMAGE_REFERENCE_FORMAT = prevFmt
  }
}

describe("payload-builder: named-image mentions resolve on an images-only graph", () => {
  it("a named upload-image node + @town:1 → the structured branch, label plumbed", () => {
    const result = withHybridEnv(() => buildUploadImagePayload("a wide shot of @town:1 at dusk"))
    const prompt = result.payload.prompt as string

    expect(prompt).toContain("reference image A")
    expect(prompt).not.toContain("@town")
    expect(result.payload.referenceImageUrls as string[]).toContain(TOWN_URL)
  })

  it("@town:1:background renders the role phrase", () => {
    const result = withHybridEnv(() =>
      buildUploadImagePayload("a wide shot of @town:1:background at dusk"),
    )
    expect(result.payload.prompt as string).toContain("the background from reference image A")
  })

  it("FE/BE PARITY: the orchestrator's prompt equals `assembleImageInput` on the equivalent frontend refs", () => {
    // The frontend (`frontend/src/components/editor/workflow-editor/execute-node.ts`)
    // names a wired upstream from its node label and passes `connectedReferences`
    // unconditionally. Feeding the SAME reference list through the shared
    // assembler must reproduce the orchestrator's prompt byte for byte.
    const userPrompt = "a wide shot of @town:1:background at dusk"
    const frontendRefs: ConnectedReference[] = [
      { id: "upload-1", defaultName: "Town", source: "wired-image", url: TOWN_URL },
    ]
    const { orchestrated, frontendish } = withHybridEnv(() => ({
      orchestrated: buildUploadImagePayload(userPrompt),
      frontendish: assembleImageInput({
        userPrompt,
        provider: "nano-banana-pro",
        referenceFormat: "hybrid",
        connectedReferences: frontendRefs,
      }),
    }))
    expect(orchestrated.payload.prompt as string).toBe(frontendish.prompt)
    expect(orchestrated.payload.referenceImageUrls as string[]).toEqual(
      frontendish.referenceImageUrls,
    )
  })
})

describe("payload-builder: the useConnectedRefs widening is scoped to resolvable mentions", () => {
  it("MENTION-FREE graph → byte-identical prompt and referenceImageUrls (flat branch kept)", () => {
    // The pre-change flat-branch output for this graph. Captured, not
    // re-derived: this is the guard on the branch widening.
    const result = withHybridEnv(() => buildUploadImagePayload("a wide shot of a quiet town square"))
    expect(result.payload.prompt as string).toBe("a wide shot of a quiet town square")
    expect(result.payload.referenceImageUrls as string[]).toEqual([TOWN_URL])
  })

  it("an UNRESOLVABLE mention (no ref by that name) does not widen the branch either", () => {
    const result = withHybridEnv(() => buildUploadImagePayload("a wide shot of @plaza:1 at dusk"))
    // Nothing to bind → token stays literal, flat branch, output unchanged.
    expect(result.payload.prompt as string).toContain("@plaza:1")
    expect(result.payload.referenceImageUrls as string[]).toEqual([TOWN_URL])
  })

  it("an UNNAMED upload node keeps its id-derived name (no node label to plumb)", () => {
    // No `label`/`name` on the upload node → `buildRefNameLookup` falls back to
    // the node TYPE ("upload-image"), which slugs to "upload-image".
    const upload = node("upload-1", "upload-image", { imageUrl: TOWN_URL })
    const generateImage = node("gen-1", "generate-image", {
      prompt: "a wide shot of @town:1 at dusk",
      provider: "nano-banana-pro",
    })
    const result = withHybridEnv(() =>
      buildPayload(generateImage, "job-1", { referenceImageUrls: [TOWN_URL] }, undefined, {
        nodes: [upload, generateImage],
        edges: [edge("upload-1", "gen-1")],
        nodeStates: {},
      }),
    )
    expect(result.payload.prompt as string).toContain("@town:1")
  })
})

describe("payload-builder: LEGACY reference format leaves image mentions literal", () => {
  it("NODE_ENV=test (the legacy default) → flat branch, token verbatim", () => {
    expect(process.env.NODE_ENV).toBe("test")
    const result = buildUploadImagePayload("a wide shot of @town:1 at dusk")
    expect(result.payload.prompt as string).toContain("@town:1")
    expect(result.payload.prompt as string).not.toContain("reference image A")
    expect(result.payload.referenceImageUrls as string[]).toContain(TOWN_URL)
  })
})
