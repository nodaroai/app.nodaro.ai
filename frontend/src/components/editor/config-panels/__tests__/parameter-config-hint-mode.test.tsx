/**
 * The config-panel half of the shared "Prompt hint" (Full / Compact) lever.
 *
 * The panel's `PromptInjectionPreview` used to compose its own preview text
 * from a bare catalog id per node type (`getLensPromptHint(data.lens)`, …).
 * That made it blind to TWO things the real injection path honours:
 *
 *   1. `data.hintMode` — a node set to "compact" injects its short
 *      professional `term`, but the panel kept previewing the long
 *      `promptHint`. The panel disagreed with what actually got injected.
 *   2. the graph — transition / camera-motion / character-fx compose clauses
 *      from their `startState` / `endState` edges, which a data-only call
 *      cannot see (`composeTransitionHintForNode(data)` passed no connections).
 *
 * Both are fixed in ONE place: inside the config panel's
 * `ParameterPreviewContext`, the preview runs the node through
 * `getParameterPromptHint(node, { nodes, edges })` — the same function the
 * frontend DAG executor and the backend orchestrator call — and renders the
 * shared `HintModeToggle` beside it.
 *
 * `@nodaro/prompts` is deliberately NOT mocked here: the whole point is that
 * the panel shows the REAL injected fragment, so the assertions compare
 * against the catalog getters themselves (`getLensTerm` vs
 * `getLensPromptHint`). Mocked-wiring coverage lives in the canvas-card test
 * (`components/nodes/__tests__/parameter-node-hint-mode.test.tsx`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import {
  getLensPromptHint,
  getLensTerm,
  getSettingPromptHint,
  getSettingTerm,
} from "@nodaro/prompts"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

const updateNodeData = vi.fn()
const updateNode = vi.fn()

// The only store consumer in this tree is `useHintModeSetter` (via the
// preview's toggle) — it needs both writers.
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ updateNode, updateNodeData }),
    { getState: () => ({ updateNode, updateNodeData }) },
  ),
}))

// LocaleHeader → LocalePicker drags in router + react-query providers we don't
// mount here; it's decorative for this test.
vi.mock("../locale-header", () => ({ LocaleHeader: () => null }))

import { LensConfig, TransitionConfig } from "../parameter-configs"
import { ParameterPreviewContext } from "../parameter-preview-context"

const LENS_ID = "wide-24mm"
const FULL_HINT = getLensPromptHint(LENS_ID)
const COMPACT_TERM = getLensTerm(LENS_ID)

const SETTING_ID = "library"
const SETTING_FULL_HINT = getSettingPromptHint(SETTING_ID)
const SETTING_COMPACT_TERM = getSettingTerm(SETTING_ID)

const FULL_TAB = "Prompt hint: Full"
const COMPACT_TAB = "Prompt hint: Compact"

/** The composed fragment the preview block renders (monospace paragraph).
 *  Read off the DOM rather than matched by exact string so the assertions can
 *  stay about WHICH catalog fragment landed, not about punctuation. */
function previewText(container: HTMLElement): string {
  return container.querySelector("p.font-mono")?.textContent ?? ""
}

function lensNode(data: Record<string, unknown>): WorkflowNode {
  return { id: "lens-1", type: "lens", position: { x: 0, y: 0 }, data } as unknown as WorkflowNode
}

/** Mirrors the real panel: the config component gets `data`, and the provider
 *  gets the node + graph it lives in. */
function renderLens(data: Record<string, unknown>, opts?: { withContext?: boolean }) {
  const node = lensNode(data)
  const ui = (
    <LensConfig
      data={data as never}
      onUpdate={() => {}}
      sources={[]}
      fieldMappings={{}}
      onMapField={() => {}}
      nodes={[node]}
    />
  )
  if (opts?.withContext === false) return render(ui)
  return render(
    <ParameterPreviewContext.Provider value={{ node, nodes: [node], edges: [] }}>
      {ui}
    </ParameterPreviewContext.Provider>,
  )
}

/** A transition node with a `setting` picker wired into its `startState`
 *  handle — the composition the old data-only panel call could not see. */
function renderTransition(data: Record<string, unknown>) {
  const settingNode = {
    id: "setting-1",
    type: "setting",
    position: { x: 0, y: 0 },
    data: { setting: SETTING_ID },
  } as unknown as WorkflowNode
  const transitionNode = {
    id: "transition-1",
    type: "transition",
    position: { x: 0, y: 0 },
    data,
  } as unknown as WorkflowNode
  const edge = {
    id: "e1",
    source: "setting-1",
    target: "transition-1",
    targetHandle: "startState",
  } as unknown as WorkflowEdge
  const nodes = [settingNode, transitionNode]

  return render(
    <ParameterPreviewContext.Provider value={{ node: transitionNode, nodes, edges: [edge] }}>
      <TransitionConfig
        data={data as never}
        onUpdate={() => {}}
        sources={[]}
        fieldMappings={{}}
        onMapField={() => {}}
        nodes={nodes}
        edges={[edge]}
      />
    </ParameterPreviewContext.Provider>,
  )
}

beforeEach(() => {
  updateNodeData.mockClear()
  updateNode.mockClear()
})

describe("config panel preview — Prompt hint (Full / Compact)", () => {
  it("sanity: the catalog's long hint and compact term are different strings", () => {
    // Everything below is only meaningful if these two can be told apart.
    expect(FULL_HINT).toBeTruthy()
    expect(COMPACT_TERM).toBeTruthy()
    expect(COMPACT_TERM).not.toBe(FULL_HINT)
  })

  it("previews the LONG hint when hintMode is absent (the pre-lever default)", () => {
    renderLens({ lens: LENS_ID })

    expect(screen.getByText(FULL_HINT)).toBeInTheDocument()
    expect(screen.queryByText(COMPACT_TERM)).not.toBeInTheDocument()
    expect(screen.getByLabelText(FULL_TAB)).toHaveAttribute("aria-selected", "true")
    expect(screen.getByLabelText(COMPACT_TAB)).toHaveAttribute("aria-selected", "false")
  })

  it("previews the COMPACT term when the node carries hintMode:'compact'", () => {
    // The regression this whole change exists for: before the fix the panel
    // showed FULL_HINT here while the term was what got injected.
    renderLens({ lens: LENS_ID, hintMode: "compact" })

    expect(screen.getByText(COMPACT_TERM)).toBeInTheDocument()
    expect(screen.queryByText(FULL_HINT)).not.toBeInTheDocument()
    expect(screen.getByLabelText(COMPACT_TAB)).toHaveAttribute("aria-selected", "true")
  })

  it("treats an unrecognized hintMode as full — compact is opt-in only", () => {
    renderLens({ lens: LENS_ID, hintMode: "COMPACT" })

    expect(screen.getByText(FULL_HINT)).toBeInTheDocument()
    expect(screen.getByLabelText(FULL_TAB)).toHaveAttribute("aria-selected", "true")
  })

  it("keeps preText / postText composed around the compact term", () => {
    renderLens({ lens: LENS_ID, hintMode: "compact", preText: "handheld", postText: "with flare" })

    expect(screen.getByText(`handheld, ${COMPACT_TERM}, with flare`)).toBeInTheDocument()
  })

  it("clicking Compact writes the mode into node data AND clears the card height", () => {
    renderLens({ lens: LENS_ID })

    fireEvent.click(screen.getByLabelText(COMPACT_TAB))

    // `data.hintMode` is what persists through save / copy-paste / presets.
    expect(updateNodeData).toHaveBeenCalledWith("lens-1", { hintMode: "compact" })
    // …and the canvas card must re-fit the now-shorter fragment even though
    // the click happened in the PANEL. Both writes live in `useHintModeSetter`.
    expect(updateNode).toHaveBeenCalledWith("lens-1", { height: undefined })
  })

  it("composes from the graph: a connected startState reaches the transition preview", () => {
    // `composeTransitionHintForNode(data)` — the old panel call — passed no
    // connections at all, so this clause could never appear in the panel even
    // though the executor injected it.
    const { container } = renderTransition({ transition: "smash-cut" })

    expect(previewText(container)).toContain(SETTING_FULL_HINT)
  })

  it("carries the compact mode DOWN into the connected startState clause", () => {
    // Compact must not mix a term with a paragraph: the mode rides down to the
    // node wired into `startState`, so the whole sentence stays at one level of
    // detail. Only `getParameterPromptHint` knows how to do that — which is
    // exactly why the panel now calls it instead of composing its own text.
    const { container } = renderTransition({ transition: "smash-cut", hintMode: "compact" })

    const text = previewText(container)
    expect(text).toContain(SETTING_COMPACT_TERM)
    expect(text).not.toContain(SETTING_FULL_HINT)
  })

  it("falls back to the caller's hints (and renders NO lever) outside the config panel", () => {
    // The component is still usable as a plain presentational block; with no
    // node in scope there is nothing to write a mode to.
    renderLens({ lens: LENS_ID, hintMode: "compact" }, { withContext: false })

    expect(screen.getByText(FULL_HINT)).toBeInTheDocument()
    expect(screen.queryByLabelText(FULL_TAB)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(COMPACT_TAB)).not.toBeInTheDocument()
  })
})
