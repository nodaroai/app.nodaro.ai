/**
 * The phone's app runner (MobileAppShell) and a published app that clones a
 * voice (decided 2026-11-13): the same "Your voice" card as the desktop
 * runner, whatever the author curated, and its Run waits for the runner's own
 * recordings and tick. The chat composer's chip names it and reads Ready once
 * it is filled.
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
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  uploadFile: (...args: unknown[]) => uploadFile(...args),
  voiceCloneConsentApi: (...args: unknown[]) => voiceCloneConsentApi(...args),
}))

vi.mock("@/hooks/use-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, useAuth: () => ({ user: { id: "u1", email: "runner@example.com" }, loading: false, signOut: () => {} }) }
})

vi.mock("@/components/audio-player", () => ({
  WaveformAudioPlayer: ({ url }: { url: string }) => <div data-testid="player" data-url={url} />,
}))

import { MobileAppShell } from "../mobile-app-shell"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import { useAppRunnerStore } from "@/hooks/use-app-runner-store"
import { DEFAULT_PRESENTATION_SETTINGS, type PresentationSettings } from "@/hooks/use-workflow-store"
import { getChipValue } from "@/components/presentation/views/chat-view-helpers"
import { appCloneInputNode } from "@/lib/app-clone-inputs"
import type { WorkflowNode } from "@/types/nodes"

const EMPTIED = { sourceAudioUrl: "", consentAudioUrl: "" }
const REF = "https://cdn.example/me.wav"
const CONSENT = "https://cdn.example/consent.wav"
const OWN = { userId: "u1", signature: "sig-u1" }

const tick = (ms = 40) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const wav = (name = "me.wav") => new File(["RIFF"], name, { type: "audio/wav" })

const nodes = [
  { id: "P", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "Script", text: "Hello there", presentationInput: true } },
  {
    id: "D",
    type: "text-to-dialogue",
    position: { x: 0, y: 0 },
    data: {
      label: "Conversation",
      provider: "gemini-3-8-flash-tts",
      dialogue: [{ id: "1", text: "Hi", voice: "Me" }, { id: "2", text: "Yo", voice: "Kore" }],
      speakers: [{ voice: "Me", replica: EMPTIED }, { voice: "Kore", pace: "slow" }],
    },
  },
] as unknown as WorkflowNode[]

const runSlots = {
  activeSlotId: null,
  slots: [],
  versions: [],
  selectedVersion: null,
  latestVersion: 1,
  isLoadingRun: false,
  inputsReadOnlyValue: false,
  newRunAction: "new",
  setSelectedVersion: () => {},
  handleCreateNew: () => {},
  handleDuplicateSlot: () => {},
  handleHeaderAction: () => {},
  handleRenameSlot: () => {},
  handleRequestDelete: () => {},
  handleSelectSlot: () => {},
  launch: () => {},
}

function mount() {
  const presentationSettings = DEFAULT_PRESENTATION_SETTINGS as PresentationSettings
  const app = { id: "app", name: "Talk", slug: "talk", snapshotNodes: nodes, snapshotEdges: [], snapshotSettings: { presentationSettings } }
  useAppRunnerStore.setState({ slug: "talk", app: app as never, inputValues: {} })
  usePresentationStore.setState({ nodes, edges: [], inputValues: {}, nodeStates: {}, executionStatus: "idle", presentationSettings } as never)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/app/talk"]}>
        <MobileAppShell app={app as never} user={{ id: "u1" } as never} runSlots={runSlots as never} cancel={() => {}} />
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

const runButton = () => screen.getAllByRole("button").find((b) => /^Run\b/.test(b.textContent ?? "")) as HTMLButtonElement

beforeEach(() => {
  uploadFile.mockReset()
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

afterEach(() => cleanup())

describe("the phone's app runner and a published dialogue's emptied clone", () => {
  it("shows the cloned speaker's card on the inputs tab though the node is not curated, and Run waits for the runner's own recordings and tick", async () => {
    mount()
    const card = await screen.findByTestId("app-clone-card")
    expect(screen.getByText("Script")).toBeTruthy()
    expect(within(card).getByRole("heading", { name: "Me" })).toBeTruthy()
    expect(runButton().disabled).toBe(true)
    // The sticky Run says why it waits, just above it, and names it as its description.
    const reason = screen.getAllByRole("status").find((el) => el.textContent?.includes("under “Your voice”"))
    expect(reason).toBeTruthy()
    expect(runButton().getAttribute("aria-describedby")).toBe(reason!.id)

    await pick(card, "app-clone-reference", wav(), REF)
    await pick(card, "app-clone-consent", wav("consent.wav"), CONSENT)
    await act(async () => { fireEvent.click(within(card).getByRole("checkbox")) })
    await tick()

    expect(runButton().disabled).toBe(false)
    expect(screen.queryAllByRole("status").some((el) => el.textContent?.includes("under “Your voice”"))).toBe(false)
    // The runner's input on the dialogue node: its whole speakers list, the clone filled, the other speaker as it was.
    expect(usePresentationStore.getState().inputValues.D).toEqual({
      speakers: [
        { voice: "Me", replica: { sourceAudioUrl: REF, consentAudioUrl: CONSENT }, replicaConsent: OWN },
        { voice: "Kore", pace: "slow" },
      ],
    })
  })
})

describe("the chat composer's chip", () => {
  it("reads nothing until the clone is filled, then Ready", () => {
    const chip = appCloneInputNode(nodes[1] as never, "Your voice")
    expect(getChipValue(chip, {})).toBeUndefined()
    const filled = { D: { speakers: [{ voice: "Me", replica: { sourceAudioUrl: REF, consentAudioUrl: CONSENT }, replicaConsent: OWN }, { voice: "Kore", pace: "slow" }] } }
    expect(getChipValue(chip, filled)).toBe("Ready")
  })
})
