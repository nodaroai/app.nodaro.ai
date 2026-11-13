/**
 * The Text to Dialogue panel snaps / clears what a model does not take ONLY when
 * the user switches the model — never because the panel moved to another node.
 *
 * ConfigPanel keeps ONE TextToDialogueConfig instance mounted while the selection
 * moves between dialogue nodes (and through a deselect), so anything keyed to
 * "the provider changed" would rewrite the node the user merely clicked (snap a
 * v4 node's 0.3 stability, strip its similarity) and mark the workflow unsaved.
 * These tests render the REAL panel against the real workflow store — the harness
 * of config-panel-tts-model-switch.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

vi.mock("@/lib/supabase", () => {
  const auth = {
    getUser: () => Promise.resolve({ data: { user: null } }),
    getSession: () => Promise.resolve({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  }
  const from = () => {
    const q: Record<string, unknown> = {}
    for (const m of ["select", "eq", "in", "order", "limit", "single", "maybeSingle", "is", "neq", "gte", "lte", "match", "filter"]) q[m] = () => q
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
    return q
  }
  const client = { auth, from, channel: () => ({ on() { return this }, subscribe() { return this } }), removeChannel() {} }
  return { createClient: () => client }
})

// The per-line voice browser fetches its catalogue and lives in a dialog; stand
// it in with an inert button (no case here picks a voice).
vi.mock("@/components/editor/config-panels/voice-browser", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  VoiceBrowser: () => <button type="button" data-testid="voice-browser">voice</button>,
}))

import { ConfigPanel } from "@/components/editor/config-panel"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { NODE_DEFINITIONS } from "@/types/nodes"

const defaults = NODE_DEFINITIONS.find((d) => d.type === "text-to-dialogue")!.defaultData as Record<string, unknown>

function dialogueNode(id: string, data: Record<string, unknown> = {}) {
  return { id, type: "text-to-dialogue", position: { x: 0, y: 0 }, data: { ...defaults, label: `Dialogue ${id}`, dialogue: [{ id: "1", text: "Hi", voice: "Rachel" }], ...data } } as never
}

const dataOf = (id: string) => useWorkflowStore.getState().nodes.find((n) => n.id === id)!.data as Record<string, unknown>
const tick = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const select = (selectedNodeId: string | null) => act(async () => { useWorkflowStore.setState({ selectedNodeId } as never) })

function mountPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ConfigPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  globalThis.fetch = vi.fn(() => Promise.resolve(new Response("{}", { status: 404 }))) as never
  const g = globalThis as Record<string, unknown>
  if (typeof window.matchMedia !== "function") {
    ;(window as unknown as Record<string, unknown>).matchMedia = (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })
  }
  if (typeof g.ResizeObserver !== "function") g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  if (typeof g.IntersectionObserver !== "function") g.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
})

afterEach(() => cleanup())

describe("text-to-dialogue panel — selecting another node rewrites nothing", () => {
  it("a v3 node, then a v4 node with a stepless stability: the second keeps its values and the workflow stays clean", async () => {
    useWorkflowStore.setState({
      nodes: [dialogueNode("A", { provider: "elevenlabs-dialogue" }), dialogueNode("B", { provider: "elevenlabs-dialogue-v4", stability: 0.3, similarityBoost: 0.8 })],
      edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false,
    } as never)
    mountPanel()
    await tick()
    useWorkflowStore.setState({ isDirty: false } as never)

    await select("B")
    await tick()

    expect(dataOf("B").stability).toBe(0.3)
    expect(dataOf("B").similarityBoost).toBe(0.8)
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it("a v3 node that an agent wrote with similarity and a stepless stability keeps them when merely selected", async () => {
    useWorkflowStore.setState({
      nodes: [dialogueNode("A"), dialogueNode("B", { provider: "elevenlabs-dialogue", stability: 0.3, similarityBoost: 0.8 })],
      edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false,
    } as never)
    mountPanel()
    await tick()
    await select(null)
    await tick()
    useWorkflowStore.setState({ isDirty: false } as never)

    await select("B")
    await tick()

    expect(dataOf("B").stability).toBe(0.3)
    expect(dataOf("B").similarityBoost).toBe(0.8)
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it("a node saved before the model field existed shows v3 dialogue, which is what it runs as, and rewrites nothing", async () => {
    useWorkflowStore.setState({ nodes: [dialogueNode("A", { provider: undefined })], edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false } as never)
    mountPanel()
    await tick()
    expect(screen.getByRole("combobox", { name: "Model" }).textContent).toMatch(/^ElevenLabs Dialogue v3/)
    expect(dataOf("A").provider).toBeUndefined()
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })
})

describe("text-to-dialogue panel — a model the user picks", () => {
  async function pickModel(label: RegExp) {
    const user = userEvent.setup()
    await user.click(screen.getByRole("combobox", { name: "Model" }))
    await user.click(await within(await screen.findByRole("listbox")).findByRole("option", { name: label }))
    await tick()
  }

  it("v4 → v3: the stability snaps to a step and similarity is cleared; the lines are untouched", async () => {
    useWorkflowStore.setState({
      nodes: [dialogueNode("A", { provider: "elevenlabs-dialogue-v4", stability: 0.3, similarityBoost: 0.8 })],
      edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false,
    } as never)
    mountPanel()
    await tick()

    await pickModel(/^ElevenLabs Dialogue v3/)

    const data = dataOf("A")
    expect(data.provider).toBe("elevenlabs-dialogue")
    expect(data.stability).toBe(0.5)
    expect(data.similarityBoost).toBeUndefined()
    expect(data.dialogue).toEqual([{ id: "1", text: "Hi", voice: "Rachel" }])
  })

  it("v3 → v4: the stability is kept and a similarity slider appears", async () => {
    useWorkflowStore.setState({
      nodes: [dialogueNode("A", { provider: "elevenlabs-dialogue", stability: 1 })],
      edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false,
    } as never)
    mountPanel()
    await tick()
    expect(screen.queryByLabelText(/Similarity/)).toBeNull()

    await pickModel(/^ElevenLabs Dialogue v4/)

    expect(dataOf("A").provider).toBe("elevenlabs-dialogue-v4")
    expect(dataOf("A").stability).toBe(1)
    expect(screen.getByLabelText(/Similarity/)).toBeTruthy()
  })

  it("the length counter shows the chosen model's cap", async () => {
    useWorkflowStore.setState({
      nodes: [dialogueNode("A", { provider: "elevenlabs-dialogue-v4" })],
      edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false,
    } as never)
    mountPanel()
    await tick()
    expect(screen.getByText(/\/10000$/)).toBeTruthy() // the probe's number (DIALOGUE_V4_MAX_CHARS, measured 2026-10-06)
  })
})

describe("text-to-dialogue panel — the Gemini dialogue models (decided 2026-11-12)", () => {
  const twoSpeakers = [
    { id: "1", text: "Hi", voice: "Kore", voiceLabel: "Kore" },
    { id: "2", text: "Hello", voice: "Puck", voiceLabel: "Puck" },
  ]

  it("3.1: each line picks from the model's own voices; the ElevenLabs settings are gone; one direction block per speaker", async () => {
    useWorkflowStore.setState({
      nodes: [dialogueNode("A", { provider: "gemini-3-1-flash-tts", dialogue: twoSpeakers, stability: 0.5, languageCode: "en" })],
      edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false,
    } as never)
    mountPanel()
    await tick()

    expect(screen.queryByTestId("voice-browser")).toBeNull()
    expect(screen.getAllByTestId("tts-named-voice").map((el) => el.textContent)).toEqual(["Kore", "Puck"])
    expect(screen.queryByRole("combobox", { name: "Stability" })).toBeNull()
    expect(screen.queryByLabelText(/Stability/)).toBeNull()
    expect(screen.queryByRole("combobox", { name: "Language" })).toBeNull()
    expect(screen.queryByLabelText("Seed")).toBeNull()
    expect(screen.queryByRole("combobox", { name: "Text normalization" })).toBeNull()
    const speakers = screen.getByTestId("dialogue-speakers")
    expect(within(speakers).getByText("Speaker: Kore")).toBeTruthy()
    expect(within(speakers).getByText("Speaker: Puck")).toBeTruthy()
    expect(screen.queryAllByTestId("dialogue-line-style")).toHaveLength(0)
    expect(screen.queryByTestId("dialogue-filler-words")).toBeNull()
    expect(screen.getByText("2/2 voices")).toBeTruthy()
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it("3.8: a style per line, and filler words with exactly two speakers, written by the person's edits", async () => {
    useWorkflowStore.setState({
      nodes: [dialogueNode("A", { provider: "gemini-3-8-flash-tts", dialogue: twoSpeakers })],
      edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false,
    } as never)
    mountPanel()
    await tick()

    expect(screen.queryByTestId("dialogue-speakers")).toBeNull()
    const user = userEvent.setup()
    await user.type(screen.getByRole("textbox", { name: "Speaking style of line 1" }), "Warm")
    await tick()
    expect((dataOf("A").dialogue as Array<Record<string, unknown>>)[0]!.styleDirection).toBe("Warm")

    await user.click(within(screen.getByTestId("dialogue-filler-words")).getByRole("switch"))
    await tick()
    expect(dataOf("A").fillerWords).toBe(true)
  })

  it("3.8 with one speaker offers no filler words; three voices say the model speaks at most two", async () => {
    useWorkflowStore.setState({
      nodes: [
        dialogueNode("A", { provider: "gemini-3-8-flash-tts", dialogue: [{ id: "1", text: "Hi", voice: "Kore" }] }),
        dialogueNode("B", { provider: "gemini-3-8-flash-tts", dialogue: [...twoSpeakers, { id: "3", text: "Yo", voice: "Fola" }] }),
      ],
      edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false,
    } as never)
    mountPanel()
    await tick()
    expect(screen.queryByTestId("dialogue-filler-words")).toBeNull()
    expect(screen.queryByTestId("dialogue-speaker-limit")).toBeNull()

    await select("B")
    await tick()
    expect(screen.getByTestId("dialogue-speaker-limit").textContent).toMatch(/at most 2 voices/)
    expect(screen.getByText("3/2 voices")).toBeTruthy()
  })

  it("a Gemini node whose lines still name ElevenLabs voices shows the voices it runs with, and selecting it rewrites nothing", async () => {
    useWorkflowStore.setState({
      nodes: [dialogueNode("A"), dialogueNode("B", { provider: "gemini-3-1-flash-tts", dialogue: [{ id: "1", text: "Hi", voice: "Sarah" }, { id: "2", text: "Yo", voice: "Rachel" }] })],
      edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false,
    } as never)
    mountPanel()
    await tick()
    useWorkflowStore.setState({ isDirty: false } as never)

    await select("B")
    await tick()

    expect(screen.getAllByTestId("tts-named-voice").map((el) => el.textContent)).toEqual(["Kore", "Achernar"])
    expect((dataOf("B").dialogue as Array<Record<string, unknown>>).map((l) => l.voice)).toEqual(["Sarah", "Rachel"])
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it("v3 → Gemini 3.1 from the dropdown: the voices move onto the model's own (two stay two) and the language resets", async () => {
    useWorkflowStore.setState({
      nodes: [dialogueNode("A", { provider: "elevenlabs-dialogue", languageCode: "en", dialogue: [{ id: "1", text: "Hi", voice: "Sarah" }, { id: "2", text: "Yo", voice: "Rachel" }] })],
      edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false,
    } as never)
    mountPanel()
    await tick()

    const user = userEvent.setup()
    await user.click(screen.getByRole("combobox", { name: "Model" }))
    await user.click(await within(await screen.findByRole("listbox")).findByRole("option", { name: /^Gemini 3\.1 Flash TTS/ }))
    await tick()

    const data = dataOf("A")
    expect(data.provider).toBe("gemini-3-1-flash-tts")
    expect(data.languageCode).toBe("")
    expect(data.dialogue).toEqual([
      { id: "1", text: "Hi", voice: "Kore", voiceLabel: "Kore" },
      { id: "2", text: "Yo", voice: "Achernar", voiceLabel: "Achernar" },
    ])
  })

  it("Add line on a Gemini model gives the new line the other speaker's voice", async () => {
    useWorkflowStore.setState({
      nodes: [dialogueNode("A", { provider: "gemini-3-1-flash-tts", dialogue: twoSpeakers })],
      edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false,
    } as never)
    mountPanel()
    await tick()
    await userEvent.setup().click(screen.getByRole("button", { name: /Add Line/ }))
    await tick()
    expect((dataOf("A").dialogue as Array<Record<string, unknown>>).map((l) => l.voice)).toEqual(["Kore", "Puck", "Kore"])
  })
})

describe("text-to-dialogue panel — the file format (decided 2026-11-13)", () => {
  const lines = [{ id: "1", text: "Hi", voice: "Kore", voiceLabel: "Kore" }]

  it("a Gemini model offers the three files, shows MP3 128 kbps for a node with none, and selecting the node writes nothing", async () => {
    useWorkflowStore.setState({
      nodes: [dialogueNode("A"), dialogueNode("B", { provider: "gemini-3-8-flash-tts", dialogue: lines })],
      edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false,
    } as never)
    mountPanel()
    await tick()
    expect(screen.queryByTestId("dialogue-file-format")).toBeNull()
    useWorkflowStore.setState({ isDirty: false } as never)

    await select("B")
    await tick()
    const file = screen.getByRole("combobox", { name: "File" })
    expect(file.textContent).toBe("MP3, 128 kbps")
    expect(dataOf("B").outputFormat).toBeUndefined()
    expect(useWorkflowStore.getState().isDirty).toBe(false)

    const user = userEvent.setup()
    await user.click(file)
    const options = within(await screen.findByRole("listbox")).getAllByRole("option").map((o) => o.textContent)
    expect(options).toEqual(["MP3, 128 kbps", "MP3, 192 kbps", "WAV, 24 kHz"])
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "WAV, 24 kHz" }))
    await tick()
    expect(dataOf("B").outputFormat).toBe("wav_24000")

    await user.click(screen.getByRole("combobox", { name: "File" }))
    await user.click(within(await screen.findByRole("listbox")).getByRole("option", { name: "MP3, 128 kbps" }))
    await tick()
    expect(dataOf("B").outputFormat).toBeUndefined()
  })

  it("v4 dialogue (one file only) draws no file choice", async () => {
    useWorkflowStore.setState({
      nodes: [dialogueNode("A", { provider: "elevenlabs-dialogue-v4" })],
      edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false,
    } as never)
    mountPanel()
    await tick()
    expect(screen.queryByTestId("dialogue-file-format")).toBeNull()
  })
})
