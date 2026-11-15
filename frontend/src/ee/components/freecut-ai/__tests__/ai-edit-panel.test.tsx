import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"

const run = vi.hoisted(() => ({
  fails: false,
  musicFails: false,
  declined: null as null | "cannot" | "nothing" | "done",
  partial: false,
  extra: false,
  undone: null as number | null,
  calls: [] as Array<Record<string, unknown>>,
}))
const playback = vi.hoisted(() => vi.fn())

vi.mock("@/ee/lib/freecut-ai/editor-link", () => ({
  createEditorLink: () => ({
    getTimeline: vi.fn(),
    applyOps: vi.fn(),
    undoEdit: vi.fn(),
    importFile: vi.fn(),
    playback,
    presence: vi.fn(),
    dispose: vi.fn(),
  }),
}))

vi.mock("@/ee/components/freecut-ai/panel/use-edit-prices", () => ({
  useEditPrices: () => ({ read: 1, listen: 22, music: 33, readEstimate: false }),
}))

// The run itself is tested in run-ai-edit.test.ts; here it plays a short, fixed run of the steps asked for.
vi.mock("@/ee/lib/freecut-ai/run-ai-edit", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/ee/lib/freecut-ai/run-ai-edit")>()
  return {
    ...real,
    runAiEdit: vi.fn(async (opts: Parameters<typeof real.runAiEdit>[0]) => {
      run.calls.push({ request: opts.request, videoUrl: opts.videoUrl, videoName: opts.videoName, heard: opts.heard, done: opts.done, quoted: opts.quoted })
      const { planFromRequest } = await import("@/ee/lib/freecut-ai/edit-plan")
      const asked = planFromRequest(opts.request).steps.filter((s) => !opts.done?.includes(s))
      if (run.declined) {
        const plan = { steps: [], musicStyle: null, reply: "I cannot change the shirt's color yet.", cannot: run.declined === "cannot" ? ["change the shirt's color"] : [] }
        opts.onEvent({ type: "plan", plan })
        throw new real.RunDeclined(plan, run.declined)
      }
      if (run.partial) {
        const plan = { steps: ["pauses" as const], musicStyle: null, reply: "Cutting the pauses.", cannot: ["make the shirt blue"] }
        opts.onEvent({ type: "plan", plan })
        if (!(await opts.confirmPartial?.(plan, { listen: false, music: false }))) throw new real.RunDeclined(plan)
      }
      if (run.extra) {
        // A general request: the planner chooses every step, beyond the price shown for none.
        const plan = { steps: ["pauses" as const, "captions" as const, "music" as const], musicStyle: "upbeat pop", reply: "All of it.", cannot: [] }
        opts.onEvent({ type: "plan", plan })
        if (!(await opts.confirmPartial?.(plan, { listen: true, music: true }))) throw new real.RunDeclined(plan)
        asked.splice(0, asked.length, "pauses", "captions", "music")
      }
      opts.onEvent({ type: "plan", plan: { steps: asked, musicStyle: asked.includes("music") ? "upbeat pop" : null, reply: "On it.", cannot: [] } })
      if (!opts.heard) opts.onEvent({ type: "heard", heard: { words: [{ text: "Hi", start: 0, end: 0.4 }], language: "en" } })
      if (asked.includes("pauses") || asked.includes("fillers")) {
        opts.onEvent({ type: "agent", agent: "cutter", state: "working", key: "freecutAi.cutting", vars: { done: 1, total: 8 }, progress: 0.125 })
        opts.onEvent({ type: "feed", agent: "cutter", key: "freecutAi.cutFiller", vars: { word: "um" } })
        opts.onEvent({ type: "recorded", label: "Cut the pauses" })
        opts.onEvent({ type: "agent", agent: "cutter", state: "done", key: "freecutAi.cutDone", vars: { seconds: "13.9" }, progress: 1 })
      }
      if (asked.includes("captions")) {
        opts.onEvent({ type: "recorded", label: "Add captions" })
        opts.onEvent({ type: "agent", agent: "captions", state: "done", key: "freecutAi.captionsDone", vars: { n: 19 }, progress: 1 })
      }
      if (asked.includes("music")) {
        if (run.musicFails) opts.onEvent({ type: "agent", agent: "sound", state: "failed", key: "freecutAi.musicFailed", detail: "Suno refused the prompt" })
        else {
          opts.onEvent({ type: "recorded", label: "Add music" })
          opts.onEvent({ type: "agent", agent: "sound", state: "done", key: "freecutAi.musicDone" })
        }
      }
      if (run.fails) throw new real.RunFailed("freecutAi.listenFailed", undefined, "Audio file contains no audible speech")
      const summary = { fromSeconds: 26.3, toSeconds: 12.4, pausesCut: asked.includes("pauses") ? 7 : 0, fillersCut: asked.includes("fillers") ? 1 : 0, captions: asked.includes("captions") ? 19 : 0, music: asked.includes("music") && !run.musicFails }
      opts.onEvent({ type: "done", summary })
      return summary
    }),
    undoAiEdit: vi.fn(async (_link: unknown, recorded: readonly string[]) => run.undone ?? recorded.length),
  }
})

import { runAiEdit, undoAiEdit } from "@/ee/lib/freecut-ai/run-ai-edit"
import AiEditPanel, { type AiEditPanelProps } from "../ai-edit-panel"

const VIDEO = { url: "https://cdn.example.com/take.mp4", name: "take.mp4" }

const renderPanel = (props: Partial<AiEditPanelProps> = {}) =>
  render(<AiEditPanel editorWindow={() => window} editorOrigin="https://editor.example" videos={[VIDEO]} openedVideoUrl={VIDEO.url} onClose={() => {}} {...props} />)

const card = (name: string) => screen.getByRole("checkbox", { name: new RegExp(name) })
const request = () => screen.getByRole("textbox") as HTMLTextAreaElement
const edit = () => fireEvent.click(screen.getByRole("button", { name: /^Edit/ }))

beforeEach(() => {
  vi.clearAllMocks()
  run.fails = false
  run.musicFails = false
  run.declined = null
  run.partial = false
  run.extra = false
  run.undone = null
  run.calls = []
})

describe("Edit with AI panel", () => {
  it("opens ready, with what it can do as cards, and nothing to start until something is asked", () => {
    renderPanel()
    expect(screen.getByText("Ready")).toBeTruthy()
    for (const name of ["Cut the pauses", "Remove filler words", "Add captions", "Add music"]) expect(card(name).getAttribute("aria-checked")).toBe("false")
    expect(screen.getByText("Tidy up")).toBeTruthy()
    expect((screen.getByRole("button", { name: /^Edit/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("a card writes its words into the request, and the request says what it will do and what it is charged", () => {
    renderPanel()
    fireEvent.click(card("Cut the pauses"))
    expect(request().value).toBe("Cut the pauses")
    expect(card("Cut the pauses").getAttribute("aria-checked")).toBe("true")
    expect(screen.getByText("Will do: Cut the pauses")).toBeTruthy()
    // Reading the request, and listening to the video for the first time.
    expect(screen.getByText("Charged: 23 CR")).toBeTruthy()

    fireEvent.click(card("Add music"))
    expect(request().value).toBe("Cut the pauses, add upbeat music")
    expect(screen.getByText("Charged: 56 CR")).toBeTruthy()

    fireEvent.click(card("Cut the pauses"))
    expect(request().value).toBe("Add upbeat music")
    expect(card("Cut the pauses").getAttribute("aria-checked")).toBe("false")
  })

  it("reads what the person wrote in their own words too", () => {
    renderPanel()
    fireEvent.change(request(), { target: { value: "Tighten it and add some captions" } })
    expect(card("Cut the pauses").getAttribute("aria-checked")).toBe("true")
    expect(card("Add captions").getAttribute("aria-checked")).toBe("true")
    fireEvent.change(request(), { target: { value: "Make the shirt blue" } })
    expect(screen.getByText("The assistant reads this when you start, and says what it can do.")).toBeTruthy()
  })

  it("runs it, says it is done, and the cards say what was done", async () => {
    renderPanel()
    fireEvent.click(card("Cut the pauses"))
    fireEvent.click(card("Remove filler words"))
    edit()

    expect(await screen.findByText("Done")).toBeTruthy()
    expect(within(card("Cut the pauses")).getByText("7 pauses cut")).toBeTruthy()
    expect(within(card("Remove filler words")).getByText("1 filler word removed")).toBeTruthy()
    expect(screen.getByText("26.3 s → 12.4 s")).toBeTruthy()
    expect(screen.getByText("Heard 1 words")).toBeTruthy()
    // A done step cannot be asked for again on this video.
    expect((card("Cut the pauses") as HTMLButtonElement).disabled).toBe(true)
    expect(request().value).toBe("")
  })

  it("keeps editing: the next run is not listened to again, and leaves out what is done", async () => {
    renderPanel()
    fireEvent.click(card("Cut the pauses"))
    edit()
    await screen.findByText("Done")

    fireEvent.click(card("Add captions"))
    // Heard already: only the reading is charged now.
    expect(screen.getByText("Charged: 1 CR")).toBeTruthy()
    edit()
    await screen.findByText("Done")

    expect(run.calls).toHaveLength(2)
    expect(run.calls[1]).toMatchObject({ heard: { words: [{ text: "Hi" }] }, done: ["pauses"] })
    expect(within(card("Add captions")).getByText("19 captions")).toBeTruthy()
    expect(within(card("Cut the pauses")).getByText("7 pauses cut")).toBeTruthy()
  })

  it("plays the edit from the start", async () => {
    renderPanel()
    fireEvent.click(card("Cut the pauses"))
    edit()
    fireEvent.click(await screen.findByRole("button", { name: "Play the result" }))
    expect(playback).toHaveBeenCalledWith("seek", 0)
    expect(playback).toHaveBeenCalledWith("play")
  })

  it("compares with the original over the editor, and goes back to the edit", async () => {
    const onLayout = vi.fn()
    const { container } = renderPanel({ onLayout })
    fireEvent.click(card("Cut the pauses"))
    edit()
    fireEvent.click(await screen.findByRole("button", { name: "Compare" }))

    expect(onLayout).toHaveBeenLastCalledWith(true)
    expect(screen.getByText("Showing the original")).toBeTruthy()
    expect(container.querySelector("video")?.getAttribute("src")).toBe(VIDEO.url)
    expect((card("Add captions") as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole("button", { name: "Back to the edit" }))
    expect(onLayout).toHaveBeenLastCalledWith(false)
    expect(container.querySelector("video")).toBeNull()
  })

  it("Undo all reverts every run's steps, and the cards with them", async () => {
    renderPanel()
    fireEvent.click(card("Cut the pauses"))
    edit()
    await screen.findByText("Done")
    fireEvent.click(card("Add music"))
    edit()
    await screen.findByText("Done")

    fireEvent.click(screen.getByRole("button", { name: "Undo all" }))
    expect(await screen.findByText("Undone")).toBeTruthy()
    expect(undoAiEdit).toHaveBeenCalledWith(expect.anything(), ["Cut the pauses", "Add music"])
    expect((card("Cut the pauses") as HTMLButtonElement).disabled).toBe(false)
  })

  it("says so when an edit by hand stops Undo all part way", async () => {
    run.undone = 0
    renderPanel()
    fireEvent.click(card("Cut the pauses"))
    edit()
    fireEvent.click(await screen.findByRole("button", { name: "Undo all" }))
    expect(await screen.findByText("Nothing to undo: the newest edit on the timeline is not one of these.")).toBeTruthy()
  })

  it("shows the provider's words on a card whose step failed, and the step can be asked for again", async () => {
    run.musicFails = true
    renderPanel()
    fireEvent.click(card("Add music"))
    edit()

    expect(await screen.findByText("Done")).toBeTruthy()
    expect(within(card("Add music")).getByText("The music could not be made; the rest of the edit is done.")).toBeTruthy()
    expect(within(card("Add music")).getByText("Suno refused the prompt")).toBeTruthy()
    expect((card("Add music") as HTMLButtonElement).disabled).toBe(false)
  })

  it("says why a run stopped, with the provider's own words", async () => {
    run.fails = true
    renderPanel()
    fireEvent.click(card("Cut the pauses"))
    edit()

    expect(await screen.findByText("The edit stopped")).toBeTruthy()
    expect(screen.getByText("The video could not be transcribed.")).toBeTruthy()
    expect(screen.getByText("Audio file contains no audible speech")).toBeTruthy()
  })

  it("answers a request it cannot do with what it can do, and edits nothing", async () => {
    run.declined = "cannot"
    renderPanel()
    fireEvent.change(request(), { target: { value: "Make the shirt blue" } })
    edit()

    expect(await screen.findByText("This cannot be done yet")).toBeTruthy()
    expect(screen.getByText("I cannot change the shirt's color yet.")).toBeTruthy()
    expect(screen.getByText("change the shirt's color")).toBeTruthy()
    expect(screen.getAllByText("Nothing was edited. Only reading the request was charged.").length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: /^Edit/ })).toBeTruthy()
  })

  it("says a request is already done on this video", async () => {
    run.declined = "done"
    renderPanel()
    fireEvent.click(card("Cut the pauses"))
    edit()
    expect(await screen.findByText("Already done")).toBeTruthy()
  })

  it("asks before running only the part of a request it can do", async () => {
    run.partial = true
    renderPanel()
    fireEvent.change(request(), { target: { value: "Cut the pauses and make the shirt blue" } })
    edit()

    expect(await screen.findByRole("button", { name: "Do the possible part" })).toBeTruthy()
    expect(screen.getByText("make the shirt blue")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Do the possible part" }))
    expect(await screen.findByText("Done")).toBeTruthy()
  })

  it("goes back to the request when the person chooses to change it", async () => {
    run.partial = true
    renderPanel()
    fireEvent.change(request(), { target: { value: "Cut the pauses and make the shirt blue" } })
    edit()
    fireEvent.click(await screen.findByRole("button", { name: "Change the request" }))

    expect(await screen.findByText("Ready")).toBeTruthy()
    expect(request().value).toBe("Cut the pauses and make the shirt blue")
  })

  it("with several videos, edits the one chosen, by its name when the host's names are the editor's", async () => {
    const shot2 = { url: "https://cdn.example.com/2.mp4", name: "Shot 2.mp4" }
    renderPanel({ videos: [VIDEO, shot2], matchByName: true })
    fireEvent.change(screen.getByRole("combobox"), { target: { value: shot2.url } })
    fireEvent.click(card("Cut the pauses"))
    edit()
    await screen.findByText("Done")
    expect(run.calls[0]).toMatchObject({ videoUrl: shot2.url, videoName: "Shot 2.mp4" })

    // Each video keeps its own: the first one has nothing done yet.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: VIDEO.url } })
    expect((card("Cut the pauses") as HTMLButtonElement).disabled).toBe(false)
  })

  it("asks before a plan that costs more than the price shown, with what it adds and the new total", async () => {
    run.extra = true
    renderPanel()
    fireEvent.change(request(), { target: { value: "Edit it for me" } })
    expect(screen.getByText("Charged: 1 CR")).toBeTruthy()
    edit()

    expect(await screen.findByRole("group", { name: "This plan does more than the price showed" })).toBeTruthy()
    expect(screen.getByText("It also needs listening to the video, music. In all, it is charged 56 CR.")).toBeTruthy()
    expect(run.calls[0]).toMatchObject({ quoted: [] })
    fireEvent.click(screen.getByRole("button", { name: "Go ahead" }))
    expect(await screen.findByText("Done")).toBeTruthy()
  })

  it("forgets what it did when the editor starts a fresh project, but not what it heard", async () => {
    const { rerender } = renderPanel({ project: 0 })
    fireEvent.click(card("Cut the pauses"))
    edit()
    await screen.findByText("Done")
    expect((card("Cut the pauses") as HTMLButtonElement).disabled).toBe(true)

    rerender(<AiEditPanel editorWindow={() => window} editorOrigin="https://editor.example" videos={[VIDEO]} openedVideoUrl={VIDEO.url} onClose={() => {}} project={1} />)
    expect(await screen.findByText("Ready")).toBeTruthy()
    expect((card("Cut the pauses") as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByRole("button", { name: "Undo all" })).toBeNull()
    expect(screen.getByText("Heard 1 words")).toBeTruthy()
  })

  it("an Undo all stopped part way gives back only the steps it reverted", async () => {
    renderPanel()
    fireEvent.click(card("Add music"))
    edit()
    await screen.findByText("Done")
    fireEvent.click(card("Add captions"))
    edit()
    await screen.findByText("Done")

    // The newest entry (the captions) is reverted, then an edit by hand stops it.
    run.undone = 1
    fireEvent.click(screen.getByRole("button", { name: "Undo all" }))
    expect(await screen.findByText("1 of 2 steps undone: the newest edit on the timeline is yours, so the rest stays.")).toBeTruthy()
    expect((card("Add captions") as HTMLButtonElement).disabled).toBe(false)
    // The music is still on the timeline: it is not offered again.
    expect((card("Add music") as HTMLButtonElement).disabled).toBe(true)
  })

  it("starts on the first video when the opened one is not among the videos it may edit", async () => {
    renderPanel({ openedVideoUrl: "https://cdn.example.com/elsewhere.mp4" })
    fireEvent.click(card("Cut the pauses"))
    edit()
    await screen.findByText("Done")
    expect(run.calls[0]).toMatchObject({ videoUrl: VIDEO.url })
  })

  it("names no video to the run when the host's names are not the editor's", async () => {
    renderPanel()
    fireEvent.click(card("Cut the pauses"))
    edit()
    await screen.findByText("Done")
    expect(run.calls[0]).toMatchObject({ videoUrl: VIDEO.url, videoName: undefined })
    expect(runAiEdit).toHaveBeenCalledTimes(1)
  })
})
