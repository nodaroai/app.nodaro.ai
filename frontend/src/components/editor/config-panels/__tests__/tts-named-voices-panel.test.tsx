// @test-units-by-name looks up only the text-to-speech definition (NODE_DEFINITIONS)
/**
 * The Text to Speech panel on a model that speaks only its own named voices and
 * takes a style direction (Gemini; `TtsCapabilities.voices` / `.direction`):
 * the voice list in place of the ElevenLabs browser, no language picker, the
 * style direction drawn from the sheet — and, as everywhere on this panel,
 * nothing written unless the user acts (one panel instance is reused across
 * nodes). Renders the REAL panel against the real workflow store.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { GEMINI_3_1_DEFAULT_VOICE, GEMINI_3_8_DEFAULT_VOICE } from "@nodaro/shared/models"

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

// The ElevenLabs voice browser fetches its catalogue; a marker stands in for it, so a test can see which voice field shows.
vi.mock("@/components/editor/config-panels/voice-browser", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  VoiceBrowser: () => <span data-testid="elevenlabs-voice-browser" />,
}))

import { ConfigPanel } from "@/components/editor/config-panel"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { NODE_DEFINITIONS } from "@/types/nodes"

const LITE_38 = "gemini-3-8-flash-lite-tts"
const FLASH_31 = "gemini-3-1-flash-tts"
const defaults = NODE_DEFINITIONS.find((d) => d.type === "text-to-speech")!.defaultData as Record<string, unknown>

function ttsNode(id: string, data: Record<string, unknown> = {}) {
  return { id, type: "text-to-speech", position: { x: 0, y: 0 }, data: { ...defaults, label: `TTS ${id}`, ...data } } as never
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

async function open(trigger: HTMLElement) {
  await userEvent.setup().click(trigger)
  return within(await screen.findByRole("listbox"))
}

async function pick(trigger: HTMLElement, option: string | RegExp) {
  const list = await open(trigger)
  await userEvent.setup().click(await list.findByRole("option", { name: option }))
  await tick()
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

describe("text-to-speech panel — a model with named voices", () => {
  it("3.8: its voice list in place of the browser, showing its default for a voice it does not speak; no language picker; a free-text style", async () => {
    useWorkflowStore.setState({ nodes: [ttsNode("A", { provider: LITE_38, voiceId: "Rachel" })], edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false } as never)
    mountPanel()
    await tick()

    expect(screen.queryByTestId("elevenlabs-voice-browser")).toBeNull()
    const voice = screen.getByTestId("tts-named-voice")
    expect(voice.textContent).toBe(GEMINI_3_8_DEFAULT_VOICE)
    expect(screen.queryByRole("combobox", { name: "Language" })).toBeNull()
    expect(screen.getByTestId("tts-direction")).toBeTruthy()
    expect(screen.getByRole("textbox", { name: "Speaking style" })).toBeTruthy()
    expect(screen.queryByRole("combobox", { name: "Pace" })).toBeNull()
    // Showing the default wrote nothing.
    expect(dataOf("A").voiceId).toBe("Rachel")
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it("3.8's voices sit under their groups' headers, and a pick writes the voice as a premade one", async () => {
    useWorkflowStore.setState({ nodes: [ttsNode("A", { provider: LITE_38 })], edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false } as never)
    mountPanel()
    await tick()

    const list = await open(screen.getByTestId("tts-named-voice"))
    expect(list.getByText("Tutor")).toBeTruthy()
    expect(list.getByText("Commercial Voiceover")).toBeTruthy()
    await userEvent.setup().click(list.getByRole("option", { name: "Bodi" }))
    await tick()

    expect(dataOf("A")).toMatchObject({ voiceId: "Bodi", voiceType: "premade", voiceDisplayName: "Bodi", voiceLabel: "Bodi" })
  })

  it("3.8's character counter reads the text as the model takes it: its tags rewritten, as a run measures it (decided 2026-11-13)", async () => {
    // 1,250 × " [pause]" is 10,000 characters as typed, and 17,499 once each tag is 3.8's <short pause> (leading space trimmed).
    useWorkflowStore.setState({ nodes: [ttsNode("A", { provider: LITE_38, textSource: "direct", directText: " [pause]".repeat(1250) })], edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false } as never)
    mountPanel()
    await tick()
    expect(screen.getByText("17499/10000")).toBeTruthy()
  })

  it("on 3.1, which keeps its [square] tags, the counter is the text as typed", async () => {
    useWorkflowStore.setState({ nodes: [ttsNode("A", { provider: FLASH_31, textSource: "direct", directText: "Hi [pause] there" })], edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false } as never)
    mountPanel()
    await tick()
    expect(screen.getByText("16/10000")).toBeTruthy()
  })

  it("typing a style writes it", async () => {
    useWorkflowStore.setState({ nodes: [ttsNode("A", { provider: LITE_38 })], edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false } as never)
    mountPanel()
    await tick()

    await userEvent.setup().type(screen.getByRole("textbox", { name: "Speaking style" }), "Warm")
    expect(dataOf("A").styleDirection).toBe("Warm")
  })

  it("3.1: a flat list, its styles, paces and accents as choices with a default, and an audio profile", async () => {
    useWorkflowStore.setState({ nodes: [ttsNode("A", { provider: FLASH_31, pace: "Rapid Fire" })], edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false } as never)
    mountPanel()
    await tick()

    expect(screen.getByTestId("tts-named-voice").textContent).toBe(GEMINI_3_1_DEFAULT_VOICE)
    const voices = await open(screen.getByTestId("tts-named-voice"))
    expect(voices.queryByText("Tutor")).toBeNull()
    await userEvent.setup().keyboard("{Escape}")
    await tick()

    expect(screen.getByRole("combobox", { name: "Speaking style" }).textContent).toBe("Default")
    expect(screen.getByRole("combobox", { name: "Accent" })).toBeTruthy()
    expect(screen.getByRole("textbox", { name: "Audio profile" })).toBeTruthy()

    const pace = screen.getByRole("combobox", { name: "Pace" })
    expect(pace.textContent).toBe("Rapid Fire")
    await pick(pace, "Default")
    expect(dataOf("A").pace).toBeUndefined()

    await pick(screen.getByRole("combobox", { name: "Speaking style" }), "Newscaster")
    expect(dataOf("A").styleDirection).toBe("Newscaster")
  })

  it("a stored value the model does not take reads as Default, and selecting the node rewrites nothing", async () => {
    useWorkflowStore.setState({
      nodes: [ttsNode("A", { provider: LITE_38, voiceId: "Rachel", pace: "Natural" }), ttsNode("B", { provider: FLASH_31, voiceId: "Bodi", styleDirection: "Warm and slow." })],
      edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false,
    } as never)
    mountPanel()
    await tick()
    useWorkflowStore.setState({ isDirty: false } as never)

    await select("B")
    await tick()

    expect(screen.getByTestId("tts-named-voice").textContent).toBe(GEMINI_3_1_DEFAULT_VOICE)
    expect(screen.getByRole("combobox", { name: "Speaking style" }).textContent).toBe("Default")
    expect(dataOf("A")).toMatchObject({ voiceId: "Rachel", pace: "Natural" })
    expect(dataOf("B")).toMatchObject({ voiceId: "Bodi", styleDirection: "Warm and slow." })
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it("an ElevenLabs node keeps its browser and its language picker, and shows no style direction", async () => {
    useWorkflowStore.setState({ nodes: [ttsNode("A")], edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false } as never)
    mountPanel()
    await tick()

    expect(screen.getByTestId("elevenlabs-voice-browser")).toBeTruthy()
    expect(screen.queryByTestId("tts-named-voice")).toBeNull()
    expect(screen.getByRole("combobox", { name: "Language" })).toBeTruthy()
    expect(screen.queryByTestId("tts-direction")).toBeNull()
  })
})

describe("text-to-speech panel — switching to and from a model with named voices", () => {
  it("a fresh node to 3.8: the voice snaps to its default, the levers go, the language picker goes; back to v4: the browser and no voice", async () => {
    useWorkflowStore.setState({ nodes: [ttsNode("A")], edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false } as never)
    mountPanel()
    await tick()

    await pick(screen.getByRole("combobox", { name: "Model" }), /^Gemini 3\.8 Flash-Lite TTS/)
    let data = dataOf("A")
    expect(data).toMatchObject({ provider: LITE_38, voiceId: GEMINI_3_8_DEFAULT_VOICE, voiceType: "premade", voiceDisplayName: GEMINI_3_8_DEFAULT_VOICE })
    expect(data.similarityBoost).toBeUndefined()
    expect(data.speed).toBeUndefined()
    expect(screen.getByTestId("tts-named-voice").textContent).toBe(GEMINI_3_8_DEFAULT_VOICE)
    expect(screen.queryByRole("combobox", { name: "Language" })).toBeNull()

    await userEvent.setup().type(screen.getByRole("textbox", { name: "Speaking style" }), "Calm")
    await pick(screen.getByRole("combobox", { name: "Model" }), /^ElevenLabs v4 Turbo/)
    data = dataOf("A")
    expect(data.provider).toBe("elevenlabs-v4-turbo")
    expect(data.voiceId).toBe("")
    expect(data.voiceDisplayName).toBeUndefined()
    expect(data.voiceLabel).toBeUndefined()
    expect(data.styleDirection).toBeUndefined()
    expect(screen.getByTestId("elevenlabs-voice-browser")).toBeTruthy()
    expect(screen.queryByTestId("tts-direction")).toBeNull()
  })
})

describe("text-to-speech panel — the file (decided 2026-11-13)", () => {
  it("every model offers MP3 128 / 192 and WAV: the default shows for a node with none, a pick writes it, the default clears it", async () => {
    for (const provider of [FLASH_31, "elevenlabs-v4"]) {
      cleanup()
      useWorkflowStore.setState({ nodes: [ttsNode("A", { provider })], edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false } as never)
      mountPanel()
      await tick()
      const trigger = within(screen.getByTestId("tts-file-format")).getByRole("combobox")
      expect(trigger.textContent).toBe("MP3, 128 kbps")
      // Showing the default wrote nothing.
      expect(dataOf("A").outputFormat).toBeUndefined()
      expect(useWorkflowStore.getState().isDirty).toBe(false)
      const list = await open(trigger)
      expect(list.getAllByRole("option").map((o) => o.textContent)).toEqual(["MP3, 128 kbps", "MP3, 192 kbps", "WAV, 24 kHz"])
      await userEvent.setup().click(list.getByRole("option", { name: "WAV, 24 kHz" }))
      await tick()
      expect(dataOf("A").outputFormat).toBe("wav_24000")
      await pick(within(screen.getByTestId("tts-file-format")).getByRole("combobox"), "MP3, 128 kbps")
      expect(dataOf("A").outputFormat).toBeUndefined()
    }
  })
})

