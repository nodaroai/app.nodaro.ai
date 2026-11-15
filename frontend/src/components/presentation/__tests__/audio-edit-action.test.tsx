/**
 * "Edit" on an audio output card, on every surface that renders one, in each
 * state of the audio editor (`AUDIOMASS_URL`):
 *
 *   - configured: an `http(s)` URL naming an AudioMass;
 *   - nothing set: unset or empty (there is no hosted audio editor);
 *   - off: `off`, `none`, `false` or `disabled`, any casing.
 *
 * The surfaces are the presentation view's output cards: the editor's Present
 * tab, the fullscreen presentation (a shared link) and the published app's
 * runner. On each card Edit is an entry in the ••• menu and a button in the
 * mobile action bar. Clicking it opens the audio editor, the panel that
 * explains no editor is configured, or nothing.
 *
 * `EXPECTED` below is the whole recording, one row per state.
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

vi.mock("@/hooks/use-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, useAuth: () => ({ user: { id: "u1", email: "runner@example.com" }, loading: false, signOut: () => {} }) }
})

vi.mock("@/components/audio-player", () => ({
  WaveformAudioPlayer: ({ url }: { url: string }) => <div data-testid="player" data-url={url} />,
}))

import { PresentationView } from "../presentation-view"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import { useAppRunnerStore } from "@/hooks/use-app-runner-store"
import { useWorkflowStore, DEFAULT_PRESENTATION_SETTINGS, type PresentationSettings } from "@/hooks/use-workflow-store"
import type { NodaroRuntimeConfig } from "@/lib/runtime-config"
import type { WorkflowNode } from "@/types/nodes"

const AUDIO = "https://cdn.example/out/voice.mp3"
const EDITOR = "https://audiomass.example.internal"

type Surface = "tab" | "fullscreen" | "appRunner"
type Opens = "editor" | "explainer" | "nothing"
interface Row {
  /** Edit is in the ••• menu and in the mobile action bar. */
  readonly offered: boolean
  /** What a click on Edit opens, per surface (only where it is offered). */
  readonly opens: Readonly<Record<Surface, Opens>>
}

const SURFACES: readonly Surface[] = ["tab", "fullscreen", "appRunner"]

/** The recording: what each state does on every surface. */
const EXPECTED: Readonly<Record<"configured" | "unset" | "off", Row>> = {
  configured: { offered: true, opens: { tab: "editor", fullscreen: "editor", appRunner: "editor" } },
  unset: { offered: true, opens: { tab: "explainer", fullscreen: "explainer", appRunner: "explainer" } },
  off: { offered: false, opens: { tab: "nothing", fullscreen: "nothing", appRunner: "nothing" } },
}

/** Each way an install reaches a state, as `/config.js` carries it. */
const STATES: ReadonlyArray<readonly [string, keyof typeof EXPECTED, NodaroRuntimeConfig]> = [
  ["AUDIOMASS_URL naming an editor", "configured", { audiomassUrl: EDITOR }],
  ["nothing set (no key in /config.js)", "unset", {}],
  ["AUDIOMASS_URL empty", "unset", { audiomassUrl: "" }],
  ["AUDIOMASS_URL=off", "off", { audiomassUrl: "off" }],
  ["AUDIOMASS_URL=OFF", "off", { audiomassUrl: "OFF" }],
  ["AUDIOMASS_URL=none", "off", { audiomassUrl: "none" }],
  ["AUDIOMASS_URL=false", "off", { audiomassUrl: "false" }],
  ["AUDIOMASS_URL=Disabled", "off", { audiomassUrl: "Disabled" }],
]

/** One Text to Speech output with a finished take, curated as the presentation's output. */
function outputNode(withResult: boolean): WorkflowNode {
  return {
    id: "S",
    type: "text-to-speech",
    position: { x: 0, y: 0 },
    data: {
      label: "Narrator",
      presentationOutput: true,
      executionStatus: "completed",
      ...(withResult ? { generatedResults: [{ url: AUDIO, jobId: "j1" }] } : {}),
    },
  } as unknown as WorkflowNode
}

function mount(surface: Surface) {
  const presentationSettings = { ...DEFAULT_PRESENTATION_SETTINGS } as PresentationSettings
  if (surface === "tab") {
    useWorkflowStore.setState({ nodes: [outputNode(true)], edges: [], presentationSettings } as never)
  } else {
    const nodes = [outputNode(false)]
    useAppRunnerStore.setState({
      slug: "my-app",
      app: { snapshotNodes: nodes, snapshotEdges: [], snapshotSettings: { presentationSettings } } as never,
      inputValues: {},
    })
    usePresentationStore.setState({
      nodes,
      edges: [],
      inputValues: {},
      nodeStates: { S: { status: "completed", output: { audioUrl: AUDIO } } },
      executionStatus: "completed",
      presentationSettings,
      run: async () => {},
    } as never)
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view =
    surface === "tab" ? <PresentationView mode="tab" isOwner />
    : surface === "fullscreen" ? <PresentationView mode="fullscreen" isOwner={false} />
    : <PresentationView mode="fullscreen" isOwner={false} onNewRun={() => {}} newRunAction="new" />
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[surface === "tab" ? "/editor/w1" : "/app/my-app"]}>{view}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const tick = (ms = 40) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

/** The audio card (its GlassCard), found from its player. The Present tab has an Edit of its own (the layout). */
const card = () => screen.getByTestId("player").closest<HTMLElement>(".rounded-xl")!

/** The card's mobile action bar: always rendered, shown below the md breakpoint. */
const actionBarEdit = () => within(card()).queryByRole("button", { name: /^edit$/i })

/** The card's ••• menu, opened; null when the card draws no menu. */
async function openMenu(): Promise<HTMLElement | null> {
  const trigger = within(card()).queryAllByTitle(/more actions/i)[0]
  if (!trigger) return null
  await act(async () => { fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" }) })
  return screen.findByRole("menu")
}

/** What the page shows after Edit: the editor's frame, the explainer, or nothing. */
async function opened(): Promise<Opens> {
  await tick()
  const dialog = screen.queryByRole("dialog", { name: /audio editor/i })
  if (!dialog) return "nothing"
  if (dialog.querySelector("iframe")) {
    expect(dialog.querySelector("iframe")!.getAttribute("src")).toBe(EDITOR)
    return "editor"
  }
  expect(within(dialog).getByText(/no audio editor is configured/i)).toBeTruthy()
  return "explainer"
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

afterEach(() => {
  cleanup()
  delete window.__NODARO_RUNTIME__
  useAppRunnerStore.getState().reset?.()
})

describe.each(STATES)("an audio output card with %s", (_label, state, runtime) => {
  const row = EXPECTED[state]

  describe.each(SURFACES)("in the %s", (surface) => {
    beforeEach(() => { window.__NODARO_RUNTIME__ = { ...runtime } })

    it(row.offered ? "offers Edit in the mobile action bar" : "offers no Edit in the mobile action bar", async () => {
      mount(surface)
      await screen.findByTestId("player")
      expect(!!actionBarEdit()).toBe(row.offered)
    })

    it(row.offered ? "offers Edit in the ••• menu" : "offers no Edit in the ••• menu", async () => {
      mount(surface)
      await screen.findByTestId("player")
      const menu = await openMenu()
      expect(menu, "the card draws its ••• menu").not.toBeNull()
      expect(!!within(menu!).queryByRole("menuitem", { name: /^edit$/i })).toBe(row.offered)
    })

    if (row.offered) {
      it(`Edit opens ${row.opens[surface] === "nothing" ? "nothing" : `the ${row.opens[surface]}`}`, async () => {
        mount(surface)
        await screen.findByTestId("player")
        await act(async () => { fireEvent.click(actionBarEdit()!) })
        expect(await opened()).toBe(row.opens[surface])
      })
    }
  })
})

describe.each(SURFACES)("the %s's Edit handler (the backstop)", (surface) => {
  it("opens nothing once the audio editor is switched off, whatever the card bound", async () => {
    window.__NODARO_RUNTIME__ = {}
    mount(surface)
    await screen.findByTestId("player")
    const edit = actionBarEdit()!
    window.__NODARO_RUNTIME__ = { audiomassUrl: "off" }
    // The card bound Edit while nothing was set (it opens the explainer then, above); it is still there.
    expect(edit.isConnected).toBe(true)
    await act(async () => { fireEvent.click(edit) })
    expect(await opened()).toBe("nothing")
  })
})
