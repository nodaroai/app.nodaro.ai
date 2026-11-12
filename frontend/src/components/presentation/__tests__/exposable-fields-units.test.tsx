// @test-watches tools/units/__fixtures__/expected/frontend/src/nodes/fixture-echo/** tools/units/__fixtures__/tree/frontend/src/nodes/fixture-echo/** frontend/src/nodes/** backend/src/lib/mcp/generated/exposable-quick-fields.ts backend/src/lib/mcp/generated/exposable-declared-fields.ts
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, fireEvent, cleanup } from "@testing-library/react"
import type { WorkflowNode } from "@/types/nodes"

/**
 * A node unit exposes its settings to a published app through its manifest (unit.json `appFields`,
 * tools/units/README.md "A unit's app fields"), read through the editor's units door. Proven on the
 * fixture unit `fixture-echo` — a select `size` and an integer `maxLayers` — through its golden
 * definition, the projection gen:units writes: the publisher's field list (`getExposableFields`, which
 * the node picker, the presentation view and the app runner all read), the card it renders, and the
 * labels in the interface language. And legacy nodes see none of it: with the unit composed in, the two
 * tables the server reads for legacy fields render byte-for-byte as committed.
 */

const ROOT = path.resolve(__dirname, "../../../../..")
const FIXTURE_STRINGS = JSON.parse(
  readFileSync(path.join(ROOT, "tools/units/__fixtures__/tree/frontend/src/nodes/fixture-echo/strings.json"), "utf8"),
) as { keys: Record<string, Record<string, string>> }

/** The interface language the fixture's labels are read in (the real dicts do not hold the fixture's keys). */
const locale = vi.hoisted(() => ({ current: "en" }))

vi.mock("@/lib/i18n", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/i18n")>()
  const keys = JSON.parse(
    (await import("node:fs")).readFileSync(
      (await import("node:path")).resolve(__dirname, "../../../../../tools/units/__fixtures__/tree/frontend/src/nodes/fixture-echo/strings.json"),
      "utf8",
    ),
  ).keys as Record<string, Record<string, string>>
  return {
    ...real,
    tx: (key: string, vars?: Record<string, string | number>) =>
      keys[key]?.[locale.current] ?? real.tx(key as Parameters<typeof real.tx>[0], vars),
  }
})

// The fixture unit is composed in at the definitions AGGREGATE, so it reaches everything the editor builds
// from the units: the units door (`unitDefinitionOf`) and NODE_DEFINITIONS itself — the list the two
// legacy-table generators below walk. Out of the add-node picker (its family is the fixture tree's own).
vi.mock("@/nodes/_generated/definitions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/nodes/_generated/definitions")>()
  const { definition } = await import("../../../../../tools/units/__fixtures__/expected/frontend/src/nodes/fixture-echo/definition.generated")
  return { ...real, UNIT_DEFINITIONS: [...real.UNIT_DEFINITIONS, { ...definition, picker: null }] as unknown as typeof real.UNIT_DEFINITIONS }
})

const { getExposableFields, exposedOptionValue, UNIT_APP_FIELD_CARDS } = await import("../exposable-fields")
const { findExposableField, exposedFieldValue } = await import("../helpers")
const { ConfigFieldRenderer } = await import("../config-field-renderer")
const { exposableQuickFieldSpecs, renderExposableQuickFieldsModule } = await import("../exposable-quick-field-spec")
const { exposableDeclaredFieldSpecs, renderExposableDeclaredFieldsModule } = await import("../exposable-declared-field-spec")
const { definition } = await import("../../../../../tools/units/__fixtures__/expected/frontend/src/nodes/fixture-echo/definition.generated")
const { NODE_DEFINITIONS } = await import("@/types/nodes")

const node = (data: Record<string, unknown> = {}) =>
  ({ id: "n1", type: "fixture-echo", position: { x: 0, y: 0 }, data: { ...definition.defaultData, ...data } }) as unknown as WorkflowNode

afterEach(() => {
  locale.current = "en"
  cleanup()
})

describe("a node unit's app fields (unit.json appFields)", () => {
  it("the editor lists both, in declared order: the select with its values, the integer as a slider over its range", () => {
    const fields = getExposableFields("fixture-echo")
    expect(fields.map((f) => f.key)).toEqual(["size", "maxLayers"])
    expect(fields[0]).toMatchObject({
      key: "size",
      label: "Size",
      type: "select",
      options: [{ value: "auto", label: "Auto" }, { value: "1K", label: "1K" }, { value: "1.5K", label: "1.5K" }, { value: "2K", label: "2K" }],
      defaultValue: "1K",
    })
    expect(fields[1]).toMatchObject({ key: "maxLayers", label: "Max layers", type: "slider", min: 1, max: 99, step: 1, defaultValue: 9 })
    // Each carries its declaration; neither is a strip control.
    expect(fields.map((f) => f.unit)).toEqual(definition.appFields)
    expect(fields.every((f) => f.quick === undefined)).toBe(true)
  })

  it("its labels read in the interface language — the unit's own strings, an option with no label key its value", () => {
    locale.current = "he"
    const [size, layers] = getExposableFields("fixture-echo")
    expect(size!.label).toBe(FIXTURE_STRINGS.keys["fixtureEcho.field.size"]!.he)
    expect(size!.options?.[0]).toEqual({ value: "auto", label: FIXTURE_STRINGS.keys["fixtureEcho.size.auto"]!.he })
    expect(size!.options?.[1]).toEqual({ value: "1K", label: "1K" })
    expect(layers!.label).toBe(FIXTURE_STRINGS.keys["fixtureEcho.field.maxLayers"]!.he)
  })

  it("each kind is a card the app-field system already renders", () => {
    expect(UNIT_APP_FIELD_CARDS).toEqual({ select: "select", integer: "slider" })
  })

  it("the runtimes find each field by its stored key, and a restriction stores the option's own value", () => {
    expect(findExposableField(node(), "size")?.unit?.kind).toBe("select")
    expect(findExposableField(node(), "maxLayers")?.unit?.kind).toBe("integer")
    expect(findExposableField(node(), "videoUrl")).toBeUndefined()
    expect(exposedOptionValue(findExposableField(node(), "size")!, "1.5K")).toBe("1.5K")
  })

  it("a card starts at the node's value, else its default", () => {
    const size = findExposableField(node(), "size")!
    expect(exposedFieldValue(node(), "size", undefined, size)).toBe("1K")
    expect(exposedFieldValue(node({ size: "2K" }), "size", undefined, size)).toBe("2K")
    expect(exposedFieldValue(node({ size: "2K" }), "size", { size: "auto" }, size)).toBe("auto")
  })

  it("renders as a select card and a slider card, writing the value the node takes", () => {
    const onSize = vi.fn()
    const sel = render(<ConfigFieldRenderer nodeType="fixture-echo" field="size" value="1K" nodeData={node().data as Record<string, unknown>} onChange={onSize} />)
    expect(sel.getByText("Size")).toBeTruthy()
    expect(sel.container.querySelector('[role="combobox"]')).toBeTruthy()
    sel.unmount()

    const onLayers = vi.fn()
    const slider = render(<ConfigFieldRenderer nodeType="fixture-echo" field="maxLayers" value={9} nodeData={node().data as Record<string, unknown>} onChange={onLayers} />)
    const input = slider.container.querySelector<HTMLInputElement>('input[type="range"]')!
    expect([input.min, input.max, input.step, input.value]).toEqual(["1", "99", "1", "9"])
    fireEvent.change(input, { target: { value: "42" } })
    expect(onLayers).toHaveBeenCalledWith(42)
  })

  it("a legacy node's fields are untouched: the server's legacy tables render as committed with the unit composed in", async () => {
    // The generators walk NODE_DEFINITIONS, which carries the unit (with its app fields) here: a change that
    // turned a unit's app fields into a quick-field or declared-field row would add one and fail below.
    expect(NODE_DEFINITIONS.map((d) => d.type as string)).toContain("fixture-echo")
    expect(getExposableFields("fixture-echo")).toHaveLength(2)
    expect(Object.keys(exposableQuickFieldSpecs())).not.toContain("fixture-echo")
    expect(Object.keys(exposableDeclaredFieldSpecs())).not.toContain("fixture-echo")
    await expect(renderExposableQuickFieldsModule(exposableQuickFieldSpecs())).toMatchFileSnapshot(
      "../../../../../backend/src/lib/mcp/generated/exposable-quick-fields.ts",
    )
    await expect(renderExposableDeclaredFieldsModule(exposableDeclaredFieldSpecs())).toMatchFileSnapshot(
      "../../../../../backend/src/lib/mcp/generated/exposable-declared-fields.ts",
    )
  })

  it("a unit that declares none offers an app nothing", () => {
    expect(getExposableFields("shot-cuts")).toEqual([])
  })
})
