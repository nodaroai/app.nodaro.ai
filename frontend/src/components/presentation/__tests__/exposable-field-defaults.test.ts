import { describe, it, expect } from "vitest"
import type { ExposableField } from "@nodaro/shared"
import { NODE_DEFINITIONS, TTS_VOICE_SETTING_DEFAULTS } from "@/types/nodes"

/**
 * Where a published app's card starts. `exposedFieldValue` (presentation/helpers.ts) shows this run's value, else
 * the node's saved value, else the descriptor's `defaultValue`. A node saved WITHOUT the field (built by MCP,
 * imported, or saved before the field existed) reaches that last step, so the descriptor's `defaultValue` must be
 * the node's own default: the value `defaultData` gives every new node and its config panel shows. Otherwise the
 * app card and the panel disagree about the same node. Text to Speech did: its Stability and Similarity cards read
 * 0, the slider's minimum, while the panel read 0.5 and 0.75.
 */

const withExposables = NODE_DEFINITIONS.filter((d) => (d.exposableFields?.length ?? 0) > 0)
const defaultDataOf = (type: string) =>
  (NODE_DEFINITIONS.find((d) => d.type === type)?.defaultData ?? {}) as Record<string, unknown>
const exposedField = (type: string, key: string) =>
  NODE_DEFINITIONS.find((d) => d.type === type)?.exposableFields?.find((f) => f.key === key)
const hasNodeDefault = (type: string, key: string) => Object.hasOwn(defaultDataOf(type), key)

/**
 * What a slider or toggle card SHOWS for a node saved without the field: the descriptor's `defaultValue`, else the
 * card's own fallback for a missing value (field-input-card.tsx: a slider sits at its minimum, a toggle is off).
 * The two types where a missing value reads as a concrete wrong value; a select, aspect-ratio or text card shows
 * an empty control instead.
 */
function cardStartsAt(f: ExposableField): unknown {
  if (f.type === "slider") return Number(f.defaultValue ?? f.min ?? 0)
  if (f.type === "toggle") return Boolean(f.defaultValue)
  return f.defaultValue
}
const startsAway = (type: string, f: ExposableField) =>
  (f.type === "slider" || f.type === "toggle") &&
  hasNodeDefault(type, f.key) &&
  cardStartsAt(f) !== defaultDataOf(type)[f.key]

/**
 * Cards that start away from their node's default today, named so the guard lands green and blocks every NEW one.
 * Recorded, not fixed: each fix changes what that node's published apps show. The list fails when an entry is fixed
 * or no longer exposed, so it only shrinks.
 */
const KNOWN_DEFAULT_DISAGREEMENTS: Readonly<Record<string, readonly string[]>> = {
  "generate-video-pro": ["duration", "generateAudio"],
  "edit-video-pro": ["spanEnd", "generateAudio"],
  "generate-music": ["duration", "instrumental"],
  "text-to-audio": ["duration"],
  "llm-chat": ["temperature", "maxTokens"],
}

describe("an exposed card starts at its node's default", () => {
  it("floor: the registry still has exposable nodes (a reshaped NODE_DEFINITIONS must not pass for free)", () => {
    expect(withExposables.length).toBeGreaterThanOrEqual(15)
  })

  it("a descriptor's defaultValue IS the node's defaultData value for that key, on every node", () => {
    const offenders: string[] = []
    for (const def of withExposables) {
      const data = defaultDataOf(def.type)
      for (const f of def.exposableFields ?? []) {
        if (f.defaultValue === undefined) continue
        if (!Object.hasOwn(data, f.key)) {
          offenders.push(`${def.type}.${f.key}: defaultValue ${JSON.stringify(f.defaultValue)}, but the node has no default for it`)
        } else if (JSON.stringify(f.defaultValue) !== JSON.stringify(data[f.key])) {
          offenders.push(`${def.type}.${f.key}: defaultValue ${JSON.stringify(f.defaultValue)}, node default ${JSON.stringify(data[f.key])}`)
        }
      }
    }
    expect(offenders, "a card would start at a value its node does not have — read the node's default instead").toEqual([])
  })

  it("a slider or toggle whose node has a default starts there (declare it as the descriptor's defaultValue)", () => {
    const offenders: string[] = []
    for (const def of withExposables) {
      for (const f of def.exposableFields ?? []) {
        if (!startsAway(def.type, f)) continue
        if (KNOWN_DEFAULT_DISAGREEMENTS[def.type]?.includes(f.key)) continue
        offenders.push(`${def.type}.${f.key}: card starts at ${JSON.stringify(cardStartsAt(f))}, node default ${JSON.stringify(defaultDataOf(def.type)[f.key])}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("the known-disagreement list only shrinks: each entry is still exposed and still starts away from its node's default", () => {
    for (const [type, keys] of Object.entries(KNOWN_DEFAULT_DISAGREEMENTS)) {
      for (const key of keys) {
        const f = exposedField(type, key)
        expect(f, `${type}.${key} is no longer exposed — drop it from the list`).toBeDefined()
        expect(startsAway(type, f!), `${type}.${key} starts at its node's default now — drop it from the list`).toBe(true)
      }
    }
  })
})

describe("Text to Speech voice settings have one source", () => {
  it("a new node starts with TTS_VOICE_SETTING_DEFAULTS", () => {
    const data = defaultDataOf("text-to-speech")
    expect(Object.keys(TTS_VOICE_SETTING_DEFAULTS)).toEqual(["speed", "stability", "similarityBoost", "style"])
    for (const [key, value] of Object.entries(TTS_VOICE_SETTING_DEFAULTS)) expect(data[key], key).toBe(value)
  })

  it("the exposed Stability and Similarity cards start from it", () => {
    expect(exposedField("text-to-speech", "stability")?.defaultValue).toBe(TTS_VOICE_SETTING_DEFAULTS.stability)
    expect(exposedField("text-to-speech", "similarityBoost")?.defaultValue).toBe(TTS_VOICE_SETTING_DEFAULTS.similarityBoost)
  })
})
