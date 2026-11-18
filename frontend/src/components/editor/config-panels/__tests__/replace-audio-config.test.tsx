/**
 * Replace Audio's settings: the Mode and Music selects read through the shared
 * readers (a node written as JSON shows what it will send), the prompt and its
 * counter show only for a prompt, the speech's levers only while the speech is
 * kept, every slider stores a clamped whole percent, and the price line quotes
 * the row the node's settings name.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { REPLACE_AUDIO_MUSIC_PROMPT_MAX } from "@nodaro/render-rules"
import type { ReplaceAudioNodeData } from "@/types/nodes"

const priced = vi.hoisted(() => ({ ids: [] as string[], credits: 0, edition: true }))
vi.mock("@/hooks/use-model-credit-cost", () => ({
  useModelCredits: (id: string) => {
    priced.ids.push(id)
    return priced.credits
  },
}))
vi.mock("@/lib/edition", async (orig) => ({ ...(await orig<typeof import("@/lib/edition")>()), hasCredits: () => priced.edition }))

import { ReplaceAudioConfig, replaceAudioLeversFor } from "../replace-audio-config"

const data = (over: Partial<ReplaceAudioNodeData> = {}): ReplaceAudioNodeData => ({
  label: "Replace Audio",
  musicSource: "input",
  musicPrompt: "",
  mode: "keep-speech",
  musicVolume: 80,
  speechVolume: 100,
  duckAmount: 70,
  fieldMappings: {},
  ...over,
})

beforeEach(() => {
  priced.ids = []
  priced.credits = 0
  priced.edition = true
})

describe("ReplaceAudioConfig — selects", () => {
  it("shows the mode and the music source the node holds", () => {
    render(<ReplaceAudioConfig data={data()} onUpdate={vi.fn()} />)
    expect(screen.getByRole("combobox", { name: "Mode" }).textContent).toContain("Keep the speech")
    expect(screen.getByRole("combobox", { name: "Music" }).textContent).toContain("Connected music")
  })

  it("reads an unknown mode or source as the defaults (what the body sends)", () => {
    render(<ReplaceAudioConfig data={data({ mode: "loud" as never, musicSource: "radio" as never })} onUpdate={vi.fn()} />)
    expect(screen.getByRole("combobox", { name: "Mode" }).textContent).toContain("Keep the speech")
    expect(screen.getByRole("combobox", { name: "Music" }).textContent).toContain("Connected music")
  })

  it("names Replace all the sound", () => {
    render(<ReplaceAudioConfig data={data({ mode: "replace-all", musicSource: "prompt" })} onUpdate={vi.fn()} />)
    expect(screen.getByRole("combobox", { name: "Mode" }).textContent).toContain("Replace all the sound")
    expect(screen.getByRole("combobox", { name: "Music" }).textContent).toContain("Make it from a prompt")
  })
})

describe("ReplaceAudioConfig — the music prompt", () => {
  it("is hidden while the music comes from the wire", () => {
    render(<ReplaceAudioConfig data={data()} onUpdate={vi.fn()} />)
    expect(screen.queryByLabelText("Music prompt")).toBeNull()
    expect(screen.queryByTestId("replace-audio-prompt-count")).toBeNull()
  })

  it("shows the prompt with its counter, and stores what is typed", () => {
    const onUpdate = vi.fn()
    render(<ReplaceAudioConfig data={data({ musicSource: "prompt", musicPrompt: "calm piano" })} onUpdate={onUpdate} />)
    const prompt = screen.getByLabelText("Music prompt") as HTMLTextAreaElement
    expect(prompt.value).toBe("calm piano")
    expect(screen.getByTestId("replace-audio-prompt-count").textContent).toBe(`10 / ${REPLACE_AUDIO_MUSIC_PROMPT_MAX}`)
    fireEvent.change(prompt, { target: { value: "upbeat synthwave" } })
    expect(onUpdate).toHaveBeenCalledWith({ musicPrompt: "upbeat synthwave" })
  })

  it("marks a prompt over the limit (the run refuses it)", () => {
    render(<ReplaceAudioConfig data={data({ musicSource: "prompt", musicPrompt: "x".repeat(REPLACE_AUDIO_MUSIC_PROMPT_MAX + 1) })} onUpdate={vi.fn()} />)
    const count = screen.getByTestId("replace-audio-prompt-count")
    expect(count.textContent).toBe(`${REPLACE_AUDIO_MUSIC_PROMPT_MAX + 1} / ${REPLACE_AUDIO_MUSIC_PROMPT_MAX}`)
    expect(count.className).toContain("text-red-500")
    expect(screen.getByLabelText("Music prompt").getAttribute("aria-invalid")).toBe("true")
  })
})

describe("ReplaceAudioConfig — the levers", () => {
  it("keep-speech offers the music, the speech and the duck", () => {
    expect(replaceAudioLeversFor("keep-speech")).toEqual(["musicVolume", "speechVolume", "duckAmount"])
    render(<ReplaceAudioConfig data={data()} onUpdate={vi.fn()} />)
    const music = screen.getByLabelText("Music volume: 80%") as HTMLInputElement
    expect([music.min, music.max]).toEqual(["0", "200"])
    const speech = screen.getByLabelText("Speech volume: 100%") as HTMLInputElement
    expect([speech.min, speech.max]).toEqual(["0", "200"])
    const duck = screen.getByLabelText("Duck under speech: 70%") as HTMLInputElement
    expect([duck.min, duck.max]).toEqual(["0", "100"])
  })

  it("replace-all keeps no speech, so only the music's level is offered", () => {
    expect(replaceAudioLeversFor("replace-all")).toEqual(["musicVolume"])
    render(<ReplaceAudioConfig data={data({ mode: "replace-all" })} onUpdate={vi.fn()} />)
    expect(screen.getByLabelText("Music volume: 80%")).toBeTruthy()
    expect(screen.queryByText(/^Duck under speech/)).toBeNull()
    expect(screen.queryByText(/^Speech volume/)).toBeNull()
  })

  it("stores each slider's value, and shows a stored value out of bounds clamped", () => {
    const onUpdate = vi.fn()
    render(<ReplaceAudioConfig data={data({ duckAmount: 250 as number })} onUpdate={onUpdate} />)
    expect(screen.getByLabelText("Duck under speech: 100%")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Music volume: 80%"), { target: { value: "150" } })
    expect(onUpdate).toHaveBeenCalledWith({ musicVolume: 150 })
    fireEvent.change(screen.getByLabelText("Speech volume: 100%"), { target: { value: "40" } })
    expect(onUpdate).toHaveBeenCalledWith({ speechVolume: 40 })
  })
})

describe("ReplaceAudioConfig — the price line", () => {
  it("quotes the row the settings name", () => {
    priced.credits = 30
    render(<ReplaceAudioConfig data={data({ mode: "replace-all", musicSource: "prompt" })} onUpdate={vi.fn()} />)
    expect(priced.ids).toContain("replace-audio:replace-all:prompt")
    expect(screen.getByTestId("replace-audio-price-line").textContent).toContain("30")
  })

  it("keep-speech with connected music quotes the base row", () => {
    priced.credits = 20
    render(<ReplaceAudioConfig data={data()} onUpdate={vi.fn()} />)
    expect(priced.ids).toContain("replace-audio")
  })

  it("shows no price where the deployment has no credits, or the row is not priced", () => {
    priced.credits = 0
    const { unmount } = render(<ReplaceAudioConfig data={data()} onUpdate={vi.fn()} />)
    expect(screen.queryByTestId("replace-audio-price-line")).toBeNull()
    unmount()
    priced.credits = 30
    priced.edition = false
    render(<ReplaceAudioConfig data={data()} onUpdate={vi.fn()} />)
    expect(screen.queryByTestId("replace-audio-price-line")).toBeNull()
  })
})
