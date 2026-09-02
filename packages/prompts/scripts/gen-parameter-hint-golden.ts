/**
 * Golden-fixture generator for `getParameterPromptHint`.
 *
 * Writes `src/__tests__/fixtures/parameter-hint-golden.json` — the byte-exact
 * output of the CURRENT `getParameterPromptHint` for a representative sample
 * of every dispatched parameter-node type. `parameter-hint-mode.test.ts` reads
 * that file and asserts the full ("today's") hint mode still reproduces it
 * exactly, so the compact-mode work can never silently move verbose output.
 *
 * Run:  npx tsx scripts/gen-parameter-hint-golden.ts     (from packages/prompts)
 *
 * DETERMINISM CONTRACT — the fixture must be byte-stable across runs:
 *   - Every case's node ids/data are PINNED into the JSON. The test never
 *     re-derives them from a catalog, so a catalog gaining entries later
 *     cannot move the golden (nor break the test).
 *   - Catalog ids are sampled positionally (first / middle / last / the
 *     no-op "auto" entry) at generation time only.
 *   - Cases are emitted sorted by `key`; there are no timestamps, absolute
 *     paths, or environment-dependent values in the output.
 *
 * Regenerating is a DELIBERATE act: a diff in this file means verbose prompt
 * text changed for real users.
 */

import { writeFileSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { PICKER_CATALOGS, type PickerCatalog, type PickerOption } from "../src/picker-catalogs.js"
import { getParameterPromptHint } from "../src/parameter-prompt-hint.js"
import type { HintGraphContext, HintNodeLike } from "@nodaro/shared"

interface GoldenCase {
  /** Stable, unique, human-readable case id — the fixture's sort key. */
  readonly key: string
  /** What the case exercises, for a reader diffing the fixture. */
  readonly note: string
  readonly node: HintNodeLike
  readonly ctx: HintGraphContext | null
  /** `getParameterPromptHint(node, ctx ?? undefined)` at generation time. */
  readonly expected: string
}

const cases: GoldenCase[] = []
const seenKeys = new Set<string>()

function add(key: string, note: string, node: HintNodeLike, ctx?: HintGraphContext): void {
  if (seenKeys.has(key)) throw new Error(`duplicate fixture key: ${key}`)
  seenKeys.add(key)
  cases.push({
    key,
    note,
    node,
    ctx: ctx ?? null,
    expected: getParameterPromptHint(node, ctx),
  })
}

/** Options that actually inject something (a no-op "auto" entry has ""). */
function injecting(options: readonly PickerOption[]): readonly PickerOption[] {
  return options.filter((o) => o.promptHint.length > 0)
}

/**
 * Positional sample of a catalog: first, middle, last, plus the first no-op
 * ("auto" / "none") entry when the catalog has one. Order-preserving + deduped.
 */
function sampleIds(options: readonly PickerOption[]): string[] {
  if (options.length === 0) return []
  const picks = [
    options[0],
    options[Math.floor(options.length / 2)],
    options[options.length - 1],
    options.find((o) => o.promptHint === ""),
  ]
  const ids: string[] = []
  for (const opt of picks) {
    if (opt && !ids.includes(opt.id)) ids.push(opt.id)
  }
  return ids
}

// ---------------------------------------------------------------------------
// 1. Every registered catalog — positional id sample + a pre/post-text variant
// ---------------------------------------------------------------------------

const catalogByType = new Map<string, PickerCatalog>(
  PICKER_CATALOGS.map((c) => [c.nodeType, c]),
)

for (const cat of PICKER_CATALOGS) {
  if (cat.kind === "single" && cat.valueField && cat.options) {
    const field = cat.valueField
    for (const id of sampleIds(cat.options)) {
      add(
        `${cat.nodeType}/id:${id}`,
        `single-dim catalog id`,
        { id: "n1", type: cat.nodeType, data: { [field]: id } },
      )
    }
    const first = injecting(cat.options)[0]
    if (first) {
      add(
        `${cat.nodeType}/pre-post`,
        `preText + postText wrap the base fragment`,
        {
          id: "n1",
          type: cat.nodeType,
          data: { [field]: first.id, preText: "shot on location", postText: "no text overlays" },
        },
      )
    }
    continue
  }

  // multi-dim: one case per positional slice across ALL dimensions, plus a
  // single-dimension case (only the first field set).
  const dims = cat.dimensions ?? []
  if (dims.length === 0) continue

  /** Dimensions whose node-data field is array-ONLY (never a bare string). */
  const arrayOnly = (field: string): boolean => field === "instruments"
  const asValue = (field: string, id: string): unknown => (arrayOnly(field) ? [id] : id)

  const slices: ReadonlyArray<readonly [string, (opts: readonly PickerOption[]) => PickerOption | undefined]> = [
    ["first-of-each", (o) => o[0]],
    ["mid-of-each", (o) => o[Math.floor(o.length / 2)]],
    ["last-of-each", (o) => o[o.length - 1]],
  ]
  for (const [name, pick] of slices) {
    const data: Record<string, unknown> = {}
    for (const dim of dims) {
      const opt = pick(dim.options)
      if (opt) data[dim.field] = asValue(dim.field, opt.id)
    }
    add(`${cat.nodeType}/${name}`, `multi-dim: ${name} across ${dims.length} dimensions`, {
      id: "n1",
      type: cat.nodeType,
      data,
    })
  }

  const soleDim = dims[0]
  const soleOpt = injecting(soleDim.options)[0] ?? soleDim.options[0]
  if (soleOpt) {
    add(`${cat.nodeType}/one-dimension`, `multi-dim: only "${soleDim.field}" set`, {
      id: "n1",
      type: cat.nodeType,
      data: { [soleDim.field]: asValue(soleDim.field, soleOpt.id) },
    })
    add(`${cat.nodeType}/pre-post`, `multi-dim: preText + postText`, {
      id: "n1",
      type: cat.nodeType,
      data: {
        [soleDim.field]: asValue(soleDim.field, soleOpt.id),
        preText: "shot on location",
        postText: "no text overlays",
      },
    })
  }
}

// ---------------------------------------------------------------------------
// 2. Multi-pick (array-valued) fields
// ---------------------------------------------------------------------------

/** node type → the data field that accepts an array of 1-2 ids. */
const MULTI_PICK_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["mood", "mood"],
  ["material", "material"],
  ["atmosphere", "atmosphere"],
  ["action-fx", "actionFx"],
  ["held-prop", "heldProp"],
  ["post-process-effects", "postProcess"],
  ["transition", "transition"],
  ["character-fx", "characterFx"],
]

for (const [nodeType, field] of MULTI_PICK_FIELDS) {
  const cat = catalogByType.get(nodeType)
  const opts = injecting(cat?.options ?? [])
  if (opts.length < 2) continue
  add(`${nodeType}/multi-pick`, `array of 2 ids on "${field}"`, {
    id: "n1",
    type: nodeType,
    data: { [field]: [opts[0].id, opts[1].id] },
  })
}

/** The two multi-dim catalogs with an array-valued dimension. */
for (const [nodeType, field] of [
  ["framing", "composition"],
  ["lighting", "lightingStyle"],
] as const) {
  const cat = catalogByType.get(nodeType)
  const dim = cat?.dimensions?.find((d) => d.field === field)
  const opts = injecting(dim?.options ?? [])
  if (opts.length < 2) continue
  add(`${nodeType}/multi-pick`, `array of 2 ids on the "${field}" dimension`, {
    id: "n1",
    type: nodeType,
    data: { [field]: [opts[0].id, opts[1].id] },
  })
}

// ---------------------------------------------------------------------------
// 3. Timing fields + graph-aware composers (ctx-less and with a tiny ctx)
// ---------------------------------------------------------------------------

const firstInjecting = (nodeType: string): string =>
  injecting(catalogByType.get(nodeType)?.options ?? [])[0]?.id ?? ""

const TRANSITION_ID = firstInjecting("transition")
const CHARACTER_FX_ID = firstInjecting("character-fx")
const CAMERA_MOTION_ID = firstInjecting("camera-motion")

/** A two-node upstream graph feeding the composer's startState / endState. */
function stateCtx(targetId: string): HintGraphContext {
  return {
    nodes: [
      { id: "s1", type: "framing", data: { shotSize: "wide-shot" } },
      { id: "s2", type: "mood", data: { mood: "calm" } },
    ],
    edges: [
      { source: "s1", target: targetId, sourceHandle: "output", targetHandle: "startState" },
      { source: "s2", target: targetId, sourceHandle: "output", targetHandle: "endState" },
    ],
  }
}

add(
  "camera-motion/ctx-less",
  "camera-motion with no graph context — bare motion hint",
  { id: "n1", type: "camera-motion", data: { cameraMotion: CAMERA_MOTION_ID } },
)
add(
  "camera-motion/with-ctx",
  "camera-motion composing startState + endState clauses",
  { id: "n1", type: "camera-motion", data: { cameraMotion: CAMERA_MOTION_ID } },
  stateCtx("n1"),
)
add(
  "camera-motion/with-ctx-pre-post",
  "camera-motion: startState/endState clauses plus preText/postText",
  {
    id: "n1",
    type: "camera-motion",
    data: { cameraMotion: CAMERA_MOTION_ID, preText: "handheld", postText: "35mm" },
  },
  stateCtx("n1"),
)

add(
  "transition/timing",
  "transition with position + duration + intensity, no ctx",
  {
    id: "n1",
    type: "transition",
    data: {
      transition: TRANSITION_ID,
      position: "middle",
      duration: "short",
      intensity: "dynamic",
    },
  },
)
add(
  "transition/timing-auto",
  'transition whose timing fields are all "auto" — no timing clauses',
  {
    id: "n1",
    type: "transition",
    data: { transition: TRANSITION_ID, position: "auto", duration: "auto", intensity: "auto" },
  },
)
add(
  "transition/ctx-less",
  "transition with no graph context",
  { id: "n1", type: "transition", data: { transition: TRANSITION_ID } },
)
add(
  "transition/with-ctx",
  "transition composing startState + endState clauses",
  { id: "n1", type: "transition", data: { transition: TRANSITION_ID } },
  stateCtx("n1"),
)
add(
  "transition/with-ctx-timing-multi-pick",
  "transition: 2 ids + full timing + startState/endState + preText/postText",
  {
    id: "n1",
    type: "transition",
    data: {
      transition: [TRANSITION_ID, injecting(catalogByType.get("transition")?.options ?? [])[1]?.id]
        .filter((v): v is string => typeof v === "string"),
      position: "end",
      duration: "long",
      intensity: "subtle",
      preText: "on the beat",
      postText: "hold the last frame",
    },
  },
  stateCtx("n1"),
)

add(
  "character-fx/timing",
  "character-fx with position + duration + intensity, no ctx",
  {
    id: "n1",
    type: "character-fx",
    data: {
      characterFx: CHARACTER_FX_ID,
      position: "start",
      duration: "medium",
      intensity: "crazy",
    },
  },
)
add(
  "character-fx/with-ctx",
  "character-fx substituting an upstream character-ref name for 'the subject'",
  { id: "n1", type: "character-fx", data: { characterFx: CHARACTER_FX_ID } },
  {
    nodes: [{ id: "c1", type: "character-ref", data: { characterName: "Mira" } }],
    edges: [{ source: "c1", target: "n1", sourceHandle: "output", targetHandle: "target" }],
  },
)

// ---------------------------------------------------------------------------
// 4. Free-text node types + the empty / unknown edges
// ---------------------------------------------------------------------------

add("text-prompt/text", "free-text node — text passes through verbatim", {
  id: "n1",
  type: "text-prompt",
  data: { text: "  a lighthouse at dusk  " },
})
add("style-guide/text", "free-text node — style guide text passes through verbatim", {
  id: "n1",
  type: "style-guide",
  data: { text: "Always warm, never neon." },
})
add("tone/text", "free-text node — tone passes through verbatim", {
  id: "n1",
  type: "tone",
  data: { tone: "wry and understated" },
})
add("unknown/type", "an unregistered node type injects nothing", {
  id: "n1",
  type: "definitely-not-a-parameter-node",
  data: { whatever: "x" },
})
add("setting/unknown-id", "an unknown catalog id injects nothing", {
  id: "n1",
  type: "setting",
  data: { setting: "does-not-exist" },
})
add("setting/empty-data", "no value selected injects nothing", {
  id: "n1",
  type: "setting",
  data: {},
})

// ---------------------------------------------------------------------------
// 5. W1-b rephrase coverage — spec 2026-09-01-app-reports-triage-design.md
//    §3.3. The positional sampler above reaches only three of the reworded
//    hints, so every one is pinned here by id. A diff on any of these cases
//    means the safety-motivated wording moved — which is exactly what this
//    fixture exists to make loud.
//
//    eye-state-half-lidded and feature-collarbone-visible are DELIBERATELY
//    excluded: per the replay-harness go/no-go verdict (internal validation
//    results, 2026-09-02), those two attributes
//    rendered 0/10 and 0/22 times under either wording in validation, so the
//    approved rewording could not be confirmed and both were left byte-
//    identical to their pre-W1-b wording. Pinning them here would just be
//    re-asserting old strings under a `w1b:` key — do not add cases for them.
// ---------------------------------------------------------------------------

/** [id, data field, value] per reworded person entry. */
const W1B_PERSON: ReadonlyArray<readonly [string, string, string | string[]]> = [
  ["bust-very-full", "bust", "bust-very-full"],
  ["silhouette-hourglass", "silhouette", "silhouette-hourglass"],
  ["waist-defined", "waist", "waist-defined"],
  ["lip-state-glossy", "lipState", ["lip-state-glossy"]],
  ["lip-state-parted", "lipState", ["lip-state-parted"]],
  ["lip-state-bitten", "lipState", ["lip-state-bitten"]],
  ["eye-state-staring-camera", "eyeState", ["eye-state-staring-camera"]],
  ["texture-dewy", "skinTexture", ["texture-dewy"]],
  ["texture-glistening", "skinTexture", ["texture-glistening"]],
  ["texture-baby-soft", "skinTexture", ["texture-baby-soft"]],
  ["texture-shower-fresh-wet", "skinTexture", ["texture-shower-fresh-wet"]],
  ["feature-bare-shoulders", "distinctiveFeature", ["feature-bare-shoulders"]],
  ["feature-midriff-visible", "distinctiveFeature", ["feature-midriff-visible"]],
]

for (const [id, field, value] of W1B_PERSON) {
  add(`person/w1b:${id}`, `W1-b reworded hint — ${id}`, {
    id: "n1",
    type: "person",
    data: { [field]: value },
  })
}

add(
  "person/w1b:midriff+navel-fold",
  "W1-b reworded hard-coded midriff+navel fold clause",
  { id: "n1", type: "person", data: { distinctiveFeature: ["feature-midriff-visible", "feature-navel-visible"] } },
)

for (const id of ["state-fitted", "state-wet"] as const) {
  add(`styling/w1b:${id}`, `W1-b reworded hint — ${id}`, {
    id: "n1",
    type: "styling",
    data: { wardrobeState: [id] },
  })
}

add("pose/w1b:biting-lip", "W1-b reworded pose twin of lip-state-bitten", {
  id: "n1",
  type: "pose",
  data: { pose: "biting-lip" },
})

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

cases.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

const outPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/__tests__/fixtures/parameter-hint-golden.json",
)
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      $comment:
        "GENERATED by packages/prompts/scripts/gen-parameter-hint-golden.ts — do not hand-edit. " +
        "Byte-exact getParameterPromptHint output in full (verbose) hint mode; a diff here means " +
        "verbose prompt text changed for real users.",
      cases,
    },
    null,
    2,
  )}\n`,
  "utf8",
)

process.stdout.write(`wrote ${cases.length} golden cases → ${outPath}\n`)
