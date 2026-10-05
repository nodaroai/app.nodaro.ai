import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react"

/**
 * Two more paid runs that write their result onto a canvas node from a dialog
 * of their own, against a `view` answer that reaches the canvas while they are
 * out (T100): a Suno Voice node's persona (its voice id) and an Image Overlay
 * layer's AI placement suggestion. Neither left a mark the freeze could see,
 * so a downgrade mid-run dropped a result already paid for. Both now run
 * inside `withRunInFlight`.
 *
 * The real dialogs, the real store and the real `applyWorkflowAccess`; only
 * the network is mocked.
 */

const h = vi.hoisted(() => ({
  /** Every paid request a run made, in order. */
  paid: [] as string[],
  /** What the Suno persona's status check answers. */
  voice: { status: "generating" } as { status: string; voiceId?: string; errorMessage?: string },
  /** The overlay suggestion the test answers by hand. */
  suggestion: null as null | { resolve: (value: unknown) => void; reject: (err: unknown) => void },
}))

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getWorkflowAccess: vi.fn(),
  sunoVoiceGenerateApi: vi.fn(async () => {
    h.paid.push("suno-voice")
    return { jobId: "voice-job", kieTaskId: "kie-1" }
  }),
  sunoVoiceRecordInfoApi: vi.fn(async () => ({ ...h.voice })),
  suggestOverlayPlacement: vi.fn(() => {
    h.paid.push("overlay-placement")
    return new Promise((resolve, reject) => {
      h.suggestion = { resolve, reject }
    })
  }),
}))

// The dialog shows the live persona price (react-query); not what this is about.
vi.mock("@/hooks/use-model-credit-cost", () => ({ useModelCredits: () => 200 }))

import { toast } from "sonner"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { applyWorkflowAccess, showsARunInFlight } from "@/hooks/workflow-access-mode"
import { isSaveRefused } from "@/hooks/workflow-save-refusal"
import { getWorkflowAccess } from "@/lib/api"
import type { WorkflowAccessInfo } from "@/lib/api"
import { translate } from "@/lib/i18n"
import { SunoVoiceSetupModal } from "@/components/nodes/suno-voice-setup-modal"
import { OverlayLayerEditor } from "@/components/editor/config-panels/image-overlay-layer-editor"
import { DEFAULT_OVERLAY_LAYER, type OverlayLayerConfig, type SunoVoiceData, type WorkflowNode } from "@/types/nodes"

const WF = "wf-1"
const READ_ONLY_REASON = "This workflow is read-only for you."
const RECORD_POLL_MS = 3000

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

/** A canvas its `edit` collaborator has open. */
function openAsEditor(id: string, type: string, data: Record<string, unknown>) {
  const node = { id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } } as unknown as WorkflowNode
  useWorkflowStore.getState().loadWorkflow(WF, "W", [node], [])
  useWorkflowStore.setState({ loadedAccess: { workflowId: WF, access: "edit" } })
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

const dataOf = (id: string) => useWorkflowStore.getState().nodes.find((n) => n.id === id)!.data as Record<string, unknown>
const inFlight = (id: string) => showsARunInFlight({ data: dataOf(id) })
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

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  h.paid.length = 0
  h.voice = { status: "generating" }
  h.suggestion = null
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("a Suno voice's persona", () => {
  const VOICE = "v1"
  /** A setup already validated and recorded: what is left is the paid step. */
  const SETUP: Partial<SunoVoiceData> = {
    sourceAudioUrl: "https://cdn/source.mp3",
    validateTaskId: "validate-1",
    validateInfo: "Read this phrase aloud",
    verifyAudioUrl: "https://cdn/reading.mp3",
    status: "wait_validating",
  }

  function openSetup() {
    openAsEditor(VOICE, "suno-voice", SETUP)
    const modal = (open: boolean) => (
      <SunoVoiceSetupModal nodeId={VOICE} data={dataOf(VOICE) as unknown as SunoVoiceData} open={open} onClose={vi.fn()} />
    )
    const view = render(modal(true))
    click(translate("en", "node.continue"))
    return { close: () => view.rerender(modal(false)), unmount: view.unmount }
  }

  async function createVoice() {
    // "Create voice", with the price beside it on an edition that has credits.
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${translate("en", "node.createVoice")}`) }))
    await advance(0)
  }

  it("a downgrade mid-run lands the voice id, and only then freezes the canvas", async () => {
    openSetup()
    await createVoice()
    expect(h.paid).toEqual(["suno-voice"])
    expect(inFlight(VOICE)).toBe(true)

    await lowerToView()
    expect(isFrozen()).toBe(false)
    await advance(RECORD_POLL_MS)
    expect(isFrozen()).toBe(false)

    h.voice = { status: "success", voiceId: "voice-123" }
    await advance(RECORD_POLL_MS)
    expect(dataOf(VOICE)).toMatchObject({ voiceId: "voice-123", status: "success" })
    expect(inFlight(VOICE)).toBe(false)
    expectFrozen()
  })

  it("with the run over, a downgrade freezes the canvas at once", async () => {
    openSetup()
    h.voice = { status: "success", voiceId: "voice-123" }
    await createVoice()
    await advance(RECORD_POLL_MS)
    expect(dataOf(VOICE).voiceId).toBe("voice-123")
    expect(inFlight(VOICE)).toBe(false)

    await lowerToView()
    expectFrozen()
  })

  it("a failed persona clears its mark, and the freeze lands then", async () => {
    openSetup()
    await createVoice()
    await lowerToView()
    expect(isFrozen()).toBe(false)
    h.voice = { status: "fail", errorMessage: "rejected" }
    // The first few failed checks count as a blip; the next one is believed.
    await advance(RECORD_POLL_MS * 4)
    expect(dataOf(VOICE)).toMatchObject({ status: "fail" })
    expect(dataOf(VOICE).voiceId).toBeUndefined()
    expect(inFlight(VOICE)).toBe(false)
    expectFrozen()
  })

  it("closing the dialog stops the persona's poll, which clears its mark, and the freeze lands", async () => {
    const setup = openSetup()
    await createVoice()
    await lowerToView()
    expect(isFrozen()).toBe(false)

    setup.close()
    await advance(RECORD_POLL_MS)
    expect(inFlight(VOICE)).toBe(false)
    expectFrozen()
  })

  it("on a canvas already read-only, sends nothing and says why", async () => {
    openSetup()
    await lowerToView()
    expectFrozen()
    await createVoice()
    expect(h.paid).toEqual([])
    expect(toast.error).toHaveBeenCalledWith(READ_ONLY_REASON)
  })
})

describe("an overlay layer's placement suggestion", () => {
  const OVERLAY = "o1"
  const PLACEMENT = { anchor: "top-left", x: 4, y: 6, width: 22, reason: "clear sky" }
  const layerOn = () => ((dataOf(OVERLAY).layers ?? []) as OverlayLayerConfig[])[0]

  function openEditor({ withNode = true } = {}) {
    openAsEditor(OVERLAY, "image-overlay", { layers: [DEFAULT_OVERLAY_LAYER] })
    // What both mounts do with a layer's patch: write it onto the node.
    const onChange = (patch: Partial<OverlayLayerConfig>) =>
      useWorkflowStore.getState().updateNodeData(OVERLAY, { layers: [{ ...DEFAULT_OVERLAY_LAYER, ...patch }] })
    return render(
      <OverlayLayerEditor
        index={0}
        layer={DEFAULT_OVERLAY_LAYER}
        connected
        base={{ w: 1000, h: 1000 }}
        onChange={onChange}
        nodeId={withNode ? OVERLAY : undefined}
        baseUrl="https://cdn/base.png"
      />,
    )
  }

  async function suggest() {
    click(translate("en", "overlayAi.suggestPlacement"))
    await advance(0)
  }

  it("a downgrade mid-request lands the placement, and only then freezes the canvas", async () => {
    openEditor()
    await suggest()
    expect(h.paid).toEqual(["overlay-placement"])
    expect(inFlight(OVERLAY)).toBe(true)

    await lowerToView()
    expect(isFrozen()).toBe(false)

    h.suggestion!.resolve({ jobId: "j1", placement: PLACEMENT })
    await advance(0)
    expect(layerOn()).toMatchObject({ anchor: "top-left", x: 4, y: 6, width: 22 })
    expect(inFlight(OVERLAY)).toBe(false)
    expectFrozen()
  })

  it("with the suggestion in, a downgrade freezes the canvas at once", async () => {
    openEditor()
    await suggest()
    h.suggestion!.resolve({ jobId: "j1", placement: PLACEMENT })
    await advance(0)
    expect(inFlight(OVERLAY)).toBe(false)

    await lowerToView()
    expectFrozen()
  })

  it("a failed suggestion clears its mark, and the freeze lands then", async () => {
    openEditor()
    await suggest()
    await lowerToView()
    expect(isFrozen()).toBe(false)
    h.suggestion!.reject(new Error("no placement"))
    await advance(0)
    expect(layerOn()).toEqual(DEFAULT_OVERLAY_LAYER)
    expect(inFlight(OVERLAY)).toBe(false)
    expectFrozen()
  })

  it("closing the editor mid-request: the placement still lands, and only then the freeze", async () => {
    const view = openEditor()
    await suggest()
    view.unmount()
    await lowerToView()
    expect(isFrozen()).toBe(false)

    h.suggestion!.resolve({ jobId: "j1", placement: PLACEMENT })
    await advance(0)
    expect(layerOn()).toMatchObject({ anchor: "top-left", x: 4, y: 6 })
    expect(inFlight(OVERLAY)).toBe(false)
    expectFrozen()
  })

  it("on a canvas already read-only, sends nothing and says why", async () => {
    openEditor()
    await lowerToView()
    expectFrozen()
    await suggest()
    expect(h.paid).toEqual([])
    expect(toast.error).toHaveBeenCalledWith(READ_ONLY_REASON)
  })

  it("is not offered without the node its result would land on", () => {
    openEditor({ withNode: false })
    expect(screen.queryByRole("button", { name: translate("en", "overlayAi.suggestPlacement") })).not.toBeInTheDocument()
  })
})
