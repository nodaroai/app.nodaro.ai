import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"
import type { ExposableField } from "@nodaro/shared"
import { NODE_DEFINITIONS, TTS_VOICE_SETTING_DEFAULTS, type WorkflowNode } from "@/types/nodes"
import { ConfigFieldRenderer } from "../config-field-renderer"
import { exposedFieldValue } from "../helpers"

/**
 * Where a published app's card starts. `exposedFieldValue` (presentation/helpers.ts) shows this run's value, else
 * the node's saved value, else the field's default. A node saved WITHOUT the field (built by MCP, imported, or saved
 * before the field existed) reaches that last step, so the default must be the node's own: the value `defaultData`
 * gives every new node and its config panel shows. Otherwise the app card and the panel disagree about the same
 * node. Text to Speech did: its Stability and Similarity cards read 0, the slider's minimum, while the panel read
 * 0.5 and 0.75.
 *
 * The card is RENDERED here, through the same value resolution and the same component the app runner and the
 * presentation view use (`ConfigFieldRenderer`: a node's own renderer where it has one, else the generic
 * `FieldInputCard`), so a renderer with its own fallback for a missing value is measured, not modelled.
 */

const withExposables = NODE_DEFINITIONS.filter((d) => (d.exposableFields?.length ?? 0) > 0)
const defaultDataOf = (type: string) =>
  (NODE_DEFINITIONS.find((d) => d.type === type)?.defaultData ?? {}) as Record<string, unknown>
const exposedField = (type: string, key: string) =>
  NODE_DEFINITIONS.find((d) => d.type === type)?.exposableFields?.find((f) => f.key === key)
const hasNodeDefault = (type: string, key: string) => Object.hasOwn(defaultDataOf(type), key)

function savedWithout(type: string, key: string): Record<string, unknown> {
  const data = { ...defaultDataOf(type) }
  delete data[key]
  return data
}

/**
 * What a slider or toggle card SHOWS for a node saved with its defaults except this field. A slider (or a node
 * renderer's plain number input) reads its control's value, a toggle its switch state. The two types where a
 * missing value reads as a concrete wrong value; a select, aspect-ratio or text card shows an empty control instead.
 */
function renderedStart(type: string, f: ExposableField): unknown {
  const data = savedWithout(type, f.key)
  const node = { id: "n1", type, position: { x: 0, y: 0 }, data } as unknown as WorkflowNode
  const { container, unmount } = render(
    <ConfigFieldRenderer
      nodeType={type}
      field={f.key}
      value={exposedFieldValue(node, f.key, undefined, f)}
      nodeData={data}
      onChange={vi.fn()}
    />,
  )
  try {
    const toggle = container.querySelector('[role="switch"]')
    if (toggle) return toggle.getAttribute("aria-checked") === "true"
    const input = container.querySelector<HTMLInputElement>('input[type="range"], input[type="number"]')
    return input ? Number(input.value) : undefined
  } finally {
    unmount()
  }
}

const same = (a: unknown, b: unknown) =>
  typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-9 : a === b
const startsAway = (type: string, f: ExposableField) =>
  (f.type === "slider" || f.type === "toggle") &&
  hasNodeDefault(type, f.key) &&
  !same(renderedStart(type, f), defaultDataOf(type)[f.key])

/**
 * Cards that start away from their node's default, each with the reason it is not simply pointed at that default,
 * so the guard stays green and blocks every NEW one. The list fails when an entry is fixed or no longer exposed, so
 * it only shrinks.
 *
 * Both entries are cases where `defaultData` is NOT what a node saved without the field runs with, so starting the
 * card at `defaultData` would show a value the run does not use. Which side moves is the owner's call.
 */
const KNOWN_DEFAULT_DISAGREEMENTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "generate-music": {
    instrumental:
      "a node saved without it runs WITH vocals (the run reads a missing value as false) and its panel checkbox " +
      "is unchecked; only defaultData says true. The card's off state is what runs.",
  },
  "text-to-audio": {
    duration:
      "a node saved without it runs at the provider's automatic length (no duration is sent) and its panel field " +
      "is empty; a slider has no automatic position, so 10 (defaultData) would be as wrong as the minimum.",
  },
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

  it("a slider or toggle whose node has a default starts there (declare it as the descriptor's defaultValue)", { timeout: 60_000 }, () => {
    const offenders: string[] = []
    let measured = 0
    for (const def of withExposables) {
      for (const f of def.exposableFields ?? []) {
        if ((f.type === "slider" || f.type === "toggle") && hasNodeDefault(def.type, f.key)) measured++
        if (!startsAway(def.type, f)) continue
        if (KNOWN_DEFAULT_DISAGREEMENTS[def.type]?.[f.key]) continue
        offenders.push(`${def.type}.${f.key}: card starts at ${JSON.stringify(renderedStart(def.type, f))}, node default ${JSON.stringify(defaultDataOf(def.type)[f.key])}`)
      }
    }
    expect(measured, "the walk must reach the exposed sliders and toggles").toBeGreaterThanOrEqual(12)
    expect(offenders).toEqual([])
  })

  it("the known-disagreement list only shrinks: each entry is still exposed and still starts away from its node's default", { timeout: 60_000 }, () => {
    for (const [type, entries] of Object.entries(KNOWN_DEFAULT_DISAGREEMENTS)) {
      for (const [key, reason] of Object.entries(entries)) {
        expect(reason.length, `${type}.${key} needs a reason`).toBeGreaterThan(0)
        const f = exposedField(type, key)
        expect(f, `${type}.${key} is no longer exposed — drop it from the list`).toBeDefined()
        expect(startsAway(type, f!), `${type}.${key} starts at its node's default now — drop it from the list`).toBe(true)
      }
    }
  })
})

describe("cards drawn by a node's own renderer", () => {
  it("the measurement reads the renderer's own control, not the generic card", () => {
    // Edit Video Pro draws its span fields as plain number inputs (no slider), so a range input here would mean
    // the generic card answered instead of the node's renderer.
    const f = exposedField("edit-video-pro", "spanStart")!
    const data = savedWithout("edit-video-pro", "spanStart")
    const { container, unmount } = render(
      <ConfigFieldRenderer nodeType="edit-video-pro" field="spanStart" value={undefined} nodeData={data} onChange={vi.fn()} />,
    )
    expect(container.querySelector('input[type="number"]')).not.toBeNull()
    expect(container.querySelector('input[type="range"]')).toBeNull()
    unmount()
    expect(renderedStart("edit-video-pro", f)).toBe(0)
  })

  it("Edit Video Pro's Span End starts 8 seconds after the span start, as the node runs it", () => {
    const f = exposedField("edit-video-pro", "spanEnd")!
    const node = (data: Record<string, unknown>) =>
      ({ id: "e1", type: "edit-video-pro", position: { x: 0, y: 0 }, data }) as unknown as WorkflowNode
    expect(exposedFieldValue(node({}), "spanEnd", undefined, f)).toBe(8)
    expect(exposedFieldValue(node({ spanStart: 5 }), "spanEnd", undefined, f)).toBe(13)
    expect(exposedFieldValue(node({ spanStart: 5 }), "spanEnd", { spanStart: 3 }, f)).toBe(11) // this run's start
    expect(exposedFieldValue(node({ spanStart: 5, spanEnd: 20 }), "spanEnd", undefined, f)).toBe(20)
    expect(exposedFieldValue(node({ spanStart: 5 }), "spanEnd", { spanEnd: 9 }, f)).toBe(9)
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
