import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge, ResolvedInputs } from "../types.js"
import { assembleImageInput } from "@nodaro/prompts"
import type { ConnectedReference } from "@nodaro/shared"

// ---------------------------------------------------------------------------
// Wired-creature / wired-object mentions through the ORCHESTRATOR (FE/BE
// parity) — the entity twin of `payload-builder-image-mentions.test.ts`.
//
// `useConnectedRefs = hasWiredCharacter || extras || hasImageMention` left an
// ENTITY-ONLY graph on the FLAT branch, so `connectedReferences` never reached
// `buildImagePrompt` and an `@creature` mention that resolves on a frontend
// single-node Run would have shipped literal text through the identical DAG run.
// The widening is scoped to prompts carrying a RESOLVABLE entity mention and is
// hybrid-gated, so every mention-free graph keeps its exact branch and byte
// output — the second describe block asserts that.
//
// Env pattern (save/restore in `finally`) copied from the image-mention file:
// NODE_ENV=test forces legacy, so the hybrid cases must simulate staging.
// ---------------------------------------------------------------------------

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}

function edge(source: string, target: string): SimpleEdge {
  return { id: `${source}->${target}`, source, target, sourceHandle: null, targetHandle: null }
}

const NESSIE_URL = "https://r2/nessie.png"

/** An entity-only graph: a NAMED `creature` node wired into generate-image. */
function buildCreaturePayload(prompt: string) {
  const creature = node("cr-1", "creature", {
    creatureName: "Nessie",
    generatedImageUrl: NESSIE_URL,
  })
  const generateImage = node("gen-1", "generate-image", { prompt, provider: "nano-banana-pro" })
  // The DAG resolves the upstream entity's image into the consumer's inputs, so
  // the URL is present on BOTH branches — which is what makes the flat-branch
  // assertions below a real byte-identity pin rather than a vacuous one.
  const inputs: ResolvedInputs = { referenceImageUrls: [NESSIE_URL] }
  return buildPayload(generateImage, "job-1", inputs, undefined, {
    nodes: [creature, generateImage],
    edges: [edge("cr-1", "gen-1")],
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

describe("payload-builder: entity mentions resolve on an entity-only graph", () => {
  it("a named creature node + @nessie:1 → the structured branch, phrase inline", () => {
    const result = withHybridEnv(() => buildCreaturePayload("a wide shot of @nessie:1 rising"))
    const prompt = result.payload.prompt as string

    expect(prompt).toContain("the creature from reference image A rising")
    expect(prompt).not.toContain("@nessie")
    expect(result.payload.referenceImageUrls as string[]).toContain(NESSIE_URL)
  })

  it("the mentioned ref does NOT also emit a trailing canonical phrase", () => {
    const result = withHybridEnv(() => buildCreaturePayload("a wide shot of @nessie:1 rising"))
    const prompt = result.payload.prompt as string
    // The live bug, pinned at the orchestrator: one reference, one phrase.
    expect(prompt.split("the creature from reference image A").length - 1).toBe(1)
  })

  it("@nessie:1:markings renders the curated creature role", () => {
    const result = withHybridEnv(() => buildCreaturePayload("a close shot of @nessie:1:markings"))
    expect(result.payload.prompt as string).toContain("the markings from reference image A")
  })

  it("FE/BE PARITY: the orchestrator's prompt equals `assembleImageInput` on the equivalent refs", () => {
    const userPrompt = "a wide shot of @nessie:1:markings rising"
    const frontendRefs: ConnectedReference[] = [
      { id: "cr-1", defaultName: "Nessie", source: "wired-creature", url: NESSIE_URL },
    ]
    const { orchestrated, frontendish } = withHybridEnv(() => ({
      orchestrated: buildCreaturePayload(userPrompt),
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

describe("payload-builder: the entity widening is scoped to resolvable mentions", () => {
  it("MENTION-FREE graph → byte-identical prompt and referenceImageUrls (flat branch kept)", () => {
    const result = withHybridEnv(() => buildCreaturePayload("a wide shot of a lake at dusk"))
    expect(result.payload.prompt as string).toBe("a wide shot of a lake at dusk")
    expect(result.payload.referenceImageUrls as string[]).toEqual([NESSIE_URL])
  })

  it("an UNRESOLVABLE mention (no entity by that name) does not widen the branch either", () => {
    const result = withHybridEnv(() => buildCreaturePayload("a wide shot of @dragon:1 rising"))
    expect(result.payload.prompt as string).toContain("@dragon:1")
    expect(result.payload.referenceImageUrls as string[]).toEqual([NESSIE_URL])
  })
})

describe("payload-builder: LEGACY reference format leaves entity mentions literal", () => {
  it("NODE_ENV=test (the legacy default) → flat branch, token verbatim", () => {
    expect(process.env.NODE_ENV).toBe("test")
    const result = buildCreaturePayload("a wide shot of @nessie:1 rising")
    expect(result.payload.prompt as string).toContain("@nessie:1")
    expect(result.payload.prompt as string).not.toContain("reference image A")
    expect(result.payload.referenceImageUrls as string[]).toContain(NESSIE_URL)
  })
})
