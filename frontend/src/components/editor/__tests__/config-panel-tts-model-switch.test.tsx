/**
 * The Text to Speech panel clears what a model does not honour ONLY when the user
 * switches the model — never because the panel moved to another node.
 *
 * ConfigPanel keeps ONE TextToSpeechConfig instance mounted while the selection
 * moves between text-to-speech nodes (and through a deselect), so anything keyed to
 * "the provider changed" would rewrite the node the user merely clicked: strip the
 * sliders a default v3 node carries (speed 1, style 0, similarityBoost 0.75) and mark the
 * workflow unsaved. These tests render the REAL panel against the real workflow store.
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

// The Voice Library browser fetches its catalogue and lives in a dialog; stand it
// in with one button that makes the pick the real browser hands the panel for a
// library voice verified only on v3 (so a turbo node snaps to v3).
vi.mock("@/components/editor/config-panels/voice-browser", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  VoiceBrowser: ({ onSelect }: { onSelect: (...args: unknown[]) => void }) => (
    <button
      type="button"
      data-testid="pick-library-voice"
      onClick={() => onSelect("lib-voice-1", "Library Voice", "library", { recommendedProvider: "elevenlabs-v3", verifiedProviders: ["elevenlabs-v3"] })}
    >
      library voice
    </button>
  ),
}))

import { ConfigPanel } from "@/components/editor/config-panel"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { NODE_DEFINITIONS } from "@/types/nodes"

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

describe("text-to-speech panel — selecting another node rewrites nothing", () => {
  it("a turbo node, then a default v3 node: the v3 node keeps the settings it carries and the workflow stays clean", async () => {
    useWorkflowStore.setState({ nodes: [ttsNode("A", { provider: "elevenlabs-turbo" }), ttsNode("B")], edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false } as never)
    mountPanel()
    await tick()
    const before = { similarityBoost: dataOf("B").similarityBoost, style: dataOf("B").style, speed: dataOf("B").speed }
    expect(before).toStrictEqual({ similarityBoost: 0.75, style: 0, speed: 1 }) // what a default node stores
    useWorkflowStore.setState({ isDirty: false } as never)

    await select("B")
    await tick()

    expect({ similarityBoost: dataOf("B").similarityBoost, style: dataOf("B").style, speed: dataOf("B").speed }).toStrictEqual(before)
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it("the same through a deselect", async () => {
    useWorkflowStore.setState({ nodes: [ttsNode("A", { provider: "elevenlabs-turbo" }), ttsNode("B")], edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false } as never)
    mountPanel()
    await tick()
    await select(null)
    await tick()
    useWorkflowStore.setState({ isDirty: false } as never)

    await select("B")
    await tick()

    expect(dataOf("B").similarityBoost).toBe(0.75)
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it("a node whose language its model does not offer keeps it when it is merely selected", async () => {
    useWorkflowStore.setState({ nodes: [ttsNode("A"), ttsNode("B", { provider: "elevenlabs-turbo", languageCode: "he" })], edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false } as never)
    mountPanel()
    await tick()
    useWorkflowStore.setState({ isDirty: false } as never)

    await select("B")
    await tick()

    expect(dataOf("B").languageCode).toBe("he")
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })
})

describe("text-to-speech panel — a model the user picks", () => {
  async function pickModel(label: RegExp) {
    const user = userEvent.setup()
    await user.click(screen.getByRole("combobox", { name: "Model" }))
    await user.click(await within(await screen.findByRole("listbox")).findByRole("option", { name: label }))
    await tick()
  }

  it("clears the settings the new model ignores and keeps the rest", async () => {
    useWorkflowStore.setState({
      nodes: [ttsNode("A", { provider: "elevenlabs-turbo", stability: 0.4, similarityBoost: 0.8, style: 0.3, speed: 1.15, languageCode: "es" })],
      edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false,
    } as never)
    mountPanel()
    await tick()

    await pickModel(/^ElevenLabs v3/)

    const data = dataOf("A")
    expect(data.provider).toBe("elevenlabs-v3")
    expect(data.similarityBoost).toBeUndefined()
    expect(data.style).toBeUndefined()
    expect(data.speed).toBeUndefined()
    expect(data.stability).toBe(0.4)
    expect(data.languageCode).toBe("es")
  })

  it("resets a language the new model is not offered in", async () => {
    useWorkflowStore.setState({
      nodes: [ttsNode("A", { provider: "elevenlabs-v3", languageCode: "he" })],
      edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false,
    } as never)
    mountPanel()
    await tick()

    await pickModel(/^ElevenLabs Turbo/)

    expect(dataOf("A").provider).toBe("elevenlabs-turbo")
    expect(dataOf("A").languageCode).toBe("")
  })
})

describe("text-to-speech panel — a Voice Library pick that snaps the model", () => {
  it("a library voice not verified on turbo snaps the node to its recommended model and clears what that model ignores", async () => {
    useWorkflowStore.setState({
      nodes: [ttsNode("A", { provider: "elevenlabs-turbo", stability: 0.4, similarityBoost: 0.8, style: 0.3, speed: 1.15, languageCode: "es" })],
      edges: [], selectedNodeId: "A", isDirty: false, isReadOnly: false,
    } as never)
    mountPanel()
    await tick()

    await userEvent.setup().click(screen.getByTestId("pick-library-voice"))
    await tick()

    const data = dataOf("A")
    expect(data.voiceId).toBe("lib-voice-1")
    expect(data.voiceType).toBe("library")
    expect(data.provider).toBe("elevenlabs-v3")
    expect(data.similarityBoost).toBeUndefined()
    expect(data.style).toBeUndefined()
    expect(data.speed).toBeUndefined()
    expect(data.stability).toBe(0.4)
    expect(data.languageCode).toBe("es")
  })
})
