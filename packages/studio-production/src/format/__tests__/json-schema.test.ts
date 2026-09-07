import { describe, it, expect } from "vitest"
import { z } from "zod"

import example from "../fixtures/example.json"
import { DIRECTING_MODES } from "../../model-menu"
import {
  buildFormatRegistry,
  lookPickerKeys,
  shotPickKeys,
} from "../registry"
import {
  STRUCTURAL_KEYWORDS,
  renderStrictJsonSchema,
  renderStructuralJsonSchema,
} from "../json-schema"
import { FORMAT_VERSION, productionDocumentSchema } from "../schema"
import { VOICE_DELIVERY_BOUNDS } from "../../voice-delivery-settings"

const FORMAT_ID_LITERAL = "nodaro-studio-production"

type Node = Record<string, unknown>

/** Every SUBSCHEMA reachable from a node (never the `required` string array). */
function subschemas(node: Node): Node[] {
  const out: Node[] = []
  const props = node.properties as Record<string, Node> | undefined
  if (props) out.push(...Object.values(props))
  if (node.items) out.push(node.items as Node)
  if (node.additionalProperties && typeof node.additionalProperties === "object") {
    out.push(node.additionalProperties as Node)
  }
  if (Array.isArray(node.anyOf)) out.push(...(node.anyOf as Node[]))
  return out
}

function walk(node: Node, path: string, visit: (n: Node, p: string) => void): void {
  visit(node, path)
  for (const [i, child] of subschemas(node).entries()) walk(child, `${path}/${i}`, visit)
}

/** RAW JSON container nesting — the metric the route's depth cap counts. */
function rawDepth(v: unknown): number {
  if (Array.isArray(v)) return v.length === 0 ? 1 : 1 + Math.max(...v.map(rawDepth))
  if (v && typeof v === "object") {
    const values = Object.values(v as Record<string, unknown>)
    return values.length === 0 ? 1 : 1 + Math.max(...values.map(rawDepth))
  }
  return 0
}

/**
 * `example` (`fixtures/example.json`) with its two STRICT-only fields
 * stripped — `scenes[].frame.subject` (D1) and `cast[].imageUrl` (D8) — the
 * same projection `renderStructuralJsonSchema` needs (D7 fix round 1, R47:
 * the fixture keeps both fields as the studio-EXPORT-shaped superset; the
 * route's own `frame`/`cast.items` are `additionalProperties: false` with
 * neither). Every site below that spreads `example` into a STRUCTURAL-schema
 * check goes through this ONE helper, so none of them can silently pass
 * because the un-stripped base was already refused for an unrelated reason
 * (fix round 1 addendum, item 6).
 */
function routeSafe(doc: typeof example): Record<string, unknown> {
  return {
    ...doc,
    scenes: doc.scenes.map((scene) => {
      if (!scene.frame?.subject) return scene
      const { subject, ...frame } = scene.frame
      return { ...scene, frame }
    }),
    ...(doc.cast ? { cast: doc.cast.map(({ imageUrl, ...rest }) => rest) } : {}),
  }
}

/**
 * The structural schema is the one the GENERATOR route receives, so it lives
 * inside the keyword subset `z.fromJSONSchema` converts faithfully (§8). A
 * keyword outside it either throws at the route (`not`, `if/then`, `$ref`) or —
 * worse — converts to something that enforces nothing.
 */
describe("renderStructuralJsonSchema — route-safe by construction", () => {
  const schema = renderStructuralJsonSchema(buildFormatRegistry())

  it("uses only the keywords the route can convert", () => {
    const offenders: string[] = []
    walk(schema, "$", (node, path) => {
      for (const key of Object.keys(node)) {
        if (!STRUCTURAL_KEYWORDS.has(key)) offenders.push(`${path}.${key}`)
      }
    })
    expect(offenders).toEqual([])
  })

  it("never emits an anyOf of BARE required branches (it would enforce nothing)", () => {
    const offenders: string[] = []
    walk(schema, "$", (node, path) => {
      if (!Array.isArray(node.anyOf)) return
      for (const [i, branch] of (node.anyOf as Node[]).entries()) {
        const concrete = "type" in branch || "const" in branch || "enum" in branch
        if (!concrete) offenders.push(`${path}.anyOf[${i}]`)
      }
    })
    expect(offenders).toEqual([])
  })

  it("documents the at-least-one weakness: the route accepts a scene studio rejects", () => {
    const empty = {
      format: "nodaro-studio-production",
      version: FORMAT_VERSION,
      title: "Rain in Rome",
      scenes: [{ name: "a scene that plans nothing" }],
    }
    expect(z.fromJSONSchema(schema).safeParse(empty).success).toBe(true)
    expect(productionDocumentSchema().safeParse(empty).success).toBe(false)
  })

  it("REQUIRES a title — the generator always names its film (§17 erratum 12)", () => {
    expect(schema.required).toContain("title")
    const doc = {
      format: FORMAT_ID_LITERAL,
      version: FORMAT_VERSION,
      scenes: [{ frame: { prompt: "an alley" } }],
    }
    const converted = z.fromJSONSchema(schema)
    expect(converted.safeParse(doc).success).toBe(false)
    expect(converted.safeParse({ ...doc, title: "Rain in Rome" }).success).toBe(true)
  })

  it("fits the route's size and nesting caps", () => {
    expect(JSON.stringify(schema).length).toBeLessThan(64 * 1024)
    // The route counts RAW JSON container nesting and caps it at 20 (spec §8,
    // amended from its original 8). This document measures 13 (the `audio`
    // cue object added the shot's own array-of-objects nesting, D3) — seven
    // levels of headroom — and the number is pinned so a shape change that
    // eats into that headroom fails here first, on the studio side, rather
    // than as an opaque 400 on every Generate.
    expect(rawDepth(schema)).toBe(13)
    expect(rawDepth(schema)).toBeLessThanOrEqual(20)
  })

  it("round-trips through z.fromJSONSchema and accepts the §3 example, minus its STRICT-only fields", () => {
    // D11's own asymmetry (`promptBaked`, `cast[].imageUrl`): a STUDIO EXPORT
    // may write a field the GENERATOR is never asked to author, so it rides the
    // STRICT published contract only and stays out of the route's own budget.
    // `frame.subject` (D1) is the same shape — the route's `frame` object has
    // no `subject` property, on purpose (its own catalog is too large for the
    // generator's input ceiling). `fixtures/example.json` (unlike the system
    // prompt's own WORKED_EXAMPLE, split from it in D7 fix round 1 / R47)
    // carries both — it is the richer, studio-EXPORT-shaped superset the
    // import / round-trip / strict-schema tests exercise — so the route-safe
    // view here strips them rather than the schema growing a hole in its
    // `additionalProperties: false`.
    const converted = z.fromJSONSchema(schema)
    // Load-bearing, not incidental: the fixture AS WRITTEN is refused — that
    // refusal is the entire reason the strip below exists.
    expect(converted.safeParse(example).success).toBe(false)
    const parsed = converted.safeParse(routeSafe(example))
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
  })

  it("round-trips the rejections the model must not produce", () => {
    const converted = z.fromJSONSchema(schema)
    // Every fixture below NAMES a film (§17 erratum 12 made `title` required
    // on this schema alone): an untitled one would be refused on the missing
    // title, and each case would stop testing the constraint it names.
    const base = {
      format: "nodaro-studio-production",
      version: FORMAT_VERSION,
      title: "Rain in Rome",
    }
    expect(
      converted.safeParse({ ...base, scenes: [{ shots: [{ seconds: 0, text: "t" }] }] }).success,
    ).toBe(false)
    expect(
      converted.safeParse({
        ...base,
        scenes: [{ shots: [{ seconds: 2, text: "t", picks: { framingId: 42 } }] }],
      }).success,
    ).toBe(false)
    expect(converted.safeParse({ ...base, scenes: [] }).success).toBe(false)
    expect(
      converted.safeParse({
        format: "recast-script",
        version: FORMAT_VERSION,
        title: "Rain in Rome",
        scenes: [],
      }).success,
    ).toBe(false)
    // …and the structural schema names ONE version too, now that it is a
    // `const` — the route can no longer hand back a document the published
    // strict contract refuses on the version alone.
    expect(converted.safeParse({ ...base, version: 1, scenes: [{ frame: { prompt: "p" } }] }).success).toBe(
      false,
    )
  })

  it("offers the scene's generic prompt as its own bounded field", () => {
    // The authoring model never writes a field the schema does not name, and
    // the one prose field it must NOT reuse for this is `motion.prompt` — the
    // importer deletes that one the moment the scene has shots.
    const scene = (schema.properties as Record<string, Node>).scenes.items as Node
    const motion = (scene.properties as Record<string, Node>).motion
    const scenePrompt = (motion.properties as Record<string, Node>).scenePrompt
    expect(scenePrompt.type).toBe("string")
    expect(scenePrompt.maxLength).toBe(
      ((motion.properties as Record<string, Node>).prompt as Node).maxLength,
    )
    expect(String(motion.description)).toContain("scenePrompt")
  })

  // structuralAudio's own description is pinned in `json-schema.audio.test.ts`
  // (fix round 1) beside the rest of this file's audio-cue coverage.

  it("names the valid keys in each map's description rather than enumerating ids", () => {
    const scene = ((schema.properties as Record<string, Node>).scenes.items as Node)
    const look = (scene.properties as Record<string, Node>).look
    expect(String(look.description)).toContain("lighting-time-of-day")
    expect(JSON.stringify(look)).not.toContain("golden-hour")
  })
})

/**
 * `schema.json` is the PUBLISHED authoring contract (§9): it names every id, so
 * an external validator can catch an invented one before the file ever reaches
 * studio. D11 ties the two together — valid there ⇒ parses and maps here.
 */
describe("renderStrictJsonSchema — the published contract", () => {
  const registry = buildFormatRegistry()
  const schema = renderStrictJsonSchema(registry)
  const props = schema.properties as Record<string, Node>
  const scene = props.scenes.items as Node
  const sceneProps = scene.properties as Record<string, Node>

  it("is JSON Schema 2020-12 and closed at every level", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema")
    expect(schema.additionalProperties).toBe(false)
    expect(scene.additionalProperties).toBe(false)
  })

  it("enumerates every look key's ids, and every pick key's", () => {
    const look = sceneProps.look.properties as Record<string, Node>
    for (const p of lookPickerKeys(registry)) {
      expect(look[p.key], `${p.key} missing from look`).toBeDefined()
    }
    const shots = sceneProps.shots.items as Node
    const picks = ((shots.properties as Record<string, Node>).picks.properties) as Record<
      string,
      Node
    >
    for (const p of shotPickKeys(registry)) {
      expect(picks[p.key], `${p.key} missing from picks`).toBeDefined()
      expect(picks[p.key].enum).toEqual(p.options.map((o) => o.id))
    }
  })

  it("restricts `film` to the four keys the film layer owns (D14)", () => {
    expect(Object.keys(props.film.properties as Node).sort()).toEqual(
      [...registry.filmKeys].sort(),
    )
  })

  it("enumerates the model ids and the lever ids", () => {
    const frame = sceneProps.frame.properties as Record<string, Node>
    expect(frame.model.enum).toEqual(registry.imageModels.map((m) => m.id))
    const motion = sceneProps.motion.properties as Record<string, Node>
    expect(motion.model.enum).toEqual(registry.videoModels.map((m) => m.id))
    const shots = sceneProps.shots.items as Node
    const transition = ((shots.properties as Record<string, Node>).transition.properties) as Record<
      string,
      Node
    >
    expect(transition.id.enum).toEqual(registry.transition.ids.map((o) => o.id))
    for (const d of registry.transition.dimensions) {
      expect(transition[d.field].enum).toEqual(d.options.map((o) => o.id))
    }
  })

  it("carries the union of every model's own option vocabulary (model-agnostic, D11)", () => {
    const frame = sceneProps.frame.properties as Record<string, Node>
    for (const m of registry.imageModels) {
      for (const r of m.resolutions) expect(frame.resolution.enum).toContain(r)
      for (const a of m.aspectRatios) expect(frame.aspectRatio.enum).toContain(a)
    }
    const motion = sceneProps.motion.properties as Record<string, Node>
    for (const m of registry.videoModels) {
      for (const d of m.durations) expect(motion.duration.enum).toContain(d)
    }
  })

  it("leaves the tenths grid to the ROUTE — a JSON Schema validator cannot do 0.1 steps", () => {
    // ajv computes 0.3 / 0.1 = 2.9999999999999996 and REJECTS a tenth studio's
    // own export writes (0.3, 6.1). The published contract therefore states the
    // grid in prose and lets the importer snap an off-grid value. The structural
    // schema keeps `multipleOf`: that lane is zod's own float-safe remainder.
    const shots = sceneProps.shots.items as Node
    const seconds = (shots.properties as Record<string, Node>).seconds
    const structuralScene = (renderStructuralJsonSchema(registry).properties as Record<
      string,
      Node
    >).scenes.items as Node
    const structuralShots = (structuralScene.properties as Record<string, Node>).shots
      .items as Node
    const structuralSeconds = (structuralShots.properties as Record<string, Node>).seconds
    expect(seconds.multipleOf).toBeUndefined()
    expect(structuralSeconds.multipleOf).toBe(registry.shots.step)
    // The bounds the contract CAN carry stay, and the ceiling is the same one.
    expect(seconds.exclusiveMinimum).toBe(0)
    expect(seconds.maximum).toBe(structuralSeconds.maximum)
    expect(String(seconds.description)).toContain("tenths")
  })

  it("rejects a root `voice` — it is an unknown key now that voice lives at scenes[].voice (D7)", () => {
    expect(props.voice).toBeUndefined()
    const converted = z.fromJSONSchema(schema)
    expect(converted.safeParse(example).success).toBe(true)
    // Closed at the root the same way `sound: {}` already is — `voice` is no
    // longer a named allowance, so `additionalProperties: false` refuses it.
    const withRootVoice = { ...example, voice: { track: "vo-1" } }
    const parsed = converted.safeParse(withRootVoice)
    expect(parsed.success).toBe(false)
    expect(converted.safeParse({ ...example, sound: {} }).success).toBe(false)
  })

  it("enumerates `music` for real (D5) — a catalog-valid document validates, a malformed one does not", () => {
    expect(props.music).toBeDefined()
    const converted = z.fromJSONSchema(schema)
    expect(converted.safeParse(example).success).toBe(true)
    const withMusic = {
      ...example,
      music: {
        prompt: "a driving synth pulse",
        duration: registry.music.maxDuration,
        vocals: registry.music.vocals[0],
        vocalGender: registry.music.vocalGenders[0],
        genre: registry.music.genres[0]!.id,
        mood: registry.music.moods[0]!.id,
        instruments: [registry.music.instruments[0]!.id],
        singingStyle: registry.music.singingStyles[0]!.id,
        language: registry.music.languages[0]!.id,
      },
    }
    const parsed = converted.safeParse(withMusic)
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    // What D1 left as `z.unknown()` no longer accepts just anything.
    expect(converted.safeParse({ ...example, music: ["cue-a"] }).success).toBe(false)
    expect(
      converted.safeParse({ ...example, music: { prompt: "x", genre: "not-a-genre" } }).success,
    ).toBe(false)
    expect(
      converted.safeParse({ ...example, music: { prompt: "x", duration: registry.music.maxDuration + 1 } })
        .success,
    ).toBe(false)
    // `prompt` is the one required field.
    expect(converted.safeParse({ ...example, music: {} }).success).toBe(false)
  })

  it("takes the scene's generic prompt, so studio's own export validates (D11)", () => {
    const motion = sceneProps.motion.properties as Record<string, Node>
    expect(motion.scenePrompt.type).toBe("string")
    const converted = z.fromJSONSchema(schema)
    const withScenePrompt = {
      ...example,
      scenes: [
        {
          ...example.scenes[0],
          motion: { ...example.scenes[0].motion, scenePrompt: "A chase in the rain." },
        },
      ],
    }
    expect(converted.safeParse(withScenePrompt).success).toBe(true)
  })

  it("carries the at-least-one rule so valid-here ⇒ parses-there (D11)", () => {
    expect(scene.anyOf).toEqual([
      { required: ["frame"] },
      { required: ["motion"] },
      { required: ["shots"] },
      // The FOURTH stage (D4): a narration-only scene is a scene.
      { required: ["voice"] },
    ])
  })

  it("accepts the §3 example and refuses an invented model id", () => {
    const converted = z.fromJSONSchema(schema)
    expect(converted.safeParse(example).success).toBe(true)
    const invented = {
      ...example,
      scenes: [{ ...example.scenes[0], frame: { ...example.scenes[0].frame, model: "dall-e-9" } }],
    }
    expect(converted.safeParse(invented).success).toBe(false)
  })

  it("refuses an EMPTY voice line and an empty soundtrack prompt — as strict as the importer (D11)", () => {
    // The importer DROPS both, each with its own warning, so a contract that
    // accepted `""` promised something no import would land.
    const strict = z.fromJSONSchema(renderStrictJsonSchema(registry))
    const scene = { frame: { prompt: "an alley" } }
    const doc = {
      format: FORMAT_ID_LITERAL,
      version: FORMAT_VERSION,
      title: "Rain in Rome",
      scenes: [scene],
    }
    expect(strict.safeParse({ ...doc, scenes: [{ ...scene, voice: { text: "" } }] }).success).toBe(
      false,
    )
    expect(
      strict.safeParse({ ...doc, scenes: [{ ...scene, voice: { text: "Go" } }] }).success,
    ).toBe(true)
    expect(strict.safeParse({ ...doc, music: { prompt: "" } }).success).toBe(false)
    expect(strict.safeParse({ ...doc, music: { prompt: "strings" } }).success).toBe(true)
    // The STRUCTURAL schema stays looser — none of its prose fields carry a
    // minimum, and an empty string from the generator is a repair case.
    const structural = z.fromJSONSchema(renderStructuralJsonSchema(registry))
    expect(
      structural.safeParse({ ...doc, scenes: [{ ...scene, voice: { text: "" } }] }).success,
    ).toBe(true)
  })

  it("pins the version ASYMMETRY: the strict schema takes only today's, the importer takes any", () => {
    // `version: z.literal(FORMAT_VERSION)` converts to `const: 2` — the
    // published contract describes ONE format version, the one this studio
    // writes. The IMPORTER is deliberately looser (`schema.ts`: "never
    // `z.literal(FORMAT_VERSION)` — a file from a newer studio imports with a
    // `newer-version` warning rather than being refused"), so the two must not
    // be assumed to agree. Nothing else pins that on purpose.
    const strictVersion = (renderStrictJsonSchema(registry).properties as Record<
      string,
      Node
    >).version
    expect(strictVersion.const).toBe(FORMAT_VERSION)
    const strict = z.fromJSONSchema(renderStrictJsonSchema(registry))
    const v1 = { ...example, version: 1 }
    expect(strict.safeParse(v1).success).toBe(false)
    expect(strict.safeParse(example).success).toBe(true)
    // The importer's own lenient schema takes it (and a newer one).
    expect(productionDocumentSchema().safeParse(v1).success).toBe(true)
    expect(
      productionDocumentSchema().safeParse({ ...example, version: 99 }).success,
    ).toBe(true)
  })

  it("keeps `title` OPTIONAL — a hand-authored file need not name the film (§17 erratum 12)", () => {
    // The asymmetry the generator's schema states from the other side: it
    // REQUIRES a title (a draft always names its film), while the published
    // contract and the importer take a document that carries none.
    const doc = {
      format: FORMAT_ID_LITERAL,
      version: FORMAT_VERSION,
      scenes: [{ frame: { prompt: "an alley" } }],
    }
    expect(z.fromJSONSchema(renderStrictJsonSchema(registry)).safeParse(doc).success).toBe(true)
    expect(productionDocumentSchema().safeParse(doc).success).toBe(true)
    expect(renderStructuralJsonSchema(registry).required).toContain("title")
  })

  it("accepts a production larger than the GENERATOR's budget — the caps are the generator's, not the format's", () => {
    const scene = { frame: { prompt: "an alley" } }
    const doc = {
      format: "nodaro-studio-production",
      version: FORMAT_VERSION,
      title: "Rain in Rome",
      scenes: Array.from({ length: 25 }, () => scene),
    }
    expect(z.fromJSONSchema(renderStrictJsonSchema(registry)).safeParse(doc).success).toBe(true)
    // The route's schema still caps it — that is where `maxTokens` is protected.
    expect(z.fromJSONSchema(renderStructuralJsonSchema(registry)).safeParse(doc).success).toBe(
      false,
    )
  })
})

// The D3 shots[].audio / motion.audio test moved to
// `json-schema.audio.test.ts` (fix round 1) beside the rest of this file's
// audio-cue coverage.

/**
 * Task D1 (plan-import-v2 leg D, D9–D11): `frame.subject` and `motion.input`
 * ride the STRICT schema (an external validator must catch an invented
 * hair-color id or input mode), while the STRUCTURAL one — the route's own
 * budget — carries the cheap `motion.input` enum but omits `subject`
 * entirely: the legend documents it instead (`catalog.md`, gated).
 */
describe("frame.subject and motion.input (D1)", () => {
  it("the strict schema enumerates frame.subject and motion.input; the structural one carries motion.input but not subject", () => {
    const registry = buildFormatRegistry()
    const strict = z.fromJSONSchema(renderStrictJsonSchema(registry))
    expect(
      strict.safeParse({
        ...example,
        scenes: [{ frame: { prompt: "x", subject: { hairColor: "nope" } } }],
      }).success,
    ).toBe(false)
    const hairColorId = registry.subject.find((d) => d.field === "hairColor")!.options[0].id
    const inputMode = registry.videoModels.find((m) => (m.inputs?.length ?? 0) > 0)!.inputs![0]
    expect(
      strict.safeParse({
        ...example,
        scenes: [
          {
            frame: { prompt: "x", subject: { hairColor: hairColorId } },
            motion: { input: inputMode },
          },
        ],
      }).success,
    ).toBe(true)
    const structural = renderStructuralJsonSchema(registry) as Node
    const scene = (structural.properties as Record<string, Node>).scenes.items as Node
    const sceneProps = scene.properties as Record<string, Node>
    expect((sceneProps.frame.properties as Record<string, Node>).subject).toBeUndefined()
    expect((sceneProps.motion.properties as Record<string, Node>).input).toBeDefined()
    expect(
      z.fromJSONSchema(structural).safeParse({
        format: "nodaro-studio-production",
        version: FORMAT_VERSION,
        title: "Rain in Rome",
        scenes: [{ motion: { input: inputMode } }],
      }).success,
    ).toBe(true)
  })

  it("derives the STRICT input enum from the registry's own models, not the editor module", () => {
    const registry = buildFormatRegistry()
    const strictMotion = ((
      ((renderStrictJsonSchema(registry).properties as Record<string, Node>).scenes
        .items as Node).properties as Record<string, Node>
    ).motion.properties) as Record<string, Node>
    const derived = [
      ...new Set(registry.videoModels.flatMap((m) => m.inputs ?? [])),
    ]
    expect(strictMotion.input.enum).toEqual(derived)
    // Cross-check against the editor's canonical list — equal TODAY, and the
    // point of deriving is that a catalog change moves the contract without
    // one, so this is the "they agree" pin, not the source.
    expect([...derived].sort()).toEqual([...DIRECTING_MODES].sort())
  })

  it("refuses an invented input mode on both schemas", () => {
    const registry = buildFormatRegistry()
    const strict = z.fromJSONSchema(renderStrictJsonSchema(registry))
    const structural = z.fromJSONSchema(renderStructuralJsonSchema(registry))
    // `version: FORMAT_VERSION` (fix round 1 addendum, item 7) — a hardcoded
    // `version: 1` made the STRICT leg's own `version: z.literal(FORMAT_VERSION)`
    // refuse the document on the version alone, so it stopped testing the
    // input mode at all. The CONTROL leg: the identical document with a LEGAL
    // mode passes on both schemas.
    const legal = {
      format: "nodaro-studio-production",
      version: FORMAT_VERSION,
      title: "Rain in Rome",
      scenes: [{ motion: { input: DIRECTING_MODES[0] } }],
    }
    expect(strict.safeParse(legal).success, JSON.stringify(strict.safeParse(legal).error?.issues)).toBe(true)
    expect(
      structural.safeParse(legal).success,
      JSON.stringify(structural.safeParse(legal).error?.issues),
    ).toBe(true)
    // Built FROM the control (not a second literal), so a field added to
    // `legal` can never desync the two and refuse this one on that instead.
    const invalid = { ...legal, scenes: [{ motion: { input: "teleport" } }] }
    expect(strict.safeParse(invalid).success).toBe(false)
    expect(structural.safeParse(invalid).success).toBe(false)
  })

  it("caps a multi subject dimension at its own maxPicks, single ones stay scalar", () => {
    const registry = buildFormatRegistry()
    const strict = z.fromJSONSchema(renderStrictJsonSchema(registry))
    const multiDim = registry.subject.find((d) => d.multi)
    expect(multiDim, "the subject vocabulary must carry at least one multi dimension").toBeDefined()
    const at = (subject: Record<string, unknown>) => ({
      ...example,
      scenes: [{ frame: { prompt: "x", subject } }],
    })
    const tooMany = Array.from({ length: multiDim!.maxPicks + 1 }, () => multiDim!.options[0].id)
    expect(strict.safeParse(at({ [multiDim!.field]: tooMany })).success).toBe(false)

    // THE POSITIVE HALF (whole-branch panel): refusing the over-cap array says
    // nothing about what the contract ACCEPTS. Both legal spellings of a multi
    // dimension — an in-cap array, and R35's collapsed single id — must pass,
    // and so must a single-pick dimension's scalar.
    const inCap = multiDim!.options.slice(0, multiDim!.maxPicks).map((o) => o.id)
    expect(strict.safeParse(at({ [multiDim!.field]: inCap })).success).toBe(true)
    expect(strict.safeParse(at({ [multiDim!.field]: inCap[0] })).success).toBe(true)
    const singleDim = registry.subject.find((d) => !d.multi)!
    expect(strict.safeParse(at({ [singleDim.field]: singleDim.options[0].id })).success).toBe(
      true,
    )
    expect(strict.safeParse(at({ [singleDim.field]: [singleDim.options[0].id] })).success).toBe(
      false,
    )

    // …and the SHAPE that carries it: `z.union([enum, array])` converts to the
    // one `anyOf` in the published contract, which is what makes both
    // spellings legal at all.
    const subjectNode = (
      ((
        ((renderStrictJsonSchema(registry).properties as Record<string, Node>).scenes
          .items as Node).properties as Record<string, Node>
      ).frame.properties as Record<string, Node>).subject.properties as Record<string, Node>
    )[multiDim!.field]
    expect(Array.isArray(subjectNode.anyOf)).toBe(true)
    expect((subjectNode.anyOf as Node[]).length).toBe(2)
  })
})

/**
 * Task D4 (plan-import-v2 leg D): `scenes[].voice` rides BOTH schemas, but not
 * the same shape — the STRUCTURAL one (what the generator receives) exposes
 * only `text`/`casting` (skill rule 15: the rest is a studio export's own
 * fields), while the STRICT one (the published contract) names every field,
 * enums `voiceType` and bounds `delivery` against
 * {@link VOICE_DELIVERY_BOUNDS} — the D11 precedent `frame.subject` and
 * `motion.input` already set.
 */
describe("scenes[].voice (D4)", () => {
  it("the structural schema carries only text/casting; the strict one carries every field", () => {
    const registry = buildFormatRegistry()
    const structural = renderStructuralJsonSchema(registry) as Node
    const scene = (structural.properties as Record<string, Node>).scenes.items as Node
    const voiceProps = ((scene.properties as Record<string, Node>).voice.properties) as Record<
      string,
      Node
    >
    expect(Object.keys(voiceProps).sort()).toEqual(["casting", "text"])
    expect((scene.properties as Record<string, Node>).voice.required).toEqual(["text"])

    const strict = renderStrictJsonSchema(registry) as Node
    const strictScene = (strict.properties as Record<string, Node>).scenes.items as Node
    const strictVoiceProps = (
      (strictScene.properties as Record<string, Node>).voice.properties
    ) as Record<string, Node>
    expect(Object.keys(strictVoiceProps).sort()).toEqual(
      ["casting", "delivery", "model", "text", "ttsProvider", "voiceId", "voiceType"].sort(),
    )
  })

  it("the strict schema enums voiceType and bounds delivery against VOICE_DELIVERY_BOUNDS", () => {
    const registry = buildFormatRegistry()
    const converted = z.fromJSONSchema(renderStrictJsonSchema(registry))
    const withVoice = (voice: Record<string, unknown>) => ({
      ...example,
      scenes: [{ ...example.scenes[0], voice }],
    })
    expect(converted.safeParse(withVoice({ text: "Go" })).success).toBe(true)
    expect(converted.safeParse(withVoice({ text: "Go", voiceType: "premade" })).success).toBe(
      true,
    )
    expect(converted.safeParse(withVoice({ text: "Go", voiceType: "robot" })).success).toBe(
      false,
    )
    // A voiceover with no `text` is refused outright — the one required field.
    expect(converted.safeParse(withVoice({ casting: "male" })).success).toBe(false)
    // `ttsProvider` enums the platform's own TTS_PROVIDERS too (R38-1) — the
    // same enforcement `voiceType` gets, so an external validator catches an
    // invented provider before the importer's own repair would have.
    expect(
      converted.safeParse(withVoice({ text: "Go", ttsProvider: "elevenlabs-v3" })).success,
    ).toBe(true)
    expect(converted.safeParse(withVoice({ text: "Go", ttsProvider: "acme" })).success).toBe(
      false,
    )
    // Every delivery lever's bound, both directions.
    for (const [lever, { min, max }] of Object.entries(VOICE_DELIVERY_BOUNDS)) {
      expect(
        converted.safeParse(withVoice({ text: "Go", delivery: { [lever]: min } })).success,
        `${lever} at its min`,
      ).toBe(true)
      expect(
        converted.safeParse(withVoice({ text: "Go", delivery: { [lever]: max } })).success,
        `${lever} at its max`,
      ).toBe(true)
      expect(
        converted.safeParse(withVoice({ text: "Go", delivery: { [lever]: max + 1 } })).success,
        `${lever} over its max`,
      ).toBe(false)
      expect(
        converted.safeParse(withVoice({ text: "Go", delivery: { [lever]: min - 1 } })).success,
        `${lever} under its min`,
      ).toBe(false)
    }
  })

  it("the structural schema refuses a field only the strict one carries", () => {
    const registry = buildFormatRegistry()
    const structural = z.fromJSONSchema(renderStructuralJsonSchema(registry))
    const base = routeSafe(example) as { scenes: Array<Record<string, unknown>> }
    // The CONTROL leg (fix round 1 addendum, item 6): the route-safe base, no
    // `voiceId`, is legal — so the failing case below can never rot into
    // asserting some unrelated structural rejection (`example` unstripped
    // would fail regardless of `voiceId`, for `frame.subject`/`cast[].imageUrl`).
    const parsedBase = structural.safeParse(base)
    expect(parsedBase.success, JSON.stringify(parsedBase.error?.issues)).toBe(true)
    const withVoiceId = structural.safeParse({
      ...base,
      scenes: [{ ...base.scenes[0], voice: { text: "Go", voiceId: "rachel-1" } }],
    })
    expect(withVoiceId.success).toBe(false)
  })
})

// Audio-cue schema tests (structuralAudio's description, D3's shots[].audio /
// motion.audio, and D5's music) moved to `json-schema.audio.test.ts` (fix
// round 1) once this file crossed the 800-line house cap.

describe("brief — the root story logline (D6), the structural/strict asymmetry (R45)", () => {
  it("the structural schema bounds it at MAX_BRIEF_CHARS (the generator's budget); the strict one is an unbounded string, like title", () => {
    const registry = buildFormatRegistry()
    const structural = renderStructuralJsonSchema(registry) as Node
    const structuralBrief = (structural.properties as Record<string, Node>).brief
    expect(structuralBrief).toEqual({ type: "string", maxLength: 2000 })

    const strict = renderStrictJsonSchema(registry) as Node
    const props = strict.properties as Record<string, Node>
    // Same shape as `title` — no `maxLength` at all (D11: the published
    // contract bounds nothing `exportProduction` doesn't already bound, the
    // same asymmetry `music.prompt` / `voice.text` get).
    expect(props.brief).toEqual({ type: "string" })
    expect(props.brief.maxLength).toBeUndefined()
  })

  it("the structural schema refuses a brief over the cap; the strict one accepts any length", () => {
    const registry = buildFormatRegistry()
    const structural = z.fromJSONSchema(renderStructuralJsonSchema(registry))
    const strict = z.fromJSONSchema(renderStrictJsonSchema(registry))
    const base = routeSafe(example)
    // The CONTROL leg (fix round 1 addendum, item 6) — see the voiceId test's
    // own comment for why the un-stripped `example` can't be the base here.
    const parsedBase = structural.safeParse(base)
    expect(parsedBase.success, JSON.stringify(parsedBase.error?.issues)).toBe(true)
    const overCapStructural = structural.safeParse({ ...base, brief: "a".repeat(2001) })
    expect(overCapStructural.success).toBe(false)
    // The STRICT schema carries subject/imageUrl (D11's own asymmetry) — no
    // stripping needed for this leg, and the point is unbounded prose length.
    const overCap = { ...example, brief: "a".repeat(2001) }
    expect(strict.safeParse(overCap).success).toBe(true)
  })
})

describe("both renderers are pure functions of the registry", () => {
  it("render identically on repeated calls", () => {
    const registry = buildFormatRegistry()
    expect(renderStructuralJsonSchema(registry)).toEqual(renderStructuralJsonSchema(registry))
    expect(renderStrictJsonSchema(registry)).toEqual(renderStrictJsonSchema(registry))
  })
})
