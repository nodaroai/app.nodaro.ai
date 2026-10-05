import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import { LEGACY_EXPOSED_FIELD_KEYS } from "@nodaro/shared"
import { NODE_DEFINITIONS } from "@/types/nodes"

/**
 * An exposable field's `key` is not a label or an id of its own. A published app writes the card's value to
 * `node.data[key]` (presentation-view.tsx, mobile-app-shell.tsx) or to `inputOverrides[nodeId][key]` (the
 * orchestrator's shallow merge), and the runners read the node's REAL data field. Name it anything else and
 * the card renders, moves and changes nothing — `similarity` on Text to Speech did exactly that (the field
 * is `similarityBoost`). The type system cannot see it: every `*Data` type carries `[key: string]: unknown`
 * and `ExposableField.key` is a plain string.
 *
 * A key passes when the node starts with it (it is in `defaultData`), or it is a reviewed optional field the
 * node's data type DECLARES — checked against nodes.ts below, so an entry naming a type that does not
 * declare the key fails and the list cannot be used to wave a typo through.
 */
const OPTIONAL_DATA_FIELDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "generate-image": { quality: "GenerateImageData" },
  "text-to-video": { aspectRatio: "TextToVideoData", generateAudio: "TextToVideoData" },
  "voice-design": { loudness: "VoiceDesignData" },
}

/**
 * Known offenders, named so the guard lands green and blocks every NEW one. Each is a card that renders and
 * changes nothing. The test fails when an entry is fixed or no longer exposed, so the list only shrinks.
 */
const KNOWN_DEAD_EXPOSURES: Readonly<Record<string, readonly string[]>> = {
  // `motion` (slider 1–255): TextToVideoData has no such field, payload-builder's text-to-video case and
  // routes/text-to-video.ts never read it, and no video provider takes it. Deprecated node type.
  "text-to-video": ["motion"],
}

const NODES_TS = fs.readFileSync(path.resolve(__dirname, "../../../types/nodes.ts"), "utf8")

/** Source of `export type <name> = …` up to the next top-level export. */
function declaredBy(typeName: string): string {
  const start = NODES_TS.indexOf(`export type ${typeName} =`)
  expect(start, `${typeName} is not declared in nodes.ts`).toBeGreaterThan(-1)
  const next = NODES_TS.indexOf("\nexport ", start + 1)
  return NODES_TS.slice(start, next === -1 ? undefined : next)
}
const declares = (typeName: string, key: string) => new RegExp(`^\\s+${key}\\??:`, "m").test(declaredBy(typeName))

const withExposables = NODE_DEFINITIONS.filter((d) => (d.exposableFields?.length ?? 0) > 0)
const exposedKeys = (type: string) => (NODE_DEFINITIONS.find((d) => d.type === type)?.exposableFields ?? []).map((f) => f.key)
const dataKeys = (type: string) => Object.keys((NODE_DEFINITIONS.find((d) => d.type === type)?.defaultData ?? {}) as Record<string, unknown>)

describe("exposable field keys are the node's real data fields", () => {
  it("floor: the registry still has exposable nodes (a reshaped NODE_DEFINITIONS must not pass for free)", () => {
    expect(withExposables.length).toBeGreaterThanOrEqual(15)
  })

  it("every exposed key is a default-data key, a verified optional field, or a named known offender", () => {
    const offenders: string[] = []
    for (const def of withExposables) {
      const data = new Set(dataKeys(def.type))
      for (const f of def.exposableFields ?? []) {
        if (data.has(f.key)) continue
        const typeName = OPTIONAL_DATA_FIELDS[def.type]?.[f.key]
        if (typeName && declares(typeName, f.key)) continue
        if (KNOWN_DEAD_EXPOSURES[def.type]?.includes(f.key)) continue
        offenders.push(`${def.type}.${f.key}`)
      }
    }
    expect(
      offenders,
      "exposed keys that are not a data field of their node — the card renders and changes nothing. " +
        "Use the data field's name; to rename one apps already published, add a row to LEGACY_EXPOSED_FIELD_KEYS.",
    ).toEqual([])
  })

  it("the optional-field list is honest: each entry is exposed, absent from defaultData, and declared by the named type", () => {
    for (const [type, fields] of Object.entries(OPTIONAL_DATA_FIELDS)) {
      for (const [key, typeName] of Object.entries(fields)) {
        expect(exposedKeys(type), `${type}.${key} is no longer exposed`).toContain(key)
        expect(dataKeys(type), `${type}.${key} is in defaultData now — drop it from the list`).not.toContain(key)
        expect(declares(typeName, key), `${typeName} does not declare ${key}`).toBe(true)
      }
    }
  })

  it("the known-offender list only shrinks: each entry is still exposed and still not a data field", () => {
    for (const [type, keys] of Object.entries(KNOWN_DEAD_EXPOSURES)) {
      for (const key of keys) {
        expect(exposedKeys(type), `${type}.${key} is no longer exposed — drop it from the list`).toContain(key)
        expect(dataKeys(type), `${type}.${key} is a data field now — drop it from the list`).not.toContain(key)
      }
    }
  })
})

describe("LEGACY_EXPOSED_FIELD_KEYS", () => {
  it("every row points at a key the node exposes today, and the old key is no longer exposed", () => {
    for (const [type, renames] of Object.entries(LEGACY_EXPOSED_FIELD_KEYS)) {
      for (const [legacy, current] of Object.entries(renames)) {
        expect(exposedKeys(type), `${type}: ${current}`).toContain(current)
        expect(exposedKeys(type), `${type}: ${legacy} is still exposed`).not.toContain(legacy)
      }
    }
  })
})
