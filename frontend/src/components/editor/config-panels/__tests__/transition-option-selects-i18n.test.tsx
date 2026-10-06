/**
 * The transition panel in another language: the per-row options (Direction,
 * Style), their choices and tooltips, a merged two-pick's row names, and the
 * strings the panel hands the Transition picker all follow the interface
 * locale. `@nodaro/prompts` is NOT mocked: the rows are the real catalog's.
 */
import { afterEach, describe, it, expect, vi } from "vitest"
import { act, render, screen } from "@testing-library/react"
import { DEBRIS_SHOWER_STYLE, GARDEN_BLOOM_STYLE, TRANSITION_CATEGORY_LABELS, WIPE_DIRECTION } from "@nodaro/prompts"
import { ensureLocaleCatalogLoaded, resolveLabel, type LocaleId } from "@nodaro/shared"
import "@/lib/i18n-bootstrap"
import { translate } from "@/lib/i18n"
import { localizeOptionLabel } from "@/lib/i18n/labels"
import { useLocaleStore } from "@/lib/locale-store"
import type { TransitionPickerCopy } from "@/lib/picker-ui"
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

// The picker stand-in shows what the panel handed it: the search placeholder,
// the counter for one pick, and the first category tab as localized.
vi.mock("@/lib/picker-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/picker-ui")>()),
  TransitionPicker: ({ copy, localizeLabel }: { copy?: TransitionPickerCopy; localizeLabel?: (s: string) => string }) => (
    <div data-testid="picker">
      <span data-testid="picker-search">{copy?.searchPlaceholder}</span>
      <span data-testid="picker-count">{copy?.selectedCount(1, 2)}</span>
      <span data-testid="picker-tab">{localizeLabel?.("Standard")}</span>
    </div>
  ),
  CharacterFxPicker: () => null,
  CharacterMotionPicker: () => null,
}))

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: { children?: React.ReactNode; value?: string; onValueChange?: (v: string) => void }) => (
    <select value={value} onChange={(e) => onValueChange?.(e.target.value)}>{children}</select>
  ),
  SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value, title }: { children?: React.ReactNode; value: string; title?: string }) => (
    <option value={value} title={title}>{children}</option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => <span />,
}))

import { TransitionConfig } from "../parameter-configs"
import { ParameterPreviewContext } from "../parameter-preview-context"

const setLocale = (locale: LocaleId) => act(() => useLocaleStore.getState().setLocale(locale))
afterEach(() => setLocale("en"))

function renderTransition(data: Record<string, unknown>) {
  const node = { id: "transition-1", type: "transition", position: { x: 0, y: 0 }, data } as unknown as WorkflowNode
  render(
    <ParameterPreviewContext.Provider value={{ node, nodes: [node], edges: [] }}>
      <TransitionConfig data={data as never} onUpdate={vi.fn()} sources={[]} fieldMappings={{}} onMapField={() => {}} nodes={[node]} />
    </ParameterPreviewContext.Provider>,
  )
}

function optionSelect(text: string): HTMLSelectElement | undefined {
  const label = screen.queryAllByText(text).find((el) => el.tagName === "LABEL")
  return label?.parentElement?.querySelector("select") ?? undefined
}
const rows = (select: HTMLSelectElement) =>
  Array.from(select.querySelectorAll("option")).map((o) => [o.value, o.textContent, o.title])

describe("the transition panel follows the interface language", () => {
  it("Japanese: the wipe's Direction, its choices and their tooltips", () => {
    setLocale("ja")
    renderTransition({ transition: "wipe" })
    const select = optionSelect("方向")
    expect(select).toBeDefined()
    expect(rows(select!)).toEqual(
      WIPE_DIRECTION.choices.map((c) => [c.id, localizeOptionLabel(c.label, "ja"), localizeOptionLabel(c.description, "ja")]),
    )
    expect(rows(select!)[1]).toEqual(["left-to-right", "左→右", "縦の境界線が左から右へ進む"])
  })

  it("Brazilian Portuguese: a styled row's Style, its default look named in Portuguese", () => {
    setLocale("pt-BR")
    renderTransition({ transition: "debris-shower" })
    const select = optionSelect("Estilo")
    expect(select).toBeDefined()
    expect(rows(select!)).toEqual([
      ["auto", "Cobertura total (Padrão)", localizeOptionLabel(DEBRIS_SHOWER_STYLE.choices[0].description, "pt-BR")],
      ["debris-shower-light-sweep", "Varredura leve", localizeOptionLabel(DEBRIS_SHOWER_STYLE.choices[1].description, "pt-BR")],
    ])
    // The tooltips are the Portuguese copy, not the catalog's English.
    for (const [i, [, , title]] of rows(select!).entries()) {
      expect(title).not.toBe(DEBRIS_SHOWER_STYLE.choices[i].description)
    }
  })

  it("Japanese: a merged two-pick names the second row's looks after the row, in Japanese", async () => {
    await ensureLocaleCatalogLoaded("transitions", "ja")
    setLocale("ja")
    renderTransition({ transition: ["debris-shower", "garden-bloom"] })
    const select = optionSelect("スタイル")
    expect(select).toBeDefined()
    const row = resolveLabel("transitions", "garden-bloom", "Garden Bloom", "ja")
    expect(rows(select!).map(([id, label]) => [id, label])).toEqual([
      ["auto", translate("ja", "paramcfg.transitionDefaultLook")],
      ...DEBRIS_SHOWER_STYLE.choices.slice(1).map((c) => [c.id, localizeOptionLabel(c.label, "ja")]),
      ...GARDEN_BLOOM_STYLE.choices.slice(1).map((c) => [
        c.id,
        translate("ja", "common.scopedLabel", { scope: row, label: localizeOptionLabel(c.label, "ja") }),
      ]),
    ])
  })

  it("hands the picker its strings and category names in the interface language", () => {
    setLocale("pt-BR")
    renderTransition({ transition: "wipe" })
    expect(screen.getByTestId("picker-search")).toHaveTextContent(translate("pt-BR", "paramcfg.searchTransitions"))
    expect(screen.getByTestId("picker-count")).toHaveTextContent("1 / 2 selecionadas")
    expect(screen.getByTestId("picker-tab")).toHaveTextContent(localizeOptionLabel(TRANSITION_CATEGORY_LABELS.standard, "pt-BR"))
    expect(screen.getByTestId("picker-tab")).toHaveTextContent("Padrão")
  })
})
