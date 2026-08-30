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

/** The same graph with NO label on the upload node — the type-fallback case. */
function buildUnnamedUploadPayload(prompt: string) {
  const upload = node("upload-1", "upload-image", { imageUrl: TOWN_URL })
  const generateImage = node("gen-1", "generate-image", { prompt, provider: "nano-banana-pro" })
  return buildPayload(generateImage, "job-1", { referenceImageUrls: [TOWN_URL] }, undefined, {
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

  it("an UNNAMED upload node is named from its TYPE, so `@town:1` finds nothing", () => {
    const result = withHybridEnv(() => buildUnnamedUploadPayload("a wide shot of @town:1 at dusk"))
    expect(result.payload.prompt as string).toContain("@town:1")
  })
})

describe("payload-builder: how an UNNAMED node gets its mention name", () => {
  // `buildRefNameLookup` resolves `label ?? name ?? type` — the node TYPE, NOT
  // the node id. So an unlabelled upload node is mentionable as
  // `@upload-image:N`. Deliberate: the frontend
  // (`execute-node.ts`, `label || name || type`) does exactly the same, and
  // dropping the type fallback here would make the two engines resolve
  // different mention sets on the same graph.
  it("the TYPE fallback is mentionable: `@upload-image:1` RESOLVES", () => {
    const result = withHybridEnv(() =>
      buildUnnamedUploadPayload("a wide shot of @upload-image:1 at dusk"),
    )
    const prompt = result.payload.prompt as string
    expect(prompt).toContain("reference image A")
    expect(prompt).not.toContain("@upload-image")
  })

  it("a ref id with NO node behind it keeps the id as its name (the `?? id` fallback)", () => {
    // `extractedReferenceUrls` keys as `extracted_0` — an id that is not a
    // canvas node id, so the lookup misses and the id itself is the name. It
    // slugs to "extracted-0", which a leading-digit-free slug CAN match.
    const generateImage = node("gen-1", "generate-image", {
      prompt: "a wide shot of @extracted-0:1 at dusk",
      provider: "nano-banana-pro",
      extractedReferenceUrls: [TOWN_URL],
    })
    const result = withHybridEnv(() =>
      buildPayload(generateImage, "job-1", {}, undefined, {
        nodes: [generateImage],
        edges: [],
        nodeStates: {},
      }),
    )
    const prompt = result.payload.prompt as string
    expect(prompt).toContain("reference image A")
    expect(prompt).not.toContain("@extracted-0")
  })
})

describe("payload-builder: the node-name lookup is forfeited when the ref zip is not 1:1", () => {
  // `refUrlMap` zips `wiredSourceIds` (edge sources FILTERED to image types)
  // against `chainRefs` POSITIONALLY. A `reference-sheet` upstream spreads its
  // whole `panels` set into `referenceImageUrls` AND is not an image type, so
  // both halves of the zip shift: `chainRefs[0]` (a panel) would be keyed
  // "upload-1" and stamped with the upload node's label "Town". A mention would
  // then bind the WRONG image with no error.
  const PANEL_1 = "https://r2/panel1.png"
  const PANEL_2 = "https://r2/panel2.png"

  function buildShiftedZipPayload(prompt: string) {
    const sheet = node("sheet-1", "reference-sheet", { label: "Sheet" })
    const upload = node("upload-1", "upload-image", { label: "Town", imageUrl: TOWN_URL })
    const generateImage = node("gen-1", "generate-image", { prompt, provider: "nano-banana-pro" })
    return buildPayload(
      generateImage,
      "job-1",
      { referenceImageUrls: [PANEL_1, PANEL_2, TOWN_URL] },
      undefined,
      {
        nodes: [sheet, upload, generateImage],
        edges: [edge("sheet-1", "gen-1"), edge("upload-1", "gen-1")],
        nodeStates: {},
      },
    )
  }

  it("a multi-URL non-image upstream shifts the zip → `@town:1` stays literal, never mis-binds", () => {
    const result = withHybridEnv(() => buildShiftedZipPayload("a wide shot of @town:1 at dusk"))
    const prompt = result.payload.prompt as string
    // The failure this pins shut: `@town:1` resolving to "reference image A",
    // which is the reference SHEET's first panel, not the node named "Town".
    expect(prompt).toContain("@town:1")
    expect(prompt).not.toContain("reference image A")
    // Forfeiting the names forfeits the branch widening too → flat branch,
    // byte-identical to pre-P3.
    expect(result.payload.referenceImageUrls as string[]).toEqual([PANEL_1, PANEL_2, TOWN_URL])
  })

  it("mention-free on the same shifted graph is unchanged (the guard adds no behavior)", () => {
    const result = withHybridEnv(() => buildShiftedZipPayload("a wide shot of a quiet town square"))
    expect(result.payload.prompt as string).toBe("a wide shot of a quiet town square")
    expect(result.payload.referenceImageUrls as string[]).toEqual([PANEL_1, PANEL_2, TOWN_URL])
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
