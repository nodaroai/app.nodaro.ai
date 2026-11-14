/**
 * A published app that clones a voice (decided 2026-11-13: recordings as app
 * inputs). The app ships its clone emptied, so the REAL app runner
 * (PresentationView, full screen) shows a "Your voice" card for it whatever the
 * author curated, holds Run until the runner's own recordings and tick are in,
 * and the run's `inputOverrides` carry what the card wrote.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

vi.mock("@/lib/supabase", () => {
  const auth = {
    getUser: () => Promise.resolve({ data: { user: null } }),
    getSession: () => Promise.resolve({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: () => Promise.resolve({}),
  }
  const from = () => {
    const q: Record<string, unknown> = {}
    for (const m of ["select", "eq", "in", "order", "limit", "single", "maybeSingle", "is", "neq", "gte", "lte", "match", "filter"]) q[m] = () => q
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
    return q
  }
  const client = { auth, from, channel: () => ({ on() { return this }, subscribe() { return this } }), removeChannel() {} }
  return { createClient: () => client, supabase: client }
})

const uploadFile = vi.fn()
const voiceCloneConsentApi = vi.fn()
const runPublishedApp = vi.fn()
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  uploadFile: (...args: unknown[]) => uploadFile(...args),
  voiceCloneConsentApi: (...args: unknown[]) => voiceCloneConsentApi(...args),
  runPublishedApp: (...args: unknown[]) => runPublishedApp(...args),
}))

vi.mock("@/hooks/use-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, useAuth: () => ({ user: { id: "u1", email: "runner@example.com" }, loading: false, signOut: () => {} }) }
})

const availability = vi.hoisted(() => ({ withheld: false }))
vi.mock("@/lib/voice-clone-availability", () => ({ useOneOffCloneWithheld: () => availability.withheld }))

vi.mock("@/components/audio-player", () => ({
  WaveformAudioPlayer: ({ url }: { url: string }) => <div data-testid="player" data-url={url} />,
}))

import { PresentationView } from "../presentation-view"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import { useAppRunnerStore, createBridgedRun } from "@/hooks/use-app-runner-store"
import { DEFAULT_PRESENTATION_SETTINGS, type PresentationSettings } from "@/hooks/use-workflow-store"
import type { WorkflowNode } from "@/types/nodes"

const FLASH = "gemini-3-8-flash-tts"
const EMPTIED = { sourceAudioUrl: "", consentAudioUrl: "" }
const REF = "https://cdn.example/me.wav"
const CONSENT = "https://cdn.example/consent.wav"
const OWN = { userId: "u1", signature: "sig-u1" }

const tick = (ms = 40) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const wav = (name = "me.wav") => new File(["RIFF"], name, { type: "audio/wav" })

/** The app as it ships: a curated prompt, and a Text to Speech node whose clone is emptied — not curated. */
function snapshot(ttsCurated = false): WorkflowNode[] {
  return [
    { id: "P", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "Script", text: "Hello there", presentationInput: true } },
    {
      id: "S",
      type: "text-to-speech",
      position: { x: 0, y: 0 },
      data: { label: "Narrator", provider: FLASH, voiceId: "Kore", replica: EMPTIED, ...(ttsCurated ? { presentationInput: true } : {}) },
    },
  ] as unknown as WorkflowNode[]
}

function mount(nodes: WorkflowNode[], settings: Partial<PresentationSettings> = {}) {
  const presentationSettings = { ...DEFAULT_PRESENTATION_SETTINGS, ...settings } as PresentationSettings
  useAppRunnerStore.setState({
    slug: "my-app",
    app: { snapshotNodes: nodes, snapshotEdges: [], snapshotSettings: { presentationSettings } } as never,
    inputValues: {},
  })
  usePresentationStore.setState({
    nodes,
    edges: [],
    inputValues: {},
    nodeStates: {},
    executionStatus: "idle",
    presentationSettings,
    // The app runner's Run, as useRunSlots wires it: the runner's values into the app's run.
    run: createBridgedRun(() => usePresentationStore.getState().inputValues),
  } as never)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/app/my-app"]}>
        <PresentationView mode="fullscreen" isOwner={false} onNewRun={() => {}} newRunAction="new" />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function pick(scope: HTMLElement, testId: "app-clone-reference" | "app-clone-consent", file: File, url: string) {
  uploadFile.mockResolvedValueOnce({ url, thumbnailUrl: null, assetId: null })
  const input = within(scope).getByTestId(testId).querySelector<HTMLInputElement>('input[type="file"]')!
  await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
  await tick()
}

const runButtons = () => screen.getAllByRole("button").filter((b) => /^Run\b/.test(b.textContent ?? ""))

beforeEach(() => {
  availability.withheld = false
  uploadFile.mockReset()
  voiceCloneConsentApi.mockReset()
  voiceCloneConsentApi.mockResolvedValue(OWN)
  runPublishedApp.mockReset()
  runPublishedApp.mockResolvedValue({ executionId: "exec-1", runId: "run-1", status: "running" })
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
  useAppRunnerStore.getState().reset?.()
})

describe("a published app's emptied voice clone in the app runner", () => {
  it("shows “Your voice” though the node is not curated, holds Run until the runner's own recordings and tick, and the run carries them", async () => {
    mount(snapshot())
    const card = await screen.findByTestId("app-clone-card")
    // The curated input is there as before; the clone node itself is not an input card.
    expect(screen.getByText("Script")).toBeTruthy()
    expect(within(card).getByRole("heading", { name: "Your voice" })).toBeTruthy()

    // Run waits, and says why.
    expect(runButtons().length).toBeGreaterThan(0)
    for (const b of runButtons()) expect((b as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByTestId("run-warning")[0].textContent).toContain("Your voice")

    await pick(card, "app-clone-reference", wav(), REF)
    await pick(card, "app-clone-consent", wav("consent.wav"), CONSENT)
    for (const b of runButtons()) expect((b as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { fireEvent.click(within(card).getByRole("checkbox")) })
    await tick()
    expect(voiceCloneConsentApi).toHaveBeenCalledWith({ sourceAudioUrl: REF, consentAudioUrl: CONSENT })

    for (const b of runButtons()) expect((b as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByTestId("run-warning")).toBeNull()

    await act(async () => { fireEvent.click(runButtons()[0]) })
    await tick()
    expect(runPublishedApp).toHaveBeenCalledTimes(1)
    const [slug, overrides] = runPublishedApp.mock.calls[0] as [string, Record<string, Record<string, unknown>>]
    expect(slug).toBe("my-app")
    expect(overrides.S).toEqual({ replica: { sourceAudioUrl: REF, consentAudioUrl: CONSENT }, replicaConsent: OWN })
  })

  it("is appended to the curated items too, and is extra to a clone node's own curated card", async () => {
    mount(snapshot(true), { inputItems: [{ type: "node", nodeId: "P" }, { type: "node", nodeId: "S" }] })
    await screen.findByTestId("app-clone-card")
    expect(screen.getAllByTestId("app-clone-card")).toHaveLength(1)
    expect(screen.getByText("Script")).toBeTruthy()
    // The Text to Speech node's own card (its curated inputs) stays.
    expect(screen.getAllByText("Narrator").length).toBeGreaterThan(0)
  })

  it("where the deployment withholds one-off clones: the card says so, and Run waits saying the same", async () => {
    availability.withheld = true
    mount(snapshot())
    const card = await screen.findByTestId("app-clone-card")
    expect(card.textContent).toContain("One-off voice cloning isn't available on this deployment.")
    for (const b of runButtons()) expect((b as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByTestId("run-warning")[0].textContent).toContain("One-off voice cloning isn't available on this deployment.")
  })

  it("an app with no clone shows no card and never waits on one", async () => {
    const nodes = snapshot().map((n) => (n.id === "S" ? { ...n, data: { ...(n.data as Record<string, unknown>), replica: undefined } } : n)) as WorkflowNode[]
    mount(nodes)
    await tick()
    expect(screen.queryByTestId("app-clone-card")).toBeNull()
    for (const b of runButtons()) expect((b as HTMLButtonElement).disabled).toBe(false)
  })
})
