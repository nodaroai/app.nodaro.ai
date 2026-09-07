import { describe, it, expect } from "vitest"

import {
  buildFormatRegistry,
  lookPickerKeys,
  shotPickKeys,
} from "../registry"
import { renderLegend } from "../legend"
import { VOICE_TYPES } from "../../tts-provider"
import { VOICE_DELIVERY_BOUNDS } from "../../voice-delivery-settings"

/**
 * The legend is what the generator's system prompt spends most of its tokens
 * on, and what `references/catalog.md` publishes. It must name EVERY id the
 * format accepts (an id missing here is an id no model will ever emit) while
 * staying inside the prompt budget.
 */
describe("renderLegend", () => {
  const registry = buildFormatRegistry()
  const legend = renderLegend(registry)
  const withTerms = renderLegend(registry, { terms: true })

  it("heads every picker with its key, cardinality and role", () => {
    expect(legend).toContain("framingId · Shot Size · single · usable-in-picks")
    expect(legend).toContain("atmosphereId · Atmosphere · multi ≤ 2 · usable-in-picks")
    expect(legend).toContain("characterFxId · Character FX · single · not-usable-in-picks")
  })

  it("lists every picker key and every one of its option ids", () => {
    for (const p of registry.pickers) {
      expect(legend, `${p.key} header`).toContain(`${p.key} · ${p.label} · `)
      for (const o of p.options) {
        expect(legend.includes(`${o.id} — ${o.label}`), `${p.key}/${o.id}`).toBe(true)
      }
    }
  })

  it("names the film-only keys and the shots grid", () => {
    for (const key of registry.filmKeys) expect(legend).toContain(key)
    expect(legend).toContain(`step ${registry.shots.step}`)
    expect(legend).toContain(`max ${registry.candidates.max}`)
  })

  it("gives each model its own option vocabulary, verbatim", () => {
    const gpt = registry.imageModels.find((m) => m.id === "gpt-image-2")!
    expect(legend).toContain(`${gpt.id} — ${gpt.label}`)
    expect(legend).toContain(gpt.resolutions.join(", "))
    const seedance = registry.videoModels.find((m) => m.id === "seedance-2")!
    expect(legend).toContain(seedance.durations.join(", "))
    // A video model's shots budget IS its longest clip.
    expect(legend).toContain(`shots budget ${Math.max(...seedance.durations)}s`)
  })

  it("names the defaults the importer falls back to", () => {
    expect(legend).toContain(registry.defaults.imageModel)
    expect(legend).toContain(registry.defaults.videoModel)
    expect(legend).toContain(registry.defaults.aspectRatio)
    expect(legend).toContain(registry.defaults.resolution)
  })

  it("lists the lever ids once and each timing scale", () => {
    expect(legend).toContain("shots[].transition")
    expect(legend).toContain("shots[].characterFx")
    for (const d of registry.transition.dimensions) {
      expect(legend).toContain(`${d.field}: ${d.options.map((o) => o.id).join(", ")}`)
    }
  })

  it("adds the professional TERM only when it says something new", () => {
    expect(withTerms).toContain("golden-hour — Golden Hour — golden hour")
    // The `auto` no-op rows inject nothing, so they carry no term.
    expect(withTerms).not.toContain("auto — Auto — auto")
    expect(withTerms.length).toBeGreaterThan(legend.length)
  })

  it("stays inside the system-prompt budget", () => {
    expect(legend.length).toBeGreaterThan(30_000)
    expect(legend.length).toBeLessThan(55_000)
    expect(withTerms.length).toBeGreaterThan(50_000)
    expect(withTerms.length).toBeLessThan(85_000)
  })

  it("says where a key may appear WITHOUT over-claiming", () => {
    // `usable-in-picks` is not the same as "a look key": Camera Movement is a
    // pick key that a `look` map may not name, and that has a home of its own.
    const lookKeys = lookPickerKeys(registry)
    const pickOnly = shotPickKeys(registry)
      .map((p) => p.key)
      .filter((key) => !lookKeys.some((p) => p.key === key))
    expect(pickOnly.length).toBeGreaterThan(0)
    expect(legend).toContain(`take the ${lookKeys.length} LOOK keys`)
    expect(legend).toContain(`(${pickOnly.join(", ")})`)
    for (const key of pickOnly) expect(legend).toContain(`\`motion.${key}\``)
  })

  it("labels the FRAME resolution default and says motion has none", () => {
    expect(legend).toContain(`frame.resolution ${registry.defaults.resolution}`)
    expect(legend).toContain("motion.resolution omit = Auto")
  })

  it("is a pure function of the registry", () => {
    expect(renderLegend(registry)).toBe(renderLegend(registry))
  })

  it("keeps the subject block out of the base legend, and includes it when asked (D1)", () => {
    expect(legend).not.toContain("## Subject dimensions")
    const withSubject = renderLegend(registry, { subject: true })
    expect(withSubject).toContain("## Subject dimensions — frame.subject")
    expect(withSubject).toContain("hairColor · ")
    // Every subject dimension's own key and every one of its option ids.
    for (const d of registry.subject) {
      expect(withSubject, `${d.field} header`).toContain(`${d.field} · ${d.label} · ${d.section}`)
      for (const o of d.options) {
        expect(withSubject.includes(`${o.id} — ${o.label}`), `${d.field}/${o.id}`).toBe(true)
      }
    }
  })

  it("gives every video model its own input modes (D1)", () => {
    const seedance = registry.videoModels.find((m) => m.id === "seedance-2-5")!
    expect(legend).toContain(`inputs: ${seedance.inputs!.join(", ")}`)
  })

  it("has a Music section listing every catalog and the fixed vocab (D1)", () => {
    expect(legend).toContain("## Music — music")
    // SCOPED to the Music block: a whole-legend `toContain` of an id passes on
    // any other section that happens to publish the same word, so the five
    // CATALOG rows are asserted whole, against the registry, inside it.
    const music = legend.slice(legend.indexOf("## Music — music")).split("\n## ")[0]
    for (const [row, options] of [
      ["genre", registry.music.genres],
      ["mood", registry.music.moods],
      ["instruments", registry.music.instruments],
      ["singingStyle", registry.music.singingStyles],
      ["language", registry.music.languages],
    ] as const) {
      expect(music, `the ${row} row`).toContain(
        `${row}: ${options.map((o) => o.id).join(", ")}`,
      )
    }
    expect(legend).toContain(`vocals: ${registry.music.vocals.join(", ")}`)
    // The row is the DOCUMENT field name (`vocalGender:`, singular) — D1's own
    // review flagged that it had labelled it `vocalGenders:` (the registry
    // key, plural); the registry key stays plural, only this row's LABEL
    // changed (D5).
    expect(legend).toContain(`vocalGender: ${registry.music.vocalGenders.join(", ")}`)
    // `duration` is STORED on `ProductionMusic`, never sent to Suno
    // (`useMusic.ts`) — the line says so rather than implying it drives the
    // generation (D1's duration note; D5 hoists the cap this interpolates).
    expect(legend).toContain(`duration: 1–${registry.music.maxDuration}s`)
    expect(legend).toContain("never sent to the generator")
  })

  it("has a Voice prose block naming scenes[].voice's fields (D1)", () => {
    expect(legend).toContain("## Voice — scenes[].voice")
    expect(legend).toContain("voiceType")
    expect(legend).toContain("premade")
    expect(legend).toContain("delivery")
  })

  it("pins the Voice block's delivery ranges to VOICE_DELIVERY_BOUNDS, not hand-typed numbers (D4)", () => {
    expect(legend).toContain(
      `speed ${VOICE_DELIVERY_BOUNDS.speed.min}–${VOICE_DELIVERY_BOUNDS.speed.max}`,
    )
    expect(legend).toContain(
      `stability ${VOICE_DELIVERY_BOUNDS.stability.min}–${VOICE_DELIVERY_BOUNDS.stability.max}`,
    )
    expect(legend).toContain(
      `similarityBoost ${VOICE_DELIVERY_BOUNDS.similarityBoost.min}–${VOICE_DELIVERY_BOUNDS.similarityBoost.max}`,
    )
    expect(legend).toContain(
      `style ${VOICE_DELIVERY_BOUNDS.style.min}–${VOICE_DELIVERY_BOUNDS.style.max}`,
    )
  })

  it("pins the Voice block's voiceType vocabulary to VOICE_TYPES, not a hand-typed list (R38-9)", () => {
    expect(legend).toContain(VOICE_TYPES.join(" | "))
  })

  it("has an Audio section and an audio mode per video model", () => {
    expect(legend).toContain("## Audio — shots[].audio / motion.audio")
    // Sliced to veo3.1's OWN block (its header line through the last of its
    // own indented detail lines, stopping at the next model's un-indented
    // header) — a lazy whole-legend regex would still pass if veo3.1's row
    // vanished while a LATER model's `audio:` line survived.
    const lines = legend.split("\n")
    const start = lines.findIndex((line) => line.startsWith("veo3.1 — "))
    expect(start, "veo3.1's own model header").toBeGreaterThan(-1)
    const block = [lines[start]]
    for (let i = start + 1; i < lines.length && lines[i].startsWith("  "); i++) {
      block.push(lines[i])
    }
    expect(block).toContain("  audio: speech")
  })
})
