// The retake toolbar's mode labels used to be a module-level `const` built
// with `tx()`, which resolves ONCE at import time and therefore freezes on the
// boot locale. They are a getter now; this locks that in by switching language
// after the first render and asserting the pill follows.
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  useStore: vi.fn((selector: (s: { transform: number[] }) => unknown) => selector({ transform: [0, 0, 1] })),
}))

// One stable state object, as zustand hands out — a fresh object per call gives
// every slice a new identity each render and masks memoization bugs.
const store = vi.hoisted(() => ({
  state: {
    updateNodeData: () => {},
    runSingleNode: () => {},
    nodes: [{ id: "n1", width: 900 }],
  },
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: (s: Record<string, unknown>) => unknown) => selector(store.state),
}))

vi.mock("../run-node-button", () => ({ RunNodeButton: () => <div data-testid="run-node-button" /> }))
vi.mock("../prompt-edit-button", () => ({ PromptEditButton: () => <div data-testid="prompt-edit-button" /> }))
vi.mock("@/components/editor/config-panels/aspect-ratio-selector", () => ({ RatioIcon: () => null }))

vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

import { VideoRetakeQuickToolbar } from "../video-retake-quick-toolbar"
import { useLocaleStore } from "@/lib/locale-store"
import { translate } from "@/lib/i18n"

/** The pill shows the mode label with a leading "Replace " stripped (English
 *  only — other locales show the whole label), so assert on the dict value. */
function pillTextFor(locale: "en" | "he") {
  return translate(locale, "node.replaceAudio").replace(/^Replace\s+/i, "").toLowerCase()
}

describe("VideoRetakeQuickToolbar mode labels", () => {
  afterEach(() => {
    cleanup()
    act(() => useLocaleStore.getState().setLocale("en"))
  })

  it("builds the mode labels per render, so they follow a language switch", () => {
    render(
      <VideoRetakeQuickToolbar
        nodeId="n1"
        data={{ retakeMode: "replace_audio" } as never}
        credits={4}
        isRunning={false}
      />,
    )
    expect(screen.getByText(pillTextFor("en"))).toBeInTheDocument()

    act(() => useLocaleStore.getState().setLocale("he"))
    expect(screen.getByText(pillTextFor("he"))).toBeInTheDocument()
  })

  it("takes the versions tooltip from the dict", () => {
    render(
      <VideoRetakeQuickToolbar
        nodeId="n1"
        data={{ retakeMode: "replace_video" } as never}
        credits={4}
        isRunning={false}
      />,
    )
    expect(screen.getByTitle(translate("en", "node.versionsPerRun"))).toBeInTheDocument()
  })
})
