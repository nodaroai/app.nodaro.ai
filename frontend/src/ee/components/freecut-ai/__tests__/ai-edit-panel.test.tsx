import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

const run = vi.hoisted(() => ({ fails: false, undone: null as number | null }))

vi.mock("@/ee/lib/freecut-ai/editor-link", () => ({
  createEditorLink: () => ({
    getTimeline: vi.fn(),
    applyOps: vi.fn(),
    undoEdit: vi.fn(),
    importFile: vi.fn(),
    playback: vi.fn(),
    presence: vi.fn(),
    dispose: vi.fn(),
  }),
}))

// The run itself is tested in run-ai-edit.test.ts; here it plays a short, fixed run.
vi.mock("@/ee/lib/freecut-ai/run-ai-edit", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/ee/lib/freecut-ai/run-ai-edit")>()
  return {
    ...real,
    runAiEdit: vi.fn(async (opts: Parameters<typeof real.runAiEdit>[0]) => {
      opts.onEvent({ type: "plan", plan: { steps: ["fillers", "pauses", "captions", "music"], musicStyle: "upbeat pop", reply: "Cutting the pauses and the um.", understood: true } })
      opts.onEvent({ type: "agent", agent: "cutter", state: "working", key: "freecutAi.cutting", vars: { done: 1, total: 8 }, progress: 0.125 })
      opts.onEvent({ type: "feed", agent: "cutter", key: "freecutAi.cutFiller", vars: { word: "um" } })
      opts.onEvent({ type: "recorded", label: "Cut the pauses" })
      opts.onEvent({ type: "recorded", label: "Add music" })
      if (run.fails) throw new real.RunFailed("freecutAi.listenFailed", undefined, "Audio file contains no audible speech")
      const summary = { fromSeconds: 26.3, toSeconds: 12.4, pausesCut: 7, fillersCut: 1, captions: 19, music: true }
      opts.onEvent({ type: "done", summary })
      return summary
    }),
    undoAiEdit: vi.fn(async (_link: unknown, recorded: readonly string[]) => run.undone ?? recorded.length),
  }
})

import { undoAiEdit } from "@/ee/lib/freecut-ai/run-ai-edit"
import AiEditPanel from "../ai-edit-panel"

const renderPanel = () =>
  render(<AiEditPanel editorWindow={() => window} editorOrigin="https://editor.example" videoUrl="https://cdn.example.com/take.mp4" onClose={() => {}} />)

beforeEach(() => {
  vi.clearAllMocks()
  run.fails = false
  run.undone = null
})

describe("Edit with AI panel", () => {
  it("runs the edit, then shows the plan, the agents' log and the result", async () => {
    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: "Start editing" }))

    expect(await screen.findByText("Your edit is ready")).toBeTruthy()
    expect(screen.getByText("Cutting the pauses and the um.")).toBeTruthy()
    expect(screen.getByText("Removed “um”")).toBeTruthy()
    expect(screen.getByText("26.3 s → 12.4 s")).toBeTruthy()
    for (const line of ["7 pauses cut", "1 filler word removed", "19 captions", "Music under the voice"]) {
      expect(screen.getByText(line)).toBeTruthy()
    }
  })

  it("Undo all reverts exactly the steps the run made", async () => {
    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: "Start editing" }))
    fireEvent.click(await screen.findByRole("button", { name: "Undo all" }))

    expect(await screen.findByText("Undone. The video is back the way it was.")).toBeTruthy()
    expect(undoAiEdit).toHaveBeenCalledWith(expect.anything(), ["Cut the pauses", "Add music"])
  })

  it("says so when an edit by hand stops Undo all part way", async () => {
    run.undone = 1
    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: "Start editing" }))
    fireEvent.click(await screen.findByRole("button", { name: "Undo all" }))

    expect(await screen.findByText("1 of 2 steps undone: the newest edit on the timeline is yours, so the rest stays.")).toBeTruthy()
  })

  it("shows why a failed run stopped, with the provider's own words under it", async () => {
    run.fails = true
    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: "Start editing" }))

    expect(await screen.findByText("The edit stopped: The video could not be transcribed.")).toBeTruthy()
    expect(screen.getByText("Audio file contains no audible speech")).toBeTruthy()
  })
})
