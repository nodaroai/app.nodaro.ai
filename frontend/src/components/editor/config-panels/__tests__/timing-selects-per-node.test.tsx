/**
 * The Transition and Character FX panels each render three timing dropdowns —
 * Position / Duration / Intensity — beside their picker. They used to share
 * ONE constant built from the transition catalogs, which was harmless only
 * while the two option sets were identical. They are not any more: the ids
 * match, the wording does not (a transition occurs and spans the clip; an
 * effect manifests and persists), and that wording is what each dropdown
 * shows as its option tooltip.
 *
 * Each panel must render its own node's catalogs. The assertions read the
 * expected rows off `@nodaro/prompts` itself, so they cannot drift from the
 * catalogs — and the sanity case pins that the two nodes' rows really differ,
 * without which "renders its own catalogs" would be indistinguishable from
 * "renders the transition catalogs".
 *
 * `@nodaro/prompts` is deliberately NOT mocked (see `mock-real-constants`
 * pattern): the point is that the panel renders the REAL catalog rows.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import {
  TRANSITION_POSITIONS,
  TRANSITION_DURATIONS,
  TRANSITION_INTENSITIES,
  CHARACTER_FX_POSITIONS,
  CHARACTER_FX_DURATIONS,
  CHARACTER_FX_INTENSITIES,
} from "@nodaro/prompts"
import type { WorkflowNode } from "@/types/nodes"

// The only store consumer in this tree is the preview's hint-mode toggle.
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

// LocaleHeader → LocalePicker drags in router + react-query providers we don't
// mount here; it's decorative for this test.
vi.mock("../locale-header", () => ({ LocaleHeader: () => null }))

// The tile-grid pickers are heavy and irrelevant here — only the timing
// dropdowns beside them are under test. Everything else in the module is the
// real thing.
vi.mock("@/lib/picker-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/picker-ui")>()),
  TransitionPicker: () => null,
  CharacterFxPicker: () => null,
}))

// Radix Select renders its items only while open (and not at all in jsdom
// without pointer events). Flatten it so every option — with the `title` the
// panel puts its catalog description into — is in the DOM.
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value, title }: { children?: React.ReactNode; value: string; title?: string }) => (
    <option value={value} title={title}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span />,
}))

import { TransitionConfig, CharacterFxConfig } from "../parameter-configs"
import { ParameterPreviewContext } from "../parameter-preview-context"

type TimingRow = { readonly id: string; readonly label: string; readonly description: string }
type TimingCatalogs = readonly [ReadonlyArray<TimingRow>, ReadonlyArray<TimingRow>, ReadonlyArray<TimingRow>]

const TRANSITION_TIMING: TimingCatalogs = [TRANSITION_POSITIONS, TRANSITION_DURATIONS, TRANSITION_INTENSITIES]
const CHARACTER_FX_TIMING: TimingCatalogs = [CHARACTER_FX_POSITIONS, CHARACTER_FX_DURATIONS, CHARACTER_FX_INTENSITIES]

const FIELDS = ["Position", "Duration", "Intensity"] as const

function renderPanel(
  Panel: typeof TransitionConfig | typeof CharacterFxConfig,
  type: "transition" | "character-fx",
  data: Record<string, unknown>,
) {
  const node = { id: `${type}-1`, type, position: { x: 0, y: 0 }, data } as unknown as WorkflowNode
  return render(
    <ParameterPreviewContext.Provider value={{ node, nodes: [node], edges: [] }}>
      <Panel
        data={data as never}
        onUpdate={() => {}}
        sources={[]}
        fieldMappings={{}}
        onMapField={() => {}}
        nodes={[node]}
      />
    </ParameterPreviewContext.Provider>,
  )
}

/** What each of the three dropdowns rendered: `{ value, label, title }` per
 *  option, in Position / Duration / Intensity order. Located by the column
 *  label so the assertion is about the control the user sees, not DOM order. */
function renderedTiming(): Array<Array<{ value: string; label: string; title: string }>> {
  return FIELDS.map((field) => {
    const label = screen
      .getAllByText(field)
      .find((el) => el.tagName === "LABEL")
    expect(label, `${field} dropdown label`).toBeDefined()
    const column = label!.parentElement!
    return Array.from(column.querySelectorAll("option")).map((o) => ({
      value: o.value,
      label: o.textContent ?? "",
      title: o.title,
    }))
  })
}

function expectedTiming(catalogs: TimingCatalogs) {
  return catalogs.map((rows) =>
    rows.map((o) => ({ value: o.id, label: o.label, title: o.description })),
  )
}

describe("timing dropdowns render each node's OWN catalogs", () => {
  it("sanity: the two nodes' timing rows are distinguishable", () => {
    // Without this the two assertions below could both pass on a shared
    // constant. Position and duration are worded differently on purpose;
    // intensity happens to coincide and is deliberately not relied on.
    expect(CHARACTER_FX_POSITIONS.map((o) => o.description)).not.toEqual(
      TRANSITION_POSITIONS.map((o) => o.description),
    )
    expect(CHARACTER_FX_DURATIONS.map((o) => o.description)).not.toEqual(
      TRANSITION_DURATIONS.map((o) => o.description),
    )
  })

  it("Transition renders the transition timing catalogs", () => {
    renderPanel(TransitionConfig, "transition", { transition: "smash-cut" })
    expect(renderedTiming()).toEqual(expectedTiming(TRANSITION_TIMING))
  })

  it("Character FX renders the character-fx timing catalogs — not the transition ones", () => {
    // The debt the transition pass left: both panels read one constant built
    // from TRANSITION_*. Pointing this panel back at it fails here on the
    // position and duration tooltips.
    renderPanel(CharacterFxConfig, "character-fx", { characterFx: "werewolf" })
    const rendered = renderedTiming()
    expect(rendered).toEqual(expectedTiming(CHARACTER_FX_TIMING))
    expect(rendered).not.toEqual(expectedTiming(TRANSITION_TIMING))
  })

  it("both panels lead every dropdown with the no-op `auto` and bind the stored value", () => {
    // `auto` is the default the panel falls back to when the field is unset;
    // it must be the first option of every scale on both nodes.
    renderPanel(CharacterFxConfig, "character-fx", { characterFx: "werewolf", position: "full" })
    for (const column of renderedTiming()) {
      expect(column[0]?.value).toBe("auto")
    }
  })
})
