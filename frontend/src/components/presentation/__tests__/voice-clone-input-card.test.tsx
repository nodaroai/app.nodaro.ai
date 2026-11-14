/**
 * "Your voice" — a published app's one-off voice clone as the runner's own
 * input (decided 2026-11-13). The REAL card against the real presentation
 * store (the runner's input values), with the upload and the consent route
 * stood in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { REPLICA_MAX_BYTES } from "@nodaro/shared/models"

vi.mock("@/lib/supabase", () => {
  const auth = {
    getUser: () => Promise.resolve({ data: { user: null } }),
    getSession: () => Promise.resolve({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  }
  return { createClient: () => ({ auth }) }
})

const uploadFile = vi.fn()
const voiceCloneConsentApi = vi.fn()
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  uploadFile: (...args: unknown[]) => uploadFile(...args),
  voiceCloneConsentApi: (...args: unknown[]) => voiceCloneConsentApi(...args),
}))

// The signed-in runner: the box is theirs only for a record issued to them.
let currentUser: { id: string } | null = { id: "u1" }
vi.mock("@/hooks/use-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, useAuth: () => ({ user: currentUser, loading: false }) }
})

// The one audio player (wavesurfer) is not what is under test.
vi.mock("@/components/audio-player", () => ({
  WaveformAudioPlayer: ({ url }: { url: string }) => <div data-testid="player" data-url={url} />,
}))

const toastError = vi.fn()
vi.mock("sonner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sonner")>()
  return { ...actual, toast: Object.assign(() => {}, actual.toast, { error: (...a: unknown[]) => toastError(...a) }) }
})

import { VoiceCloneInputCard } from "../input-cards/voice-clone-input-card"
import { appCloneInputNode } from "@/lib/app-clone-inputs"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import { __resetSurfaceAvailabilityForTests } from "@/lib/surface-availability"

const EMPTIED = { sourceAudioUrl: "", consentAudioUrl: "" }
const REF = "https://cdn.example/me.wav"
const CONSENT = "https://cdn.example/consent.wav"
const OWN = { userId: "u1", signature: "sig-u1" }

const tick = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const wav = (name = "me.wav") => new File(["RIFF"], name, { type: "audio/wav" })

const writes: Array<[string, string, unknown]> = []

function Runner({ node }: { node: ReturnType<typeof appCloneInputNode> }) {
  const inputValues = usePresentationStore((s) => s.inputValues)
  return (
    <VoiceCloneInputCard
      node={node}
      inputValues={inputValues}
      onUpdateInput={(id, key, value) => {
        writes.push([id, key, value])
        usePresentationStore.getState().updateInputValue(id, key, value)
      }}
    />
  )
}

function mount(type: "text-to-speech" | "text-to-dialogue", data: Record<string, unknown>, values: Record<string, Record<string, unknown>> = {}) {
  usePresentationStore.setState({ inputValues: values })
  const node = appCloneInputNode({ id: "N", type, data: { label: "Speech", ...data } }, "Your voice")
  return render(<Runner node={node} />)
}

async function pick(scope: HTMLElement, testId: "app-clone-reference" | "app-clone-consent", file: File, url?: string) {
  if (url) uploadFile.mockResolvedValueOnce({ url, thumbnailUrl: null, assetId: null })
  const input = within(scope).getByTestId(testId).querySelector<HTMLInputElement>('input[type="file"]')!
  await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
  await tick()
}

const values = () => usePresentationStore.getState().inputValues.N ?? {}

beforeEach(() => {
  writes.length = 0
  currentUser = { id: "u1" }
  uploadFile.mockReset()
  voiceCloneConsentApi.mockReset()
  voiceCloneConsentApi.mockResolvedValue(OWN)
  toastError.mockReset()
  globalThis.fetch = vi.fn(() => Promise.resolve(new Response("{}", { status: 404 }))) as never
})

afterEach(() => {
  cleanup()
  __resetSurfaceAvailabilityForTests(null)
})

describe("Text to Speech: your two recordings and your tick", () => {
  it("each WAV upload writes the clone's links; the box then records the runner's own consent over exactly those links", async () => {
    mount("text-to-speech", { replica: EMPTIED })
    await tick()
    const card = screen.getByTestId("app-clone-card")
    const box = within(card).getByRole("checkbox")
    expect(box.hasAttribute("disabled")).toBe(true)
    // The sentence the consent recording reads, and the approved wording of the box.
    expect(within(card).getByTestId("app-clone-sentence").textContent).toContain("I am the owner of this voice")
    expect(within(card).getByText(/I confirm the voice in these recordings is my own/)).toBeTruthy()

    await pick(card, "app-clone-reference", wav(), REF)
    expect(uploadFile).toHaveBeenCalledTimes(1)
    expect(values().replica).toEqual({ sourceAudioUrl: REF, consentAudioUrl: "" })
    expect(box.hasAttribute("disabled")).toBe(true)

    await pick(card, "app-clone-consent", wav("consent.wav"), CONSENT)
    expect(values().replica).toEqual({ sourceAudioUrl: REF, consentAudioUrl: CONSENT })
    expect(within(card).getByRole("checkbox").hasAttribute("disabled")).toBe(false)

    await act(async () => { fireEvent.click(within(card).getByRole("checkbox")) })
    await tick()
    expect(voiceCloneConsentApi).toHaveBeenCalledTimes(1)
    expect(voiceCloneConsentApi).toHaveBeenCalledWith({ sourceAudioUrl: REF, consentAudioUrl: CONSENT })
    expect(values().replicaConsent).toEqual(OWN)
    expect(within(card).getByRole("checkbox").getAttribute("aria-checked")).toBe("true")
    expect(within(card).getByTestId("app-clone-status").textContent).toBe("Ready")
    // Only the clone's two keys, on the clone node itself.
    expect(new Set(writes.map(([id, key]) => `${id}.${key}`))).toEqual(new Set(["N.replica", "N.replicaConsent"]))
  })

  it("a file that is not a WAV, or is over the size taken, is refused before any upload", async () => {
    mount("text-to-speech", { replica: EMPTIED })
    await tick()
    const card = screen.getByTestId("app-clone-card")
    await pick(card, "app-clone-reference", new File(["ID3"], "me.mp3", { type: "audio/mpeg" }))
    expect(screen.getByRole("alert").textContent).toBe("Choose a WAV file.")
    const big = wav()
    Object.defineProperty(big, "size", { value: REPLICA_MAX_BYTES + 1 })
    await pick(card, "app-clone-reference", big)
    expect(screen.getByRole("alert").textContent).toBe("This file is larger than 10 MB.")
    expect(uploadFile).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  it("someone else's record shows unticked; replacing or removing a recording clears the runner's own", async () => {
    mount("text-to-speech", { replica: EMPTIED }, { N: { replica: { sourceAudioUrl: REF, consentAudioUrl: CONSENT }, replicaConsent: { userId: "author", signature: "sig-author" } } })
    await tick()
    const card = screen.getByTestId("app-clone-card")
    expect(within(card).getByRole("checkbox").getAttribute("aria-checked")).toBe("false")
    expect(within(card).getByTestId("app-clone-status").textContent).not.toBe("Ready")

    await act(async () => { fireEvent.click(within(card).getByRole("checkbox")) })
    await tick()
    expect(values().replicaConsent).toEqual(OWN)

    // Replace the reference: a new link, and the consent goes with the old one.
    await pick(card, "app-clone-reference", wav("again.wav"), "https://cdn.example/again.wav")
    expect(values().replica).toEqual({ sourceAudioUrl: "https://cdn.example/again.wav", consentAudioUrl: CONSENT })
    expect(values().replicaConsent).toBeUndefined()
    expect(within(card).getByRole("checkbox").getAttribute("aria-checked")).toBe("false")

    await act(async () => { fireEvent.click(within(card).getByRole("checkbox")) })
    await tick()
    await act(async () => { fireEvent.click(within(card).getByRole("button", { name: "Remove the consent recording" })) })
    expect(values().replica).toEqual({ sourceAudioUrl: "https://cdn.example/again.wav", consentAudioUrl: "" })
    expect(values().replicaConsent).toBeUndefined()
  })

  it("unticking clears the record; a refused consent stores nothing and says why", async () => {
    mount("text-to-speech", { replica: EMPTIED }, { N: { replica: { sourceAudioUrl: REF, consentAudioUrl: CONSENT }, replicaConsent: OWN } })
    await tick()
    const card = screen.getByTestId("app-clone-card")
    expect(within(card).getByRole("checkbox").getAttribute("aria-checked")).toBe("true")
    await act(async () => { fireEvent.click(within(card).getByRole("checkbox")) })
    expect(values().replicaConsent).toBeUndefined()

    voiceCloneConsentApi.mockRejectedValueOnce(new Error("The consent route refused."))
    await act(async () => { fireEvent.click(within(card).getByRole("checkbox")) })
    await tick()
    expect(toastError).toHaveBeenCalledWith("The consent route refused.")
    expect(values().replicaConsent).toBeUndefined()
    expect(within(card).getByRole("checkbox").getAttribute("aria-checked")).toBe("false")
  })

  it("a guest is asked to sign in, and nothing can be added", async () => {
    currentUser = null
    mount("text-to-speech", { replica: EMPTIED })
    await tick()
    expect(screen.getByTestId("app-clone-sign-in").textContent).toBe("Sign in to add your recordings.")
    await pick(screen.getByTestId("app-clone-card"), "app-clone-reference", wav(), REF)
    expect(uploadFile).not.toHaveBeenCalled()
    expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(true)
  })
})

describe("Text to Dialogue: one block per cloned speaker a line speaks with", () => {
  const speakers = [
    { voice: "Me", replica: EMPTIED },
    { voice: "Kore", pace: "slow" },
    { voice: "Spare", replica: EMPTIED },
  ]
  const data = { dialogue: [{ id: "1", text: "Hi", voice: "Me" }, { id: "2", text: "Yo", voice: "Kore" }], speakers }

  it("writes the node's whole speakers list in one update each time, with the runner's clone filled and every other speaker unchanged", async () => {
    mount("text-to-dialogue", data)
    await tick()
    const blocks = screen.getAllByTestId("app-clone")
    expect(blocks).toHaveLength(1)
    expect(within(blocks[0]).getByRole("heading", { name: "Me" })).toBeTruthy()

    await pick(blocks[0], "app-clone-reference", wav(), REF)
    await pick(blocks[0], "app-clone-consent", wav("consent.wav"), CONSENT)
    await act(async () => { fireEvent.click(within(blocks[0]).getByRole("checkbox")) })
    await tick()

    expect(voiceCloneConsentApi).toHaveBeenCalledWith({ sourceAudioUrl: REF, consentAudioUrl: CONSENT })
    // Every write is the one key, the whole list: three actions, three writes.
    expect(writes.map(([id, key]) => `${id}.${key}`)).toEqual(["N.speakers", "N.speakers", "N.speakers"])
    expect(values()).toEqual({
      speakers: [
        { voice: "Me", replica: { sourceAudioUrl: REF, consentAudioUrl: CONSENT }, replicaConsent: OWN },
        { voice: "Kore", pace: "slow" },
        { voice: "Spare", replica: EMPTIED },
      ],
    })
    expect(screen.getByTestId("app-clone-status").textContent).toBe("Ready")
  })
})

describe("one-off clones withheld by the deployment", () => {
  it("shows the notice in place of the recordings and the box", async () => {
    __resetSurfaceAvailabilityForTests({ nodes: ["voice-clone-one-off"], models: [] })
    mount("text-to-speech", { replica: EMPTIED })
    await tick()
    expect(screen.getByTestId("clone-unavailable").textContent).toBe("One-off voice cloning isn't available on this deployment.")
    expect(screen.queryByRole("checkbox")).toBeNull()
    expect(screen.queryByTestId("app-clone-reference")).toBeNull()
  })
})
