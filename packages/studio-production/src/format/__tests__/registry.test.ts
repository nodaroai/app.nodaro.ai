import { describe, it, expect } from "vitest"

import {
  BEATS_AUTHOR_CAP_SECONDS,
  BEAT_SECONDS_STEP,
  beatsCapSeconds,
} from "../../beats"
import { MAX_CANDIDATES } from "../../candidates"
import { characterFxDimensions } from "../../character-fx"
import { FILM_LOOK_KEYS } from "../../look-layers"
import {
  CAMERA_MOVEMENT_KEY,
  CHARACTER_FX_KEY,
  LOOK_PICKERS,
} from "../../look-pickers"
import {
  DEFAULT_FRAMING_ASPECT,
  DEFAULT_FRAMING_PROVIDER,
  DEFAULT_FRAMING_RESOLUTION,
  DEFAULT_VIDEO_PROVIDER,
  supportedDirectingModes,
} from "../../model-menu"
import {
  MUSIC_GENRES,
  MUSIC_INSTRUMENTS,
  MUSIC_LANGUAGES,
  MUSIC_MAX_DURATION_SECONDS,
  MUSIC_MOODS,
  MUSIC_SINGING_STYLES,
} from "../../music-options"
import {
  ANIMAL_PICKER,
  PROP_PICKERS,
  SUBJECT_MULTIDIM,
} from "../../subject-pickers"
import { transitionDimensions } from "../../transition"
import {
  buildFormatRegistry,
  lookPickerKeys,
  shotPickKeys,
} from "../registry"

/**
 * The registry view is the ONE place the format's vocabulary comes from — the
 * schema, both JSON Schemas, the legend and the skill are pure functions of it
 * (spec §4). These assertions are DERIVED, never pinned counts: a catalog bump
 * that adds a picker or a model must flow through with no edit here, while a
 * picker that silently stops reaching the format fails the build.
 */
describe("buildFormatRegistry — the picker view", () => {
  const registry = buildFormatRegistry()

  it("carries every LOOK_PICKERS key with its own cardinality and options", () => {
    for (const p of LOOK_PICKERS) {
      const row = registry.pickers.find((r) => r.key === p.key)
      expect(row, `${p.key} missing from the registry`).toBeDefined()
      expect(row!.label).toBe(p.label)
      expect(row!.surface).toBe(p.surface)
      expect(row!.multi).toBe(p.multi === true)
      expect(row!.maxPicks).toBe(p.multi === true ? (p.maxPicks ?? 2) : 1)
      expect(row!.options.map((o) => o.id)).toEqual(p.catalog.map((e) => e.id))
      expect(row!.usableAsPick).toBe(true)
    }
  })

  it("adds Camera Movement as a usable pick and Character FX as its own node", () => {
    const camera = registry.pickers.find((p) => p.key === CAMERA_MOVEMENT_KEY)
    const fx = registry.pickers.find((p) => p.key === CHARACTER_FX_KEY)
    expect(camera?.usableAsPick).toBe(true)
    expect(fx?.usableAsPick).toBe(false)
    // `beatContent` resolves LOOK_PICKERS + Camera Movement; FX is a node.
    expect(shotPickKeys(registry).map((p) => p.key)).toContain(CAMERA_MOVEMENT_KEY)
    expect(shotPickKeys(registry).map((p) => p.key)).not.toContain(CHARACTER_FX_KEY)
    // A LOOK map never carries Camera Movement — that is motion.cameraMotionId.
    expect(lookPickerKeys(registry).map((p) => p.key)).not.toContain(CAMERA_MOVEMENT_KEY)
    expect(lookPickerKeys(registry).map((p) => p.key)).not.toContain(CHARACTER_FX_KEY)
  })

  it("every picker key is unique and every option resolves a label", () => {
    const keys = registry.pickers.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(registry.pickers.length).toBeGreaterThanOrEqual(30)
    for (const p of registry.pickers) {
      expect(p.options.length, `${p.key} options`).toBeGreaterThan(0)
      for (const o of p.options) expect(o.label, `${p.key}/${o.id}`).toBeTruthy()
    }
  })

  it("carries real catalog ids the format's worked example uses", () => {
    const byKey = (key: string) => registry.pickers.find((p) => p.key === key)
    expect(byKey("lighting-time-of-day")?.options.map((o) => o.id)).toContain("golden-hour")
    const atmosphere = byKey("atmosphereId")
    expect(atmosphere?.multi).toBe(true)
    expect(atmosphere?.maxPicks).toBe(2)
    expect(atmosphere?.options.map((o) => o.id)).toEqual(
      expect.arrayContaining(["fog", "light-rain"]),
    )
    expect(byKey("framingId")?.options.map((o) => o.id)).toContain("wide-shot")
    expect(byKey(CAMERA_MOVEMENT_KEY)?.options.map((o) => o.id)).toContain("tracking-shot")
  })

  it("exposes the FILM layer's keys, and each is a real picker", () => {
    expect([...registry.filmKeys].sort()).toEqual([...FILM_LOOK_KEYS].sort())
    for (const key of registry.filmKeys) {
      expect(registry.pickers.some((p) => p.key === key), `${key} picker`).toBe(true)
    }
  })
})

describe("buildFormatRegistry — the lever nodes", () => {
  const registry = buildFormatRegistry()

  it("mirrors the transition catalog's own ids and scales", () => {
    expect(registry.transition.ids.map((o) => o.id)).toEqual(
      LOOK_PICKERS.find((p) => p.key === "transitionId")!.catalog.map((e) => e.id),
    )
    expect(registry.transition.dimensions.map((d) => d.field)).toEqual(
      transitionDimensions().map((d) => d.field),
    )
    for (const d of registry.transition.dimensions) {
      const source = transitionDimensions().find((s) => s.field === d.field)!
      expect(d.options.map((o) => o.id)).toEqual(source.options.map((o) => o.id))
    }
  })

  it("mirrors the character-fx catalog's own ids and scales", () => {
    expect(registry.characterFx.ids.map((o) => o.id)).toContain("werewolf")
    expect(registry.characterFx.dimensions.map((d) => d.field)).toEqual(
      characterFxDimensions().map((d) => d.field),
    )
  })

  it("the published scales are exactly the three the FORMAT can carry", () => {
    // A fourth scale cannot be expressed by `{ id, position?, duration?,
    // intensity? }` — this failing is the signal to cut a format v2, not to
    // widen the filter.
    for (const dims of [transitionDimensions(), characterFxDimensions()]) {
      expect(dims.map((d) => d.field)).toEqual(["position", "duration", "intensity"])
    }
  })
})

describe("buildFormatRegistry — models, budgets and defaults", () => {
  const registry = buildFormatRegistry()

  it("carries the curated image and video menus with their own option vocabularies", () => {
    expect(registry.imageModels.length).toBeGreaterThan(0)
    expect(registry.videoModels.length).toBeGreaterThan(0)
    const gpt = registry.imageModels.find((m) => m.id === "gpt-image-2")
    expect(gpt?.resolutions).toEqual(expect.arrayContaining(["1K", "2K", "4K"]))
    expect(gpt?.aspectRatios).toContain("16:9")
    expect(gpt?.durations).toEqual([])
    const seedance = registry.videoModels.find((m) => m.id === "seedance-2")
    expect(seedance?.durations[0]).toBe(4)
    expect(seedance?.durations.at(-1)).toBe(15)
    expect(seedance?.resolutions).toContain("1080p")
  })

  it("a video model's shots budget is the editor's own beatsCapSeconds", () => {
    // The budget belongs to `beatsCapSeconds` (lib/beats), which the legend, the
    // skill and the importer's clamp all quote — reserve headroom there and this
    // fails rather than the three artifacts silently disagreeing.
    for (const m of registry.videoModels) {
      const budget =
        m.durations.length > 0
          ? Math.max(...m.durations)
          : registry.shots.fallbackCapSeconds
      expect(beatsCapSeconds(m.durations), m.id).toBe(budget)
    }
  })

  it("reads the shots grid and the candidate ceiling from their owners", () => {
    expect(registry.shots.step).toBe(BEAT_SECONDS_STEP)
    expect(registry.shots.fallbackCapSeconds).toBe(BEATS_AUTHOR_CAP_SECONDS)
    expect(registry.candidates.max).toBe(MAX_CANDIDATES)
  })

  it("the defaults are the Composer's, and each is offered by its own menu", () => {
    expect(registry.defaults.imageModel).toBe(DEFAULT_FRAMING_PROVIDER)
    expect(registry.defaults.videoModel).toBe(DEFAULT_VIDEO_PROVIDER)
    expect(registry.defaults.aspectRatio).toBe(DEFAULT_FRAMING_ASPECT)
    expect(registry.defaults.resolution).toBe(DEFAULT_FRAMING_RESOLUTION)
    // `DEFAULT_FRAMING_ASPECT` / `_RESOLUTION` are PREFERRED, not guaranteed —
    // `useStaleSafeLever` falls back to the model's first option when a model
    // does not offer them (model-menu.ts:342-346). Asserted as a smoke pin on
    // today's curated default, not as an invariant of the menu.
    const image = registry.imageModels.find((m) => m.id === registry.defaults.imageModel)
    expect(image, registry.defaults.imageModel).toBeDefined()
    expect(registry.videoModels.some((m) => m.id === registry.defaults.videoModel)).toBe(true)
  })

  it("is memoized — the renderers may call it per artifact", () => {
    expect(buildFormatRegistry()).toBe(buildFormatRegistry())
  })

  it("publishes the audio modes and each video model's audio mode", () => {
    expect([...registry.audio.modes]).toEqual(["speech", "tone", "sfx", "ambience", "music"])
    for (const m of registry.videoModels) expect(["none", "ambient", "speech"]).toContain(m.audio)
    expect(registry.videoModels.find((m) => m.id === "veo3.1")?.audio).toBe("speech")
    // `hailuo-2.3` carries `getVideoAudioCapability("hailuo-2.3").mode === "none"` —
    // pinned so a regression collapsing every model to `speech` fails here too.
    expect(registry.videoModels.find((m) => m.id === "hailuo-2.3")?.audio).toBe("none")
  })

  it("never puts an audio mode on an image model", () => {
    for (const m of registry.imageModels) expect(m.audio).toBeUndefined()
  })
})

/**
 * Task D1 (plan-import-v2 leg D, spec §9, D9–D11): the registry learns the
 * framing SUBJECT dimensions, each video model's directing INPUT modes, and
 * the MUSIC option lists — the three vocabularies D2–D5 build on.
 */
describe("buildFormatRegistry — subject dimensions, video inputs, music", () => {
  const registry = buildFormatRegistry()

  it("carries every SUBJECT_MULTIDIM dimension with its section, cardinality and options", () => {
    // The `LOOK_PICKERS` precedent above: iterate the SOURCE, not a spot-check
    // of two dimensions — a dimension that silently stops reaching the format
    // (a section renamed, a picker dropped) fails here.
    for (const spec of SUBJECT_MULTIDIM) {
      for (const section of spec.sections) {
        for (const dim of section.dimensions) {
          const row = registry.subject.find((d) => d.field === dim.field)
          expect(row, `${dim.field} missing from the registry`).toBeDefined()
          expect(row!.label).toBe(dim.label)
          expect(row!.section).toBe(`${spec.label} · ${section.label}`)
          expect(row!.multi).toBe(dim.multi === true)
          // Against the SOURCE's own cap (`getPersonDimensionLimit` /
          // `getStylingDimensionLimit` via `buildMultiDim`), never against the
          // registry row's own value — `toBe(d.multi ? d.maxPicks : 1)` was a
          // tautology for every multi dimension.
          expect(row!.maxPicks).toBe(dim.multi === true ? (dim.maxPicks ?? 2) : 1)
          expect(row!.options.map((o) => o.id)).toEqual(
            dim.pill.catalog.map((e) => e.id),
          )
        }
      }
    }
  })

  it("carries every single-pick PROP with its own catalog, deduplicated", () => {
    const seen = new Set<string>()
    for (const p of [...PROP_PICKERS, ANIMAL_PICKER]) {
      if (seen.has(p.pill.key)) continue
      seen.add(p.pill.key)
      const row = registry.subject.find((d) => d.field === p.pill.key)
      expect(row, `${p.pill.key} missing from the registry`).toBeDefined()
      expect(row!.section).toBe("Props")
      expect(row!.multi).toBe(false)
      expect(row!.maxPicks).toBe(1)
      expect(row!.options.map((o) => o.id)).toEqual(p.pill.catalog.map((e) => e.id))
      // A prop resolves its short TERM through its own `getTerm` (the pills
      // do not), which is the one place the two differ from a multi-dim row.
      for (const o of row!.options) expect(o.term).toBe(p.getTerm(o.id))
    }
    // Animal ships in both lists and must appear exactly once.
    expect(registry.subject.filter((d) => d.field === ANIMAL_PICKER.pill.key)).toHaveLength(1)
    expect(new Set(registry.subject.map((d) => d.field)).size).toBe(registry.subject.length)
  })

  it("gives every option a resolvable label", () => {
    for (const d of registry.subject) {
      expect(d.options.length, `${d.field} options`).toBeGreaterThan(0)
      for (const o of d.options) expect(o.label, `${d.field}/${o.id}`).toBeTruthy()
    }
  })

  it("publishes each video model's input modes and the music catalogs", () => {
    expect(registry.videoModels.find((m) => m.id === "seedance-2-5")?.inputs).toContain(
      "references",
    )
    expect(registry.music.genres.length).toBeGreaterThan(0)
    // Pinned against the HOISTED constant (D5), not a magic literal — the one
    // `music-options.ts` source `useMusic`, the legend and the strict/
    // structural `music.duration` caps all read too.
    expect(registry.music.maxDuration).toBe(MUSIC_MAX_DURATION_SECONDS)
  })

  it("derives each video model's inputs straight from supportedDirectingModes, never an image model", () => {
    for (const m of registry.videoModels) {
      expect(m.inputs).toEqual(supportedDirectingModes(m.id))
    }
    for (const m of registry.imageModels) expect(m.inputs).toBeUndefined()
  })

  it("mirrors the music-options catalogs verbatim, and pins the fixed vocab", () => {
    expect(registry.music.genres.map((o) => o.id)).toEqual(MUSIC_GENRES.map((o) => o.id))
    expect(registry.music.moods.map((o) => o.id)).toEqual(MUSIC_MOODS.map((o) => o.id))
    expect(registry.music.instruments.map((o) => o.id)).toEqual(
      MUSIC_INSTRUMENTS.map((o) => o.id),
    )
    expect(registry.music.singingStyles.map((o) => o.id)).toEqual(
      MUSIC_SINGING_STYLES.map((o) => o.id),
    )
    expect(registry.music.languages.map((o) => o.id)).toEqual(MUSIC_LANGUAGES.map((o) => o.id))
    expect(registry.music.vocals).toEqual(["instrumental", "vocals"])
    expect(registry.music.vocalGenders).toEqual(["any", "male", "female"])
  })
})
