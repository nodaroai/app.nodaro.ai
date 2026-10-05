import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react"

/**
 * More paid runs that write their result onto a canvas node from a dialog or
 * a panel of their own, against a `view` answer that reaches the canvas while
 * they are out (T100): a Suno Voice node's persona (its voice id), an Image
 * Overlay layer's AI placement suggestion and a Character Studio's seed prompt
 * suggestion. None left a mark the freeze could see, so a downgrade mid-run
 * dropped a result already paid for. Each now runs inside `withRunInFlight`.
 *
 * The real dialogs and Studio page, the real store and the real
 * `applyWorkflowAccess`; only the network is mocked.
 */

type Held = null | { resolve: (value: unknown) => void; reject: (err: unknown) => void }

const h = vi.hoisted(() => ({
  /** Every paid request a run made, in order. */
  paid: [] as string[],
  /** What the Suno persona's status check answers. */
  voice: { status: "generating" } as { status: string; voiceId?: string; errorMessage?: string },
  /** The overlay suggestion the test answers by hand. */
  suggestion: null as Held,
  /** The seed prompt suggestion the test answers by hand. */
  seedPrompt: null as Held,
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
  llmSuggestDescription: vi.fn(() => {
    h.paid.push("seed-prompt")
    return new Promise((resolve, reject) => {
      h.seedPrompt = { resolve, reject }
    })
  }),
}))

// The dialog shows the live persona price (react-query); not what this is about.
vi.mock("@/hooks/use-model-credit-cost", () => ({ useModelCredits: () => 200 }))
// Nor the portrait's price on the Studio's Profile page.
vi.mock("@/ee/hooks/use-model-credits", () => ({ useModelCredits: () => 4 }))

import { toast } from "sonner"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { applyWorkflowAccess, showsARunInFlight } from "@/hooks/workflow-access-mode"
import { isSaveRefused } from "@/hooks/workflow-save-refusal"
import { getWorkflowAccess } from "@/lib/api"
import type { WorkflowAccessInfo } from "@/lib/api"
import { translate } from "@/lib/i18n"
import { SunoVoiceSetupModal } from "@/components/nodes/suno-voice-setup-modal"
import { OverlayLayerEditor } from "@/components/editor/config-panels/image-overlay-layer-editor"
import { ProfilePage } from "@/components/editor/character-studio/pages/profile-page"
import { useCharacterStudio } from "@/components/editor/character-studio/use-character-studio"
import { PortraitCandidatesContext } from "@/components/editor/character-studio/portrait-candidates-context"
import type { PortraitCandidatesApi } from "@/components/editor/character-studio/use-portrait-candidates"
import type { CharacterStudioJobs } from "@/components/editor/character-studio/use-character-studio-jobs"
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
  h.seedPrompt = null
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

describe("a Character Studio's seed prompt suggestion", () => {
  const CHARACTER = "c1"
  const ANSWER = "a weathered sailor, salt in his beard"
  const NO_CANDIDATES: PortraitCandidatesApi = {
    candidates: [],
    previousCandidates: [],
    busy: false,
    generate: async () => {},
    approve: async () => {},
    cancelCandidate: () => {},
  }

  /** The Studio's Profile page on the Studio's own state, as its modal mounts it. */
  function Studio() {
    const state = useCharacterStudio(CHARACTER)
    if (!state) return null
    return (
      <PortraitCandidatesContext.Provider value={NO_CANDIDATES}>
        <ProfilePage state={state} jobs={{} as CharacterStudioJobs} />
      </PortraitCandidatesContext.Provider>
    )
  }

  async function openStudio() {
    // A character with no row yet: the Studio asks the server for nothing.
    openAsEditor(CHARACTER, "character", { characterName: "", seedPrompt: "" })
    const view = render(<Studio />)
    await advance(0)
    return view
  }

  async function suggest() {
    click(translate("en", "studio.suggestSeedPrompt"))
    await advance(0)
  }

  const seedPromptField = () => screen.getByPlaceholderText(translate("en", "studio.seedPromptPh"))

  /**
   * Answer the request the way a browser meets it, with no act() around it.
   * The Studio writes its fields onto the node inside a state updater, and a
   * state update outside an event renders in a task of its own, after the
   * run's own microtasks (its release among them); act() would render it in a
   * microtask before the release, and hide a write that lands too late.
   */
  async function answerLikeABrowser(answer: unknown) {
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const was = env.IS_REACT_ACT_ENVIRONMENT
    env.IS_REACT_ACT_ENVIRONMENT = false
    try {
      h.seedPrompt!.resolve(answer)
      for (let i = 0; i < 20; i++) await Promise.resolve()
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = was
    }
    // Then whatever render is still due.
    await advance(0)
  }

  it("a downgrade mid-request lands the seed prompt on the node, and only then freezes the canvas", async () => {
    await openStudio()
    await suggest()
    expect(h.paid).toEqual(["seed-prompt"])
    expect(inFlight(CHARACTER)).toBe(true)

    // The person keeps working in the Studio meanwhile. After that edit's
    // render, React no longer runs the Studio's next state updater at once.
    fireEvent.change(screen.getByPlaceholderText(translate("en", "studio.appearanceDescriptionPh")), {
      target: { value: "tall, grey coat" },
    })
    await advance(0)

    await lowerToView()
    expect(isFrozen()).toBe(false)

    await answerLikeABrowser({ text: `  ${ANSWER}  ` })
    expect(dataOf(CHARACTER).seedPrompt).toBe(ANSWER)
    expect(seedPromptField()).toHaveValue(ANSWER)
    expect(inFlight(CHARACTER)).toBe(false)
    expectFrozen()
  })

  it("with the answer in, a downgrade freezes the canvas at once", async () => {
    await openStudio()
    await suggest()
    await act(async () => h.seedPrompt!.resolve({ text: ANSWER }))
    await advance(0)
    expect(dataOf(CHARACTER).seedPrompt).toBe(ANSWER)
    expect(inFlight(CHARACTER)).toBe(false)

    await lowerToView()
    expectFrozen()
  })

  it("a failed suggestion clears its mark, and the freeze lands then", async () => {
    await openStudio()
    await suggest()
    await lowerToView()
    expect(isFrozen()).toBe(false)

    await act(async () => h.seedPrompt!.reject(new Error("no suggestion")))
    await advance(0)
    expect(dataOf(CHARACTER).seedPrompt).toBe("")
    expect(toast.error).toHaveBeenCalledWith("no suggestion")
    expect(inFlight(CHARACTER)).toBe(false)
    expectFrozen()
  })

  it("closing the Studio mid-request: its mark goes when the request ends, and the freeze lands then", async () => {
    const view = await openStudio()
    await suggest()
    view.unmount()
    await lowerToView()
    expect(inFlight(CHARACTER)).toBe(true)
    expect(isFrozen()).toBe(false)

    await act(async () => h.seedPrompt!.resolve({ text: ANSWER }))
    await advance(0)
    expect(inFlight(CHARACTER)).toBe(false)
    expectFrozen()
  })

  it("on a canvas already read-only, sends nothing and says why", async () => {
    await openStudio()
    await lowerToView()
    expectFrozen()
    await suggest()
    expect(h.paid).toEqual([])
    expect(toast.error).toHaveBeenCalledWith(READ_ONLY_REASON)
  })
})
