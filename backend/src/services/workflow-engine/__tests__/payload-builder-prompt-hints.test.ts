/**
 * buildPayload: the prompt hints buildPayload assembles (Look and Elements
 * injection, prompt policy, node and user direction, motion).
 *
 * Merged from 7 test files (CI test de-duplication, plan §5.7 B) so the
 * workflow-engine module graph loads once instead of 7 times. Each original
 * file is one top-level describe named after it, with its own helpers, setup
 * and teardown; test names and assertions are unchanged.
 */
import { describe, it, expect, afterEach } from "vitest"
import { buildPayload, buildNodeRefMap } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge, ResolvedInputs } from "../types.js"
import { registerPromptPolicy, clearPromptPolicies } from "../../../lib/prompt-policy.js"
import { getFramingPromptHint, getLightingPromptHint } from "@nodaro/prompts/pickers"
import { renderStructuredFields } from "@nodaro/prompts/prompt-builder"
import type { ResolvedUserDirection } from "../../../lib/user-direction.js"
import { imageReferenceLimit } from "@nodaro/shared/models"

describe("payload-builder-prompt-injection-toggle.test.ts", () => {
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
})

describe("payload-builder-prompt-policy.test.ts", () => {
  /**
   * B4b — PromptPolicy applied at the orchestrator image-assembly sites.
   *
   * buildPayload folds any registered PromptPolicy over the server-authoritative
   * image prompt at BOTH assembly funnels: `assembleImageInput` (generate-image)
   * and `buildImagePrompt` (image-to-image / modify). With no policy registered
   * the transform is the identity, so mainline is byte-identical.
   */
  afterEach(() => clearPromptPolicies())

  const imageSuffix = () =>
    registerPromptPolicy({
      id: "test-image-suffix",
      apply: (a) => (a.kind === "image" ? { ...a, prompt: `${a.prompt} SUFFIX` } : a),
    })

  describe("buildPayload — PromptPolicy at image assembly (B4b)", () => {
    it("applies a registered policy to the generate-image prompt (assembleImageInput funnel)", () => {
      imageSuffix()
      const n: SimpleNode = { id: "gi-1", type: "generate-image", data: { provider: "nano-banana", prompt: "a red bird" } }
      const result = buildPayload(n, "job-1", {}, undefined, { nodes: [n], edges: [], nodeStates: {} })
      expect(result.payload.prompt).toBe("a red bird SUFFIX")
    })

    it("applies a registered policy to the image-to-image prompt (buildImagePrompt funnel)", () => {
      imageSuffix()
      const n: SimpleNode = {
        id: "i2i-1",
        type: "image-to-image",
        data: { provider: "flux-i2i", prompt: "make it night", imageUrl: "https://r2/main.png" },
      }
      const result = buildPayload(n, "job-2", { imageUrl: "https://r2/main.png" }, undefined, {
        nodes: [n],
        edges: [],
        nodeStates: {},
      })
      expect(result.jobName).toBe("image-to-image")
      expect(result.payload.prompt as string).toContain("make it night SUFFIX")
    })

    it("applies a registered policy to the edit-image prompt", () => {
      imageSuffix()
      const n: SimpleNode = {
        id: "ei-1",
        type: "edit-image",
        data: { provider: "nano-banana-edit", prompt: "add a hat", imageUrl: "https://r2/main.png" },
      }
      const result = buildPayload(n, "job-ei", { imageUrl: "https://r2/main.png" }, undefined, {
        nodes: [n],
        edges: [],
        nodeStates: {},
      })
      expect(result.jobName).toBe("edit-image")
      expect(result.payload.prompt as string).toBe("add a hat SUFFIX")
    })

    it("is byte-identical for edit-image when no policy is registered (inert default)", () => {
      const n: SimpleNode = {
        id: "ei-2",
        type: "edit-image",
        data: { provider: "nano-banana-edit", prompt: "add a hat", imageUrl: "https://r2/main.png" },
      }
      const result = buildPayload(n, "job-ei2", { imageUrl: "https://r2/main.png" }, undefined, {
        nodes: [n],
        edges: [],
        nodeStates: {},
      })
      expect(result.payload.prompt).toBe("add a hat")
    })

    it("applies a registered policy at the video funnel (composeVideoPrompt)", () => {
      registerPromptPolicy({
        id: "test-video-suffix",
        apply: (a) => (a.kind === "video" ? { ...a, prompt: `${a.prompt} VID` } : a),
      })
      const n: SimpleNode = { id: "i2v-1", type: "image-to-video", data: { provider: "kling", prompt: "a dog runs" } }
      const result = buildPayload(n, "job-v", { imageUrl: "https://r2/img.png" }, undefined, {
        nodes: [n],
        edges: [],
        nodeStates: {},
      })
      expect(result.jobName).toBe("image-to-video")
      expect(result.payload.prompt as string).toBe("a dog runs VID")
    })

    it("is byte-identical when no policy is registered (inert default)", () => {
      const n: SimpleNode = { id: "gi-2", type: "generate-image", data: { provider: "nano-banana", prompt: "a red bird" } }
      const result = buildPayload(n, "job-3", {}, undefined, { nodes: [n], edges: [], nodeStates: {} })
      expect(result.payload.prompt).toBe("a red bird")
    })
  })
})

describe("payload-builder-node-direction.test.ts", () => {
  /**
   * THE KEYSTONE for "canvas executors honor node-data direction/structured".
   *
   * The orchestrator now narrow-reads a `generate-image` node's stored
   * `data.direction` / `data.structured` and forwards them to
   * `assembleImageInput`, which folds them exactly once inside
   * `composePromptText`. What must be pinned HERE rather than in the wrapper's
   * own suite is the CALLER level: the wrapper's whitespace fixtures pass no
   * direction, so they guard the wrapper but not this call site, and the fold is
   * duplicated across the builder's two `assembleImageInput` branches.
   *
   * Helpers mirror `payload-builder.test.ts` / `payload-builder-mentions.test.ts`.
   */

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

  const jobId = "job-1"
  const PROVIDER = "nano-banana-pro"
  const FRAMING_ID = "medium-shot"
  const LIGHTING_ID = "golden-hour"

  /** A wired Character upstream is what flips the builder onto its
   *  `useConnectedRefs` branch — the branch a one-sided fold would miss. */
  function charNode(id: string): SimpleNode {
    return node(id, "character", {
      label: "Kira",
      characterName: "Kira",
      sourceImageUrl: "https://r2/kira-source.png",
      canonicalDescription: "young woman, brown eyes, auburn shoulder-length hair",
      defaultAssetUrl: "https://r2/kira-portrait.png",
    })
  }

  /** Build a `generate-image` payload, optionally with a wired Character (the
   *  connected-refs branch) and/or extra graph nodes/edges. */
  function promptFor(
    data: Record<string, unknown>,
    opts: { wiredCharacter?: boolean; nodes?: SimpleNode[]; edges?: SimpleEdge[] } = {},
  ): string {
    const gi = node("gen-1", "generate-image", { provider: PROVIDER, ...data })
    const extraNodes = opts.nodes ?? []
    const extraEdges = opts.edges ?? []
    const nodes: SimpleNode[] = opts.wiredCharacter
      ? [charNode("char-1"), ...extraNodes, gi]
      : [...extraNodes, gi]
    const edges: SimpleEdge[] = opts.wiredCharacter
      ? [edge("char-1", "gen-1"), ...extraEdges]
      : [...extraEdges]
    const inputs: ResolvedInputs = opts.wiredCharacter
      ? { referenceImageUrls: ["https://r2/kira-portrait.png"] }
      : {}
    return buildPayload(gi, jobId, inputs, undefined, { nodes, edges, nodeStates: {} }).payload
      .prompt as string
  }

  function occurrences(haystack: string, needle: string): number {
    if (needle.length === 0) return 0
    let count = 0
    let from = 0
    for (;;) {
      const at = haystack.indexOf(needle, from)
      if (at === -1) return count
      count += 1
      from = at + needle.length
    }
  }

  describe("payload-builder: no stored direction/structured is byte-identical", () => {
    // THE parity guarantee, asserted where the wrapper's own fixtures cannot:
    // a node with neither key must still take `composePromptText`'s exact no-op
    // branch, so the prompt reaches `jobs.input_data` UNTRIMMED. A trailing
    // newline (common from an upstream LLM prompt node) is the fixture that
    // fails the moment the join branch is taken unconditionally.
    it("returns a trailing-newline prompt verbatim and untrimmed", () => {
      expect(promptFor({ prompt: "a knight on a hill\n" })).toBe("a knight on a hill\n")
    })

    it("returns a leading/trailing-whitespace prompt verbatim on the connected-refs branch", () => {
      expect(promptFor({ prompt: "  a knight on a hill  " }, { wiredCharacter: true })).toContain(
        "  a knight on a hill  ",
      )
    })

    it("is unchanged by junk in data.direction (dropped by the reader, never thrown on)", () => {
      const base = "a knight on a hill\n"
      expect(promptFor({ prompt: base, direction: "nope" })).toBe(base)
      expect(promptFor({ prompt: base, direction: { framingId: 5 } })).toBe(base)
      expect(promptFor({ prompt: base, direction: {} })).toBe(base)
      expect(promptFor({ prompt: base, direction: { framingId: "" } })).toBe(base)
      expect(promptFor({ prompt: base, structured: "nope" })).toBe(base)
      expect(promptFor({ prompt: base, structured: { person: { age: "drop table" } } })).toBe(base)
    })
  })

  describe("payload-builder: stored direction folds into the prompt", () => {
    const hint = getFramingPromptHint(FRAMING_ID)

    it("has a non-empty oracle hint (guards against a vacuous assertion)", () => {
      expect(hint.length).toBeGreaterThan(0)
      expect(getLightingPromptHint(LIGHTING_ID).length).toBeGreaterThan(0)
    })

    it("folds on the flat branch, into the [style] section", () => {
      const prompt = promptFor({ prompt: "a knight on a hill", direction: { framingId: FRAMING_ID } })
      expect(prompt).toBe(`a knight on a hill\n\n[style]:\n${hint}`)
    })

    it("folds on the connected-refs branch too (both branches assemble the same)", () => {
      // The `generate-image` case builds its input through TWO hand-duplicated
      // `assembleImageInput` calls; folding into only one is THE failure mode.
      const prompt = promptFor(
        { prompt: "a knight on a hill", direction: { framingId: FRAMING_ID } },
        { wiredCharacter: true },
      )
      expect(prompt).toContain(hint)
    })

    it("folds the hint EXACTLY ONCE on both branches", () => {
      expect(
        occurrences(
          promptFor({ prompt: "a knight on a hill", direction: { framingId: FRAMING_ID } }),
          hint,
        ),
      ).toBe(1)
      expect(
        occurrences(
          promptFor(
            { prompt: "a knight on a hill", direction: { framingId: FRAMING_ID } },
            { wiredCharacter: true },
          ),
          hint,
        ),
      ).toBe(1)
    })

    it("accepts an array of ids (the multi-pick shape) on a dimension", () => {
      const prompt = promptFor({ prompt: "a knight", direction: { framingId: [FRAMING_ID] } })
      expect(prompt).toBe(`a knight\n\n[style]:\n${hint}`)
    })

    it("is ADDITIVE with a wired picker node — wired hint first, stored second", () => {
      // A wired Framing picker folds into `rawPrompt` BEFORE assembly; the stored
      // ids fold after, inside `composePromptText`. No precedence, no dedupe —
      // exactly today's semantics for two wired picker nodes of one family.
      const framingNode = node("fr-1", "framing", { shotSize: FRAMING_ID })
      const prompt = promptFor(
        { prompt: "a knight on a hill", direction: { lightingId: LIGHTING_ID } },
        { nodes: [framingNode], edges: [edge("fr-1", "gen-1", null, "look")] },
      )
      const lightingHint = getLightingPromptHint(LIGHTING_ID)
      expect(prompt).toContain(lightingHint)
      expect(prompt).toMatch(/medium|mid-?shot/i)
      expect(prompt.indexOf(lightingHint)).toBeGreaterThan(prompt.indexOf("a knight on a hill"))
    })

    it("assembles a non-empty prompt from direction alone (the orchestrator never throws)", () => {
      const prompt = promptFor({ prompt: "", direction: { framingId: FRAMING_ID } })
      expect(prompt.trim().length).toBeGreaterThan(0)
      expect(prompt).toContain(hint)
    })
  })

  describe("payload-builder: stored structured fields fold into the prompt", () => {
    it("appends the rendered structured fragment exactly once", () => {
      const structured = { person: { age: 34, gender: "woman" as const } }
      const fragment = renderStructuredFields(structured)
      expect(fragment.length).toBeGreaterThan(0)
      const prompt = promptFor({ prompt: "a portrait", structured })
      expect(prompt).toBe(`a portrait. ${fragment}`)
      expect(occurrences(prompt, fragment)).toBe(1)
    })

    it("folds direction before structured, both exactly once — structured ends the BODY", () => {
      // Fold order is unchanged (direction first); string position is not the same
      // question any more. The structured fragment is the last thing in the body,
      // and the look clause reads after it in the `[style]` section.
      const structured = { mood: "brooding" }
      const prompt = promptFor({
        prompt: "a portrait",
        direction: { framingId: FRAMING_ID },
        structured,
      })
      const fragment = renderStructuredFields(structured)
      expect(prompt).toBe(
        `a portrait. ${fragment}\n\n[style]:\n${getFramingPromptHint(FRAMING_ID)}`,
      )
    })
  })
})

describe("payload-builder-user-direction.test.ts", () => {
  /**
   * A Generate Image node whose stored `direction` names the caller's palette /
   * moodboard, built by the orchestrator. The node executor resolves the
   * reference first (`node-user-direction.ts`) and hands the result in as
   * `PayloadBuildContext.userDirection`; this pins what the builder does with it,
   * on BOTH of its `assembleImageInput` branches: the clauses fold like catalog
   * clauses, the moodboard's images follow the node's own references, the price
   * is the price of what is sent, and a moodboard that did not fit says so on
   * the payload (which becomes the job's `input_data`).
   */
  const PALETTE = "palette:0f9e8d7c-6b5a-4c3d-9e2f-1a2b3c4d5e6f"
  const MOODBOARD = "moodboard:1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
  const PALETTE_CLAUSE = "color palette: petrol blue #0F4C5C, honey #E3B23C"
  const images = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `https://cdn.test/mood-${i + 1}.png` }))

  function resolved(n = 2): ResolvedUserDirection {
    return {
      refs: new Map([[PALETTE, PALETTE_CLAUSE], [MOODBOARD, "Moody Nordic interiors"]]),
      styleReferences: images(n),
      moodboard: { id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", name: "Nordic calm" },
    }
  }

  const node = (id: string, type: string, data: Record<string, unknown>): SimpleNode => ({ id, type, data })
  const edge = (source: string, target: string): SimpleEdge => ({ id: `${source}->${target}`, source, target, sourceHandle: null, targetHandle: null })

  function build(
    data: Record<string, unknown>,
    userDirection: ResolvedUserDirection | undefined,
    opts: { wiredCharacter?: boolean } = {},
  ) {
    const gi = node("gen-1", "generate-image", { provider: "nano-banana-pro", prompt: "a cabin", ...data })
    const character = node("char-1", "character", {
      label: "Kira",
      characterName: "Kira",
      sourceImageUrl: "https://r2/kira-source.png",
      canonicalDescription: "young woman, auburn hair",
      defaultAssetUrl: "https://r2/kira-portrait.png",
    })
    const nodes = opts.wiredCharacter ? [character, gi] : [gi]
    const edges = opts.wiredCharacter ? [edge("char-1", "gen-1")] : []
    const inputs: ResolvedInputs = opts.wiredCharacter ? { referenceImageUrls: ["https://r2/kira-portrait.png"] } : {}
    return buildPayload(gi, "job-1", inputs, undefined, {
      nodes,
      edges,
      nodeStates: {},
      ...(userDirection ? { userDirection } : {}),
    })
  }

  describe("Generate Image node with the caller's palette / moodboard (workflow lane)", () => {
    for (const wiredCharacter of [false, true]) {
      const branch = wiredCharacter ? "connected-refs branch" : "flat branch"

      it(`folds both clauses and sends the moodboard after the node's own references (${branch})`, () => {
        const { payload } = build({ direction: { colorLook: PALETTE, style: MOODBOARD } }, resolved(2), { wiredCharacter })
        expect(payload.prompt).toContain(PALETTE_CLAUSE)
        expect(payload.prompt).toContain("Moody Nordic interiors")
        const refs = payload.referenceImageUrls as string[]
        expect(refs.slice(-2)).toEqual(["https://cdn.test/mood-1.png", "https://cdn.test/mood-2.png"])
        if (wiredCharacter) expect(refs[0]).toBe("https://r2/kira-portrait.png")
        expect(payload).not.toHaveProperty("warnings")
      })
    }

    it("prices the run on the references it sends", () => {
      const withBoard = build({ provider: "flux-2-max", direction: { style: MOODBOARD } }, resolved(2))
      const without = build({ provider: "flux-2-max", direction: { style: "anime" } }, undefined)
      expect(withBoard.modelIdentifier).not.toBe(without.modelIdentifier)
      expect((withBoard.payload.referenceImageUrls as string[]).length).toBe(2)
    })

    it("carries a warning when the moodboard did not fit the model's reference limit", () => {
      const cap = imageReferenceLimit("nano-banana-pro")
      const { payload } = build({ direction: { style: MOODBOARD } }, resolved(cap + 3))
      expect((payload.referenceImageUrls as string[]).length).toBe(cap)
      const warnings = payload.warnings as Array<{ code: string; message: string }>
      expect(warnings).toHaveLength(1)
      expect(warnings[0].code).toBe("moodboard_images_not_sent")
      expect(warnings[0].message).toContain(`3 of the ${cap + 3} images`)
    })

    it("keeps the ids in the node's direction (what the job records is the reference, not its text)", () => {
      const gi = node("gen-1", "generate-image", { provider: "nano-banana-pro", prompt: "a cabin", direction: { colorLook: PALETTE } })
      buildPayload(gi, "job-1", {}, undefined, { nodes: [gi], edges: [], nodeStates: {}, userDirection: resolved(0) })
      expect(gi.data.direction).toEqual({ colorLook: PALETTE })
    })

    it("folds nothing for a reference it was not handed", () => {
      const { payload } = build({ direction: { colorLook: PALETTE } }, undefined)
      expect(payload.prompt).toBe("a cabin")
    })
  })
})

describe("payload-builder-character-element-injection.test.ts", () => {
  // Backend workflow-run parity for the downstream character-element injection: a
  // held-prop wired into a Character that feeds a Generate Image node must surface
  // INSIDE that character's identity bullet (canonical-fallback path — the
  // user-reported case), NOT appended at the prompt tail. Mirrors the frontend
  // build-image-assemble-input-element-injection integration test.

  function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
    return { id, type, data }
  }
  function edge(source: string, target: string, sourceHandle?: string | null, targetHandle?: string | null): SimpleEdge {
    return { id: `${source}->${target}`, source, target, sourceHandle: sourceHandle ?? null, targetHandle: targetHandle ?? null }
  }

  describe("payload-builder: character-borne held-prop rides the identity bullet", () => {
    it("weaves a wired held-prop into the character's bullet, not the prompt tail", () => {
      const character = node("char-1", "character", {
        characterName: "Kira",
        sourceImageUrl: "https://r2/kira-source.png",
        canonicalDescription: "young woman, brown eyes, auburn hair, athletic build",
        defaultAssetUrl: "https://r2/kira-portrait.png",
      })
      const heldProp = node("hp-1", "held-prop", { heldProp: "smartphone" })
      const generateImage = node("gen-1", "generate-image", {
        prompt: "a woman in a cafe",
        provider: "nano-banana-pro",
      })
      const nodes = [character, heldProp, generateImage]
      const edges = [
        edge("hp-1", "char-1", null, "assets"), // prop → character
        edge("char-1", "gen-1"), // character → consumer (no @-mention → canonical fallback)
      ]
      const inputs: ResolvedInputs = { referenceImageUrls: ["https://r2/kira-portrait.png"] }

      const result = buildPayload(generateImage, "job-1", inputs, undefined, { nodes, edges, nodeStates: {} })
      const prompt = result.payload.prompt as string

      // Prop is inside Kira's identity bullet, after her canonical description.
      expect(prompt).toMatch(/- Image 1 \(Kira\) — young woman[^\n]*smartphone/i)
      // ...within the "Use these characters:" directive block (before the body).
      const blockEnd = prompt.indexOf("\n\n")
      const block = blockEnd === -1 ? prompt : prompt.slice(0, blockEnd)
      expect(block).toMatch(/smartphone/i)
      // ...and the user's body prose still follows the block.
      expect(prompt).toContain("a woman in a cafe")
      // CRITICAL: exactly ONCE — bullet only, NOT also appended to the tail (the
      // generate-image case excludes the cinematography char-element fold). Guards
      // against the double-injection the opt-out flag prevents.
      expect((prompt.match(/smartphone/gi) || []).length).toBe(1)
    })

    it("edit-image (non-bullet) appends the held-prop to its edit prompt (no bullet, so tail is correct)", () => {
      const character = node("char-1", "character", {
        characterName: "Kira",
        sourceImageUrl: "https://r2/kira-source.png",
        canonicalDescription: "young woman, brown eyes",
        defaultAssetUrl: "https://r2/kira-portrait.png",
      })
      const heldProp = node("hp-1", "held-prop", { heldProp: "smartphone" })
      const editImage = node("ei-1", "edit-image", { prompt: "make it sunset", provider: "nano-banana-edit" })
      const nodes = [character, heldProp, editImage]
      const edges = [edge("hp-1", "char-1", null, "assets"), edge("char-1", "ei-1")]
      const inputs: ResolvedInputs = { imageUrl: "https://r2/base.png", prompt: "make it sunset" }

      const result = buildPayload(editImage, "job-2", inputs, undefined, { nodes, edges, nodeStates: {} })
      const prompt = result.payload.prompt as string
      // No "Use these characters:" bullet on edit-image — the element is appended
      // to the edit instruction (the only sensible placement). Preserves the
      // behavior the prior flat fold provided; not a silent regression.
      expect(prompt).toMatch(/smartphone/i)
      expect(prompt).toContain("make it sunset")
    })
  })
})

describe("payload-builder-settings-motion.test.ts", () => {
  /**
   * A Motion node wired into a video node's Settings input adds its clause to the
   * prompt (it sets no field). Mirrors the editor's collector
   * (frontend cinematography-hints.ts), which asks the same `isSettingsHintEdge`.
   */
  const node = (id: string, type: string, data: Record<string, unknown> = {}): SimpleNode => ({ id, type, data })
  const wire = (source: string, target: string, targetHandle = "settings"): SimpleEdge =>
    ({ id: `${source}->${target}`, source, target, sourceHandle: null, targetHandle }) as SimpleEdge

  const promptOf = (consumer: SimpleNode, nodes: SimpleNode[], edges: SimpleEdge[]): string =>
    buildPayload(consumer, "job-1", {}, undefined, { nodes, edges, nodeStates: {} }).payload.prompt as string

  describe("payload-builder: Motion in the Settings input", () => {
    const video = node("v", "generate-video", { prompt: "a lighthouse at dusk", provider: "seedance-2" })
    const dynamic = node("m1", "motion", { label: "Motion", motion: "dynamic" })
    const subtle = node("m2", "motion", { label: "Calm", motion: "subtle" })

    it("adds the Motion clause to a video prompt", () => {
      expect(promptOf(video, [video, dynamic], [wire("m1", "v")])).toMatch(/dynamic, energetic motion/)
    })

    it("follows the Inject Look switch", () => {
      const off = { ...video, data: { ...video.data, injectLook: false } }
      expect(promptOf(off, [off, dynamic], [wire("m1", "v")])).not.toMatch(/energetic motion/)
    })

    it("uses only the last Motion wired, as the chips show", () => {
      const prompt = promptOf(video, [video, dynamic, subtle], [wire("m1", "v"), wire("m2", "v")])
      expect(prompt).toMatch(/subtle, gentle motion/)
      expect(prompt).not.toMatch(/energetic motion/)
    })

    it("adds nothing through a handle that is not the Settings input", () => {
      expect(promptOf(video, [video, dynamic], [wire("m1", "v", "assets")])).not.toMatch(/energetic motion/)
    })
  })
})

describe("payload-builder-own-motion.test.ts", () => {
  /**
   * A video node's OWN Motion setting (`motionEnabled` + `motion`) in the
   * orchestrator's prompt — the `ownMotionHint` rule from @nodaro/prompts, which
   * the editor run and the prompt preview now share. Generate Video applies it in
   * both modes (its Motion control shows with or without a start frame); the
   * legacy Image to Video node applies it; a legacy Text to Video node has none.
   */
  const MOTION = { motionEnabled: true, motion: "dynamic" }

  function node(type: string, data: Record<string, unknown> = {}): SimpleNode {
    return { id: `${type}-1`, type, data: { provider: "seedance-2", prompt: "a lighthouse in a storm", duration: 5, ...MOTION, ...data } }
  }

  function promptOf(n: SimpleNode, inputs: Record<string, unknown> = {}): string {
    const result = buildPayload(n, "job-own-motion", inputs, undefined, { nodes: [n], edges: [], nodeStates: {} })
    return String(result.payload.prompt)
  }

  describe("the node's own Motion setting in the orchestrator's prompt", () => {
    it("Generate Video with no start frame (text-to-video) carries it", () => {
      expect(promptOf(node("generate-video"))).toContain("a lighthouse in a storm. dynamic motion")
    })

    it("Generate Video with a start frame (image-to-video) carries it", () => {
      expect(promptOf(node("generate-video"), { startFrameUrl: "https://cdn.example/start.png" })).toContain("dynamic motion")
    })

    it("the legacy Image to Video node carries it", () => {
      expect(promptOf(node("image-to-video"), { imageUrl: "https://cdn.example/start.png" })).toContain("dynamic motion")
    })

    it("the legacy Text to Video node has no such setting", () => {
      expect(promptOf(node("text-to-video"))).not.toContain("motion")
    })

    it("an enabled setting with no step stored runs as the step the panel shows (Moderate)", () => {
      expect(promptOf(node("generate-video", { motion: undefined }))).toContain("moderate motion")
    })

    it("nothing is added while the setting is off", () => {
      expect(promptOf(node("generate-video", { motionEnabled: false }))).not.toContain("motion")
    })
  })
})
