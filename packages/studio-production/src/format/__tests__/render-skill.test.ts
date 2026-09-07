import { describe, it, expect } from "vitest"
import { z } from "zod"

import { LLM_TEXT_INPUT_MAX } from "@nodaro/shared"

import { DIRECTING_MODES } from "../../model-menu"
import fixtureExample from "../fixtures/example.json"
import {
  renderStrictJsonSchema,
  renderStructuralJsonSchema,
} from "../json-schema"
import {
  buildFormatRegistry,
  lookPickerKeys,
  shotPickKeys,
} from "../registry"
import {
  renderSkill,
  renderSystemPrompt,
} from "../render-skill"
import {
  AUDIO_MODES,
  FORMAT_ID,
  productionDocumentSchema,
} from "../schema"

const GENERATED_FROM = { prompts: "1.10.0", shared: "2.14.0" }

/** The single fenced JSON block of the skill — the worked example that ships. */
function workedExample(markdown: string): Record<string, unknown> {
  const fence = markdown.split("\n```json\n")[1]?.split("\n```")[0]
  expect(fence, "the skill must carry exactly one fenced json example").toBeTruthy()
  return JSON.parse(fence) as Record<string, unknown>
}

describe("renderSkill", () => {
  const registry = buildFormatRegistry()
  const { skillMd, catalogMd } = renderSkill(registry, GENERATED_FROM)

  it("opens with the frontmatter a skill loader reads", () => {
    expect(skillMd.startsWith("---\nname: studio-production\n")).toBe(true)
    expect(skillMd).toContain("description: ")
    expect(skillMd).toContain(
      "generated_from: \"@nodaro/prompts 1.10.0, @nodaro/shared 2.14.0\"",
    )
  })

  it("teaches the layers, the rules and the workflow", () => {
    expect(skillMd).toContain("film > scene look > shot picks")
    expect(skillMd).toContain("Ids, never labels")
    expect(skillMd).toContain("references/catalog.md")
    expect(skillMd).toContain("schema.json")
    expect(skillMd).toContain("Common mistakes")
    expect(skillMd).toContain("under ~20 scenes")
  })

  it("names Director's Add scenes as the append path, never the deleted Import scenes…", () => {
    // The editor's "Import scenes…" item was removed with the ⋯ menu (spec
    // 2026-09-02 §17.11). This string rides `renderSystemPrompt` too, so a
    // stale sentence would teach every Director run a path that isn't there.
    expect(skillMd).not.toContain("Import scenes…")
    expect(skillMd).toContain("Director's Review step (**Add scenes**)")
  })

  it("points at the catalog instead of inlining it", () => {
    expect(skillMd.length).toBeLessThan(catalogMd.length)
    // A deep catalog row belongs to catalog.md, not to the skill body.
    expect(catalogMd).toContain("photographerId · Photographer")
    expect(skillMd).not.toContain("photographerId · Photographer")
  })

  it("the catalog carries the legend WITH terms and its own provenance", () => {
    expect(catalogMd).toContain("@nodaro/prompts 1.10.0")
    expect(catalogMd).toContain("golden-hour — Golden Hour — golden hour")
  })

  it("illustrates the model-words rule with models and words that EXIST", () => {
    // The rule says "take the words from the model's own row" — so an example
    // naming a model or a resolution this catalog does not have teaches the
    // exact mistake it forbids. Every `` `word` on id `` in the prose is checked.
    const models = [...registry.imageModels, ...registry.videoModels]
    const rule = skillMd.split("are the MODEL's own words**")[1]?.split("\n8.")[0]
    expect(rule, "the model-words rule must be there to illustrate").toBeTruthy()
    const examples = [...rule!.matchAll(/`([^`\n]+)` on ([a-z0-9.-]+)/g)]
    expect(examples.length, "the rule must carry examples").toBeGreaterThan(1)
    for (const [, word, id] of examples) {
      const model = models.find((m) => m.id === id)
      expect(model, `${id} is not a model in the catalog`).toBeDefined()
      expect(model!.resolutions, `${id} does not offer ${word}`).toContain(word)
    }
    // And they must not all speak the same vocabulary — that IS the rule.
    expect(new Set(examples.map((m) => m[1])).size).toBeGreaterThan(1)
  })

  it("states what is REJECTED outright, and that the rest only warns", () => {
    const rejects = skillMd.split("**What is REJECTED outright**")[1]?.split("\n\n")[0]
    expect(rejects, "the rules must name the hard rejections").toBeTruthy()
    expect(rejects).toContain(FORMAT_ID)
    expect(rejects).toContain("`version`")
    expect(rejects).toContain("`prompt`")
    expect(rejects).toContain("`text`")
    expect(rejects).toContain("`seconds`")
    expect(rejects).toContain("imports with a warning")
    // The cast kinds come from the CONTRACT, so a kind added to the schema and
    // not to the prose fails here rather than warning on every entry of it. They
    // belong to the WARN-and-import rule: only the published `schema.json` enums
    // them — the importer lists an unknown kind as unresolved and imports the rest.
    const published = renderStrictJsonSchema(registry) as unknown as {
      properties: { cast: { items: { properties: { kind: { enum: string[] } } } } }
    }
    const kinds = published.properties.cast.items.properties.kind.enum
    const castRule = skillMd.split("**`cast[].kind` is one of**")[1]?.split("\n\n")[0]
    expect(castRule, "the rules must name the cast kinds").toBeTruthy()
    for (const kind of kinds) expect(castRule, kind).toContain(kind)
    expect(castRule, "and say where they ARE enforced").toContain("schema.json")
  })

  it("says who writes `cast[].imageUrl`, and that an author does not (D8)", () => {
    // The field is in the published contract, so an author WILL see it in
    // `schema.json` — the rules have to say it isn't theirs to write, or the
    // model invents image urls the importer can never fetch.
    const castRule = skillMd.split("**`cast[].kind` is one of**")[1]?.split("\n\n")[0]
    expect(castRule, "the cast rule must be there").toBeTruthy()
    expect(castRule).toContain("`cast[].imageUrl`")
    expect(castRule).toContain("EXPORT")
    expect(castRule).toContain("Leave it out")
  })

  it("keeps D4 in rule 4 while naming D8's user-initiated exception", () => {
    // Both halves, in the ONE place an author reads: the import creates
    // nothing, and the user may then choose to create what is missing.
    const rule = skillMd.split("**Prose mentions are `@Name`**")[1]?.split("\n5.")[0]
    expect(rule, "the mentions rule must be there").toBeTruthy()
    expect(rule).toContain("nothing is created for")
    expect(rule).toContain("choose to create a missing one")
  })

  it("separates the FRAME resolution default from motion's Auto", () => {
    expect(skillMd).toContain(`falls back to the frame default (${registry.defaults.resolution})`)
    expect(skillMd).toContain("in `motion` it falls back to")
    expect(skillMd).toContain("`motion.resolution` has NO default")
    expect(skillMd).toContain("Auto")
  })

  it("includes rule 11 about putting the film's own look in film", () => {
    expect(skillMd).toContain("11. **Put the film's own look in `film`.**")
  })

  it("pins rule 11's film-dimension prose to FILM_LOOK_KEYS (an invariant, not a reminder)", () => {
    // Rule 11 names the FILM dimensions in WORDS — "camera, colour, style or
    // era" — because the picker labels ("Camera / Film", "Color / Look") read
    // worse in a sentence, and words can't interpolate. So the COUNT is pinned
    // against the literal: a fifth key in `FILM_LOOK_KEYS` fails here and the
    // prose is updated with it. Comparing `registry.filmKeys` to the set it IS
    // would pin nothing — the registry carries that very object.
    expect(registry.filmKeys.size).toBe(4)
    expect(skillMd).toContain("A camera, colour, style or era key")
  })

  it("the catalog renders the subject block (D1); the skill body does not", () => {
    expect(catalogMd).toContain("## Subject dimensions — frame.subject")
    expect(skillMd).not.toContain("## Subject dimensions")
  })

  it("includes rules 12–13 about per-shot audio cues, in order after rule 11", () => {
    expect(skillMd).toContain(
      "12. **Audio is a list of concurrent cues per shot** — `shots[].audio`, each",
    )
    expect(skillMd).toContain(
      "13. **`motion.audio` is for a scene WITHOUT `shots`.** Beside shots, its cues",
    )
    const rule11At = skillMd.indexOf("11. **Put the film's own look in `film`.**")
    const rule12At = skillMd.indexOf("12. **Audio is a list of concurrent cues per shot**")
    const rule13At = skillMd.indexOf("13. **`motion.audio` is for a scene WITHOUT `shots`.**")
    expect(rule11At).toBeGreaterThan(-1)
    expect(rule12At).toBeGreaterThan(rule11At)
    expect(rule13At).toBeGreaterThan(rule12At)
  })

  it("names every AUDIO_MODES member in rule 12's prose (B19 — an invariant, not a reminder)", () => {
    // Read from schema.ts, never a hand-typed list here: a mode added to (or
    // dropped from) AUDIO_MODES without updating rule 12's prose must fail.
    const rule = skillMd
      .split("12. **Audio is a list of concurrent cues per shot**")[1]
      ?.split("\n13.")[0]
    expect(rule, "rule 12 must be there").toBeTruthy()
    for (const mode of AUDIO_MODES) expect(rule).toContain(`\`${mode}\``)
  })

  it("includes rule 14 about motion.input, after rule 13 and before Workflow (D3)", () => {
    expect(skillMd).toContain("14. **`motion.input` is the directing mode**")
    const rule13At = skillMd.indexOf("13. **`motion.audio` is for a scene WITHOUT `shots`.**")
    const rule14At = skillMd.indexOf("14. **`motion.input` is the directing mode**")
    const workflowAt = skillMd.indexOf("## Workflow")
    expect(rule13At).toBeGreaterThan(-1)
    expect(rule14At).toBeGreaterThan(rule13At)
    expect(workflowAt).toBeGreaterThan(rule14At)
    // Every value the rule names is one this catalog's video models actually
    // publish an `inputs:` row from — DIRECTING_MODES, not a hand-copied list.
    // SCOPED TO RULE 14's OWN TEXT (sliced at rule 15's marker, the idiom
    // below): over the whole document these would pass on another rule's
    // wording, or on a `## Video models` row, while rule 14 named nothing.
    const rule = skillMd
      .split("14. **`motion.input` is the directing mode**")[1]
      ?.split("\n15.")[0]
    expect(rule, "rule 14 must be there").toBeTruthy()
    for (const mode of DIRECTING_MODES) expect(rule).toContain(`\`${mode}\``)
  })

  it("names the WHICH model rule 14 gates on, correctly for BOTH halves (R37: import vs editor)", () => {
    // R36's fix picked a Composer-only wording ("the scene's own model when
    // the plan names one, else the chosen one") that was FALSE of import:
    // `repairModel` validates `motion.input` against `motion.model`, or the
    // FORMAT's own default video model (`registry.defaults.videoModel`) —
    // never the live UI pick, which the importer never sees at all. R37
    // pins the two halves separately so an author reads the truth for each.
    const rule = skillMd
      .split("14. **`motion.input` is the directing mode**")[1]
      // Rule 15 (D4) sits directly below rule 14 with no blank line between
      // them — `\n\n` alone would swallow it into this slice, so the slice is
      // bounded at rule 15's own marker instead (updated, not loosened).
      ?.split("\n15.")[0]
    expect(rule, "rule 14 must be there").toBeTruthy()
    expect(rule).toContain("Checked at IMPORT against the scene's own model")
    expect(rule).toContain(`\`${registry.defaults.videoModel}\` (the format's default video model)`)
    expect(rule).toContain("In the EDITOR")
    expect(rule).toContain("the model the scene OPENS WITH")
    // The fix-round-1 wording (Composer-only, and wrong about import) is gone.
    expect(rule).not.toContain("the CHOSEN model's own")
    expect(rule).not.toContain("else the chosen one")
  })

  it("names frame.subject in the SKILL only — never in the generator's prompt (R49)", () => {
    // D1's invariant, made visible to the one audience that can act on it: a
    // hand-authored or studio-exported FILE may carry `frame.subject`, and the
    // published skill is where an author reads about it. The generator must
    // NOT be told — its STRUCTURAL schema has no `subject` property, so a
    // document naming one would be refused by the very route that produced it.
    expect(skillMd).toContain("18. **`frame.subject`")
    expect(skillMd).toContain("(the Subject block)")
    // The example field names are DERIVED, never hand-typed beside a catalog
    // the same rule points at.
    for (const d of registry.subject.slice(0, 4)) {
      expect(skillMd).toContain(`\`${d.field}\``)
    }
    const systemPrompt = renderSystemPrompt(registry)
    expect(systemPrompt).not.toContain("18. **`frame.subject`")
    expect(systemPrompt).not.toContain("frame.subject")
  })

  it("includes rule 15 about scenes[].voice, after rule 14 and before Workflow (D4)", () => {
    expect(skillMd).toContain("15. **`scenes[].voice` is the spoken line**")
    const rule14At = skillMd.indexOf("14. **`motion.input` is the directing mode**")
    const rule15At = skillMd.indexOf("15. **`scenes[].voice` is the spoken line**")
    const workflowAt = skillMd.indexOf("## Workflow")
    expect(rule14At).toBeGreaterThan(-1)
    expect(rule15At).toBeGreaterThan(rule14At)
    expect(workflowAt).toBeGreaterThan(rule15At)
    const rule = skillMd.split("15. **`scenes[].voice` is the spoken line**")[1]?.split("\n\n")[0]
    expect(rule, "rule 15 must be there").toBeTruthy()
    expect(rule).toContain("`text` (required)")
    expect(rule).toContain("`casting`")
    expect(rule).toContain("STUDIO EXPORT")
    expect(rule).toContain("reserved here")
  })

  it("includes rule 16 about music, after rule 15 and before Workflow (D5)", () => {
    const registry = buildFormatRegistry()
    const { skillMd } = renderSkill(registry, GENERATED_FROM)
    expect(skillMd).toContain("16. **`music` is the production's ONE soundtrack**")
    const rule15At = skillMd.indexOf("15. **`scenes[].voice` is the spoken line**")
    const rule16At = skillMd.indexOf("16. **`music` is the production's ONE soundtrack**")
    const workflowAt = skillMd.indexOf("## Workflow")
    expect(rule15At).toBeGreaterThan(-1)
    expect(rule16At).toBeGreaterThan(rule15At)
    expect(workflowAt).toBeGreaterThan(rule16At)
    const rule = skillMd
      .split("16. **`music` is the production's ONE soundtrack**")[1]
      ?.split("\n\n")[0]
    expect(rule, "rule 16 must be there").toBeTruthy()
    expect(rule).toContain("`prompt` (required)")
    expect(rule).toContain("`vocals`")
    expect(rule).toContain("`instruments`")
    // Unlike voice, every field here is generator-authorable (D5) — the rule
    // says so explicitly rather than leaving it implied.
    expect(rule).toContain("every one of these is yours to author")
    // …AND that they are catalog ids, not free text (whole-branch panel: the
    // rule used to say "text tags, not platform ids" while the schema's own
    // description called them catalog ids — one of the two had to go).
    expect(rule).toContain("every one is a CATALOG ID")
    expect(rule).not.toContain("text tags")
    expect(rule).toContain(`1–${registry.music.maxDuration}s`)
    expect(rule).toContain("never sent to the generator")
  })

  it("includes rule 17 about the root brief, after rule 16 and before Workflow (D6)", () => {
    const registry = buildFormatRegistry()
    const { skillMd } = renderSkill(registry, GENERATED_FROM)
    expect(skillMd).toContain("17. **`brief` is the production's own logline**")
    const rule16At = skillMd.indexOf("16. **`music` is the production's ONE soundtrack**")
    const rule17At = skillMd.indexOf("17. **`brief` is the production's own logline**")
    const workflowAt = skillMd.indexOf("## Workflow")
    expect(rule16At).toBeGreaterThan(-1)
    expect(rule17At).toBeGreaterThan(rule16At)
    expect(workflowAt).toBeGreaterThan(rule17At)
    const rule = skillMd
      .split("17. **`brief` is the production's own logline**")[1]
      ?.split("\n\n")[0]
    expect(rule, "rule 17 must be there").toBeTruthy()
    expect(rule).toContain("optional")
    // The DIALOG's own fallback (studio falls back to what the user typed) is
    // studio's business, not the format's — the rule stays about the FORMAT.
    expect(rule).not.toContain("Describe")
  })
})

describe("the skill's worked example is authored against THIS catalog", () => {
  const registry = buildFormatRegistry()
  const { skillMd } = renderSkill(registry, GENERATED_FROM)
  const example = workedExample(skillMd) as {
    brief?: string
    film?: Record<string, string>
    music?: {
      prompt: string
      duration?: number
      vocals?: string
      vocalGender?: string
      genre?: string
      mood?: string
      instruments?: string[]
      singingStyle?: string
      language?: string
    }
    cast?: Array<{ kind: string; name: string; description?: string; imageUrl?: string }>
    scenes: Array<{
      look?: Record<string, string | string[]>
      frame?: {
        model?: string
        aspectRatio?: string
        resolution?: string
        count?: number
        subject?: Record<string, string | string[]>
      }
      motion?: {
        model?: string
        resolution?: string
        duration?: number
        cameraMotionId?: string
        input?: string
      }
      voice?: { text: string; casting?: string }
      shots?: Array<{
        seconds: number
        picks?: Record<string, string>
        transition?: Record<string, string>
        characterFx?: Record<string, string>
        audio?: Array<{ mode: string; content: string; voice?: string; speaker?: string }>
      }>
    }>
  }
  const picker = (key: string) => registry.pickers.find((p) => p.key === key)

  it("names only film keys the film layer owns, with real ids", () => {
    for (const [key, id] of Object.entries(example.film ?? {})) {
      expect(registry.filmKeys.has(key), `${key} is not a film key`).toBe(true)
      expect(picker(key)!.options.map((o) => o.id)).toContain(id)
    }
  })

  it("names only look and pick keys with real ids", () => {
    const lookKeys = new Set(lookPickerKeys(registry).map((p) => p.key))
    const pickKeys = new Set(shotPickKeys(registry).map((p) => p.key))
    for (const scene of example.scenes) {
      for (const [key, value] of Object.entries(scene.look ?? {})) {
        expect(lookKeys.has(key), `${key} is not a look key`).toBe(true)
        const valid = picker(key)!.options.map((o) => o.id)
        for (const id of Array.isArray(value) ? value : [value]) expect(valid).toContain(id)
        if (Array.isArray(value)) expect(value.length).toBeLessThanOrEqual(picker(key)!.maxPicks)
      }
      for (const shot of scene.shots ?? []) {
        for (const [key, id] of Object.entries(shot.picks ?? {})) {
          expect(pickKeys.has(key), `${key} is not a pick key`).toBe(true)
          expect(picker(key)!.options.map((o) => o.id)).toContain(id)
        }
      }
    }
  })

  it("uses models that exist, with options and a duration THEY offer", () => {
    for (const scene of example.scenes) {
      const image = registry.imageModels.find((m) => m.id === scene.frame?.model)
      if (scene.frame?.model) expect(image, scene.frame.model).toBeDefined()
      if (image && scene.frame?.aspectRatio) {
        expect(image.aspectRatios).toContain(scene.frame.aspectRatio)
      }
      if (image && scene.frame?.resolution) {
        expect(image.resolutions).toContain(scene.frame.resolution)
      }
      if (scene.frame?.count !== undefined) {
        expect(scene.frame.count).toBeLessThanOrEqual(registry.candidates.max)
      }
      const video = registry.videoModels.find((m) => m.id === scene.motion?.model)
      if (scene.motion?.model) expect(video, scene.motion.model).toBeDefined()
      if (video && scene.motion?.duration !== undefined) {
        expect(video.durations).toContain(scene.motion.duration)
      }
      if (video && scene.motion?.resolution) {
        expect(video.resolutions).toContain(scene.motion.resolution)
      }
      if (scene.motion?.cameraMotionId) {
        expect(picker("cameraMotionId")!.options.map((o) => o.id)).toContain(
          scene.motion.cameraMotionId,
        )
      }
    }
  })

  it("uses real lever ids and fits every scene inside its model's budget", () => {
    for (const scene of example.scenes) {
      const video = registry.videoModels.find((m) => m.id === scene.motion?.model)
      const total = (scene.shots ?? []).reduce((sum, s) => sum + s.seconds, 0)
      const budget =
        video && video.durations.length > 0
          ? Math.max(...video.durations)
          : registry.shots.fallbackCapSeconds
      expect(total).toBeLessThanOrEqual(budget)
      for (const shot of scene.shots ?? []) {
        expect(Math.round(shot.seconds * 10) / 10).toBe(shot.seconds)
        for (const [node, source] of [
          [shot.transition, registry.transition],
          [shot.characterFx, registry.characterFx],
        ] as const) {
          if (!node) continue
          expect(source.ids.map((o) => o.id)).toContain(node.id)
          for (const dimension of source.dimensions) {
            const value = node[dimension.field]
            if (value === undefined) continue
            expect(dimension.options.map((o) => o.id)).toContain(value)
          }
        }
      }
    }
  })

  it("carries every leg-D field the SYSTEM PROMPT is allowed to — audio, voice, music, brief, input (D7)", () => {
    // The worked example is the ONE place a new author reads every field this
    // format carries — D7's job is making sure none of leg D (D1/D3/D4/D5/D6)
    // ships undemonstrated. `frame.subject` (D1) and `cast[].imageUrl` (D8)
    // are STRICT-only (R47, fix round 1) — their presence is pinned in
    // `example-fixture.test.ts` against `fixtures/example.json` instead, never
    // here: this literal is what the GENERATOR reads (`renderSystemPrompt`),
    // and the route's own structural schema has neither property.
    expect(example.brief, "brief").toBeTruthy()
    expect(example.music?.prompt, "music.prompt").toBeTruthy()
    expect(example.scenes[0].motion?.input, "motion.input").toBeTruthy()
    expect(example.scenes[0].voice?.text, "scenes[].voice.text").toBeTruthy()
    const audio = example.scenes[0].shots?.[0]?.audio
    expect(audio?.length, "shots[].audio").toBeGreaterThan(0)
  })

  it("never carries frame.subject or cast[].imageUrl — the generator's route schema has neither (R47)", () => {
    for (const scene of example.scenes) expect(scene.frame?.subject).toBeUndefined()
    for (const entry of example.cast ?? []) expect(entry.imageUrl).toBeUndefined()
  })

  it("is route-safe by construction — the structural (generator-facing) schema accepts it whole (R47)", () => {
    // The worked example ships inside `renderSystemPrompt`'s own output
    // (`generate.ts` sends it beside `renderStructuralJsonSchema(registry)` on
    // the same wire) — so unlike `fixtures/example.json` (a studio-EXPORT
    // superset, checked against the STRICT schema elsewhere), THIS literal
    // must satisfy the schema the generator is actually bound by, whole, with
    // nothing stripped. `frame`/`cast.items` are `additionalProperties: false`
    // there and carry neither `subject` nor `imageUrl` — a document naming
    // either would be refused, which is exactly the bug R47 fixes.
    const structural = renderStructuralJsonSchema(registry)
    const parsed = z.fromJSONSchema(structural).safeParse(example)
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
  })

  it("is the same document as fixtures/example.json, modulo the STRICT-only fields it deliberately omits (R47)", () => {
    // `frame.subject` / `cast[].imageUrl` are the two DELIBERATE splits (the
    // twins used to be identical, R47 pulled them apart); `frame.
    // negativePrompt: ""` / `referenceImageUrls: []` are two PRE-EXISTING
    // empties the fixture's studio-export shape carries that this hand-typed
    // literal never bothered writing. Every OTHER divergence between the two
    // fails here — this is the guard against the twins silently drifting on
    // anything else.
    const stripped = JSON.parse(JSON.stringify(fixtureExample)) as {
      scenes: Array<{
        frame?: Record<string, unknown>
        [key: string]: unknown
      }>
      cast?: Array<Record<string, unknown>>
      [key: string]: unknown
    }
    for (const scene of stripped.scenes) {
      if (!scene.frame) continue
      delete scene.frame.subject
      // "PRE-EXISTING EMPTIES" is the claim the allowlist rests on — assert it
      // before each delete, so it can never quietly forgive a fixture that grew
      // a REAL negative prompt or a reference url the worked example lacks.
      expect(scene.frame.negativePrompt ?? "").toBe("")
      delete scene.frame.negativePrompt
      expect(scene.frame.referenceImageUrls ?? []).toEqual([])
      delete scene.frame.referenceImageUrls
    }
    if (stripped.cast) {
      stripped.cast = stripped.cast.map(({ imageUrl: _imageUrl, ...rest }) => rest)
    }
    expect(example).toEqual(stripped)
  })

  it("names only subject dimensions and ids this catalog actually has (D1)", () => {
    // Reads `fixtureExample` (`fixtures/example.json`), not the local
    // `example` (the system prompt's WORKED_EXAMPLE) — after R47's split
    // `frame.subject` lives only on the fixture (D7 fix round 1). This is
    // still the one place its ids are checked against the live catalog.
    for (const scene of fixtureExample.scenes) {
      for (const [field, value] of Object.entries(
        (scene.frame as { subject?: Record<string, string | string[]> } | undefined)
          ?.subject ?? {},
      )) {
        const dim = registry.subject.find((d) => d.field === field)
        expect(dim, `${field} is not a subject dimension`).toBeDefined()
        const valid = dim!.options.map((o) => o.id)
        for (const id of Array.isArray(value) ? value : [value]) {
          expect(valid, `${field}: ${id}`).toContain(id)
        }
        if (Array.isArray(value)) expect(value.length).toBeLessThanOrEqual(dim!.maxPicks)
      }
    }
  })

  it("gates motion.input against the scene's own model's inputs row (D3)", () => {
    for (const scene of example.scenes) {
      if (!scene.motion?.input) continue
      const model = registry.videoModels.find((m) => m.id === scene.motion?.model)
      expect(model, `${scene.motion.model} must resolve to a real video model`).toBeDefined()
      expect(model!.inputs, `${model!.id} has no inputs row`).toContain(scene.motion.input)
    }
  })

  it("names only real audio modes, and keeps voice/speaker to speech cues only (D3)", () => {
    for (const scene of example.scenes) {
      for (const shot of scene.shots ?? []) {
        for (const cue of shot.audio ?? []) {
          expect([...AUDIO_MODES]).toContain(cue.mode)
          expect(cue.content.length, `${cue.mode} cue needs content`).toBeGreaterThan(0)
          if (cue.mode !== "speech") {
            expect(cue.voice, `${cue.mode} cue must not carry voice`).toBeUndefined()
            expect(cue.speaker, `${cue.mode} cue must not carry speaker`).toBeUndefined()
          }
        }
      }
    }
  })

  it("music names real catalog ids and stays inside the format's duration cap (D5)", () => {
    const music = example.music
    expect(music, "the example must carry a soundtrack").toBeDefined()
    if (!music) return
    expect(music.prompt.length).toBeGreaterThan(0)
    if (music.vocals) expect(registry.music.vocals).toContain(music.vocals)
    if (music.vocalGender) expect(registry.music.vocalGenders).toContain(music.vocalGender)
    if (music.genre) expect(registry.music.genres.map((o) => o.id)).toContain(music.genre)
    if (music.duration !== undefined) {
      expect(music.duration).toBeLessThanOrEqual(registry.music.maxDuration)
    }
  })

  it("is a VALID document, not just valid ids — the §4 guard the fixture can't reach", () => {
    // `fixtures/example.json` is guarded as a document (Tasks 15/22/25). This
    // literal is a SECOND copy, kept local so the renderers load under plain
    // node — so its SHAPE needs its own guard, or a missing `text`, a stray
    // top-level key or a `cast.kind` outside the enum ships inside the
    // published SKILL.md with the whole suite green. Checked against BOTH the
    // importer's structural schema and the very contract the skill tells the
    // author to validate against.
    const structural = productionDocumentSchema().safeParse(example)
    expect(structural.error?.issues[0]).toBeUndefined()
    expect(structural.success).toBe(true)
    const published = z.fromJSONSchema(renderStrictJsonSchema(registry))
    const checked = published.safeParse(example)
    expect(checked.success, JSON.stringify(checked.error?.issues)).toBe(true)
  })
})

describe("renderSystemPrompt", () => {
  const registry = buildFormatRegistry()
  const prompt = renderSystemPrompt(registry)

  it("is the skill body plus the legend WITH terms", () => {
    expect(prompt).toContain("film > scene look > shot picks")
    expect(prompt).toContain("golden-hour — Golden Hour — golden hour")
    expect(prompt).toContain("photographerId · Photographer")
  })

  it("states the limits the route's maxTokens depends on", () => {
    expect(prompt).toContain("under ~20 scenes")
    expect(prompt).toContain(`max ${registry.candidates.max}`)
  })

  it("fits the route's own input ceiling", () => {
    // `POST /v1/llm/structured` validates `system` with
    // `z.string().max(LLM_TEXT_INPUT_MAX)` (§8). The legend grows with the
    // catalogs, so this is the assertion that turns a catalog bump into a build
    // failure instead of a 400 on every Generate.
    expect(renderSystemPrompt(registry).length).toBeLessThan(LLM_TEXT_INPUT_MAX)
  })

  it("does NOT carry the skill's frontmatter (it is a system prompt, not a file)", () => {
    expect(prompt.startsWith("---")).toBe(false)
  })

  it("never carries the subject block, and stays inside the 90,000-char budget (D1)", () => {
    // The subject block (Person + Styling + props) is large enough that
    // inlining it here would blow the route's input ceiling — `catalog.md`
    // is where an author reads it. The generator receives only the
    // STRUCTURAL schema (no `subject`) and this system prompt (which omits
    // the block), so it cannot author `frame.subject` in v1 — the strict
    // `schema.json` enforces that vocabulary only for a hand-authored or
    // studio-exported FILE.
    expect(prompt).not.toContain("## Subject dimensions")
    // A BAND, not a ceiling: 86,526 chars with E1's analysis-mapping section
    // and its fix round 1 (84,596 without it — directly measured by removing
    // the splice, since the two prior baselines cited for this comment, at
    // 63ec1dd and after fix round 1's own arithmetic, disagreed by ~12 bytes).
    // The lower
    // bound is what makes a catalog bump — or a block silently dropping out —
    // a visible delta on the commit that causes it, rather than something that
    // only surfaces the day it crosses the route's own limit.
    expect(prompt.length).toBeGreaterThan(80_000)
    expect(prompt.length).toBeLessThan(90_000)
  })

  it("is a pure function of the registry", () => {
    expect(renderSystemPrompt(registry)).toBe(renderSystemPrompt(registry))
  })
})
