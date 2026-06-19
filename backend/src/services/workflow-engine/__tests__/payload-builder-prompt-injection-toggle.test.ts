import { describe, it, expect } from "vitest"
import { buildPayload, buildNodeRefMap } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge, ResolvedInputs } from "../types.js"

// Backend workflow-run parity for the "Prompt Injection" config toggles. The
// consumer node can opt out of auto-injecting Look (cinematography hints) and
// Elements (character element fragments) via `injectLook` / `injectElements`.
// Default is ON; only an explicit `false` disables. Mirrors the frontend gates
// in cinematography-hints.ts (Look) and node-input-resolver.ts (Elements).

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}
function edge(source: string, target: string, sourceHandle?: string | null, targetHandle?: string | null): SimpleEdge {
  return { id: `${source}->${target}`, source, target, sourceHandle: sourceHandle ?? null, targetHandle: targetHandle ?? null }
}

describe("payload-builder: Inject Look toggle (cinematography hints)", () => {
  // held-prop wired straight to the consumer's `look` handle folds a hint into
  // the prompt via collectCinematographyHints → getNodePromptHint.
  const build = (extra: Record<string, unknown>) => {
    const heldProp = node("hp-1", "held-prop", { heldProp: "smartphone" })
    const gi = node("gen-1", "generate-image", { prompt: "a woman in a cafe", provider: "nano-banana-pro", ...extra })
    const nodes = [heldProp, gi]
    const edges = [edge("hp-1", "gen-1", null, "look")]
    const inputs: ResolvedInputs = {}
    return buildPayload(gi, "job-1", inputs, undefined, { nodes, edges, nodeStates: {} }).payload.prompt as string
  }

  it("folds the Look hint by default (injectLook undefined)", () => {
    expect(build({})).toMatch(/smartphone/i)
  })

  it("omits the Look hint when injectLook === false", () => {
    const prompt = build({ injectLook: false })
    expect(prompt).not.toMatch(/smartphone/i)
    expect(prompt).toContain("a woman in a cafe") // body prose untouched
  })
})

describe("payload-builder: Look/Elements gates are HANDLE-scoped", () => {
  // Same source on `look` vs `elements` isolates each per-handle gate.
  const has = (extra: Record<string, unknown>, handle: string) => {
    const heldProp = node("hp-1", "held-prop", { heldProp: "smartphone" })
    const gi = node("gen-1", "generate-image", { prompt: "a woman in a cafe", provider: "nano-banana-pro", ...extra })
    const p = buildPayload(gi, "job-1", {}, undefined, {
      nodes: [heldProp, gi],
      edges: [edge("hp-1", "gen-1", null, handle)],
      nodeStates: {},
    }).payload.prompt as string
    return /smartphone/i.test(p)
  }

  it("injectLook=false drops `look` but KEEPS `elements`", () => {
    expect(has({ injectLook: false }, "look")).toBe(false)
    expect(has({ injectLook: false }, "elements")).toBe(true)
  })

  it("injectElements=false drops `elements` but KEEPS `look`", () => {
    expect(has({ injectElements: false }, "elements")).toBe(false)
    expect(has({ injectElements: false }, "look")).toBe(true)
  })
})

describe("payload-builder: Inject Elements toggle (character element fragments)", () => {
  // held-prop → Character → generate-image: the prop rides the character's
  // identity bullet via stampElementInjections.
  const build = (extra: Record<string, unknown>) => {
    const character = node("char-1", "character", {
      characterName: "Kira",
      sourceImageUrl: "https://r2/kira-source.png",
      canonicalDescription: "young woman, brown eyes, auburn hair, athletic build",
      defaultAssetUrl: "https://r2/kira-portrait.png",
    })
    const heldProp = node("hp-1", "held-prop", { heldProp: "smartphone" })
    const gi = node("gen-1", "generate-image", { prompt: "a woman in a cafe", provider: "nano-banana-pro", ...extra })
    const nodes = [character, heldProp, gi]
    const edges = [edge("hp-1", "char-1", null, "assets"), edge("char-1", "gen-1")]
    const inputs: ResolvedInputs = { referenceImageUrls: ["https://r2/kira-portrait.png"] }
    return buildPayload(gi, "job-1", inputs, undefined, { nodes, edges, nodeStates: {} }).payload.prompt as string
  }

  it("weaves the character element by default (injectElements undefined)", () => {
    expect(build({})).toMatch(/smartphone/i)
  })

  it("omits the character element when injectElements === false", () => {
    const prompt = build({ injectElements: false })
    expect(prompt).not.toMatch(/smartphone/i)
    expect(prompt).toContain("a woman in a cafe") // body prose untouched
  })
})

describe("payload-builder: used-as-variable suppression (no double-inject)", () => {
  // held-prop wired to `look` AND referenced as {Prop} → placed by the ref only.
  const build = (prompt: string) => {
    const heldProp = node("hp-1", "held-prop", { label: "Prop", heldProp: "smartphone" })
    const gi = node("gen-1", "generate-image", { prompt, provider: "nano-banana-pro" })
    return buildPayload(gi, "job-1", {}, undefined, {
      nodes: [heldProp, gi],
      edges: [edge("hp-1", "gen-1", null, "look")],
      nodeStates: {},
    }).payload.prompt as string
  }

  it("auto-injects when NOT referenced", () => {
    expect(build("a woman in a cafe")).toMatch(/smartphone/i)
  })
  it("does NOT auto-inject (appears once) when referenced as {Prop}", () => {
    const p = build("a woman in a cafe holding {Prop}")
    // exactly one occurrence — placed by the {Prop} ref, not also appended
    expect((p.match(/smartphone/gi) ?? []).length).toBe(1)
  })
})

describe("payload-builder: prompt auto-append (generate-image, appendWired)", () => {
  const build = (extra: Record<string, unknown>, wiredPrompt?: string) => {
    const gi = node("gen-1", "generate-image", { prompt: "a woman in a cafe", provider: "nano-banana-pro", ...extra })
    const inputs: ResolvedInputs = wiredPrompt !== undefined ? { prompt: wiredPrompt } : {}
    return buildPayload(gi, "job-1", inputs, undefined, { nodes: [gi], edges: [], nodeStates: {} }).payload.prompt as string
  }
  it("appends a connected (wired) prompt to the typed prompt by default", () => {
    const p = build({}, "shot on film")
    expect(p).toContain("a woman in a cafe")
    expect(p).toContain("shot on film")
    expect(p.indexOf("a woman in a cafe")).toBeLessThan(p.indexOf("shot on film"))
  })
  it("typed prompt alone when nothing is wired", () => {
    expect(build({})).toBe("a woman in a cafe")
  })
})

describe("payload-builder: negative auto-append (composeNegative)", () => {
  const buildImg = (extra: Record<string, unknown>, wiredNeg?: string) => {
    // imagen4 ∈ NATIVE_NEGATIVE_PROMPT_MODELS → the composed negative lands in
    // payload.negativePrompt (non-native providers fold it into the prompt as
    // "Avoid:", which would mean asserting the wrong field).
    const gi = node("gen-1", "generate-image", { prompt: "a woman in a cafe", provider: "imagen4", negativePrompt: "blurry", ...extra })
    const inputs: ResolvedInputs = wiredNeg !== undefined ? { negativePrompt: wiredNeg } : {}
    return buildPayload(gi, "job-1", inputs, undefined, { nodes: [gi], edges: [], nodeStates: {} }).payload.negativePrompt as string | undefined
  }
  it("appends a wired negative to the typed negative (generate-image)", () => {
    const n = buildImg({}, "low quality") ?? ""
    expect(n).toContain("blurry")
    expect(n).toContain("low quality")
    expect(n.indexOf("blurry")).toBeLessThan(n.indexOf("low quality"))
  })
  it("typed negative alone when nothing wired", () => {
    expect(buildImg({})).toBe("blurry")
  })
  it("generate-video appends a wired negative too", () => {
    const gv = node("gv-1", "generate-video", { prompt: "a city skyline", provider: "veo3", negativePrompt: "shaky" })
    const out = (buildPayload(gv, "job-1", { negativePrompt: "distorted" }, undefined, { nodes: [gv], edges: [], nodeStates: {} }).payload.negativePrompt as string | undefined) ?? ""
    expect(out).toContain("shaky")
    expect(out).toContain("distorted")
  })
})

describe("payload-builder: same-label combine — buildNodeRefMap", () => {
  it("merges same-label sources on elements + look into one {label}, elements before look", () => {
    const c = node("c", "generate-image", { label: "C" })
    const p1 = node("p1", "held-prop", { label: "X", heldProp: "smartphone" })
    const p2 = node("p2", "held-prop", { label: "X", heldProp: "umbrella" })
    const map = buildNodeRefMap("c", {
      nodes: [c, p1, p2],
      edges: [edge("p1", "c", null, "elements"), edge("p2", "c", null, "look")],
      nodeStates: {},
    })
    // labels are "X" → canonical (lowercase) map key "x"
    const x = (map.get("x") ?? "").toLowerCase()
    expect(x).toMatch(/smartphone/)
    expect(x).toMatch(/umbrella/)
    expect(x.indexOf("smartphone")).toBeLessThan(x.indexOf("umbrella"))
    expect(map.has("x (2)")).toBe(false)
  })

  it("case-insensitive: TEXt + TEXT (elements + look) collapse into one {text}", () => {
    const c = node("c", "generate-image", { label: "C" })
    const p1 = node("p1", "held-prop", { label: "TEXt", heldProp: "smartphone" })
    const p2 = node("p2", "held-prop", { label: "TEXT", heldProp: "umbrella" })
    const map = buildNodeRefMap("c", {
      nodes: [c, p1, p2],
      edges: [edge("p1", "c", null, "elements"), edge("p2", "c", null, "look")],
      nodeStates: {},
    })
    const v = (map.get("text") ?? "").toLowerCase()
    expect(map.has("text")).toBe(true)
    expect(v).toMatch(/smartphone/)
    expect(v).toMatch(/umbrella/)
    expect(v.indexOf("smartphone")).toBeLessThan(v.indexOf("umbrella"))
  })
})
