import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"

const xyflow = vi.hoisted(() => ({ zoom: 1 }))
vi.mock("@xyflow/react", () => ({
  useStore: vi.fn((selector: (s: { transform: number[] }) => unknown) => selector({ transform: [0, 0, xyflow.zoom] })),
}))

// One stable state object, as zustand hands out: re-creating it per call would
// give every slice a fresh identity on every render, which silently defeats any
// `useMemo` keyed on a store slice (and hid the stale-locale template label).
const store = vi.hoisted(() => ({
  state: {
    updateNodeData: () => {},
    runSingleNode: () => {},
    userTextTemplates: [] as unknown[],
    nodes: [{ id: "n1", width: 260 }],
  },
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: (s: Record<string, unknown>) => unknown) => selector(store.state),
}))

vi.mock("../run-node-button", () => ({
  RunNodeButton: (props: Record<string, unknown>) => (
    <div data-testid="run-node-button" data-credits={String(props.credits ?? "")} />
  ),
}))

import { LlmChatQuickToolbar, buildModelChangePatch } from "../llm-chat-quick-toolbar"
import { useLocaleStore } from "@/lib/locale-store"
import { translate } from "@/lib/i18n"

describe("LlmChatQuickToolbar", () => {
  beforeEach(() => {
    xyflow.zoom = 1
  })

  it("renders the model, template, runs, and run controls", () => {
    render(
      <LlmChatQuickToolbar
        nodeId="n1"
        data={{ llmModel: "gemini-3-flash", templateId: "custom", repeatCount: 2 } as never}
        credits={3}
        isRunning={false}
      />,
    )
    expect(screen.getByTestId("run-node-button")).toBeInTheDocument()
    expect(screen.getByText("Gemini 3 Flash")).toBeInTheDocument()
    expect(screen.getByText("Custom")).toBeInTheDocument()
    expect(screen.getByText("× 2")).toBeInTheDocument()
  })

  it("renders for a premium model + saved-template default without crashing", () => {
    const { container } = render(
      <LlmChatQuickToolbar
        nodeId="n1"
        data={{ llmModel: "claude-opus-4.7" } as never}
        credits={15}
        isRunning={false}
      />,
    )
    expect(container.firstChild).toBeTruthy()
  })

  it("shows the reasoning-effort dropdown, defaulted to Auto, for a model that declares levels", () => {
    render(
      <LlmChatQuickToolbar
        nodeId="n1"
        data={{ llmModel: "claude-opus-4.7" } as never}
        credits={15}
        isRunning={false}
      />,
    )
    expect(screen.getByTitle(translate("en", "cfgshared.reasoningEffort"))).toBeInTheDocument()
    expect(screen.getByText("Auto")).toBeInTheDocument()
  })

  it("shows the selected effort's label when data.reasoningEffort is set", () => {
    render(
      <LlmChatQuickToolbar
        nodeId="n1"
        data={{ llmModel: "claude-opus-4.7", reasoningEffort: "xhigh" } as never}
        credits={15}
        isRunning={false}
      />,
    )
    expect(screen.getByText("Very high (may bill one tier up)")).toBeInTheDocument()
  })

  it("hides the reasoning-effort dropdown for a model with no declared levels", () => {
    render(
      <LlmChatQuickToolbar
        nodeId="n1"
        data={{ llmModel: "gemini-3-flash" } as never}
        credits={3}
        isRunning={false}
      />,
    )
    expect(screen.queryByTitle(translate("en", "cfgshared.reasoningEffort"))).not.toBeInTheDocument()
  })

  it("collapses to the compact settings pill when zoomed out", () => {
    xyflow.zoom = 0.3 // visibleNodeWidth = 260 * 0.3 = 78; 360 > 78*1.5 → compact
    render(
      <LlmChatQuickToolbar
        nodeId="n1"
        data={{ llmModel: "gemini-3-flash", templateId: "custom", repeatCount: 1 } as never}
        credits={3}
        isRunning={false}
      />,
    )
    expect(screen.getByTitle("Settings")).toBeInTheDocument()
    expect(screen.queryByTitle(translate("en", "cfgshared.aiModel"))).not.toBeInTheDocument()
    expect(screen.getByTestId("run-node-button")).toBeInTheDocument()
  })
})

// The template chip reads GENERATE_TEXT_TEMPLATES(), whose labels resolve
// through the live locale — so the memo that caches the label has to be keyed
// on the locale too, or the chip keeps the previous language after a switch.
describe("LlmChatQuickToolbar template label locale", () => {
  beforeEach(() => {
    xyflow.zoom = 1
  })
  afterEach(() => {
    cleanup()
    act(() => useLocaleStore.getState().setLocale("en"))
  })

  it("follows a language switch", () => {
    render(
      <LlmChatQuickToolbar
        nodeId="n1"
        data={{ llmModel: "gemini-3-flash", templateId: "photo-shoot" } as never}
        credits={3}
        isRunning={false}
      />,
    )
    expect(screen.getByText(translate("en", "txtcfg.tplPhotoShootLabel"))).toBeInTheDocument()
    act(() => useLocaleStore.getState().setLocale("he"))
    expect(screen.getByText(translate("he", "txtcfg.tplPhotoShootLabel"))).toBeInTheDocument()
    expect(screen.queryByText(translate("en", "txtcfg.tplPhotoShootLabel"))).not.toBeInTheDocument()
  })
})

// ===========================================================================
// buildModelChangePatch — pure patch-builder behind handleModelChange's
// onValueChange. Unit-tested directly rather than by driving the real Radix
// Select (no hasPointerCapture/PointerEvent polyfill in this suite's
// src/test/setup.ts — the sibling node-quick-configs.test.tsx works around
// the same gap by stubbing @/components/ui/select entirely).
// ===========================================================================
describe("buildModelChangePatch", () => {
  // NOTE: `toEqual` treats an explicit `reasoningEffort: undefined` value as
  // equivalent to the key being absent entirely — but that distinction is
  // exactly what matters here: `updateNodeData` spread-merges the patch onto
  // the existing node data, so the key must actually be PRESENT (even if its
  // value is `undefined`) for the merge to overwrite the stale value; an
  // absent key would silently leave the old value in place (the original
  // bug). So the "clears" cases assert key presence with `toHaveProperty`
  // (which — unlike `toEqual` — does distinguish "present but undefined"
  // from "absent") in addition to the value.

  it("clears reasoningEffort when the next model doesn't support the current level", () => {
    const patch = buildModelChangePatch(
      { llmModel: "gpt-5.6-terra", reasoningEffort: "max" } as never,
      "gpt-5.4",
    )
    expect(patch.llmModel).toBe("gpt-5.4")
    expect(patch).toHaveProperty("reasoningEffort", undefined)
  })

  it("does NOT clear reasoningEffort when the next model still supports the current level", () => {
    const patch = buildModelChangePatch(
      { llmModel: "gpt-5.6-terra", reasoningEffort: "max" } as never,
      "gpt-5.6-sol",
    )
    expect(patch).toEqual({ llmModel: "gpt-5.6-sol" })
    expect(patch).not.toHaveProperty("reasoningEffort")
  })

  it("leaves the patch to just llmModel when there was no reasoningEffort set", () => {
    const patch = buildModelChangePatch({ llmModel: "gemini-3-flash" } as never, "gpt-5.4")
    expect(patch).toEqual({ llmModel: "gpt-5.4" })
    expect(patch).not.toHaveProperty("reasoningEffort")
  })

  it("clears reasoningEffort when switching to a model with no declared levels at all", () => {
    const patch = buildModelChangePatch(
      { llmModel: "claude-opus-4.7", reasoningEffort: "high" } as never,
      "gemini-3-flash",
    )
    expect(patch.llmModel).toBe("gemini-3-flash")
    expect(patch).toHaveProperty("reasoningEffort", undefined)
  })
})
