import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge, ResolvedInputs } from "../types.js"

// ---------------------------------------------------------------------------
// Unwired `{image:N}` reference tokens through the ORCHESTRATOR.
//
// A token with no image at its position follows the video rule: a labelled one
// becomes its label, an unlabelled one is dropped. The canvas twin is the
// "unwired {image:N} reference tokens" block in `execute-node.test.ts` — same
// prompts, same expected text for the unwired cases. A wired token renders
// exactly as before on each engine.
//
// Env pattern (save/restore in `finally`) as in
// `payload-builder-image-mentions.test.ts`: NODE_ENV=test forces the legacy
// format, so the hybrid cases simulate staging.
// ---------------------------------------------------------------------------

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}

function edge(source: string, target: string): SimpleEdge {
  return { id: `${source}->${target}`, source, target, sourceHandle: null, targetHandle: null }
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

const CREATOR_AT_HOME =
  "Waist-up photo of {image:1:person}, an adult, standing at home in front of a plain wall, arms relaxed, empty hands."
const CREATOR_UNWIRED =
  "Waist-up photo of person, an adult, standing at home in front of a plain wall, arms relaxed, empty hands."
const FACE_PRIVACY = "remove persons faces from {image:1}, keep everything else the same"

const KIRA_PORTRAIT = "https://r2/kira-portrait.png"

function charNode(id: string): SimpleNode {
  return node(id, "character", {
    label: "Kira",
    characterName: "Kira",
    sourceImageUrl: "https://r2/kira-source.png",
    canonicalDescription: "auburn shoulder-length hair",
    defaultAssetUrl: KIRA_PORTRAIT,
    expressions: [],
    poses: [],
    motions: [],
    angles: [],
    bodyAngles: [],
    lightingVariations: [],
  })
}

/** generate-image with nothing wired. */
function buildUnwired(prompt: string, provider = "nano-banana-pro") {
  const gen = node("gen-1", "generate-image", { prompt, provider })
  return buildPayload(gen, "job-1", {}, undefined, { nodes: [gen], edges: [], nodeStates: {} })
}

/** generate-image with a Character node wired (the structured branch). */
function buildWithCharacter(prompt: string) {
  const character = charNode("char-1")
  const gen = node("gen-1", "generate-image", { prompt, provider: "nano-banana-pro" })
  const inputs: ResolvedInputs = { referenceImageUrls: [KIRA_PORTRAIT] }
  return buildPayload(gen, "job-1", inputs, undefined, {
    nodes: [character, gen],
    edges: [edge("char-1", "gen-1")],
    nodeStates: {},
  })
}

describe("payload-builder — unwired {image:N} on generate-image", () => {
  it("nothing wired: a labelled token becomes its label", () => {
    const result = buildUnwired(CREATOR_AT_HOME)
    expect(result.payload.prompt).toBe(CREATOR_UNWIRED)
    expect(result.payload.referenceImageUrls).toBeUndefined()
  })

  it("nothing wired: an unlabelled token is dropped", () => {
    expect(buildUnwired(FACE_PRIVACY, "gpt-image-2").payload.prompt).toBe(
      "remove persons faces from , keep everything else the same",
    )
  })

  it("nothing wired, hybrid format: same text", () => {
    withHybridEnv(() => {
      expect(buildUnwired(CREATOR_AT_HOME).payload.prompt).toBe(CREATOR_UNWIRED)
    })
  })

  it("the photo wired: the token binds exactly as before", () => {
    const upload = node("up-1", "upload-image", { label: "Photo", imageUrl: "https://r2/photo.png" })
    const gen = node("gen-1", "generate-image", { prompt: CREATOR_AT_HOME, provider: "nano-banana-pro" })
    const result = buildPayload(gen, "job-1", { referenceImageUrls: ["https://r2/photo.png"] }, undefined, {
      nodes: [upload, gen],
      edges: [edge("up-1", "gen-1")],
      nodeStates: {},
    })
    expect(result.payload.prompt).toBe(
      "Waist-up photo of Image 1 (person), an adult, standing at home in front of a plain wall, arms relaxed, empty hands.",
    )
    expect(result.payload.referenceImageUrls).toEqual(["https://r2/photo.png"])
  })

  // `{image:N}` numbers the non-character references; a Character binds
  // through its `@`-mention or its canonical directive. With only a Character
  // wired the token has no image at its position, so it drops to its label —
  // and the Character still attaches.
  it("a Character wired (legacy): the token drops to its label, the canonical directive attaches the Character", () => {
    const result = buildWithCharacter(CREATOR_AT_HOME)
    const prompt = result.payload.prompt as string
    expect(prompt.startsWith("Use these characters:\n- Image 1 (Kira)")).toBe(true)
    expect(prompt.endsWith(`\n\n${CREATOR_UNWIRED}`)).toBe(true)
    expect(prompt).not.toContain("{image:")
    expect(result.payload.referenceImageUrls).toEqual([KIRA_PORTRAIT])
  })

  it("a Character wired (hybrid): the token drops to its label, the canonical phrase attaches the Character", () => {
    withHybridEnv(() => {
      const result = buildWithCharacter(CREATOR_AT_HOME)
      expect(result.payload.prompt).toBe(`${CREATOR_UNWIRED}\nthe person from reference image A`)
      expect(result.payload.referenceImageUrls).toEqual([KIRA_PORTRAIT])
    })
  })
})

describe("payload-builder — unwired {image:N} on modify-image", () => {
  it("the wired reference binds, the token past it drops to its label", () => {
    const mod = node("mod-1", "modify-image", {
      prompt: "the woman wears {image:1:hat} and {image:2:scarf}",
      provider: "nano-banana",
    })
    const inputs: ResolvedInputs = { imageUrl: "https://r2/main.png", referenceImageUrls: ["https://r2/hat.png"] }
    const result = buildPayload(mod, "job-1", inputs, undefined, { nodes: [mod], edges: [], nodeStates: {} })
    expect(result.jobName).toBe("image-to-image")
    expect(result.payload.imageUrl).toBe("https://r2/main.png")
    expect(result.payload.prompt).toBe("the woman wears Image 1 (hat) and scarf")
    expect(result.payload.referenceImageUrls).toEqual(["https://r2/hat.png"])
  })

  it("only the image being modified is wired: an unlabelled token is dropped", () => {
    const mod = node("mod-1", "modify-image", { prompt: FACE_PRIVACY, provider: "nano-banana" })
    const result = buildPayload(mod, "job-1", { imageUrl: "https://r2/main.png" }, undefined, {
      nodes: [mod],
      edges: [],
      nodeStates: {},
    })
    expect(result.payload.prompt).toBe("remove persons faces from , keep everything else the same")
  })
})
