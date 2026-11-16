import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

const run = vi.hoisted(() => ({
  fails: false,
  musicFails: false,
  declined: null as null | "cannot" | "nothing" | "done",
  partial: false,
  extra: false,
  hold: false,
  release: null as null | (() => void),
  framing: false,
  made: false,
  undone: null as number | null,
  paces: [] as number[],
  calls: [] as Array<Record<string, unknown>>,
}))

const editor = vi.hoisted(() => ({
  videos: 1,
  playback: vi.fn(),
  compare: vi.fn(),
  openSequence: vi.fn(),
  applyOps: vi.fn(async () => ({ ok: true, recorded: true })),
}))

vi.mock("@/ee/lib/freecut-ai/editor-link", () => ({
  createEditorLink: () => ({
    getTimeline: vi.fn(async () => ({
      fps: 30,
      durationInFrames: 180,
      width: 1920,
      height: 1080,
      items: Array.from({ length: editor.videos }, (_, i) => ({ id: `v${i}`, type: "video", trackId: `t${i}`, from: 0, durationInFrames: 180, mediaId: `media-${i}`, transform: { x: 0, y: 0, width: 1920, height: 1080 } })),
      media: Array.from({ length: editor.videos }, (_, i) => ({ id: `media-${i}`, fileName: i === 0 ? "take.mp4" : `angle-${i}.mp4`, duration: 6, width: 1920, height: 1080 })),
    })),
    applyOps: editor.applyOps,
    undoEdit: vi.fn(),
    importFile: vi.fn(),
    playback: editor.playback,
    compare: editor.compare,
    openSequence: editor.openSequence,
    presence: vi.fn(),
    dispose: vi.fn(),
  }),
}))

vi.mock("@/ee/components/freecut-ai/panel/use-edit-prices", () => ({
  useEditPrices: () => ({ read: 1, listen: 22, choose: 2, steps: { music: 33, mistakes: 6, broll: 30, picture: 120, phone: 12, cameras: 18, clips: 40, trailer: 25, chapters: 15 }, readEstimate: false }),
}))

// The run itself is tested in run-ai-edit.test.ts; here it plays a short, fixed run of the steps asked for.
vi.mock("@/ee/lib/freecut-ai/run-ai-edit", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/ee/lib/freecut-ai/run-ai-edit")>()
  const { requestSteps } = await import("@/ee/lib/freecut-ai/abilities")
  const { DEFAULT_PARAMS } = await import("@/ee/lib/freecut-ai/request-reading")
  const { EMPTY_SUMMARY } = await import("@/ee/lib/freecut-ai/run/types")
  const plan = (steps: string[], extra: Record<string, unknown> = {}) => ({ steps, params: DEFAULT_PARAMS, reply: "On it.", cannot: [], ...extra }) as never
  return {
    ...real,
    runAiEdit: vi.fn(async (opts: Parameters<typeof real.runAiEdit>[0]) => {
      run.calls.push({ request: opts.request, videoUrl: opts.videoUrl, videoName: opts.videoName, heard: opts.heard, done: opts.done, quoted: opts.quoted, framing: opts.framing })
      const asked = requestSteps(opts.request).filter((s) => !opts.done?.includes(s))
      opts.onEvent({ type: "phase", phase: "reading" })
      if (run.declined) {
        const declined = plan([], { reply: "I cannot change the shirt's color yet.", cannot: run.declined === "cannot" ? ["change the shirt's color"] : [] })
        opts.onEvent({ type: "plan", plan: declined })
        throw new real.RunDeclined(declined, run.declined)
      }
      if (run.partial) {
        const partial = plan(["pauses"], { cannot: ["make the shirt blue"] })
        opts.onEvent({ type: "plan", plan: partial })
        if (!(await opts.confirmPartial?.(partial, { listen: false, steps: [] }))) throw new real.RunDeclined(partial)
      }
      if (run.extra) {
        // A general request: the planner chooses steps beyond the price shown.
        const more = plan(["pauses", "captions", "music"])
        opts.onEvent({ type: "plan", plan: more })
        if (!(await opts.confirmPartial?.(more, { listen: true, steps: ["music"] }))) throw new real.RunDeclined(more)
        asked.splice(0, asked.length, "pauses", "captions", "music")
      }
      opts.onEvent({ type: "plan", plan: plan(asked) })
      if (!opts.heard) opts.onEvent({ type: "heard", heard: { words: [{ text: "Hi", start: 0, end: 0.4 }], language: "en" } })
      opts.onEvent({ type: "phase", phase: "working" })
      const cuts = asked.includes("pauses") || asked.includes("fillers")
      if (cuts) {
        opts.onEvent({ type: "agents", working: ["cutter"] })
        opts.onEvent({ type: "step", step: asked.includes("pauses") ? "pauses" : "fillers", state: "working", key: "freecutAi.cuttingRemoved", vars: { done: 1, total: 8, seconds: "1.2" }, progress: 0.125 })
        opts.onEvent({ type: "feed", agent: "cutter", key: "freecutAi.cutFiller", vars: { word: "um" } })
      }
      if (run.hold) {
        await new Promise<void>((resolve, reject) => {
          run.release = resolve
          opts.signal.addEventListener("abort", () => reject(new real.RunStopped()))
        })
        run.paces.push(opts.pace?.() ?? 1)
      }
      for (const step of asked.filter((s) => s === "pauses" || s === "fillers")) {
        opts.onEvent({ type: "recorded", label: `label:${step}`, step })
        opts.onEvent({ type: "step", step, state: "done", key: step === "pauses" ? "freecutAi.summaryPauses" : "freecutAi.summaryFillersOne", vars: { n: step === "pauses" ? 7 : 1 }, progress: 1 })
      }
      if (asked.includes("captions")) {
        opts.onEvent({ type: "recorded", label: "label:captions", step: "captions" })
        opts.onEvent({ type: "step", step: "captions", state: "done", key: "freecutAi.summaryCaptions", vars: { n: 19 }, progress: 1 })
      }
      if (asked.includes("music")) {
        if (run.musicFails) opts.onEvent({ type: "step", step: "music", state: "failed", key: "freecutAi.musicFailed", progress: 1, detail: "Suno refused the prompt" })
        else {
          opts.onEvent({ type: "recorded", label: "label:music", step: "music" })
          opts.onEvent({ type: "step", step: "music", state: "done", key: "freecutAi.musicDoneCard", progress: 1 })
        }
      }
      if (asked.includes("phone") && run.framing) {
        opts.onEvent({ type: "recorded", label: "label:phone", step: "phone" })
        opts.onEvent({ type: "framing", framing: { mediaId: "media-0", source: { width: 1920, height: 1080 }, wide: { width: 1920, height: 1080 }, phone: { width: 1080, height: 1920 }, path: [{ t: 0, cx: 0.5 }] } })
        opts.onEvent({ type: "step", step: "phone", state: "done", key: "freecutAi.phoneDone", progress: 1 })
      }
      if (asked.includes("clips") && run.made) {
        opts.onEvent({ type: "made", result: { id: "clip-1", kind: "clip", key: "freecutAi.made.clip", vars: { n: 1 }, sequenceId: "seq-7", seconds: 31 } })
        opts.onEvent({ type: "step", step: "clips", state: "done", key: "freecutAi.clipsDoneOne", vars: { n: 1 }, progress: 1 })
      }
      if (run.fails) throw new real.RunFailed("freecutAi.listenFailed", undefined, "Audio file contains no audible speech")
      opts.onEvent({ type: "compare", mode: "split" })
      const summary = { ...EMPTY_SUMMARY, fromSeconds: 26.3, toSeconds: cuts ? 12.4 : 26.3, pausesCut: asked.includes("pauses") ? 7 : 0, fillersCut: asked.includes("fillers") ? 1 : 0, captions: asked.includes("captions") ? 19 : 0, music: asked.includes("music") && !run.musicFails, clips: run.made ? 1 : 0 }
      opts.onEvent({ type: "done", summary })
      return summary
    }),
    undoAiEdit: vi.fn(async (_link: unknown, recorded: readonly string[]) => run.undone ?? recorded.length),
  }
})

import { runAiEdit, undoAiEdit } from "@/ee/lib/freecut-ai/run-ai-edit"
import { SKIP_PACE } from "@/ee/lib/freecut-ai/run/show"
import AiEditPanel, { type AiEditPanelProps } from "../ai-edit-panel"

const VIDEO = { url: "https://cdn.example.com/take.mp4", name: "take.mp4" }
const ALL = ["edit-ops", "timeline-read", "playback", "presence", "edit-ops-2", "presence-targets", "compare", "captions-word-highlight"]

const renderPanel = (props: Partial<AiEditPanelProps> = {}) =>
  render(<AiEditPanel editorWindow={() => window} editorOrigin="https://editor.example" videos={[VIDEO]} openedVideoUrl={VIDEO.url} capabilities={ALL} onClose={() => {}} {...props} />)

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const row = (name: string) => screen.getByRole("checkbox", { name: new RegExp(`^${escape(name)}`) })
const queryRow = (name: string) => screen.queryByRole("checkbox", { name: new RegExp(`^${escape(name)}`) })
const request = () => screen.getByRole("textbox") as HTMLTextAreaElement
const cta = () => screen.getByRole("button", { name: /^(Edit the video|Make it)/ }) as HTMLButtonElement
const start = () => fireEvent.click(cta())
const done = () => screen.findByText("Done")

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(run, { fails: false, musicFails: false, declined: null, partial: false, extra: false, hold: false, release: null, framing: false, made: false, undone: null, paces: [], calls: [] })
  editor.videos = 1
})

describe("Edit with AI panel: before a run", () => {
  it("opens calm: one question, the rows of what it can do, and nothing to start until something is asked", () => {
    renderPanel()
    expect(screen.getByText("What do you want from this video?")).toBeTruthy()
    expect(screen.queryByText("Ready")).toBeNull()
    expect(screen.getByRole("tab", { name: "Edit this video" }).getAttribute("aria-selected")).toBe("true")
    for (const name of ["Cut the pauses", "Remove filler words", "Remove mistakes and repeats", "Add captions", "Add music", "Visuals that follow the talk (b-roll)", "Change the picture", "Color", "Zoom on key lines", "Phone version 9:16"]) {
      expect(row(name).getAttribute("aria-checked")).toBe("false")
    }
    expect(screen.getByText("Tap what to do, or write it in your own words.")).toBeTruthy()
    expect(cta().disabled).toBe(true)
  })

  it("a row writes its words into the request, and the footer says what the request costs", () => {
    renderPanel()
    fireEvent.click(row("Cut the pauses"))
    expect(request().value).toBe("Cut the pauses")
    expect(row("Cut the pauses").getAttribute("aria-checked")).toBe("true")
    expect(screen.getByText("Will do: Cut the pauses")).toBeTruthy()
    // The cards' own words are not read by a model: only listening to the video is paid.
    expect(screen.getByText("22 CR · nothing is charged until you start")).toBeTruthy()

    fireEvent.click(row("Add music"))
    expect(request().value).toBe("Cut the pauses, add upbeat music")
    expect(screen.getByText("55 CR · nothing is charged until you start")).toBeTruthy()

    fireEvent.click(row("Cut the pauses"))
    expect(request().value).toBe("Add upbeat music")
    expect(row("Cut the pauses").getAttribute("aria-checked")).toBe("false")
    expect(screen.getByText("33 CR · nothing is charged until you start")).toBeTruthy()
  })

  it("the footer lists the parts of the price on a tap", () => {
    renderPanel()
    fireEvent.click(row("Cut the pauses"))
    fireEvent.click(row("Add music"))
    fireEvent.click(screen.getByText("55 CR · nothing is charged until you start"))
    expect(screen.getByText("Listening to the video: 22 CR")).toBeTruthy()
    expect(screen.getByText("Music: 33 CR")).toBeTruthy()
  })

  it("editing on the timeline alone is free", () => {
    renderPanel()
    fireEvent.click(row("Color"))
    expect(screen.getByText("Free · nothing is charged")).toBeTruthy()
    expect(cta().disabled).toBe(false)
  })

  it("reads what the person wrote in their own words too, and charges the reading", () => {
    renderPanel()
    fireEvent.change(request(), { target: { value: "Tighten it and add some captions" } })
    expect(row("Cut the pauses").getAttribute("aria-checked")).toBe("true")
    expect(row("Add captions").getAttribute("aria-checked")).toBe("true")
    expect(screen.getByText("23 CR · nothing is charged until you start")).toBeTruthy()
    fireEvent.change(request(), { target: { value: "Make it go viral" } })
    expect(screen.getByText("The assistant reads this when you start, and says what it can do.")).toBeTruthy()
    expect(cta().disabled).toBe(false)
  })

  it("Make from it holds the clips, the trailer and the chapters, and its button says Make it", () => {
    renderPanel()
    fireEvent.click(screen.getByRole("tab", { name: "Make from it" }))
    expect(queryRow("Cut the pauses")).toBeNull()
    fireEvent.click(row("Short clips"))
    expect(row("Trailer")).toBeTruthy()
    expect(row("Chapters")).toBeTruthy()
    expect(cta().textContent).toMatch(/^Make it/)
    expect(screen.getByText("62 CR · nothing is charged until you start")).toBeTruthy()
  })

  it("an editor not updated yet is offered only what it can do, and no Make tab", () => {
    renderPanel({ capabilities: ["edit-ops", "timeline-read", "playback", "presence"] })
    expect(row("Cut the pauses")).toBeTruthy()
    expect(row("Add captions")).toBeTruthy()
    for (const name of ["Add music", "Visuals that follow the talk (b-roll)", "Change the picture", "Color", "Phone version 9:16"]) expect(queryRow(name)).toBeNull()
    expect(screen.queryByRole("tab", { name: "Make from it" })).toBeNull()
  })

  it("offers switching cameras only once two cameras are on the timeline", async () => {
    editor.videos = 2
    renderPanel()
    expect(queryRow("Switch cameras")).toBeNull()
    expect(await screen.findByRole("checkbox", { name: /^Switch cameras/ }, { timeout: 2500 })).toBeTruthy()
  })
})

describe("Edit with AI panel: a run", () => {
  it("shows only this run's steps while the agents work, with Stop, the speed and Skip to the end", async () => {
    run.hold = true
    renderPanel()
    fireEvent.click(row("Cut the pauses"))
    fireEvent.click(row("Remove filler words"))
    start()

    const list = await screen.findByRole("region", { name: "This run" })
    expect(within(list).getByText("Cut the pauses")).toBeTruthy()
    expect(within(list).getByText("Remove filler words")).toBeTruthy()
    expect(within(list).getByText("On it.")).toBeTruthy()
    expect(queryRow("Add captions")).toBeNull()
    expect(screen.getByText("You asked")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy()

    fireEvent.click(screen.getByRole("radio", { name: "2×" }))
    fireEvent.click(screen.getByRole("button", { name: "Skip to the end" }))
    await act(async () => run.release?.())
    await done()
    // Skipping lands the rest at once: the run reads the panel's pace as it goes.
    expect(run.paces).toEqual([SKIP_PACE])
  })

  it("stops when asked, and what did not finish can be asked for again", async () => {
    run.hold = true
    renderPanel()
    fireEvent.click(row("Cut the pauses"))
    start()
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }))
    expect(await screen.findByText("Stopped")).toBeTruthy()
    expect(row("Cut the pauses").hasAttribute("disabled")).toBe(false)
  })

  it("ends with one line of what the edit did, the editor's own compare, and the rows saying what was done", async () => {
    renderPanel()
    fireEvent.click(row("Cut the pauses"))
    fireEvent.click(row("Remove filler words"))
    start()
    await done()

    expect(screen.getByText("0:26 → 0:12 · 8 cuts")).toBeTruthy()
    const compare = screen.getByRole("radiogroup", { name: "Compare" })
    expect(within(compare).getByRole("radio", { name: "Split" }).getAttribute("aria-checked")).toBe("true")
    fireEvent.click(within(compare).getByRole("radio", { name: "Original" }))
    expect(editor.compare).toHaveBeenLastCalledWith("source")
    // A cut done on this video is done for good: its row cannot be asked for again.
    expect(row("Cut the pauses").hasAttribute("disabled")).toBe(true)
    expect(request().value).toBe("")
  })

  it("keeps editing: the next run is not listened to again, and leaves out what is done", async () => {
    renderPanel()
    fireEvent.click(row("Cut the pauses"))
    start()
    await done()

    fireEvent.click(row("Add captions"))
    // Heard already, and the cards' words need no reading: laying captions is free now.
    expect(screen.getByText("Free · nothing is charged")).toBeTruthy()
    start()
    await waitFor(() => expect(run.calls).toHaveLength(2))
    await done()
    expect(run.calls[1]).toMatchObject({ heard: { words: [{ text: "Hi" }] }, done: ["pauses"] })
  })

  it("without the editor's own compare, shows the original over the editor and goes back to the edit", async () => {
    const onLayout = vi.fn()
    const { container } = renderPanel({ onLayout, capabilities: ALL.filter((c) => c !== "compare") })
    fireEvent.click(row("Cut the pauses"))
    start()
    await done()
    fireEvent.click(screen.getByRole("button", { name: "Compare" }))

    expect(onLayout).toHaveBeenLastCalledWith(true)
    expect(screen.getByText("Showing the original")).toBeTruthy()
    expect(container.querySelector("video")?.getAttribute("src")).toBe(VIDEO.url)
    fireEvent.click(screen.getByRole("button", { name: "Back to the edit" }))
    expect(onLayout).toHaveBeenLastCalledWith(false)
    expect(container.querySelector("video")).toBeNull()
  })

  it("switches a phone version back to wide and again, as one undoable edit each", async () => {
    run.framing = true
    renderPanel()
    fireEvent.click(row("Phone version 9:16"))
    start()
    await done()

    const format = screen.getByRole("radiogroup", { name: "Format" })
    expect(within(format).getByRole("radio", { name: "Phone 9:16" }).getAttribute("aria-checked")).toBe("true")
    fireEvent.click(within(format).getByRole("radio", { name: "Wide 16:9" }))
    await waitFor(() => expect(editor.applyOps).toHaveBeenCalledWith("Wide 16:9", expect.arrayContaining([expect.objectContaining({ op: "setCanvas", width: 1920, height: 1080 })])))
    await waitFor(() => expect(within(format).getByRole("radio", { name: "Wide 16:9" }).getAttribute("aria-checked")).toBe("true"))
  })

  it("lists what was made, and opens a clip's tab in the editor", async () => {
    run.made = true
    renderPanel()
    fireEvent.click(screen.getByRole("tab", { name: "Make from it" }))
    fireEvent.click(row("Short clips"))
    start()
    await done()

    const made = screen.getByRole("region", { name: "Made from this video" })
    fireEvent.click(within(made).getByRole("button", { name: "Open its tab" }))
    expect(editor.openSequence).toHaveBeenCalledWith("seq-7")
  })

  it("shows the reason on a row whose step failed, and the step can be asked for again", async () => {
    run.musicFails = true
    renderPanel()
    fireEvent.click(row("Add music"))
    start()
    await done()
    expect(within(row("Add music")).getByText("The music could not be made; the rest of the edit is done.")).toBeTruthy()
    expect(row("Add music").getAttribute("title")).toBe("Suno refused the prompt")
    expect(row("Add music").hasAttribute("disabled")).toBe(false)
  })

  it("says why a run stopped, with the provider's own words", async () => {
    run.fails = true
    renderPanel()
    fireEvent.click(row("Cut the pauses"))
    start()
    expect(await screen.findByText("The edit stopped")).toBeTruthy()
    expect(screen.getByText("The video could not be transcribed.")).toBeTruthy()
    expect(screen.getByText("Audio file contains no audible speech")).toBeTruthy()
  })
})

describe("Edit with AI panel: the request read", () => {
  it("answers a request it cannot do with what it can do, and edits nothing", async () => {
    run.declined = "cannot"
    renderPanel()
    fireEvent.change(request(), { target: { value: "Fly the camera over the city" } })
    start()
    expect(await screen.findByText("This cannot be done yet")).toBeTruthy()
    expect(screen.getByText("I cannot change the shirt's color yet.")).toBeTruthy()
    expect(screen.getByText("change the shirt's color")).toBeTruthy()
    expect(screen.getAllByText("Nothing was edited. Only reading the request was charged.").length).toBeGreaterThan(0)
  })

  it("says a request is already done on this video", async () => {
    run.declined = "done"
    renderPanel()
    fireEvent.click(row("Cut the pauses"))
    start()
    expect(await screen.findByText("Already done")).toBeTruthy()
  })

  it("asks before running only the part of a request it can do", async () => {
    run.partial = true
    renderPanel()
    fireEvent.change(request(), { target: { value: "Cut the pauses and make the shirt glow" } })
    start()
    const ask = await screen.findByRole("group", { name: "Part of this cannot be done yet" })
    expect(within(ask).getByText("make the shirt blue")).toBeTruthy()
    fireEvent.click(within(ask).getByRole("button", { name: "Do the possible part" }))
    expect(await done()).toBeTruthy()
  })

  it("goes back to the request when the person chooses to change it", async () => {
    run.partial = true
    renderPanel()
    fireEvent.change(request(), { target: { value: "Cut the pauses and make the shirt glow" } })
    start()
    fireEvent.click(await screen.findByRole("button", { name: "Change the request" }))
    expect(await screen.findByText("What do you want from this video?")).toBeTruthy()
    expect(request().value).toBe("Cut the pauses and make the shirt glow")
  })

  it("asks before a plan that costs more than the price shown, with each part it adds and the new total", async () => {
    run.extra = true
    renderPanel()
    fireEvent.change(request(), { target: { value: "Edit it for me" } })
    expect(screen.getByText("1 CR · nothing is charged until you start")).toBeTruthy()
    start()

    const ask = await screen.findByRole("group", { name: "This plan does more than the price showed" })
    expect(within(ask).getByText("Listening to the video: 22 CR")).toBeTruthy()
    expect(within(ask).getByText("Music: 33 CR")).toBeTruthy()
    expect(within(ask).getByText("In all: 55 CR")).toBeTruthy()
    expect(run.calls[0]).toMatchObject({ quoted: [] })
    fireEvent.click(within(ask).getByRole("button", { name: "Go ahead" }))
    expect(await done()).toBeTruthy()
  })
})

describe("Edit with AI panel: undo, videos and projects", () => {
  it("Undo all reverts every run's steps, and the rows with them", async () => {
    renderPanel()
    fireEvent.click(row("Cut the pauses"))
    start()
    await done()
    fireEvent.click(row("Add music"))
    start()
    await waitFor(() => expect(run.calls).toHaveLength(2))
    await done()

    fireEvent.click(screen.getByRole("button", { name: "Undo all" }))
    expect(await screen.findByText("Undone")).toBeTruthy()
    expect(undoAiEdit).toHaveBeenCalledWith(expect.anything(), ["label:pauses", "label:music"])
    expect(row("Cut the pauses").hasAttribute("disabled")).toBe(false)
  })

  it("an Undo all stopped part way gives back only the steps it reverted", async () => {
    renderPanel()
    fireEvent.click(row("Cut the pauses"))
    start()
    await done()
    fireEvent.click(row("Add captions"))
    start()
    await waitFor(() => expect(run.calls).toHaveLength(2))
    await done()

    // The newest entry (the captions) is reverted, then an edit by hand stops it.
    run.undone = 1
    fireEvent.click(screen.getByRole("button", { name: "Undo all" }))
    expect(await screen.findByText("1 of 2 steps undone: the newest edit on the timeline is yours, so the rest stays.")).toBeTruthy()
    // The cut is still on the timeline: it is not offered again.
    expect(row("Cut the pauses").hasAttribute("disabled")).toBe(true)
  })

  it("says so when an edit by hand stops Undo all at once", async () => {
    run.undone = 0
    renderPanel()
    fireEvent.click(row("Cut the pauses"))
    start()
    fireEvent.click(await screen.findByRole("button", { name: "Undo all" }))
    expect(await screen.findByText("Nothing to undo: the newest edit on the timeline is not one of these.")).toBeTruthy()
  })

  it("with several videos, edits the one chosen, by its name when the host's names are the editor's", async () => {
    const shot2 = { url: "https://cdn.example.com/2.mp4", name: "Shot 2.mp4" }
    renderPanel({ videos: [VIDEO, shot2], matchByName: true })
    fireEvent.change(screen.getByRole("combobox"), { target: { value: shot2.url } })
    fireEvent.click(row("Cut the pauses"))
    start()
    await done()
    expect(run.calls[0]).toMatchObject({ videoUrl: shot2.url, videoName: "Shot 2.mp4" })

    // Each video keeps its own: the first one has nothing done yet.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: VIDEO.url } })
    expect(row("Cut the pauses").hasAttribute("disabled")).toBe(false)
  })

  it("starts on the first video when the opened one is not among the videos it may edit, and names none when the names are not the editor's", async () => {
    renderPanel({ openedVideoUrl: "https://cdn.example.com/elsewhere.mp4" })
    fireEvent.click(row("Cut the pauses"))
    start()
    await done()
    expect(run.calls[0]).toMatchObject({ videoUrl: VIDEO.url, videoName: undefined })
    expect(runAiEdit).toHaveBeenCalledTimes(1)
  })

  it("forgets what it did when the editor starts a fresh project, but not what it heard", async () => {
    const { rerender } = renderPanel({ project: 0 })
    fireEvent.click(row("Cut the pauses"))
    start()
    await done()
    expect(row("Cut the pauses").hasAttribute("disabled")).toBe(true)

    rerender(<AiEditPanel editorWindow={() => window} editorOrigin="https://editor.example" videos={[VIDEO]} openedVideoUrl={VIDEO.url} capabilities={ALL} onClose={() => {}} project={1} />)
    expect(await screen.findByText("What do you want from this video?")).toBeTruthy()
    expect(row("Cut the pauses").hasAttribute("disabled")).toBe(false)
    expect(screen.queryByRole("button", { name: "Undo all" })).toBeNull()
    fireEvent.click(row("Add captions"))
    expect(screen.getByText("Free · nothing is charged")).toBeTruthy()
  })
})
