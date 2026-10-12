// The UGC Creator card while its options wait for the person's pick: the options
// in place of the single preview, the strip saying it waits, a credits stop's
// failure line kept above the option it kept, and the note when an option could
// not be made.
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, within } from "@testing-library/react"

const { store, strip, pick } = vi.hoisted(() => ({
  store: { nodes: [] as unknown[], edges: [] as unknown[], updateNodeData: vi.fn(), isReadOnly: false },
  strip: { props: undefined as undefined | Record<string, unknown> },
  pick: vi.fn(),
}))

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: () => null,
}))
vi.mock("../base-node", () => ({ BaseNode: ({ children, topToolbarContent }: any) => <div data-testid="base-node">{topToolbarContent}{children}</div> }))
vi.mock("../handle-with-popover", () => ({ HandleWithPopover: () => null, HANDLE_COLORS: { look: "#000", image: "#000" } }))
vi.mock("../node-quick-strip", () => ({
  NodeQuickStrip: (props: Record<string, any>) => {
    strip.props = props
    return <div data-testid="strip">{props.children}</div>
  },
}))
vi.mock("../editable-node-label", () => ({ EditableNodeLabel: () => null }))
vi.mock("../node-job-progress", () => ({ NodeJobProgress: () => <span>progress</span> }))
vi.mock("../ugc-node-pips", () => ({ UgcInputPips: () => null, ugcNodeHandles: () => [], ugcPipTop: () => 0 }))
vi.mock("lucide-react", () => new Proxy({}, { get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined), has: () => true }))
vi.mock("@/hooks/use-workflow-store", () => ({ useWorkflowStore: (selector: any) => selector(store) }))
vi.mock("@/hooks/use-upstream-image-aspect", () => ({ useUpstreamImageAspect: () => undefined }))
vi.mock("@/components/ui/cached-image", () => ({ CachedImage: (p: { src: string; alt: string }) => <img src={p.src} alt={p.alt} /> }))
vi.mock("@/lib/ugc-creator-run", () => ({ pickUgcCreator: pick }))

import { UgcCreatorNode } from "../ugc-creator-node"
import { translate } from "@/lib/i18n"
import { useLocaleStore } from "@/lib/locale-store"

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate("en", key, vars)
const rec = (u: string) => ({ v: 1, kind: "sampled", gender: "woman", identityImages: [u], traits: { t: 1 } })
const PAIR = [{ imageUrl: "https://cdn.example/a.png", record: rec("https://cdn.example/a.png") }, { imageUrl: "https://cdn.example/b.png", record: rec("https://cdn.example/b.png") }]

function renderNode(data: Record<string, unknown>) {
  return render(<UgcCreatorNode {...({ id: "c", data: { label: "UGC Creator", source: "sampled", gender: "woman", keepResult: false, ...data }, selected: false } as any)} />)
}

afterEach(() => {
  cleanup()
  strip.props = undefined
  store.isReadOnly = false
  pick.mockClear()
})

describe("UGC Creator's card while its options wait", () => {
  it("shows the options in place of the preview, and its strip says it waits for the pick", () => {
    renderNode({ candidates: PAIR, executionStatus: "completed" })
    expect(screen.getAllByText(t("ugc.creator.useThis"))).toHaveLength(2)
    expect(screen.getByText(t("ugc.creator.option", { n: 2 }))).toBeTruthy()
    expect(screen.queryByTestId("ugc-creator-preview")).toBeNull()
    expect(screen.queryByTestId("ugc-creator-empty")).toBeNull()
    expect(within(screen.getByTestId("strip")).getByText(t("ugc.creator.awaitingPick"))).toBeTruthy()
  })

  it("after a credits stop, the failure line stays above the one option it kept", () => {
    renderNode({ candidates: PAIR.slice(0, 1), executionStatus: "failed", errorMessage: "Not enough credits." })
    const failure = screen.getByText("Not enough credits.")
    const use = screen.getByText(t("ugc.creator.useThis"))
    expect(failure.compareDocumentPosition(use) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(screen.getByTestId("strip")).getByText(t("ugc.creator.awaitingPick"))).toBeTruthy()
  })

  it("while it runs, neither the options nor the waiting label show", () => {
    renderNode({ candidates: PAIR, executionStatus: "running" })
    expect(screen.queryByText(t("ugc.creator.useThis"))).toBeNull()
    expect(within(screen.getByTestId("strip")).queryByText(t("ugc.creator.awaitingPick"))).toBeNull()
  })

  it("while a run is starting (pending), the options stay in view but cannot be picked", () => {
    renderNode({ candidates: PAIR, executionStatus: "pending" })
    const uses = screen.getAllByText(t("ugc.creator.useThis")).map((b) => b.closest("button") as HTMLButtonElement)
    expect(uses).toHaveLength(2)
    expect(uses.every((b) => b.disabled)).toBe(true)
  })

  it("says when an option could not be made, below the options or the image", () => {
    renderNode({ candidates: PAIR.slice(0, 1), optionFailed: true, executionStatus: "completed" })
    expect(screen.getByText(t("ugc.creator.optionFailed"))).toBeTruthy()
    cleanup()
    renderNode({ generatedImageUrl: "https://cdn.example/a.png", optionFailed: true, executionStatus: "completed" })
    expect(screen.getByText(t("ugc.creator.optionFailed"))).toBeTruthy()
    cleanup()
    renderNode({ candidates: PAIR, executionStatus: "completed" })
    expect(screen.queryByText(t("ugc.creator.optionFailed"))).toBeNull()
  })

  it("the note reads in the interface's direction inside the left-to-right canvas", () => {
    act(() => { useLocaleStore.getState().setLocale("he") })
    try {
      renderNode({ generatedImageUrl: "https://cdn.example/a.png", optionFailed: true, executionStatus: "completed" })
      expect(screen.getByText(translate("he", "ugc.creator.optionFailed")).getAttribute("dir")).toBe("rtl")
    } finally {
      act(() => { useLocaleStore.getState().setLocale("en") })
    }
  })

  it("after a pick on the card, focus lands on the creator it now shows, never on the page", () => {
    pick.mockReturnValueOnce(true)
    const view = renderNode({ candidates: PAIR, executionStatus: "completed" })
    screen.getAllByText(t("ugc.creator.useThis"))[1]!.closest("button")!.focus()
    screen.getAllByText(t("ugc.creator.useThis"))[1]!.click()
    // The store took the options away and kept the picked creator.
    view.rerender(<UgcCreatorNode {...({ id: "c", data: { label: "UGC Creator", source: "sampled", gender: "woman", keepResult: true, generatedImageUrl: "https://cdn.example/b.png", executionStatus: "completed" }, selected: false } as any)} />)
    expect(document.activeElement).toBe(screen.getByTestId("ugc-creator-preview"))
  })

  it("with no options, the creator's image as before and nothing added to the strip", () => {
    renderNode({ generatedImageUrl: "https://cdn.example/a.png", executionStatus: "completed" })
    expect(screen.getByTestId("ugc-creator-preview")).toBeTruthy()
    expect(screen.queryByText(t("ugc.creator.useThis"))).toBeNull()
    expect(strip.props?.children).toBeFalsy()
  })

  it("a read-only canvas shows the options but cannot pick", () => {
    store.isReadOnly = true
    renderNode({ candidates: PAIR, executionStatus: "completed" })
    expect(screen.getAllByText(t("ugc.creator.useThis")).every((b) => (b.closest("button") as HTMLButtonElement).disabled)).toBe(true)
  })
})
