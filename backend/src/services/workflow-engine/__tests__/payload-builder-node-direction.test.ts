import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge, ResolvedInputs } from "../types.js"
import {
  getFramingPromptHint,
  getLightingPromptHint,
  renderStructuredFields,
} from "@nodaro/prompts"

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
