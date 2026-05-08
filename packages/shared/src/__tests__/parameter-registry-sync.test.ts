/**
 * Parameter-registry sync tests.
 *
 * Per CLAUDE.md "Parameter Picker Node Registration", every parameter node
 * type must appear in 5 registries. The shared package owns 3 of them:
 *
 *   1. PARAMETER_NODE_TYPES set            (parameter-node-value.ts)
 *   2. getParameterValue switch cases       (parameter-node-value.ts)
 *   3. getParameterPromptHint switch cases  (parameter-prompt-hint.ts)
 *
 * (The frontend owns PARAMETER_PICKER_NODE_TYPES and parameter-picker-registry,
 * tested separately on that side.)
 *
 * Drift between any of these has caused two production outages — action-fx
 * (#1649 era) and loop-subject (#2132). Both times: the type was added to
 * the set but the corresponding switch case was missed, so the orchestrator
 * created a stale `pending` jobs row and threw `Unknown node type` while the
 * picker UI silently rendered nothing.
 *
 * These tests drive a sample-data probe FROM the set, so adding a new
 * parameter type without updating the helpers fails CI here.
 */

import { describe, it, expect } from "vitest"
import {
  PARAMETER_NODE_TYPES,
  getParameterValue,
} from "../parameter-node-value.js"
import { getParameterPromptHint } from "../parameter-prompt-hint.js"

// Catalog-driven types need real ids — the prompt-hint builders look them up.
import { FRAMINGS } from "../framing.js"
import { LIGHTINGS } from "../lighting.js"
import { LENSES } from "../lens.js"
import { CAMERA_FORMATS } from "../camera-format.js"
import { CAMERA_MOTIONS } from "../camera-motions.js"
import { COLOR_LOOKS } from "../color-look.js"
import { ATMOSPHERES } from "../atmosphere.js"
import { ACTION_FX } from "../action-fx.js"
import { STYLES } from "../style.js"
import { SETTINGS } from "../setting.js"
import { LOOP_SUBJECTS } from "../loop-subject.js"
import { MATERIALS } from "../materials.js"
import { ANIMALS } from "../animals.js"
import { VEHICLES } from "../vehicles.js"
import { WEAPONS } from "../weapons.js"
import { PHOTO_GENRES } from "../photo-genre.js"
import { BACKDROPS } from "../backdrop.js"
import { HELD_PROPS } from "../held-prop.js"
import { PHOTOGRAPHERS } from "../photographer.js"
import { AESTHETICS } from "../aesthetic.js"
import { ERAS } from "../era.js"
import { MOODS } from "../mood.js"
import { POSES } from "../pose.js"
import { STYLINGS } from "../styling.js"
import { TEMPORALS } from "../temporal.js"
import { EXPOSURE_SETTINGS } from "../exposure-settings.js"
import { RENDER_QUALITIES } from "../render-quality.js"
import { COMPOSITION_EFFECTS } from "../composition-effects.js"
import { POST_PROCESS_EFFECTS } from "../post-process-effects.js"
import { PEOPLE } from "../person.js"
import {
  MUSIC_GENRES,
  MUSIC_EMOTIONS,
  INSTRUMENTS,
  VOICE_TIMBRES,
  VOICE_ARCHETYPES,
} from "../index.js"

// ---------------------------------------------------------------------------
// Lookup helper — pick an id from a catalog or return a placeholder. Empty
// catalogs fall through to a clearly invalid sentinel so the test fails
// loudly rather than silently passing on missing fixtures.
// ---------------------------------------------------------------------------
function firstId(catalog: ReadonlyArray<{ readonly id: string }>): string {
  return catalog[0]?.id ?? "<MISSING_CATALOG_ENTRY>"
}

// Pick the first FRAMINGS entry whose category === target, since FRAMINGS
// is a flat list spanning shot-size/angle/coverage/composition/vantage.
function firstByCategory<T extends { readonly id: string; readonly category: string }>(
  catalog: ReadonlyArray<T>,
  category: string,
): string {
  for (const e of catalog) {
    if (e.category === category) return e.id
  }
  return "<MISSING_CATEGORY>"
}

// Same idea for LIGHTINGS (which is also flat with `category`).
const FIRST_FRAMING_SHOT = firstByCategory(
  FRAMINGS as ReadonlyArray<{ id: string; category: string }>,
  "shot-size",
)
const FIRST_LIGHTING_TIME = firstByCategory(
  LIGHTINGS as ReadonlyArray<{ id: string; category: string }>,
  "time-of-day",
)

// ---------------------------------------------------------------------------
// Sample data per parameter type. Drives both getParameterValue and
// getParameterPromptHint tests.
// ---------------------------------------------------------------------------
const SAMPLE_DATA_BY_TYPE: Record<string, Record<string, unknown>> = {
  "text-prompt": { text: "a dog running" },
  "tone": { tone: "dramatic" },
  "style-guide": { text: "photographic, naturalistic" },
  "motion": { motion: "moderate" },
  // CAMERA_MOTIONS[0] is "auto" with intentionally empty promptHint — use a
  // real motion id so the sync test exercises the hint dispatch.
  "camera-motion": { cameraMotion: "static" },
  "framing": { shotSize: FIRST_FRAMING_SHOT },
  "lens": { lens: firstId(LENSES) },
  "camera-format": { cameraFormat: firstId(CAMERA_FORMATS) },
  "lighting": { timeOfDay: FIRST_LIGHTING_TIME },
  "color-look": { colorLook: firstId(COLOR_LOOKS) },
  "atmosphere": { atmosphere: firstId(ATMOSPHERES) },
  "style": { style: firstId(STYLES) },
  "setting": { setting: firstId(SETTINGS) },
  "person": { type: firstId(PEOPLE) },
  "mood": { mood: firstId(MOODS) },
  "photographer": { photographer: firstId(PHOTOGRAPHERS) },
  "aesthetic": { aesthetic: firstId(AESTHETICS) },
  "era": { era: firstId(ERAS) },
  "pose": { pose: firstId(POSES) },
  "styling": { outfit: firstId(STYLINGS) },
  "temporal": { temporalSpeed: firstId(TEMPORALS) },
  "material": { material: firstId(MATERIALS) },
  "animal": { animal: firstId(ANIMALS) },
  "vehicle": { vehicle: firstId(VEHICLES) },
  "weapon": { weapon: firstId(WEAPONS) },
  "photo-genre": { photoGenre: firstId(PHOTO_GENRES) },
  "backdrop": { backdrop: firstId(BACKDROPS) },
  "held-prop": { heldProp: firstId(HELD_PROPS) },
  "exposure-settings": { aperture: firstId(EXPOSURE_SETTINGS) },
  "render-quality": { renderQuality: firstId(RENDER_QUALITIES) },
  "composition-effects": { compositionEffect: firstId(COMPOSITION_EFFECTS) },
  "post-process-effects": { postProcess: firstId(POST_PROCESS_EFFECTS) },
  "action-fx": { actionFx: firstId(ACTION_FX) },
  "loop-subject": { loopSubject: firstId(LOOP_SUBJECTS) },
  "scene-count": { count: 5 },
  "duration": { seconds: 8 },
  "aspect-ratio": { ratio: "16:9" },
  "music-genre": { genre: firstId(MUSIC_GENRES) },
  "music-mood": { emotion: firstId(MUSIC_EMOTIONS) },
  "instrumentation": { instruments: [firstId(INSTRUMENTS)] },
  "voice-character": { timbre: firstId(VOICE_TIMBRES) },
  "voice-delivery": { archetype: firstId(VOICE_ARCHETYPES) },
}

// Types that intentionally do NOT inject a prompt hint via
// getParameterPromptHint. They carry pure runtime parameters (counts,
// durations, aspect ratios, motion intensity) consumed by the executor
// directly, not appended to a downstream prompt.
const HINT_EXEMPT: ReadonlySet<string> = new Set([
  "motion",
  "style-guide",
  "scene-count",
  "duration",
  "aspect-ratio",
])

// =============================================================================
// Test 1 — every type in the set has a sample (forces the developer who adds
// a new type to also extend this file).
// =============================================================================

describe("PARAMETER_NODE_TYPES — sample coverage", () => {
  for (const type of PARAMETER_NODE_TYPES) {
    it(`has a sample data fixture for "${type}"`, () => {
      expect(
        SAMPLE_DATA_BY_TYPE[type],
        `Missing SAMPLE_DATA_BY_TYPE entry for "${type}". When you add a new parameter type to PARAMETER_NODE_TYPES, you must also add a sample here so the cross-registry sync tests can probe it.`,
      ).toBeDefined()
    })
  }
})

// =============================================================================
// Test 2 — every type in PARAMETER_NODE_TYPES resolves via getParameterValue.
// Catches: type added to set but switch-case missing in getParameterValue.
// (The action-fx + loop-subject outages were exactly this.)
// =============================================================================

describe("PARAMETER_NODE_TYPES ↔ getParameterValue cases", () => {
  for (const type of PARAMETER_NODE_TYPES) {
    it(`getParameterValue resolves a value for "${type}"`, () => {
      const sample = SAMPLE_DATA_BY_TYPE[type] ?? {}
      const value = getParameterValue(sample, type)
      expect(
        value,
        `getParameterValue returned undefined for "${type}". Either add a "case ${JSON.stringify(type)}" to getParameterValue, or update SAMPLE_DATA_BY_TYPE[${JSON.stringify(type)}] with a field this case reads.`,
      ).toBeDefined()
    })
  }
})

// =============================================================================
// Test 3 — every non-exempt type returns a non-empty prompt hint.
// Catches: type added but missing from getParameterPromptHint switch — picker
// mounts and value resolves but the prompt fragment is never injected.
// =============================================================================

describe("PARAMETER_NODE_TYPES ↔ getParameterPromptHint cases", () => {
  for (const type of PARAMETER_NODE_TYPES) {
    if (HINT_EXEMPT.has(type)) continue
    it(`getParameterPromptHint returns non-empty for "${type}"`, () => {
      const sample = SAMPLE_DATA_BY_TYPE[type] ?? {}
      const node = { id: "n1", type, data: sample }
      const hint = getParameterPromptHint(node)
      expect(
        hint,
        `getParameterPromptHint returned an empty string for "${type}". Either add a "case ${JSON.stringify(type)}" to getParameterPromptHint, add the type to HINT_EXEMPT (only if it's a pure runtime parameter), or fix SAMPLE_DATA_BY_TYPE[${JSON.stringify(type)}] so the catalog lookup succeeds.`,
      ).toBeTruthy()
      expect(typeof hint).toBe("string")
      expect(hint.length).toBeGreaterThan(0)
    })
  }
})

// =============================================================================
// Test 4 — types in the exempt set are present in PARAMETER_NODE_TYPES (so
// HINT_EXEMPT can't drift to reference dead types).
// =============================================================================

describe("HINT_EXEMPT integrity", () => {
  for (const type of HINT_EXEMPT) {
    it(`exempt type "${type}" is still in PARAMETER_NODE_TYPES`, () => {
      expect(PARAMETER_NODE_TYPES.has(type)).toBe(true)
    })
    it(`exempt type "${type}" really returns empty from getParameterPromptHint`, () => {
      const sample = SAMPLE_DATA_BY_TYPE[type] ?? {}
      const node = { id: "n1", type, data: sample }
      expect(getParameterPromptHint(node)).toBe("")
    })
  }
})
