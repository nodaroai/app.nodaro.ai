import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

import { getParameterPromptHint } from "../parameter-prompt-hint.js"
import { PICKER_CATALOGS, type PickerCatalog, type PickerOption } from "../picker-catalogs.js"
import type { HintGraphContext, HintNodeLike } from "@nodaro/shared"

/**
 * Node-level hint mode: a picker node may set `data.hintMode = "compact"` to
 * inject its short professional `term` instead of the long `promptHint`.
 *
 * Two properties are load-bearing and tested here:
 *
 *  (a) FULL IS BYTE-IDENTICAL. `hintMode` absent — and `hintMode: "full"` —
 *      must reproduce the golden fixture exactly, so a diff here means verbose
 *      prompt text moved for real users.
 *
 *      What the fixture IS: the byte-exact output of
 *      `getParameterPromptHint` at the moment it was captured by
 *      `scripts/gen-parameter-hint-golden.ts`, which ran AFTER the catalogs
 *      grew their `term` fields. It therefore pins full mode against
 *      regressions from here on; it is not by itself evidence that full mode
 *      still matches the pre-compact-mode implementation. That equivalence was
 *      verified separately, by replaying every pinned case against the
 *      pre-change `parameter-prompt-hint.ts` on `origin/dev` (0 mismatches),
 *      and it holds because compact mode only ever ADDS a branch: `term` is a
 *      new field, and every `promptHint` that predates this branch is
 *      untouched.
 *
 *  (b) COMPACT SWAPS ONLY THE BASE FRAGMENT. Every catalog injects its term
 *      and not its paragraph; pre/post free text, timing clauses, multi-pick
 *      joining and multi-dimension composition are unchanged.
 *
 * Plus (c): an unrecognized `hintMode` falls back to full — compact is opt-in
 * and a typo must never silently shorten a prompt.
 */

interface GoldenCase {
  readonly key: string
  readonly note: string
  readonly node: HintNodeLike
  readonly ctx: HintGraphContext | null
  readonly expected: string
}

const golden = JSON.parse(
  readFileSync(new URL("./fixtures/parameter-hint-golden.json", import.meta.url), "utf8"),
) as { readonly cases: readonly GoldenCase[] }

/** The fixture pins its own node/data, so it never re-derives ids at run time. */
const GOLDEN_CASES = golden.cases

function withMode(node: HintNodeLike, hintMode: unknown): HintNodeLike {
  return { ...node, data: { ...(node.data as Record<string, unknown>), hintMode } }
}

// ---------------------------------------------------------------------------
// (a) full mode is byte-identical to the pre-compact-mode implementation
// ---------------------------------------------------------------------------

describe("hint mode: full output is byte-identical to the golden fixture", () => {
  it("the fixture is non-trivial and covers every registered catalog", () => {
    expect(GOLDEN_CASES.length).toBeGreaterThan(150)
    const coveredTypes = new Set(GOLDEN_CASES.map((c) => c.node.type))
    for (const cat of PICKER_CATALOGS) {
      expect(coveredTypes.has(cat.nodeType), `no golden case for ${cat.nodeType}`).toBe(true)
    }
  })

  it.each(GOLDEN_CASES.map((c) => [c.key, c] as const))(
    "%s — hintMode absent reproduces the golden",
    (_key, c) => {
      expect(getParameterPromptHint(c.node, c.ctx ?? undefined)).toBe(c.expected)
    },
  )

  it.each(GOLDEN_CASES.map((c) => [c.key, c] as const))(
    '%s — hintMode "full" reproduces the golden',
    (_key, c) => {
      expect(getParameterPromptHint(withMode(c.node, "full"), c.ctx ?? undefined)).toBe(c.expected)
    },
  )
})

// ---------------------------------------------------------------------------
// (b) compact mode injects the term, never the paragraph
// ---------------------------------------------------------------------------

/** Dimensions whose node-data field is array-ONLY (never a bare string). */
const ARRAY_ONLY_FIELDS = new Set(["instruments"])

function fieldValue(field: string, id: string): unknown {
  return ARRAY_ONLY_FIELDS.has(field) ? [id] : id
}

interface CatalogProbe {
  readonly nodeType: string
  readonly field: string
  readonly option: PickerOption
  /** The term is a genuine shortening of this entry's hint. */
  readonly shortens: boolean
}

/**
 * One probe per registered catalog: the first option that injects something,
 * PREFERRING one whose term is a genuine shortening of its hint.
 *
 * Not every catalog has one. The Sound catalogs (music-mood, voice-character,
 * voice-delivery, and much of music-genre / instrumentation) are already
 * written as terse vocabulary — "mellow", "drum machine", "drawled" — so their
 * hint IS the trade term and there is nothing for compact mode to shorten.
 * Those entries are still exercised (compact must inject the term), only the
 * "shorter than full" claim is skipped, and the count of genuinely shortening
 * catalogs is asserted below so this can't quietly become the norm.
 */
function probeFor(cat: PickerCatalog): CatalogProbe | undefined {
  const field = cat.kind === "single" ? cat.valueField : cat.dimensions?.[0]?.field
  const options = cat.kind === "single" ? cat.options : cat.dimensions?.[0]?.options
  if (!field || !options) return undefined
  const injecting = options.filter((o) => o.promptHint.length > 0 && o.term.length > 0)
  const shortens = (o: PickerOption) => !o.term.includes(o.promptHint) && o.term.length < o.promptHint.length
  const option = injecting.find(shortens) ?? injecting[0]
  return option ? { nodeType: cat.nodeType, field, option, shortens: shortens(option) } : undefined
}

const PROBES: CatalogProbe[] = PICKER_CATALOGS.map(probeFor).filter(
  (p): p is CatalogProbe => p !== undefined,
)

describe("hint mode: compact injects the term instead of the promptHint", () => {
  it("every registered catalog yields a probe", () => {
    expect(PROBES).toHaveLength(PICKER_CATALOGS.length)
  })

  it("the large majority of catalogs genuinely shorten", () => {
    expect(PROBES.filter((p) => p.shortens).length).toBeGreaterThanOrEqual(30)
  })

  it.each(PROBES.map((p) => [p.nodeType, p] as const))("%s", (_type, probe) => {
    const node: HintNodeLike = {
      id: "n1",
      type: probe.nodeType,
      data: { [probe.field]: fieldValue(probe.field, probe.option.id), hintMode: "compact" },
    }
    const compact = getParameterPromptHint(node)
    const full = getParameterPromptHint(withMode(node, "full"))

    expect(compact).toContain(probe.option.term)
    expect(full).toContain(probe.option.promptHint)
    if (probe.shortens) {
      expect(compact).not.toContain(probe.option.promptHint)
      expect(compact.length).toBeLessThan(full.length)
    }
  })
})

// ---------------------------------------------------------------------------
// (b continued) everything wrapped around the base fragment is mode-invariant
// ---------------------------------------------------------------------------

describe("hint mode: compact preserves everything but the base fragment", () => {
  it("preText and postText still wrap the fragment", () => {
    const data = { setting: "forest", preText: "shot on location", postText: "no text overlays" }
    const compact = getParameterPromptHint({ id: "n1", type: "setting", data: { ...data, hintMode: "compact" } })
    expect(compact.startsWith("shot on location, ")).toBe(true)
    expect(compact.endsWith(", no text overlays")).toBe(true)
    // ...and the middle is the term, not the paragraph.
    const full = getParameterPromptHint({ id: "n1", type: "setting", data })
    expect(compact).not.toBe(full)
    expect(compact.length).toBeLessThan(full.length)
  })

  it("transition timing clauses are emitted identically in compact mode", () => {
    const data = {
      transition: "cross-dissolve",
      position: "middle",
      duration: "short",
      intensity: "dynamic",
    }
    const compact = getParameterPromptHint({ id: "n1", type: "transition", data: { ...data, hintMode: "compact" } })
    expect(compact).toContain("the transition occurs in the middle of the clip")
    expect(compact).toContain("lasting approximately 1 second")
    expect(compact).toContain("with dynamic energy and assertive flourish")
    expect(compact).toContain("cross-dissolve")
    expect(compact.length).toBeLessThan(getParameterPromptHint({ id: "n1", type: "transition", data }).length)
  })

  it("character-fx timing clauses are emitted identically in compact mode", () => {
    const fx = firstInjectingId("character-fx")
    const data = { characterFx: fx, position: "start", duration: "medium", intensity: "crazy" }
    const compact = getParameterPromptHint({ id: "n1", type: "character-fx", data: { ...data, hintMode: "compact" } })
    expect(compact).toContain("the effect occurs at the opening of the clip")
    expect(compact).toContain("manifesting over approximately 2 seconds")
    expect(compact).toContain("with extreme exaggerated energy, wild flourishes, and dramatic distortion")
  })

  it("the wired character is NAMED in both modes", () => {
    // Regression: compact mode used to run the full mode's substitution — a
    // regex replace of "the subject" — over a `term` that never contains those
    // words, so the target silently vanished from every compact character-fx
    // fragment while full mode named it.
    const fx = firstInjectingId("character-fx")
    const ctx: HintGraphContext = {
      nodes: [{ id: "c1", type: "character-ref", data: { characterName: "Mira" } }],
      edges: [{ source: "c1", target: "n1", targetHandle: "target" }],
    }
    const node: HintNodeLike = { id: "n1", type: "character-fx", data: { characterFx: fx } }
    const full = getParameterPromptHint(node, ctx)
    const compact = getParameterPromptHint(withMode(node, "compact"), ctx)

    expect(full).toContain("Mira")
    expect(full).not.toContain("the subject")
    expect(compact).toContain("Mira")
    // ...and compact is still the term, not the paragraph.
    const term = optionFor("character-fx", "characterFx", fx).term
    expect(compact).toContain(term)
    expect(compact.length).toBeLessThan(full.length)
  })

  it("an unwired character-fx names no target in either mode", () => {
    const fx = firstInjectingId("character-fx")
    const term = optionFor("character-fx", "characterFx", fx).term
    const compact = getParameterPromptHint({
      id: "n1",
      type: "character-fx",
      data: { characterFx: fx, hintMode: "compact" },
    })
    // No target wired ⇒ no prefix at all, just the term.
    expect(compact).toBe(term)
  })

  it("multi-pick joins the TERMS with the same ', and ' separator", () => {
    const options = registeredOptions("transition").filter((o) => o.promptHint.length > 0)
    const [a, b] = options
    const compact = getParameterPromptHint({
      id: "n1",
      type: "transition",
      data: { transition: [a.id, b.id], hintMode: "compact" },
    })
    expect(compact).toBe(`${a.term}, and ${b.term}`)
  })

  it("multi-dimension composition still walks every dimension", () => {
    const data = {
      shotSize: "medium-shot",
      angle: "low-angle",
      hintMode: "compact",
    }
    const compact = getParameterPromptHint({ id: "n1", type: "framing", data })
    const shotSize = optionFor("framing", "shotSize", "medium-shot")
    const angle = optionFor("framing", "angle", "low-angle")
    expect(compact).toContain(shotSize.term)
    expect(compact).toContain(angle.term)
    expect(compact).not.toContain(shotSize.promptHint)
    expect(compact).not.toContain(angle.promptHint)
  })

  it("object entities inject the bare term without the framing verb or description", () => {
    const compact = getParameterPromptHint({
      id: "n1",
      type: "animal",
      data: { animal: "dog-golden-retriever", hintMode: "compact" },
    })
    expect(compact).toBe("golden retriever")
    const full = getParameterPromptHint({ id: "n1", type: "animal", data: { animal: "dog-golden-retriever" } })
    expect(full.startsWith("featuring a golden retriever, ")).toBe(true)
  })

  it("free-text nodes are identical in both modes", () => {
    for (const [type, data] of [
      ["text-prompt", { text: "a lighthouse at dusk" }],
      ["style-guide", { text: "Always warm, never neon." }],
      ["tone", { tone: "wry and understated" }],
    ] as const) {
      const full = getParameterPromptHint({ id: "n1", type, data })
      const compact = getParameterPromptHint({ id: "n1", type, data: { ...data, hintMode: "compact" } })
      expect(compact).toBe(full)
    }
  })

  it('a no-op "auto" entry injects nothing in either mode', () => {
    for (const [type, field] of [
      ["transition", "transition"],
      ["character-fx", "characterFx"],
      ["camera-motion", "cameraMotion"],
    ] as const) {
      expect(getParameterPromptHint({ id: "n1", type, data: { [field]: "auto", hintMode: "compact" } })).toBe("")
      expect(getParameterPromptHint({ id: "n1", type, data: { [field]: "auto" } })).toBe("")
    }
  })
})

// ---------------------------------------------------------------------------
// (b continued) the mode rides down into startState / endState inputs
// ---------------------------------------------------------------------------

describe("hint mode: graph-composed clauses stay at one level of detail", () => {
  const ctx: HintGraphContext = {
    nodes: [
      { id: "s1", type: "framing", data: { shotSize: "wide-shot" } },
      { id: "s2", type: "mood", data: { mood: "calm" } },
    ],
    edges: [
      { source: "s1", target: "n1", targetHandle: "startState" },
      { source: "s2", target: "n1", targetHandle: "endState" },
    ],
  }

  it("a compact camera-motion composes compact start/end clauses", () => {
    const compact = getParameterPromptHint(
      { id: "n1", type: "camera-motion", data: { cameraMotion: "dolly-in", hintMode: "compact" } },
      ctx,
    )
    const shotSize = optionFor("framing", "shotSize", "wide-shot")
    expect(compact).toContain("beginning with ")
    expect(compact).toContain("ending with ")
    expect(compact).toContain(shotSize.term)
    expect(compact).not.toContain(shotSize.promptHint)
  })

  it("an upstream node that declares its OWN mode wins over the inherited one", () => {
    const fullChildCtx: HintGraphContext = {
      nodes: [{ id: "s1", type: "framing", data: { shotSize: "wide-shot", hintMode: "full" } }],
      edges: [{ source: "s1", target: "n1", targetHandle: "startState" }],
    }
    const compact = getParameterPromptHint(
      { id: "n1", type: "camera-motion", data: { cameraMotion: "dolly-in", hintMode: "compact" } },
      fullChildCtx,
    )
    expect(compact).toContain(optionFor("framing", "shotSize", "wide-shot").promptHint)
  })
})

// ---------------------------------------------------------------------------
// (c) unknown / malformed hintMode values fall back to full
// ---------------------------------------------------------------------------

describe("hint mode: unrecognized values fall back to full", () => {
  const BOGUS: readonly unknown[] = ["Compact", "COMPACT", "short", "terse", "", 1, true, null, {}, ["compact"]]

  it.each(GOLDEN_CASES.filter((c) => c.expected.length > 0).slice(0, 12).map((c) => [c.key, c] as const))(
    "%s — every bogus hintMode reproduces the golden",
    (_key, c) => {
      for (const bogus of BOGUS) {
        expect(getParameterPromptHint(withMode(c.node, bogus), c.ctx ?? undefined)).toBe(c.expected)
      }
    },
  )

  it("a bogus mode does not leak compact into inherited start/end clauses either", () => {
    const ctx: HintGraphContext = {
      nodes: [{ id: "s1", type: "framing", data: { shotSize: "wide-shot" } }],
      edges: [{ source: "s1", target: "n1", targetHandle: "startState" }],
    }
    const out = getParameterPromptHint(
      { id: "n1", type: "camera-motion", data: { cameraMotion: "dolly-in", hintMode: "kinda-short" } },
      ctx,
    )
    expect(out).toContain(optionFor("framing", "shotSize", "wide-shot").promptHint)
  })
})

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function registeredOptions(nodeType: string): readonly PickerOption[] {
  const cat = PICKER_CATALOGS.find((c) => c.nodeType === nodeType)
  if (!cat?.options) throw new Error(`no single-dim catalog for ${nodeType}`)
  return cat.options
}

function firstInjectingId(nodeType: string): string {
  const opt = registeredOptions(nodeType).find((o) => o.promptHint.length > 0)
  if (!opt) throw new Error(`no injecting option for ${nodeType}`)
  return opt.id
}

function optionFor(nodeType: string, field: string, id: string): PickerOption {
  const cat = PICKER_CATALOGS.find((c) => c.nodeType === nodeType)
  const options = cat?.dimensions?.find((d) => d.field === field)?.options ?? cat?.options
  const opt = options?.find((o) => o.id === id)
  if (!opt) throw new Error(`no option ${nodeType}.${field}=${id}`)
  return opt
}
