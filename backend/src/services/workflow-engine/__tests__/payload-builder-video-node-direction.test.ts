import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode, SimpleEdge, ResolvedInputs } from "../types.js"
import {
  getCameraMotionPromptHint,
  getCameraMotionTerm,
  getStylePromptHint,
  renderStructuredFields,
} from "@nodaro/prompts"

/**
 * THE KEYSTONE for "the canvas VIDEO executors honor node-data
 * direction/structured" (P4b) — the exact mirror of
 * `payload-builder-node-direction.test.ts` on the still side.
 *
 * The orchestrator now narrow-reads a video node's stored `data.direction` /
 * `data.structured` and folds them ONCE, inside `composeVideoPrompt`, via the
 * shared `composeVideoPromptText`. What must be pinned HERE rather than in the
 * composer's own suite is the CALLER level: the fold is opted into per case,
 * and the generate-video family has FOUR exits through this builder —
 * `generate-video` in its t2v and i2v modes, `generate-video`'s LTX early
 * return (which composes no graph hints at all), plus the two legacy standalone
 * cases the frontend re-types onto. A fold wired into only some of them is the
 * whole failure mode.
 *
 * THE BYTE-IDENTITY HALF matters as much as the fold: Studio has been STORING
 * these ids on emitted video nodes while nothing read them, so every already
 * saved production must keep its exact prompt until it actually carries a
 * direction. The trailing-newline fixtures are what fail the instant a caller
 * takes the join branch unconditionally.
 *
 * Real catalog ids throughout — every `get*` hint helper returns `""` on a
 * miss, so a made-up id would make the fold assertions vacuously pass.
 *
 * Helpers mirror `payload-builder-node-direction.test.ts`.
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
/** A ref-capable provider, so no case takes a degenerate strip path. */
const PROVIDER = "seedance-2"
const CAMERA_MOTION = "handheld" // MOTION dimension → compact term
const STYLE = "cinematic" // LOOK dimension → full clause

/** A start frame flips `generate-video` onto its i2v mode; without one it is t2v. */
const WITH_START_FRAME: ResolvedInputs = { startFrameUrl: "https://r2/frame.png" }

function promptFor(
  type: string,
  data: Record<string, unknown>,
  opts: { inputs?: ResolvedInputs; nodes?: SimpleNode[]; edges?: SimpleEdge[] } = {},
): string | undefined {
  const target = node("vid-1", type, { provider: PROVIDER, ...data })
  const nodes = [...(opts.nodes ?? []), target]
  const edges = opts.edges ?? []
  return buildPayload(target, jobId, opts.inputs ?? {}, undefined, {
    nodes,
    edges,
    nodeStates: {},
  }).payload.prompt as string | undefined
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

/**
 * Every builder exit that folds, as `[name, run]`. Table-driven so a new video
 * fold site is added HERE (one row) rather than by copying a describe block —
 * and so the byte-identity half is asserted over the identical set as the fold
 * half, which is the pairing that catches a half-wired case.
 */
const FOLD_SITES: ReadonlyArray<
  readonly [string, (data: Record<string, unknown>) => string | undefined]
> = [
  ["generate-video (t2v mode)", (d) => promptFor("generate-video", d)],
  [
    "generate-video (i2v mode)",
    (d) => promptFor("generate-video", d, { inputs: WITH_START_FRAME }),
  ],
  [
    "generate-video (LTX early return)",
    (d) => promptFor("generate-video", { ...d, provider: "ltx-2.3-pro" }),
  ],
  ["image-to-video (legacy standalone)", (d) => promptFor("image-to-video", d)],
  ["text-to-video (legacy standalone)", (d) => promptFor("text-to-video", d)],
]

describe("payload-builder video: no stored direction/structured is byte-identical", () => {
  // THE parity guarantee, stated as EQUALITY AGAINST THE NO-KEY BASELINE plus a
  // literal pin — not as an untrimmed-passthrough claim. Four of the five exits
  // run the composed body through the video prompt policy, which normalizes
  // whitespace before the payload is built (pre-existing, unrelated to this
  // leg), so only the LTX exit could ever satisfy an untrimmed assertion here.
  // The composer's own untrimmed no-op contract is pinned where it is
  // observable: `packages/prompts/src/__tests__/assemble-video-input.test.ts`.
  const JUNK: ReadonlyArray<Record<string, unknown>> = [
    { direction: "nope" },
    { direction: [] },
    { direction: { cameraMotion: 5 } },
    { direction: {} },
    { direction: { cameraMotion: "" } },
    { direction: { __not_a_dimension__: "x" } },
    { structured: "nope" },
    { structured: {} },
    { structured: { person: { age: "drop table" } } },
  ]

  for (const [site, run] of FOLD_SITES) {
    it(`${site}: a direction-less node still yields its exact prompt`, () => {
      expect(run({ prompt: "a knight rides at dusk" })).toBe("a knight rides at dusk")
    })

    it(`${site}: an empty / junk direction or structured takes the no-op branch`, () => {
      // A trailing newline (common from an upstream LLM prompt node) is the
      // body that diverges the instant a caller takes the join branch
      // unconditionally instead of the composer's exact no-op branch.
      const body = "a knight rides at dusk\n"
      const baseline = run({ prompt: body })
      expect(baseline).toContain("a knight rides at dusk")
      for (const data of JUNK) {
        expect(run({ prompt: body, ...data }), JSON.stringify(data)).toBe(baseline)
      }
    })

    it(`${site}: a prompt-less node is unchanged too`, () => {
      const baseline = run({})
      for (const data of JUNK) {
        expect(run(data), JSON.stringify(data)).toBe(baseline)
      }
    })
  }
})

describe("payload-builder video: stored direction folds into the prompt", () => {
  const motionTerm = getCameraMotionTerm(CAMERA_MOTION)
  const styleHint = getStylePromptHint(STYLE)

  it("has non-empty oracle hints (guards against vacuous assertions)", () => {
    expect(motionTerm.length).toBeGreaterThan(0)
    expect(styleHint.length).toBeGreaterThan(0)
    // The verbosity split is the whole point of `VIDEO_HINT_MODE_DEFAULT`: a
    // motion dimension must render the COMPACT term here, not its full clause.
    expect(getCameraMotionPromptHint(CAMERA_MOTION)).not.toBe(motionTerm)
  })

  for (const [site, run] of FOLD_SITES) {
    it(`${site}: folds a motion id as its compact term, exactly once`, () => {
      const prompt = run({ prompt: "a knight rides at dusk", direction: { cameraMotion: CAMERA_MOTION } })!
      expect(prompt).toBe(`a knight rides at dusk. ${motionTerm}`)
      expect(occurrences(prompt, motionTerm)).toBe(1)
    })

    it(`${site}: folds a look id as its full clause, into the [style] section`, () => {
      expect(run({ prompt: "a knight rides at dusk", direction: { style: STYLE } })).toBe(
        `a knight rides at dusk\n\n[style]:\n${styleHint}`,
      )
    })

    it(`${site}: accepts an array of ids (the multi-pick shape)`, () => {
      expect(run({ prompt: "a knight", direction: { cameraMotion: [CAMERA_MOTION] } })).toBe(
        `a knight. ${motionTerm}`,
      )
    })

    it(`${site}: assembles a prompt from direction alone (the orchestrator never throws)`, () => {
      // No prose to separate from: the section is the whole prompt, and it must
      // not open on the blank line that would normally precede it.
      expect(run({ direction: { style: STYLE } })).toBe(`[style]:\n${styleHint}`)
    })

    it(`${site}: appends the rendered structured fragment exactly once`, () => {
      const structured = { person: { age: 34, gender: "woman" as const } }
      const fragment = renderStructuredFields(structured)
      expect(fragment.length).toBeGreaterThan(0)
      const prompt = run({ prompt: "a portrait", structured })!
      expect(prompt).toBe(`a portrait. ${fragment}`)
      expect(occurrences(prompt, fragment)).toBe(1)
    })

    it(`${site}: folds direction BEFORE structured, both exactly once`, () => {
      const structured = { mood: "brooding" }
      const prompt = run({
        prompt: "a portrait",
        direction: { cameraMotion: CAMERA_MOTION },
        structured,
      })
      expect(prompt).toBe(`a portrait. ${motionTerm}. ${renderStructuredFields(structured)}`)
    })
  }
})

describe("payload-builder video: stored ids are ADDITIVE to the graph composition", () => {
  const motionTerm = getCameraMotionTerm(CAMERA_MOTION)

  it("lands AFTER a wired cinematography hint — no precedence, no dedupe", () => {
    // A wired picker folds into the body inside `composeVideoPrompt`; the
    // stored ids fold after it. Exactly today's semantics for two wired picker
    // nodes of one family — and the same ordering the still side pins.
    const personNode = node("cine-1", "person", {
      label: "Person",
      preText: "a weathered fisherman",
    })
    const prompt = promptFor(
      "generate-video",
      { prompt: "walking the pier", direction: { cameraMotion: CAMERA_MOTION } },
      { nodes: [personNode], edges: [edge("cine-1", "vid-1", null, "look")] },
    )!
    expect(prompt).toContain("a weathered fisherman")
    expect(prompt).toContain(motionTerm)
    expect(prompt.indexOf(motionTerm)).toBeGreaterThan(prompt.indexOf("a weathered fisherman"))
  })

  it("folds BEFORE @-mention resolution, so identity directives still wrap it", () => {
    // The fold must land on the prompt BODY, before `resolveVideoPromptMentions`
    // frames it — folding afterwards would push the look description past the
    // identity directives (the bug this channel exists to fix).
    const kira = node("char-1", "character", {
      label: "Kira",
      characterName: "Kira",
      sourceImageUrl: "https://r2/kira-source.png",
      canonicalDescription: "young woman, brown eyes",
      defaultAssetUrl: "https://r2/kira-portrait.png",
    })
    const prompt = promptFor(
      "generate-video",
      { prompt: "@kira walks away", direction: { cameraMotion: CAMERA_MOTION } },
      { nodes: [kira], edges: [edge("char-1", "vid-1", null, "imageReferences")] },
    )!
    expect(prompt).toContain(motionTerm)
    expect(occurrences(prompt, motionTerm)).toBe(1)
    // The resolver's own framing is still present and still wraps the body.
    expect(prompt).toContain("Kira")
  })
})
