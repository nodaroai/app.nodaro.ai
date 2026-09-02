/**
 * §4.6. `resolveNodeRefs` leaves a `{Label}` literal when the upstream is
 * absent and there is no `|| fallback` — and the DAG engine then sent those
 * characters to the provider ({Describe Image} ×2 on gpt-image-2, {gravity
 * flip} / {rewind} on two seedance-2-5 rows). Refuse at build time, before the
 * credit reservation (node-executor.ts builds the payload at :1314 and only
 * reserves at :1419, deleting the placeholder jobs row on a build throw).
 *
 * Substitute-then-refuse: a token naming a node that EXISTS but produced
 * nothing resolves to empty text (or its `|| fallback`); only a token naming no
 * node at all refuses.
 *
 * SCOPE (fix round 1): the pass applies to AUTHOR-TYPED text only — the node's
 * own prompt candidate fields and its promptPrefix / promptSuffix, settled
 * BEFORE composition. Text that ARRIVES through a wired edge or a list fan-out
 * item is DATA and passes through verbatim: JSON out of a Generate Text node
 * legitimately contains `{...}`, and the `{name || fallback}` escape is
 * unreachable for text nobody authored.
 *
 * CROSS-ENGINE PARITY: the `typed prompt:` / `wired prompt:` / `affixes:` cases
 * below are named IDENTICALLY to their twins in
 * `frontend/src/components/editor/workflow-editor/__tests__/unresolved-refs-guard.test.ts`
 * so a future divergence between the two engines is one grep away.
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode } from "../types.js"

const JOB = "job-unresolved-refs"
const img = (prompt: string): SimpleNode =>
  ({ id: "img-1", type: "generate-image", data: { label: "Hero", prompt, provider: "nano-banana" } })

describe("unresolved {Label} guard", () => {
  it("refuses a prompt whose reference matches no node", () => {
    const n = img("a {gravity flip} of a car")
    expect(() => buildPayload(n, JOB, {}, undefined, { nodes: [n], edges: [], nodeStates: {} }))
      .toThrow(/unresolved_reference/)
  })

  it("names the token so the user can fix it", () => {
    const n = img("a {gravity flip} of a car")
    expect(() => buildPayload(n, JOB, {}, undefined, { nodes: [n], edges: [], nodeStates: {} }))
      .toThrow(/gravity flip/)
  })

  it("names the node and the escape hatch, and carries a stable code", () => {
    const n = img("a {gravity flip} of a car")
    try {
      buildPayload(n, JOB, {}, undefined, { nodes: [n], edges: [], nodeStates: {} })
      throw new Error("expected a refusal")
    } catch (err) {
      const e = err as Error & { code?: string }
      expect(e.code).toBe("unresolved_reference")
      expect(e.message).toContain('"Hero"')
      expect(e.message).toContain("{name || fallback}")
    }
  })

  // A blank optional input is NOT the §4.6 defect — but neither may its token
  // SHIP. The orchestrator gives a source node a state entry only `if (output)`
  // (orchestrator-worker.ts, the isSourceNode branch), so an EMPTY text-prompt
  // has no state entry at all: `nodeStates: {}` below is what production really
  // looks like. `known` is graph-derived, so the reference is recognised — and
  // resolves to EMPTY TEXT, as if the author had written `{Notes || }`.
  // Refusing it is not an option: in a published app the person who left the
  // input blank cannot edit the prompt to add the escape.
  const emptyNotes: SimpleNode = { id: "t-1", type: "text-prompt", data: { label: "Notes", text: "" } }
  const withNotes = (n: SimpleNode) => ({
    nodes: [n, emptyNotes],
    edges: [{ id: "e1", source: "t-1", target: "img-1" }],
    nodeStates: {},
  })

  // --- Composition point 1: the node's own (typed) prompt, via promptFor ---

  it("typed prompt: an empty existing node contributes empty text, not the literal", () => {
    const n = img("write {Notes} about cats")
    const result = buildPayload(n, JOB, {}, undefined, withNotes(n))
    expect(result.payload.prompt).toBe("write about cats") // token gone, double space collapsed
    expect(String(result.payload.prompt)).not.toContain("{")
  })

  it("typed prompt: an empty existing node WITH a fallback contributes the fallback", () => {
    const n = img("write {Notes || nothing} about cats")
    const result = buildPayload(n, JOB, {}, undefined, withNotes(n))
    expect(result.payload.prompt).toBe("write nothing about cats")
  })

  it("typed prompt: a label naming no node in the graph still refuses", () => {
    const n = img("write {Notes} about {NotANode}")
    expect(() => buildPayload(n, JOB, {}, undefined, withNotes(n)))
      .toThrow(/unresolved_reference: node "Hero" references \{NotANode\}/)
  })

  // Prompt affixes ride the SAME composition point: computeNodePrompt wraps the
  // core via applyPromptAffixes, so promptPrefix / promptSuffix text is inside
  // the string finalizeRefTokens sees. Without that, a `{Label}` typed into an
  // affix would bypass both the refusal and the substitution.
  it("affixes: a nonexistent {Label} in promptPrefix refuses", () => {
    const n: SimpleNode = { id: "img-1", type: "generate-image", data: {
      label: "Hero", prompt: "a car", provider: "nano-banana", promptPrefix: "{NotANode} style,",
    } }
    expect(() => buildPayload(n, JOB, {}, undefined, withNotes(n)))
      .toThrow(/unresolved_reference: node "Hero" references \{NotANode\}/)
  })

  it("affixes: an empty existing node in promptSuffix substitutes to empty text", () => {
    const n: SimpleNode = { id: "img-1", type: "generate-image", data: {
      label: "Hero", prompt: "a car", provider: "nano-banana", promptSuffix: "shot {Notes} today",
    } }
    const result = buildPayload(n, JOB, {}, undefined, withNotes(n))
    expect(String(result.payload.prompt)).toContain("shot today")
    expect(String(result.payload.prompt)).not.toContain("{Notes}")
  })

  // --- Composition point 2: the WIRED upstream prompt is DATA, not a prompt ---
  //
  // These three are the INVERSE of how they were first written, and the exact
  // twins of the frontend file's `wired prompt:` cases. A `{` that arrived over
  // an edge is a character the upstream node emitted, and no one can add
  // `{name || fallback}` to text they did not type.

  it("wired prompt: text arriving from an edge is data — passed through verbatim", () => {
    const n = img("")
    const result = buildPayload(n, JOB, { prompt: "wired {Notes} tail" }, undefined, withNotes(n))
    expect(result.payload.prompt).toBe("wired {Notes} tail")
  })

  it("wired prompt: JSON from an upstream node reaches the provider unchanged", () => {
    const n = img("")
    const json = '{"shot": "wide", "lens": "35mm"}'
    const result = buildPayload(n, JOB, { prompt: json }, undefined, withNotes(n))
    expect(result.payload.prompt).toBe(json)
  })

  it("wired prompt: a {NotANode} arriving from an edge does NOT refuse", () => {
    const n = img("")
    const result = buildPayload(n, JOB, { prompt: "wired {NotANode} tail" }, undefined, withNotes(n))
    expect(result.payload.prompt).toBe("wired {NotANode} tail")
  })

  // Adversarial: BOTH halves of the rule on one node. The typed affix must
  // still refuse, and the refusal must name ONLY the authored token — the
  // missing label riding in on the wire is data and is never reported.
  it("wired data + a typed {NotANode} affix: refuses, naming only the typed token", () => {
    const n: SimpleNode = { id: "img-1", type: "generate-image", data: {
      label: "Hero", prompt: "", provider: "nano-banana", promptPrefix: "{NotANode} style,",
    } }
    try {
      buildPayload(n, JOB, { prompt: "wired {AlsoMissing} tail" }, undefined, withNotes(n))
      throw new Error("expected a refusal")
    } catch (err) {
      const e = err as Error & { code?: string }
      expect(e.code).toBe("unresolved_reference")
      expect(e.message).toContain("{NotANode}")
      expect(e.message).not.toContain("AlsoMissing")
    }
  })

  it("passes a token with an explicit fallback, and substitutes it", () => {
    const n = img("a {mood || calm} scene")
    const result = buildPayload(n, JOB, {}, undefined, { nodes: [n], edges: [], nodeStates: {} })
    // Even with an EMPTY ref map — where `resolvePrompt`'s `rr` skips
    // resolveNodeRefs entirely — the fallback is substituted, so a `{x || y}`
    // token can no longer reach a provider as characters.
    expect(result.payload.prompt).toBe("a calm scene")
  })

  it("never fires on the reference/recast grammars, and leaves them intact", () => {
    const n = img("use {image:1:face} and {slot:hero} and {ref:car}")
    const result = buildPayload(n, JOB, {}, undefined, { nodes: [n], edges: [], nodeStates: {} })
    // Not refused AND not stripped: their own resolvers run further down.
    expect(String(result.payload.prompt)).toContain("{slot:hero}")
    expect(String(result.payload.prompt)).toContain("{ref:car}")
  })
})

// ---------------------------------------------------------------------------
// FieldMapping / `{}` injection — the second way DATA reaches a "typed" field
//
// `node-executor.ts` runs `resolveFieldMappings` BEFORE `buildPayload`, so
// `node.data.<field>` may already hold an upstream node's output by the time
// the settle pass reads it. The pre-mapping snapshot travels in
// `PayloadBuildContext.authoredData`; a field that no longer equals its
// authored value is DATA and passes through untouched.
// ---------------------------------------------------------------------------

describe("field mapping: injected upstream text is data, not an authored prompt", () => {
  const JSON_OUT = '{"k": "v"}'
  const notes: SimpleNode = { id: "t-1", type: "text-prompt", data: { label: "Notes", text: "" } }
  const graph = (n: SimpleNode) => ({
    nodes: [n, notes],
    edges: [{ id: "e1", source: "t-1", target: "img-1" }],
    nodeStates: {},
  })
  const withAuthored = (n: SimpleNode, authoredData: Record<string, unknown>) => ({
    ...graph(n),
    authoredData,
  })

  it("{} injection: JSON written into data.prompt does not refuse and ships verbatim", () => {
    const n = img(JSON_OUT)
    const result = buildPayload(n, JOB, {}, undefined, withAuthored(n, { ...n.data, prompt: "{}" }))
    expect(result.payload.prompt).toBe(JSON_OUT)
  })

  it("a mapped field is data even when the mapping wrote a {NotANode}", () => {
    const n = img("upstream {NotANode} text")
    const result = buildPayload(n, JOB, {}, undefined, withAuthored(n, { ...n.data, prompt: "{}" }))
    expect(result.payload.prompt).toBe("upstream {NotANode} text")
  })

  it("the same node's typed promptSuffix is still authored — and still refuses", () => {
    const n: SimpleNode = { id: "img-1", type: "generate-image", data: {
      label: "Hero", prompt: JSON_OUT, provider: "nano-banana", promptSuffix: "{NotANode} style",
    } }
    try {
      buildPayload(n, JOB, {}, undefined, withAuthored(n, { ...n.data, prompt: "{}" }))
      throw new Error("expected a refusal")
    } catch (err) {
      const e = err as Error & { code?: string }
      expect(e.code).toBe("unresolved_reference")
      expect(e.message).toContain("{NotANode}")
      // The injected JSON is data — its brace token is never reported.
      expect(e.message).not.toContain('"k"')
    }
  })

  it("no authoredData (direct callers, single-node parity) treats every field as authored", () => {
    const n = img("a {NotANode} scene")
    expect(() => buildPayload(n, JOB, {}, undefined, graph(n)))
      .toThrow(/unresolved_reference/)
  })
})
