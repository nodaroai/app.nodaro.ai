/**
 * buildPayload: image references and the hybrid reference format (unwired
 * image tokens, the hybrid gate, entity mentions, character motion refs).
 *
 * Merged from 4 test files (CI test de-duplication, plan §5.7 B) so the
 * workflow-engine module graph loads once instead of 4 times. Each original
 * file is one top-level describe named after it, with its own helpers, setup
 * and teardown; test names and assertions are unchanged.
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge, ResolvedInputs } from "../types.js"
import { assembleImageInput } from "@nodaro/prompts/assembly"
import type { ConnectedReference } from "@nodaro/shared/types"
import { getCharacterMotionPromptHint as hintOf } from "@nodaro/prompts/pickers"
import { getParameterPromptHint } from "@nodaro/prompts/picker-catalogs"

describe("payload-builder-unwired-image-tokens.test.ts", () => {
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
})

describe("payload-builder-hybrid-gate.test.ts", () => {
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
})

describe("payload-builder-entity-mentions.test.ts", () => {
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
})

describe("payload-builder-character-motion.test.ts", () => {
  function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
    return { id, type, data }
  }
  function edge(source: string, target: string, targetHandle: string): SimpleEdge {
    return { id: `${source}->${target}:${targetHandle}`, source, target, sourceHandle: null, targetHandle }
  }
  function ctxFor(
    consumer: SimpleNode,
    handle: string,
    opts: { picks?: string[]; mira?: Record<string, unknown> } = {},
  ) {
    return {
      nodes: [
        consumer,
        node("mira", "character", { characterName: "Mira", ...opts.mira }),
        node("theo", "character", { characterName: "Theo" }),
        node("m", "character-motion", { characterMotion: opts.picks ?? ["wave-hello", "hug-partner"] }),
      ],
      edges: [edge("mira", "m", "target"), edge("theo", "m", "partner"), edge("m", consumer.id, handle)],
      nodeStates: {},
    }
  }

  const named = (id: string) =>
    hintOf(id).replace(/\bthe subject\b/g, "Mira").replace(/\bthe partner\b/g, "Theo")

  const EXPECTED = `${named("wave-hello")}, then ${named("hug-partner")}`

  /** The wave wording with its subject stripped — present whether or not names were substituted. */
  const WAVE_BODY = hintOf("wave-hello").replace(/^the subject /, "")

  function s2vNode(): SimpleNode {
    return node("s2v", "speech-to-video", {
      prompt: "a man speaks to the crowd",
      imageUrl: "https://example.com/a.png",
      audioUrl: "https://example.com/a.mp3",
    })
  }

  function s2vPrompt(opts: { picks?: string[]; mira?: Record<string, unknown> } = {}): string {
    const s2v = s2vNode()
    return buildPayload(s2v, "job-1", {}, undefined, ctxFor(s2v, "cinematography", opts)).payload.prompt as string
  }

  describe("payload-builder: character-motion", () => {
    it("a video consumer's prompt carries the sequence with the wired names (server parity with the editor)", () => {
      expect(s2vPrompt()).toContain(EXPECTED)
    })

    it("a still-image consumer's prompt never carries it", () => {
      const gi = node("gen-1", "generate-image", { prompt: "a woman in a cafe", provider: "nano-banana-pro" })
      const prompt = buildPayload(gi, "job-1", {}, undefined, ctxFor(gi, "look")).payload.prompt as string
      expect(prompt).not.toContain("Mira")
      expect(prompt).not.toContain(WAVE_BODY)
      expect(prompt).toContain("a woman in a cafe")
    })
  })

  describe("payload-builder: character-motion minor-age floor reaches execution", () => {
    const picks = ["wave-hello", "kiss-partner"]

    it("a target Character with a minor `person` age drops the adult-only move", () => {
      const prompt = s2vPrompt({ picks, mira: { description: "a girl with a red raincoat", person: { age: "age-child" } } })
      expect(prompt).toContain(named("wave-hello"))
      expect(prompt).not.toContain(named("kiss-partner"))
      expect(prompt).not.toContain("presses the lips")
      expect(prompt).not.toContain(", then ")
    })

    it("a target Character whose description states a minor age (no `person` value) drops it too", () => {
      const prompt = s2vPrompt({ picks, mira: { description: "a 7 year old on a swing" } })
      expect(prompt).toContain(named("wave-hello"))
      expect(prompt).not.toContain("presses the lips")
    })

    it("an adult target Character keeps the move (the floor is not vacuous)", () => {
      const prompt = s2vPrompt({ picks, mira: { description: "a woman in her 30s", person: { age: "age-30s" } } })
      expect(prompt).toContain(`${named("wave-hello")}, then ${named("kiss-partner")}`)
    })
  })

  // A prompt that places the node by label (`{Motion}`) resolves through
  // buildNodeRefMap, not the cinematography collector. The editor composes that
  // value WITH the graph (execution-graph.ts extractNodeOutput), so the server
  // must too: otherwise a minor Character's run ships an adult-only move and the
  // wired names are lost.
  describe("payload-builder: character-motion placed by {Label} in the prompt", () => {
    const picks = ["wave-hello", "kiss-partner"]

    /** Subject-only substitution: these graphs wire no partner. */
    const namedSubject = (id: string) => hintOf(id).replace(/\bthe subject\b/g, "Mira")

    /** The longest run of kiss wording between partner mentions: present however
     *  the unwired partner slot is spelled. */
    const KISS_BODY = hintOf("kiss-partner")
      .split(/\bthe partner(?:'s)?/)
      .map((s) => s.trim())
      .reduce((a, b) => (b.length > a.length ? b : a), "")

    function labelGraph(age: string) {
      const s2v = node("s2v", "speech-to-video", {
        prompt: "someone speaks to the crowd, {Motion}",
        imageUrl: "https://example.com/a.png",
        audioUrl: "https://example.com/a.mp3",
      })
      const mira = node("mira", "character", { label: "Mira", characterName: "Mira", person: { age } })
      const motion = node("m", "character-motion", { label: "Motion", characterMotion: picks })
      // Also wired on `cinematography`, as the editor wires it. `{Motion}` in the
      // prompt suppresses that auto-inject, so the ref map is the ONLY way the
      // fragment can reach the prompt here.
      const edges = [edge("mira", "m", "target"), edge("m", "s2v", "cinematography")]
      const nodes = [s2v, mira, motion]
      const prompt = buildPayload(s2v, "job-1", {}, undefined, { nodes, edges, nodeStates: {} }).payload.prompt as string
      return { prompt, editor: getParameterPromptHint(motion, { nodes, edges }) }
    }

    it("the kiss wording is a real, non-trivial fragment (the absence checks below are not vacuous)", () => {
      expect(KISS_BODY.length).toBeGreaterThan(20)
      expect(hintOf("wave-hello")).toMatch(/^the subject /)
    })

    it("a minor target Character: names the subject and drops the adult-only move", () => {
      const { prompt, editor } = labelGraph("age-child")
      expect(prompt).not.toContain("{Motion}")
      expect(prompt).toContain(namedSubject("wave-hello"))
      expect(prompt).not.toContain(KISS_BODY)
      expect(prompt).toContain(editor)
    })

    it("an adult target Character (control): keeps the kiss and still names the subject", () => {
      const { prompt, editor } = labelGraph("age-30s")
      expect(prompt).toContain(`${namedSubject("wave-hello")}, then `)
      expect(prompt).toContain(KISS_BODY)
      expect(prompt).toContain(editor)
    })
  })
})
