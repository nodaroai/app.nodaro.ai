// @test-units-by-name reads only the text-to-speech and text-to-dialogue definitions it names
/**
 * A one-off clone of a person's voice in the speech panels (Gemini 3.8 Flash,
 * decided 2026-11-13): the recordings are ordinary library uploads, the
 * consent box clears whenever a recording changes, and a dialogue's clones are
 * speakers its lines speak with. The REAL panels against the real workflow
 * store — the harness of config-panel-dialogue-model-switch.test.tsx — with the
 * upload call stood in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
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

vi.mock("@/components/editor/config-panels/voice-browser", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  VoiceBrowser: () => <button type="button" data-testid="voice-browser">voice</button>,
}))

const uploadAudio = vi.fn()
const voiceCloneConsentApi = vi.fn()
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  uploadAudio: (...args: unknown[]) => uploadAudio(...args),
  voiceCloneConsentApi: (...args: unknown[]) => voiceCloneConsentApi(...args),
}))

// The signed-in viewer: the consent box is theirs only for a record issued to them.
vi.mock("@/hooks/use-auth", async (importOriginal) => {
  const actual = await importOriginal<{ useAuth: () => Record<string, unknown> }>()
  return { ...actual, useAuth: () => ({ ...actual.useAuth(), user: { id: "u1" } }) }
})

import { ConfigPanel } from "@/components/editor/config-panel"
import { __resetSurfaceAvailabilityForTests } from "@/lib/surface-availability"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { NODE_DEFINITIONS } from "@/types/nodes"

const ttsDefaults = NODE_DEFINITIONS.find((d) => d.type === "text-to-speech")!.defaultData as Record<string, unknown>
const dialogueDefaults = NODE_DEFINITIONS.find((d) => d.type === "text-to-dialogue")!.defaultData as Record<string, unknown>
const FLASH = "gemini-3-8-flash-tts"
const replica = { sourceAudioUrl: "https://cdn.example/me.wav", consentAudioUrl: "https://cdn.example/consent.wav" }
/** What the consent route answers for the viewer (`u1`). */
const OWN = { userId: "u1", signature: "sig-u1" }

function ttsNode(id: string, data: Record<string, unknown> = {}) {
  return { id, type: "text-to-speech", position: { x: 0, y: 0 }, data: { ...ttsDefaults, label: `TTS ${id}`, ...data } } as never
}
function dialogueNode(id: string, data: Record<string, unknown> = {}) {
  return { id, type: "text-to-dialogue", position: { x: 0, y: 0 }, data: { ...dialogueDefaults, label: `Dialogue ${id}`, ...data } } as never
}

const dataOf = (id: string) => useWorkflowStore.getState().nodes.find((n) => n.id === id)!.data as Record<string, unknown>
const tick = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const wav = (name = "me.wav") => new File(["RIFF"], name, { type: "audio/wav" })

function mount(nodes: unknown[]) {
  useWorkflowStore.setState({ nodes, edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false } as never)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ConfigPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function upload(scope: HTMLElement, testId: "clone-reference" | "clone-consent", url: string) {
  uploadAudio.mockResolvedValueOnce({ url })
  const input = within(within(scope).getByTestId(testId)).getByLabelText(testId === "clone-reference" ? "Reference recording" : "Consent recording", { selector: "input" })
  await act(async () => { fireEvent.change(input, { target: { files: [wav()] } }) })
  await tick()
}

beforeEach(() => {
  uploadAudio.mockReset()
  voiceCloneConsentApi.mockReset()
  voiceCloneConsentApi.mockResolvedValue(OWN)
  globalThis.fetch = vi.fn(() => Promise.resolve(new Response("{}", { status: 404 }))) as never
  const g = globalThis as Record<string, unknown>
  if (typeof window.matchMedia !== "function") {
    ;(window as unknown as Record<string, unknown>).matchMedia = (q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })
  }
  if (typeof g.ResizeObserver !== "function") g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  if (typeof g.IntersectionObserver !== "function") g.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
})

afterEach(() => {
  cleanup()
  __resetSurfaceAvailabilityForTests(null)
})

describe("Text to Speech — your own voice", () => {
  it("is offered only on a model that clones, off by default, and selecting the node writes nothing", async () => {
    mount([ttsNode("A", { provider: "gemini-3-8-flash-lite-tts", voiceId: "Kore" })])
    await tick()
    expect(screen.queryByTestId("tts-clone")).toBeNull()
    cleanup()

    mount([ttsNode("A", { provider: FLASH, voiceId: "Kore" })])
    await tick()
    const section = screen.getByTestId("tts-clone")
    expect(within(section).getByRole("switch", { name: "Your own voice (a one-off clone)" }).getAttribute("aria-checked")).toBe("false")
    expect(within(section).queryByTestId("clone-reference")).toBeNull()
    expect(dataOf("A").replica).toBeUndefined()
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it("on: the voice list gives way to the clone; uploads write the links; the box waits for both and clears when one changes; off clears all", async () => {
    mount([ttsNode("A", { provider: FLASH, voiceId: "Kore" })])
    await tick()
    const user = userEvent.setup()
    await user.click(within(screen.getByTestId("tts-clone")).getByRole("switch"))
    await tick()
    expect(dataOf("A").replica).toEqual({ sourceAudioUrl: "", consentAudioUrl: "" })
    expect(screen.queryByTestId("tts-named-voice")).toBeNull()
    expect(screen.getByTestId("tts-clone-speaks")).toBeTruthy()

    const section = screen.getByTestId("tts-clone")
    const box = within(section).getByRole("checkbox")
    expect(box.hasAttribute("disabled") || box.getAttribute("data-disabled") !== null).toBe(true)

    await upload(section, "clone-reference", replica.sourceAudioUrl)
    expect(uploadAudio).toHaveBeenCalledTimes(1)
    await upload(section, "clone-consent", replica.consentAudioUrl)
    expect(dataOf("A").replica).toEqual(replica)

    await user.click(within(section).getByRole("checkbox"))
    await tick()
    // The tick asks the server for the viewer's record over exactly these two links, and stores it.
    expect(voiceCloneConsentApi).toHaveBeenCalledWith(replica)
    expect(dataOf("A").replicaConsent).toEqual(OWN)
    expect(within(section).getByRole("checkbox").getAttribute("aria-checked")).toBe("true")

    await upload(section, "clone-reference", "https://cdn.example/again.wav")
    expect(dataOf("A").replica).toEqual({ ...replica, sourceAudioUrl: "https://cdn.example/again.wav" })
    expect(dataOf("A").replicaConsent).toBeUndefined()

    await user.click(within(section).getByRole("checkbox"))
    await tick()
    await user.click(within(section).getByRole("button", { name: "Remove the consent recording" }))
    await tick()
    expect((dataOf("A").replica as Record<string, string>).consentAudioUrl).toBe("")
    expect(dataOf("A").replicaConsent).toBeUndefined()

    await user.click(within(section).getByRole("switch"))
    await tick()
    expect(dataOf("A").replica).toBeUndefined()
    expect(dataOf("A").replicaConsent).toBeUndefined()
    expect(screen.getByTestId("tts-named-voice")).toBeTruthy()
  })

  it("a file that is not a WAV is not uploaded", async () => {
    mount([ttsNode("A", { provider: FLASH, voiceId: "Kore", replica: { sourceAudioUrl: "", consentAudioUrl: "" } })])
    await tick()
    const input = within(screen.getByTestId("clone-reference")).getByLabelText("Reference recording", { selector: "input" })
    await act(async () => { fireEvent.change(input, { target: { files: [new File(["x"], "me.mp3", { type: "audio/mpeg" })] } }) })
    await tick()
    expect(uploadAudio).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toBe("Choose a WAV file.")
  })

  it("shows the sentence to read, in English with no second copy", async () => {
    mount([ttsNode("A", { provider: FLASH, voiceId: "Kore", replica: { sourceAudioUrl: "", consentAudioUrl: "" } })])
    await tick()
    expect(screen.getByTestId("clone-sentence").textContent).toBe("I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model.")
    expect(screen.queryByTestId("clone-sentence-english")).toBeNull()
  })
})

describe("Text to Speech — the consent is the viewer's own (decided 2026-11-13)", () => {
  it("a consent someone else ticked (a template's or a copy's) shows unticked for the viewer", async () => {
    mount([ttsNode("A", { provider: FLASH, voiceId: "Kore", replica, replicaConsent: { userId: "someone-else", signature: "sig" } })])
    await tick()
    expect(within(screen.getByTestId("tts-clone")).getByRole("checkbox").getAttribute("aria-checked")).toBe("false")
  })

  it("a refused consent leaves the box unticked and stores nothing", async () => {
    voiceCloneConsentApi.mockRejectedValueOnce(new Error("refused"))
    mount([ttsNode("A", { provider: FLASH, voiceId: "Kore", replica })])
    await tick()
    const box = within(screen.getByTestId("tts-clone")).getByRole("checkbox")
    await userEvent.setup().click(box)
    await tick()
    expect(voiceCloneConsentApi).toHaveBeenCalledTimes(1)
    expect(dataOf("A").replicaConsent).toBeUndefined()
    expect(within(screen.getByTestId("tts-clone")).getByRole("checkbox").getAttribute("aria-checked")).toBe("false")
  })
})

describe("one-off clones withheld by the deployment (decided 2026-11-13)", () => {
  it("Text to Speech: no clone section; a node already holding a clone says so and can take it off", async () => {
    __resetSurfaceAvailabilityForTests({ nodes: ["voice-clone-one-off"], models: [] })
    mount([ttsNode("A", { provider: FLASH, voiceId: "Kore" })])
    await tick()
    expect(screen.queryByTestId("tts-clone")).toBeNull()
    expect(screen.queryByTestId("clone-unavailable")).toBeNull()
    cleanup()

    mount([ttsNode("A", { provider: FLASH, voiceId: "Kore", replica, replicaConsent: OWN })])
    await tick()
    expect(screen.queryByTestId("tts-clone")).toBeNull()
    expect(screen.getByTestId("clone-unavailable").textContent).toMatch(/isn't available on this deployment/)
    // The voice list stays: the clone will not speak here.
    expect(screen.getByTestId("tts-named-voice")).toBeTruthy()
    await userEvent.setup().click(within(screen.getByTestId("clone-unavailable")).getByRole("button", { name: "Remove" }))
    await tick()
    expect(dataOf("A").replica).toBeUndefined()
    expect(dataOf("A").replicaConsent).toBeUndefined()
  })

  it("Text to Dialogue: no cloned voices block; a node holding clones says so, and taking them off moves their lines", async () => {
    __resetSurfaceAvailabilityForTests({ nodes: ["voice-clone-one-off"], models: [] })
    mount([dialogueNode("A", { provider: FLASH, dialogue: [{ id: "1", text: "Hi", voice: "Kore" }] })])
    await tick()
    expect(screen.queryByTestId("dialogue-clones")).toBeNull()
    cleanup()

    mount([dialogueNode("A", { provider: FLASH, dialogue: [{ id: "1", text: "Hi", voice: "Me" }, { id: "2", text: "Yo", voice: "Kore" }], speakers: [{ voice: "Me", replica, replicaConsent: OWN }] })])
    await tick()
    expect(screen.queryByTestId("dialogue-clones")).toBeNull()
    await userEvent.setup().click(within(screen.getByTestId("clone-unavailable")).getByRole("button", { name: "Remove" }))
    await tick()
    expect(dataOf("A").speakers).toBeUndefined()
    expect((dataOf("A").dialogue as Array<Record<string, unknown>>).map((l) => l.voice)).toEqual(["Fola", "Kore"])
  })

  it("a profile that denies the Voice Clone node withholds clones before the availability answer lands", async () => {
    const w = window as unknown as { __NODARO_RUNTIME__?: unknown }
    const before = w.__NODARO_RUNTIME__
    w.__NODARO_RUNTIME__ = { surface: { nodes: { deny: ["voice-clone"] } } }
    try {
      mount([ttsNode("A", { provider: FLASH, voiceId: "Kore" })])
      await tick()
      expect(screen.queryByTestId("tts-clone")).toBeNull()
    } finally {
      w.__NODARO_RUNTIME__ = before
    }
  })
})

describe("Text to Dialogue — cloned voices on 3.8 Flash", () => {
  const lines = [{ id: "1", text: "Hi", voice: "Kore", voiceLabel: "Kore" }, { id: "2", text: "Hello", voice: "Kore", voiceLabel: "Kore" }]

  it("is offered only on a model that clones", async () => {
    mount([dialogueNode("A", { provider: "gemini-3-8-flash-lite-tts", dialogue: lines })])
    await tick()
    expect(screen.queryByTestId("dialogue-clones")).toBeNull()
  })

  it("add a clone, give a line its voice, edit another line: the first keeps the clone; rename and remove rewrite the lines", async () => {
    mount([dialogueNode("A", { provider: FLASH, dialogue: lines })])
    await tick()
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: /Add a cloned voice/ }))
    await tick()
    expect(dataOf("A").speakers).toEqual([{ voice: "Cloned voice 1", replica: { sourceAudioUrl: "", consentAudioUrl: "" } }])

    // Line 1's picker offers the clone beside the model's voices.
    await user.click(screen.getAllByTestId("tts-named-voice")[0]!)
    await user.click(await within(await screen.findByRole("listbox")).findByRole("option", { name: "Cloned voice 1" }))
    await tick()
    expect((dataOf("A").dialogue as Array<Record<string, unknown>>)[0]!.voice).toBe("Cloned voice 1")

    // An edit anywhere never moves a line off a clone still waiting for its recordings.
    await user.type(screen.getByPlaceholderText(/Line 2/), "!")
    await tick()
    expect((dataOf("A").dialogue as Array<Record<string, unknown>>).map((l) => l.voice)).toEqual(["Cloned voice 1", "Kore"])

    const clone = screen.getByTestId("dialogue-clone")
    const name = within(clone).getByRole("textbox", { name: "Name" })
    await user.clear(name)
    await tick()
    expect(within(clone).getByRole("alert").textContent).toBe("Give this voice a name.")
    await user.type(name, "Ana")
    await tick()
    expect((dataOf("A").dialogue as Array<Record<string, unknown>>)[0]!.voice).toBe("Ana")
    expect((dataOf("A").speakers as Array<Record<string, unknown>>)[0]!.voice).toBe("Ana")

    await upload(clone, "clone-reference", replica.sourceAudioUrl)
    await upload(clone, "clone-consent", replica.consentAudioUrl)
    await user.click(within(clone).getByRole("checkbox"))
    await tick()
    expect(dataOf("A").speakers).toEqual([{ voice: "Ana", replica, replicaConsent: OWN }])

    await user.click(within(clone).getByRole("button", { name: "Remove this cloned voice" }))
    await tick()
    expect(dataOf("A").speakers).toBeUndefined()
    const voices = (dataOf("A").dialogue as Array<Record<string, unknown>>).map((l) => l.voice)
    expect(voices[0]).not.toBe("Ana")
    expect(voices[1]).toBe("Kore")
  })

  it("a name another voice has is refused and not written", async () => {
    mount([dialogueNode("A", { provider: FLASH, dialogue: lines, speakers: [{ voice: "Me", replica }] })])
    await tick()
    const user = userEvent.setup()
    const name = within(screen.getByTestId("dialogue-clone")).getByRole("textbox", { name: "Name" })
    await user.clear(name)
    await user.type(name, "Kore")
    await tick()
    expect(within(screen.getByTestId("dialogue-clone")).getByRole("alert").textContent).toBe("Another voice already has this name.")
    expect((dataOf("A").speakers as Array<Record<string, unknown>>)[0]!.voice).not.toBe("Kore")
  })

  it("no more clones than the model's speakers", async () => {
    mount([dialogueNode("A", { provider: FLASH, dialogue: lines, speakers: [{ voice: "Me", replica }, { voice: "You", replica }] })])
    await tick()
    expect((screen.getByRole("button", { name: /Add a cloned voice/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})
