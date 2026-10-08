import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react"
import { findSpeakerViewIssues, speakerViewContext, speakerViewRenderBasis, speakerViewWireSettings } from "@nodaro/render-rules"
import { editPlanBasis, planClipKeyAt } from "@nodaro/shared"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))
// A credit edition, with the prices the estimate falls back to (nothing cached, nothing fetched).
vi.mock("@/lib/edition", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), hasCredits: () => true }))
vi.mock("@/lib/credit-units", () => ({ creditUnits: (n: number) => String(n) }))
vi.mock("@/hooks/use-model-credit-cost", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCachedModelCredits: () => undefined,
  prefetchModelCreditCosts: async () => undefined,
}))
vi.mock("@/components/editor/workflow-editor/newer-run-check", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  newerRunOnServer: vi.fn(async () => null),
  applyNewerRun: vi.fn(() => true),
}))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useReviewModel } from "@/hooks/use-review-model"
import { useReviewEdits } from "@/hooks/use-review-edits"
import { useReviewChecks } from "@/hooks/use-review-checks"
import { useReviewRuns } from "@/hooks/use-review-runs"
import { useClipDecisions } from "@/hooks/use-clip-decisions"
import { useClipCardInputs } from "@/hooks/use-clip-cards"
import { resetUndoStacks } from "@/lib/edl-review/undo-stack"
import { translate } from "@/lib/i18n"
import { ReviewRunButtons } from "../review-run-buttons"
import { ReviewBanners } from "../review-banners"
import { loadClipCanvas, mountClipInspector } from "./clip-canvas"

/**
 * An unpriced Speaker View quotes no price anywhere the review offers its runs
 * (C3.4): its runs are refused, so the review's Render final and Update
 * preview, the stale take's Update preview and the Clip Pack footer show the
 * refusal and no figure — directly or behind Camera Switch, where the run
 * would otherwise add Camera Switch's own price. Apply EDL still quotes its
 * price on the same canvases, so the figure is withheld for the refusal alone.
 */
const NOT_PRICED = translate("en", "speakerView.notPriced")
const MIC = { id: "mic", url: "https://cdn.test/mic.wav", kind: "audio", role: "master-audio" }
const CAM = { id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }
const PLAN = {
  version: 1,
  clock: "master",
  sources: [MIC, CAM],
  segments: [
    { id: "s0", inMs: 0, outMs: 4000, video: "cam", speaker: "Host" },
    { id: "s1", inMs: 5000, outMs: 9000, video: "cam", speaker: "Guest" },
  ],
  dropped: [{ inMs: 4000, outMs: 5000, reason: "filler" }],
}
// An applied edit that keeps s0 only: the Preview on show was not cut from it.
const EDITED = { v: 1, kind: "edl", basis: editPlanBasis(PLAN), edl: { segments: [PLAN.segments[0]], dropped: [] } }
const at = { x: 0, y: 0 }
const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: at, data })
const edge = (source: string, target: string, handle: string) => ({ id: `${source}-${target}`, source, sourceHandle: handle, target, targetHandle: handle })

/** Edit Plan (Tighten) → [Camera Switch →] the render, whose Preview on show predates the plan's edit. */
function loadTighten(renderType: "speaker-view" | "apply-edl", behindSwitch: boolean): void {
  const stale = { url: "https://cdn.test/preview.mp4", quality: "proxy" }
  const nodes = [
    node("plan", "edit-plan", { mode: "tighten", generatedJson: PLAN, editedEdl: EDITED }),
    ...(behindSwitch ? [node("switch", "camera-switch", { generatedJson: { edl: PLAN } })] : []),
    node("view", renderType, { generatedResults: [stale], activeResultIndex: 0, generatedVideoUrl: stale.url }),
  ]
  const edges = behindSwitch ? [edge("plan", "switch", "edl"), edge("switch", "view", "edl")] : [edge("plan", "view", "edl")]
  useWorkflowStore.setState({ nodes: nodes as never, edges: edges as never, isReadOnly: false, workflowId: null })
}

function TightenRuns() {
  const model = useReviewModel("view")
  const edits = useReviewEdits(model)
  const checks = useReviewChecks(model, edits)
  const runs = useReviewRuns(model, edits, checks)
  return (
    <div>
      <div data-testid="footer"><ReviewRunButtons runs={runs} /></div>
      <ReviewBanners model={model} edits={edits} checks={checks} runs={runs} />
    </div>
  )
}

const buttonsIn = (el: HTMLElement) => within(el).getAllByRole("button") as HTMLButtonElement[]

beforeEach(() => {
  resetUndoStacks()
  ;(window as { __NODARO_RUNTIME__?: unknown }).__NODARO_RUNTIME__ = { previewStopRule: true }
})
afterEach(() => {
  cleanup()
  delete (window as { __NODARO_RUNTIME__?: unknown }).__NODARO_RUNTIME__
  useWorkflowStore.setState({ renderFinal: null, renderCheck: null })
})

describe("the Tighten review of an unpriced Speaker View", () => {
  for (const behindSwitch of [false, true]) {
    const where = behindSwitch ? "behind Camera Switch" : "fed directly"
    it(`${where}: Render final and Update preview are disabled and quote no price`, () => {
      loadTighten("speaker-view", behindSwitch)
      render(<TightenRuns />)
      const buttons = buttonsIn(screen.getByTestId("footer"))
      expect(buttons.map((b) => b.textContent)).toEqual(["Update preview", "Render final"])
      expect(buttons.every((b) => b.disabled)).toBe(true)
    })

    it(`${where}: the stale take's Update preview quotes no price`, () => {
      loadTighten("speaker-view", behindSwitch)
      render(<TightenRuns />)
      const banner = screen.getByTestId("banner-stale-take")
      const update = within(banner).getByRole("button") as HTMLButtonElement
      expect(update.textContent).toBe("Update preview")
      expect(update.disabled).toBe(true)
    })

    it(`${where}: Apply EDL on the same canvas still quotes its price`, async () => {
      loadTighten("apply-edl", behindSwitch)
      render(<TightenRuns />)
      await waitFor(() => expect(buttonsIn(screen.getByTestId("footer")).every((b) => / · \d+$/.test(b.textContent ?? ""))).toBe(true))
    })
  }
})

/** Clip i of a two-speaker recording: one segment, with its speaker named. */
const svClip = (i: number) => ({
  version: 1,
  clock: "master",
  sources: [MIC, CAM],
  segments: [{ id: `c${i}`, inMs: i * 100_000, outMs: i * 100_000 + 60_000, video: "cam", speaker: i % 2 ? "Guest" : "Host" }],
  dropped: [],
  meta: { title: `Clip ${i + 1}`, hook: `Hook ${i + 1}` },
})
const SV_CLIPS = Array.from({ length: 3 }, (_, i) => svClip(i))

describe("the Clip Pack review anchored at a Speaker View", () => {
  it("the footer's Render final is disabled, says why and quotes no price", () => {
    loadClipCanvas({ plan: SV_CLIPS, renderType: "speaker-view", cut: { layout: "single" } })
    mountClipInspector()
    const footer = screen.getByTestId("clip-footer")
    const final = within(footer).getByRole("button", { name: /^Render final/ }) as HTMLButtonElement
    expect(final.disabled).toBe(true)
    expect(final.textContent).toBe("Render final · 3 clips")
    expect(footer.textContent).toContain(NOT_PRICED)
  })

  it("Apply EDL's footer on the same canvas still quotes its price", async () => {
    loadClipCanvas({ plan: SV_CLIPS })
    mountClipInspector()
    const footer = screen.getByTestId("clip-footer")
    await waitFor(() => expect(within(footer).getByRole("button", { name: /^Render final/ }).textContent).toMatch(/ · ≈\d+$/))
  })

  it("each clip's basis is the one Speaker View's run of its row stamps (clipRenderBasesBy)", () => {
    loadClipCanvas({ plan: SV_CLIPS, renderType: "speaker-view", cut: { layout: "single" } })
    const { result } = renderHook(() => {
      const model = useReviewModel("cut")
      const { decisions } = useClipDecisions({ planId: model.planId, plan: model.plan, editedEdl: model.editedEdl, locked: model.locked })
      return useClipCardInputs(model, decisions)
    })
    const expected = new Map(SV_CLIPS.map((clip, row) => {
      const settings = speakerViewWireSettings({ layout: "single" }, speakerViewContext(clip, undefined))
      return [planClipKeyAt(SV_CLIPS, row)!, speakerViewRenderBasis(settings, findSpeakerViewIssues({ edl: clip, settings }).edl!)]
    }))
    expect(result.current?.renderBases).toEqual(expected)
  })
})
