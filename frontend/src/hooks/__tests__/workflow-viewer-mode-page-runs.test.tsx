import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, renderHook, screen, fireEvent, act, cleanup } from "@testing-library/react"
import type { ReactElement } from "react"

/**
 * The paid runs a character's or object's page starts, against a `view` answer
 * that reaches the canvas while they are out (T100). Generate All Assets, a
 * custom variation and Refine write their results onto the canvas node through
 * `updateNodeData`, which does nothing on a read-only canvas, and none of them
 * left a mark the freeze could see: a downgrade mid-run froze the canvas at
 * once, and every result after it was paid for and dropped. Now each runs
 * inside `withRunInFlight`, so the freeze waits until the run's last result is
 * on the node; Refine's mark lasts until an image is picked or set aside. An
 * Undo on the canvas neither takes the mark away while the run is out nor
 * brings it back once it is over.
 *
 * The real pages, the real store and the real `applyWorkflowAccess`; only the
 * network and the heavy children (image tiles, the training section) are
 * mocked. The "Generate All Assets" button only appears once a refined image
 * has been picked, so its cases refine first.
 */

const h = vi.hoisted(() => ({
  /** Every job a run created, in order: each one is paid for. */
  created: [] as string[],
  jobs: {} as Record<string, { status: string; output_data?: Record<string, unknown>; error_message?: string }>,
  /** From the moment it is set, every job it is asked about ends this way. */
  settleAs: null as null | "completed" | "failed",
}))

/** The image a job hands back when it completes. */
const url = (jobId: string) => `https://cdn/${jobId}.png`

async function createJob(): Promise<{ jobId: string }> {
  const jobId = `job-${h.created.length}`
  h.created.push(jobId)
  return { jobId }
}

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getWorkflowAccess: vi.fn(),
  getJobStatusLean: vi.fn(async (jobId: string) => {
    const known = h.jobs[jobId]
    if (known) return { id: jobId, ...known }
    if (h.settleAs === "completed") return { id: jobId, status: "completed", output_data: { imageUrl: url(jobId) } }
    if (h.settleAs === "failed") return { id: jobId, status: "failed", error_message: "provider error" }
    return { id: jobId, status: "processing" }
  }),
  generateCharacterAsset: vi.fn(() => createJob()),
  generateObjectAsset: vi.fn(() => createJob()),
  generateImage: vi.fn(() => createJob()),
  saveCharacter: vi.fn(async () => ({})),
  saveObject: vi.fn(async () => ({})),
}))

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: { src: string; alt?: string }) => <img src={props.src} alt={props.alt} />,
}))
vi.mock("@/components/ui/image-lightbox", () => ({ ImageLightbox: () => null }))
vi.mock("@/components/editor/training-section", () => ({ TrainingSection: () => null }))
vi.mock("@/components/editor/character-asset-video-grid", () => ({ CharacterAssetVideoGrid: () => null }))

import { toast } from "sonner"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useUndoRedoSubscription, useUndoRedoActions, flushPendingUndoSnapshot } from "@/hooks/use-undo-redo"
import { useUndoRedoStore } from "@/hooks/use-undo-redo-store"
import { applyWorkflowAccess, showsARunInFlight } from "@/hooks/workflow-access-mode"
import { isSaveRefused } from "@/hooks/workflow-save-refusal"
import { getWorkflowAccess } from "@/lib/api"
import type { WorkflowAccessInfo } from "@/lib/api"
import { translate, type MessageKey } from "@/lib/i18n"
import { CharacterPageModal } from "@/components/editor/character-page-modal"
import { ObjectPageModal } from "@/components/editor/object-page-modal"
import type { WorkflowNode } from "@/types/nodes"

const WF = "wf-1"
const NODE = "e1"
const POLL_MS = 2000
const READ_ONLY_REASON = "This workflow is read-only for you."
const MAIN = "https://cdn/main.png"

const label = (key: MessageKey) => translate("en", key)

interface Page {
  readonly name: string
  readonly type: "character" | "object"
  readonly data: Record<string, unknown>
  readonly render: (onClose: () => void) => ReactElement
  readonly refine: MessageKey
  readonly variationPlaceholder: MessageKey
  /** The node keys Generate All Assets fills. */
  readonly assetKeys: readonly string[]
  /** How many paid jobs Generate All Assets runs. */
  readonly assets: number
}

const PAGES: readonly Page[] = [
  {
    name: "character",
    type: "character",
    data: { characterName: "Kira", sourceImageUrl: MAIN, expressions: [], poses: [], lightingVariations: [], angles: [] },
    render: (onClose) => <CharacterPageModal characterNodeId={NODE} onClose={onClose} />,
    refine: "entity.refineCharacter",
    variationPlaceholder: "entity.characterVariationPlaceholder",
    assetKeys: ["angles", "expressions", "poses", "lightingVariations"],
    assets: 16,
  },
  {
    name: "object",
    type: "object",
    data: { objectName: "Lamp", sourceImageUrl: MAIN, angles: [], materials: [], variations: [] },
    render: (onClose) => <ObjectPageModal objectNodeId={NODE} onClose={onClose} />,
    refine: "entity.refineObject",
    variationPlaceholder: "entity.objectVariationPlaceholder",
    assetKeys: ["angles", "materials", "variations"],
    assets: 16,
  },
]

function viewAnswer(): WorkflowAccessInfo {
  return {
    access: "view",
    workspaceId: null,
    visibility: "private",
    canChangeVisibility: false,
    canShare: false,
    canRun: false,
  }
}

/** A canvas its `edit` collaborator has open, with the page open on its node. */
function openPage(page: Page) {
  const node = { id: NODE, type: page.type, position: { x: 0, y: 0 }, data: { label: NODE, ...page.data } } as unknown as WorkflowNode
  useWorkflowStore.getState().loadWorkflow(WF, "W", [node], [])
  useWorkflowStore.setState({ loadedAccess: { workflowId: WF, access: "edit" } })
  return render(page.render(vi.fn()))
}

/** A re-check answers `view`: at once the record says so and saves stop. */
async function lowerToView() {
  vi.mocked(getWorkflowAccess).mockResolvedValue({ data: viewAnswer() })
  await act(async () => {
    await applyWorkflowAccess(WF)
  })
  const s = useWorkflowStore.getState()
  expect(s.loadedAccess).toEqual({ workflowId: WF, access: "view" })
  expect(isSaveRefused(s)).toBe(true)
}

const dataOf = () => useWorkflowStore.getState().nodes.find((n) => n.id === NODE)!.data as Record<string, unknown>
const inFlight = () => showsARunInFlight({ data: dataOf() })
const isFrozen = () => useWorkflowStore.getState().isReadOnly

function expectFrozen() {
  const s = useWorkflowStore.getState()
  expect(s.isReadOnly).toBe(true)
  expect(s.readOnlyReason).toBe(READ_ONLY_REASON)
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }))

/** Refine with every job completing at once, and nothing picked yet. */
async function refineToPicker(page: Page) {
  h.settleAs = "completed"
  click(label(page.refine))
  await advance(POLL_MS * 5)
  h.settleAs = null
  expect(screen.getByText(label("entity.selectRefinedImage"))).toBeInTheDocument()
}

/** Pick the first refined image. */
async function pickFirst() {
  fireEvent.click(screen.getByAltText(translate("en", "entity.refinedAlt", { n: 1 })))
  click(label("entity.useThisImage"))
  await advance(0)
}

/** A refine the person sees through: what makes "Generate All Assets" appear. */
async function refineAndPick(page: Page) {
  await refineToPicker(page)
  await pickFirst()
  expect(inFlight()).toBe(false)
}

const assetUrls = (page: Page) =>
  page.assetKeys.flatMap((key) => ((dataOf()[key] ?? []) as Array<{ url: string }>).map((item) => item.url))

async function startCustom(page: Page, prompt = "in a rainy street") {
  fireEvent.click(screen.getByRole("tab", { name: label("common.custom") }))
  fireEvent.change(screen.getByPlaceholderText(label(page.variationPlaceholder)), { target: { value: prompt } })
  click(label("common.generate"))
  await advance(0)
}

const variations = () => ((dataOf().customVariations ?? []) as Array<{ url: string; prompt: string }>)

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  h.created.length = 0
  h.settleAs = null
  for (const id of Object.keys(h.jobs)) delete h.jobs[id]
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe.each(PAGES)("Generate All Assets on the $name page", (page) => {
  it("a downgrade mid-run lands every asset it paid for, and only then freezes the canvas", async () => {
    openPage(page)
    await refineAndPick(page)
    const before = h.created.length

    click(label("entity.generateAllAssets"))
    await advance(0)
    expect(h.created).toHaveLength(before + 1)
    expect(inFlight()).toBe(true)

    await lowerToView()
    expect(isFrozen()).toBe(false)

    h.jobs[h.created[before]!] = { status: "completed", output_data: { imageUrl: url(h.created[before]!) } }
    await advance(POLL_MS)
    expect(assetUrls(page)).toEqual([url(h.created[before]!)])
    expect(isFrozen()).toBe(false)

    h.settleAs = "completed"
    await advance(POLL_MS * (page.assets + 1))
    expect(h.created).toHaveLength(before + page.assets)
    expect(assetUrls(page).sort()).toEqual(h.created.slice(before).map(url).sort())
    expect(inFlight()).toBe(false)
    expectFrozen()
  })

  it("with the run over, a downgrade freezes the canvas at once", async () => {
    openPage(page)
    await refineAndPick(page)
    h.settleAs = "completed"
    click(label("entity.generateAllAssets"))
    await advance(POLL_MS * (page.assets + 1))
    expect(assetUrls(page)).toHaveLength(page.assets)
    expect(inFlight()).toBe(false)

    await lowerToView()
    expectFrozen()
  })

  it("a run whose every job fails clears its mark, and the freeze lands then", async () => {
    openPage(page)
    await refineAndPick(page)
    h.settleAs = "failed"
    click(label("entity.generateAllAssets"))
    await advance(0)
    await lowerToView()
    expect(isFrozen()).toBe(false)

    await advance(POLL_MS * (page.assets + 1))
    expect(assetUrls(page)).toEqual([])
    expect(inFlight()).toBe(false)
    expectFrozen()
  })

  it("closing the page mid-run: the run goes on, lands its assets, and only then lets the freeze land", async () => {
    const view = openPage(page)
    await refineAndPick(page)
    click(label("entity.generateAllAssets"))
    await advance(0)
    view.unmount()
    expect(inFlight()).toBe(true)

    await lowerToView()
    expect(isFrozen()).toBe(false)

    h.settleAs = "completed"
    await advance(POLL_MS * (page.assets + 1))
    expect(assetUrls(page)).toHaveLength(page.assets)
    expect(inFlight()).toBe(false)
    expectFrozen()
  })

  it("on a canvas already read-only, sends nothing and says why", async () => {
    openPage(page)
    await refineAndPick(page)
    await lowerToView()
    expectFrozen()
    const before = h.created.length

    click(label("entity.generateAllAssets"))
    await advance(POLL_MS)
    expect(h.created).toHaveLength(before)
    expect(toast.error).toHaveBeenCalledWith(READ_ONLY_REASON)
  })
})

describe.each(PAGES)("a custom variation on the $name page", (page) => {
  it("a downgrade mid-run lands the variation, and only then freezes the canvas", async () => {
    openPage(page)
    await startCustom(page)
    expect(h.created).toEqual(["job-0"])
    expect(inFlight()).toBe(true)

    await lowerToView()
    expect(isFrozen()).toBe(false)

    h.jobs["job-0"] = { status: "completed", output_data: { imageUrl: url("job-0") } }
    await advance(POLL_MS)
    expect(variations().map((v) => v.url)).toEqual([url("job-0")])
    expect(inFlight()).toBe(false)
    expectFrozen()
  })

  it("with the run over, a downgrade freezes the canvas at once", async () => {
    openPage(page)
    h.settleAs = "completed"
    await startCustom(page)
    await advance(POLL_MS)
    expect(variations()).toHaveLength(1)
    expect(inFlight()).toBe(false)

    await lowerToView()
    expectFrozen()
  })

  it("a failed run clears its mark, and the freeze lands then", async () => {
    openPage(page)
    await startCustom(page)
    await lowerToView()
    expect(isFrozen()).toBe(false)

    h.jobs["job-0"] = { status: "failed", error_message: "provider error" }
    await advance(POLL_MS)
    expect(variations()).toEqual([])
    expect(inFlight()).toBe(false)
    expectFrozen()
  })

  it("closing the page mid-run: the variation still lands, and only then the freeze", async () => {
    const view = openPage(page)
    await startCustom(page)
    view.unmount()
    await lowerToView()
    expect(isFrozen()).toBe(false)

    h.jobs["job-0"] = { status: "completed", output_data: { imageUrl: url("job-0") } }
    await advance(POLL_MS)
    expect(variations().map((v) => v.url)).toEqual([url("job-0")])
    expect(inFlight()).toBe(false)
    expectFrozen()
  })

  it("on a canvas already read-only, sends nothing and says why", async () => {
    openPage(page)
    await lowerToView()
    expectFrozen()
    await startCustom(page)
    expect(h.created).toEqual([])
    expect(toast.error).toHaveBeenCalledWith(READ_ONLY_REASON)
  })
})

describe.each(PAGES)("Undo while a custom variation on the $name page is out", (page) => {
  /** The canvas's Undo, as its toolbar and its shortcut reach it. */
  function canvasUndo() {
    useUndoRedoStore.getState().clear()
    renderHook(() => useUndoRedoSubscription())
    const { result } = renderHook(() => useUndoRedoActions())
    return () => act(() => result.current.undo())
  }

  it("an Undo past its start keeps its mark: the variation lands, and only then the freeze", async () => {
    const view = openPage(page)
    const undo = canvasUndo()
    act(() => useWorkflowStore.getState().setWorkflowName("Renamed before the run"))
    flushPendingUndoSnapshot()
    await startCustom(page)
    // The page is closed and the run goes on: Undo is the canvas's again.
    view.unmount()
    await lowerToView()

    undo()
    expect(useWorkflowStore.getState().workflowName).toBe("W")
    expect(inFlight()).toBe(true)
    expect(isFrozen()).toBe(false)

    h.jobs["job-0"] = { status: "completed", output_data: { imageUrl: url("job-0") } }
    await advance(POLL_MS)
    expect(variations().map((v) => v.url)).toEqual([url("job-0")])
    expect(inFlight()).toBe(false)
    expectFrozen()
  })

  it("an Undo of the variation once it landed brings no mark back: a downgrade then freezes at once", async () => {
    const view = openPage(page)
    const undo = canvasUndo()
    h.settleAs = "completed"
    await startCustom(page)
    await advance(POLL_MS)
    expect(variations()).toHaveLength(1)
    flushPendingUndoSnapshot()
    view.unmount()

    undo()
    expect(variations()).toEqual([])
    expect(inFlight()).toBe(false)
    await lowerToView()
    expectFrozen()
  })
})

describe.each(PAGES)("Refine on the $name page", (page) => {
  it("a downgrade mid-run: the images arrive, the canvas waits for the pick, and freezes once it is on the node", async () => {
    openPage(page)
    click(label(page.refine))
    await advance(0)
    expect(h.created).toEqual(["job-0"])
    expect(inFlight()).toBe(true)

    await lowerToView()
    expect(isFrozen()).toBe(false)

    h.settleAs = "completed"
    await advance(POLL_MS * 5)
    expect(h.created).toHaveLength(4)
    // The images wait on the person; only the pick writes the node.
    expect(screen.getByText(label("entity.selectRefinedImage"))).toBeInTheDocument()
    expect(isFrozen()).toBe(false)

    await pickFirst()
    expect(dataOf().sourceImageUrl).toBe(url("job-0"))
    expect((dataOf().generatedResults as Array<{ url: string }>).map((r) => r.url)).toEqual([url("job-0")])
    expect(inFlight()).toBe(false)
    expectFrozen()
  })

  it.each([
    ["Cancel", () => click(label("common.cancel"))],
    ["the close button", () => fireEvent.click(screen.getAllByRole("button", { name: label("common.close") }).at(-1)!)],
  ])("closing the picker with %s sets the images aside and lets the freeze land", async (_how, close) => {
    openPage(page)
    await refineToPicker(page)
    expect(inFlight()).toBe(true)
    await lowerToView()
    expect(isFrozen()).toBe(false)

    close()
    await advance(0)
    expect(screen.queryByText(label("entity.selectRefinedImage"))).not.toBeInTheDocument()
    expect(dataOf().sourceImageUrl).toBe(MAIN)
    expect(inFlight()).toBe(false)
    expectFrozen()
  })

  it("closing the page with the picker open lets the freeze land", async () => {
    const view = openPage(page)
    await refineToPicker(page)
    await lowerToView()
    expect(isFrozen()).toBe(false)

    view.unmount()
    expect(inFlight()).toBe(false)
    expectFrozen()
  })

  it("closing the page while the images are being made: nobody is left to pick, and the mark clears once they are done", async () => {
    const view = openPage(page)
    click(label(page.refine))
    await advance(0)
    view.unmount()
    await lowerToView()
    expect(isFrozen()).toBe(false)

    h.settleAs = "completed"
    await advance(POLL_MS * 5)
    expect(h.created).toHaveLength(4)
    expect(inFlight()).toBe(false)
    expectFrozen()
  })

  it("a refine whose every image fails clears its mark, and the freeze lands then", async () => {
    openPage(page)
    h.settleAs = "failed"
    click(label(page.refine))
    await advance(0)
    await lowerToView()
    expect(isFrozen()).toBe(false)

    await advance(POLL_MS * 5)
    expect(screen.queryByText(label("entity.selectRefinedImage"))).not.toBeInTheDocument()
    expect(inFlight()).toBe(false)
    expectFrozen()
  })

  it("with the pick made, a downgrade freezes the canvas at once", async () => {
    openPage(page)
    await refineAndPick(page)
    await lowerToView()
    expectFrozen()
  })

  it("on a canvas already read-only, sends nothing and says why", async () => {
    openPage(page)
    await lowerToView()
    expectFrozen()
    click(label(page.refine))
    await advance(POLL_MS)
    expect(h.created).toEqual([])
    expect(toast.error).toHaveBeenCalledWith(READ_ONLY_REASON)
  })
})
