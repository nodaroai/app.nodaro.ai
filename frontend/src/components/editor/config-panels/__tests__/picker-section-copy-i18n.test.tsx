/**
 * The Lighting, Loop Subject and Color/Look panels hand their picker the
 * interface strings and a section-name localizer in the interface language.
 * The picker stand-ins below show what they were handed.
 */
import { afterEach, describe, it, expect, vi } from "vitest"
import { act, render, screen } from "@testing-library/react"
import { COLOR_LOOK_CATEGORY_LABELS, LIGHTING_CATEGORY_LABELS, LOOP_SUBJECT_CATEGORY_LABELS } from "@nodaro/prompts"
import type { LocaleId } from "@nodaro/shared"
import { translate } from "@/lib/i18n"
import { localizeOptionLabel } from "@/lib/i18n/labels"
import { useLocaleStore } from "@/lib/locale-store"
import type { LightingPickerCopy, PickerSearchCopy } from "@/lib/picker-ui"
import type { WorkflowNode } from "@/types/nodes"

vi.mock("@/hooks/use-workflow-store", () => {
  const noop = () => {}
  return {
    useWorkflowStore: Object.assign(
      (selector: (s: Record<string, unknown>) => unknown) =>
        selector({ updateNode: noop, updateNodeData: noop }),
      { getState: () => ({ updateNode: noop, updateNodeData: noop }) },
    ),
  }
})

vi.mock("../locale-header", () => ({ LocaleHeader: () => null }))
vi.mock("@/components/nodes/look-preview-style", () => ({ LookPreviewStyleSwitch: () => null }))

type Handed = { copy?: PickerSearchCopy; localizeLabel?: (english: string) => string; probe: string }
function Stand({ copy, localizeLabel, probe }: Handed) {
  return (
    <div data-testid="picker">
      <span data-testid="search">{copy?.searchPlaceholder}</span>
      <span data-testid="no-match">{copy?.noMatch("zz")}</span>
      <span data-testid="section">{localizeLabel?.(probe)}</span>
      <span data-testid="pick-up-to">{(copy as LightingPickerCopy | undefined)?.pickUpTo?.(2)}</span>
    </div>
  )
}

vi.mock("@/lib/picker-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/picker-ui")>()),
  LightingPicker: (p: Omit<Handed, "probe">) => <Stand {...p} probe={LIGHTING_CATEGORY_LABELS["time-of-day"]} />,
  LoopSubjectPicker: (p: Omit<Handed, "probe">) => <Stand {...p} probe={LOOP_SUBJECT_CATEGORY_LABELS.abstract} />,
  ColorLookPicker: (p: Omit<Handed, "probe">) => <Stand {...p} probe={COLOR_LOOK_CATEGORY_LABELS.palette} />,
}))

import { ColorLookConfig, LightingConfig, LoopSubjectConfig } from "../parameter-configs"
import { ParameterPreviewContext } from "../parameter-preview-context"

const setLocale = (locale: LocaleId) => act(() => useLocaleStore.getState().setLocale(locale))
afterEach(() => setLocale("en"))

function renderPanel(Panel: typeof LightingConfig, type: string, data: Record<string, unknown>) {
  const node = { id: `${type}-1`, type, position: { x: 0, y: 0 }, data } as unknown as WorkflowNode
  render(
    <ParameterPreviewContext.Provider value={{ node, nodes: [node], edges: [] }}>
      <Panel data={data as never} onUpdate={vi.fn()} sources={[]} fieldMappings={{}} onMapField={() => {}} nodes={[node]} />
    </ParameterPreviewContext.Provider>,
  )
}

const text = (id: string) => screen.getByTestId(id).textContent

describe.each(["ja", "pt-BR"] as const)("the picker panels in %s", (locale) => {
  it("Lighting: section names, search, empty state and the multi-pick hint", () => {
    setLocale(locale)
    renderPanel(LightingConfig, "lighting", { label: "Lighting" })
    expect(text("section")).toBe(localizeOptionLabel(LIGHTING_CATEGORY_LABELS["time-of-day"], locale))
    expect(text("section")).not.toBe(LIGHTING_CATEGORY_LABELS["time-of-day"])
    expect(text("search")).toBe(translate(locale, "paramcfg.searchLighting"))
    expect(text("no-match")).toBe(translate(locale, "paramcfg.noLightingMatch", { query: "zz" }))
    expect(text("pick-up-to")).toBe(translate(locale, "paramcfg.lightingPickUpTo", { n: 2 }))
  })

  it("Loop Subject: group names, search and empty state", () => {
    setLocale(locale)
    renderPanel(LoopSubjectConfig as typeof LightingConfig, "loop-subject", { label: "Loop Subject", loopSubject: "tunnel" })
    expect(text("section")).toBe(localizeOptionLabel(LOOP_SUBJECT_CATEGORY_LABELS.abstract, locale))
    expect(text("section")).not.toBe(LOOP_SUBJECT_CATEGORY_LABELS.abstract)
    expect(text("search")).toBe(translate(locale, "paramcfg.searchLoopSubject"))
    expect(text("no-match")).toBe(translate(locale, "paramcfg.noLoopSubjectMatch", { query: "zz" }))
  })

  it("Color/Look: section names, search and empty state", () => {
    setLocale(locale)
    renderPanel(ColorLookConfig as typeof LightingConfig, "color-look", { label: "Color / Look", colorLook: "warm" })
    expect(text("section")).toBe(localizeOptionLabel(COLOR_LOOK_CATEGORY_LABELS.palette, locale))
    expect(text("section")).not.toBe(COLOR_LOOK_CATEGORY_LABELS.palette)
    expect(text("search")).toBe(translate(locale, "paramcfg.searchColorLook"))
    expect(text("no-match")).toBe(translate(locale, "paramcfg.noColorLookMatch", { query: "zz" }))
  })
})
