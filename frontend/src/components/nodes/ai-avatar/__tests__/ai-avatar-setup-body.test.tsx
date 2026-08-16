import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react"
import type { HeygenAvatar, HeygenVoice } from "@/lib/api"
import type { AiAvatarData } from "@/types/nodes"

// ── Store: nodes/edges feed the wiring hook; updateNodeData/selectNode are spies
const updateNodeData = vi.fn()
const selectNode = vi.fn()
const runSingleNode = vi.fn()
let storeState: { nodes: unknown[]; edges: unknown[] } = { nodes: [], edges: [] }

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ ...storeState, updateNodeData, selectNode, runSingleNode }),
    { getState: () => ({ ...storeState, updateNodeData, selectNode, runSingleNode }) },
  ),
}))

// The wiring hook resolves an upstream node's output through the executor's
// extractor — a stub that reads `data.text` / `data.url` is enough here.
vi.mock("@/components/editor/workflow-editor/execution-graph", () => ({
  extractNodeOutput: (node: { data?: { text?: string; url?: string } }) => node.data?.text ?? node.data?.url,
}))

// ── HeyGen catalog: swap the two query hooks for fixtures, keep the pure bits
let avatarsFixture: HeygenAvatar[] = []
let voicesFixture: HeygenVoice[] = []
let avatarsLoading = false
vi.mock("@/components/heygen/heygen-catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/heygen/heygen-catalog")>()
  return {
    ...actual,
    useHeygenAvatars: () => ({ data: avatarsFixture, isLoading: avatarsLoading, isError: false, complete: true }),
    useHeygenVoices: () => ({ data: voicesFixture, isLoading: false, isError: false, complete: true }),
  }
})

const previewToggle = vi.fn()
vi.mock("@/components/heygen/use-voice-preview", () => ({
  useVoicePreview: (url: string | null | undefined) => ({ isPlaying: false, canPlay: !!url, toggle: previewToggle }),
}))

vi.mock("@/hooks/use-file-upload", () => ({
  useFileUpload: () => ({ upload: vi.fn(), isUploading: false, uploadError: null }),
}))

vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: ({ src, alt }: { src: string; alt?: string }) => <img data-testid="cached-image" src={src} alt={alt ?? ""} />,
}))

// Radix Popover flattened: the trigger toggles `open`, the content renders only
// while open — enough to drive the on-node voice picker without a real portal.
vi.mock("@/components/ui/popover", async () => {
  const React = await import("react")
  type Ctx = { open: boolean; set: (o: boolean) => void }
  const Ctx = React.createContext<Ctx>({ open: false, set: () => undefined })
  type TriggerChild = React.ReactElement<{ onClick?: (e: React.MouseEvent) => void }>
  return {
    Popover: ({ children, open, onOpenChange }: { children: React.ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void }) => (
      <Ctx.Provider value={{ open: !!open, set: (o: boolean) => onOpenChange?.(o) }}>{children}</Ctx.Provider>
    ),
    PopoverTrigger: ({ children }: { children: TriggerChild }) => {
      const { open, set } = React.useContext(Ctx)
      return React.cloneElement(children, {
        onClick: (e: React.MouseEvent) => { children.props.onClick?.(e); set(!open) },
      })
    },
    PopoverContent: ({ children, ...rest }: { children: React.ReactNode; "data-testid"?: string }) => {
      const { open } = React.useContext(Ctx)
      return open ? <div data-testid={rest["data-testid"]}>{children}</div> : null
    },
  }
})

// The full voice picker is its own tested component — stand in with a plain
// list so we can pick from it.
vi.mock("@/components/heygen/voice-picker", () => ({
  VoicePicker: ({ value, onSelect }: { value?: string; onSelect: (v: HeygenVoice) => void }) => (
    <ul data-testid="voice-picker" data-value={value ?? ""}>
      {voicesFixture.map((v) => (
        <li key={v.voiceId}><button type="button" onClick={() => onSelect(v)}>{`pick ${v.name.trim()}`}</button></li>
      ))}
    </ul>
  ),
}))

import { AiAvatarSetupBody } from "../ai-avatar-setup-body"

function look(name: string, id: string, extra: Partial<HeygenAvatar> = {}): HeygenAvatar {
  return {
    avatarId: id, name, gender: "female", previewImageUrl: `https://cdn/${id}.jpg`,
    defaultVoiceId: `dv-${id}`, preferredOrientation: "landscape", supportedEngines: ["avatar_v", "avatar_iv"],
    ...extra,
  }
}
const CATALOG: HeygenAvatar[] = [
  look("Cora Office 4", "cora4"), look("Cora Livingroom 1", "cora-l1"),
  look("Marieke Desk 1", "marieke1"), look("Signe Studio 1", "signe1"),
  look("Margot Outdoor 1", "margot1"), look("Livia Home 1", "livia1"), look("Elin Office 1", "elin1"),
]
const VOICES: HeygenVoice[] = [
  { voiceId: "brian", name: "Chill Brian", language: "English", gender: "male", previewAudio: "https://cdn/brian.mp3", supportPause: false, emotionSupport: false, supportLocale: true },
  { voiceId: "junk", name: "\nAllison  ", language: "", gender: "unknown", previewAudio: null as unknown as string, supportPause: false, emotionSupport: false, supportLocale: true },
]

function data(over: Partial<AiAvatarData> = {}): AiAvatarData {
  return {
    label: "AI Avatar", provider: "heygen", avatarSource: "avatar", engine: "avatar-iv", avatarId: "",
    speechMode: "text", resolution: "720p", aspectRatio: "16:9", fieldMappings: {}, ...over,
  }
}

function renderBody(d: AiAvatarData) {
  return render(<AiAvatarSetupBody nodeId="N1" data={d} />)
}

const status = () => screen.getByTestId("ai-avatar-status")

beforeEach(() => {
  updateNodeData.mockClear(); selectNode.mockClear(); previewToggle.mockClear(); runSingleNode.mockClear()
  avatarsFixture = CATALOG; voicesFixture = VOICES; avatarsLoading = false
  storeState = { nodes: [], edges: [] }
})

describe("AiAvatarSetupBody — empty, catalog source", () => {
  it("shows one featured look per person, Browse all with the catalog count, and the amber readiness", () => {
    renderBody(data())
    expect(screen.getByTestId("ai-avatar-setup-body")).toHaveAttribute("data-view", "quick-pick")
    const tiles = screen.getAllByRole("radio")
    expect(tiles.map((t) => t.getAttribute("aria-label"))).toEqual([
      "Cora Office 4", "Marieke Desk 1", "Signe Studio 1", "Margot Outdoor 1", "Livia Home 1",
    ])
    // person on the first line, scene on the second
    expect(tiles[0]).toHaveTextContent("Cora")
    expect(tiles[0]).toHaveTextContent("Office 4")
    expect(screen.getByText("Browse all 7 ›")).toBeInTheDocument()
    expect(status()).not.toHaveAttribute("data-ready")
    expect(status()).toHaveTextContent("Needs an avatar, a voice and a script before it can run")
    expect(status()).toHaveTextContent("HeyGen Avatar IV · 720p")
  })

  it("picking a tile writes the same patch the settings panel writes (id, name, preview, default voice, orientation)", () => {
    renderBody(data())
    fireEvent.click(screen.getByRole("radio", { name: "Marieke Desk 1" }))
    expect(updateNodeData).toHaveBeenCalledWith("N1", {
      avatarId: "marieke1", avatarName: "Marieke Desk 1", avatarPreviewUrl: "https://cdn/marieke1.jpg",
      avatarGroupId: undefined, avatarSupportsV: true, voiceId: "dv-marieke1", aspectRatio: "16:9",
    })
  })

  it("keeps an already-picked voice when re-picking an avatar", () => {
    renderBody(data({ voiceId: "brian" }))
    fireEvent.click(screen.getByRole("radio", { name: "Cora Office 4" }))
    expect(updateNodeData).toHaveBeenCalledWith("N1", expect.objectContaining({ voiceId: "brian" }))
  })

  it("Browse all opens the Avatar Picker modal (not the settings panel); Use an image instead flips the source", () => {
    renderBody(data())
    fireEvent.click(screen.getByText("Browse all 7 ›"))
    expect(selectNode).not.toHaveBeenCalled()
    expect(screen.getByTestId("avatar-picker-modal")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Choose an avatar" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    fireEvent.click(screen.getByRole("button", { name: /Use an image instead/ }))
    expect(updateNodeData).toHaveBeenCalledWith("N1", { avatarSource: "image" })
  })

  it("picking in the modal writes the same patch as a card tile and closes it", async () => {
    renderBody(data())
    fireEvent.click(screen.getByText("Browse all 7 ›"))
    const modal = screen.getByTestId("avatar-picker-modal")
    // person cards; pick Marieke, then her look chip, then Use this avatar
    fireEvent.click(within(modal).getByRole("radio", { name: /^Marieke,/ }))
    expect(within(modal).getByTestId("avatar-picker-detail-name")).toHaveTextContent("Marieke — Desk")
    fireEvent.click(within(modal).getByRole("button", { name: "Use this avatar" }))
    expect(updateNodeData).toHaveBeenCalledWith("N1", expect.objectContaining({ avatarId: "marieke1", avatarName: "Marieke Desk 1" }))
    await waitFor(() => expect(screen.queryByTestId("avatar-picker-modal")).toBeNull())
  })

  it("a keyless install sees the honest empty-catalog copy and no Browse all", () => {
    avatarsFixture = []
    renderBody(data())
    expect(screen.getByTestId("ai-avatar-quick-pick-empty")).toBeInTheDocument()
    expect(screen.getByText(/Add a HeyGen key or connect nodaro.ai/)).toBeInTheDocument()
    expect(screen.queryByText(/Browse all/)).toBeNull()
  })

  it("shows skeleton tiles while the catalog loads", () => {
    avatarsLoading = true; avatarsFixture = []
    renderBody(data())
    expect(document.querySelector("[aria-busy]")).toBeInTheDocument()
    expect(screen.queryByTestId("ai-avatar-quick-pick-empty")).toBeNull()
  })

  // ── Search on the card — the SAME filter the settings-panel picker runs ──
  it("typing in the search box filters the whole catalog (every matching look, not just one per person)", () => {
    renderBody(data())
    const box = screen.getByLabelText("Search avatars") as HTMLInputElement
    fireEvent.change(box, { target: { value: "cora" } })
    expect(screen.getByTestId("ai-avatar-search-results")).toBeInTheDocument()
    expect(screen.getAllByRole("radio").map((t) => t.getAttribute("aria-label"))).toEqual(["Cora Office 4", "Cora Livingroom 1"])
    expect(screen.getByTestId("ai-avatar-search-count")).toHaveTextContent("2 matches")
    // picking from the results writes the look like any tile
    fireEvent.click(screen.getByRole("radio", { name: "Cora Livingroom 1" }))
    expect(updateNodeData).toHaveBeenCalledWith("N1", expect.objectContaining({ avatarId: "cora-l1" }))
  })

  it("the account's own look that HeyGen is still building is never featured; in search results it is labelled, unpickable, and says why", () => {
    avatarsFixture = [
      look("Me Building", "mine-b", { ownership: "private", status: "processing" }),
      look("Me Broken", "mine-f", { ownership: "private", status: "failed" }),
      ...CATALOG,
    ]
    renderBody(data())
    // featured row: still the five presets, none of the unusable own looks
    expect(screen.getAllByRole("radio").map((t) => t.getAttribute("aria-label"))).toEqual([
      "Cora Office 4", "Marieke Desk 1", "Signe Studio 1", "Margot Outdoor 1", "Livia Home 1",
    ])
    fireEvent.change(screen.getByLabelText("Search avatars"), { target: { value: "me b" } })
    const tiles = screen.getAllByRole("radio")
    expect(tiles.map((t) => t.getAttribute("aria-label"))).toEqual([
      "Me Building — HeyGen is still building this look",
      "Me Broken — HeyGen could not build this look",
    ])
    expect(tiles[0]).toHaveAttribute("aria-disabled", "true")
    expect(screen.getAllByTestId("avatar-status-badge").map((b) => b.textContent)).toEqual(["Processing…", "Failed"])
    fireEvent.click(tiles[0])
    fireEvent.click(tiles[1])
    expect(updateNodeData).not.toHaveBeenCalled()
  })

  it("no match → says so and points at Browse all; clearing (✕ / Escape) restores the featured row", () => {
    renderBody(data())
    const box = screen.getByLabelText("Search avatars") as HTMLInputElement
    fireEvent.change(box, { target: { value: "zzz" } })
    expect(screen.getByTestId("ai-avatar-search-empty")).toHaveTextContent("No avatars match “zzz”")
    fireEvent.click(screen.getByRole("button", { name: "Browse all with filters ›" }))
    // opens the modal with the card's search text carried over
    expect(selectNode).not.toHaveBeenCalled()
    expect((within(screen.getByTestId("avatar-picker-modal")).getByLabelText("Search avatars") as HTMLInputElement).value).toBe("zzz")
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }))
    expect(box.value).toBe("")
    expect(screen.getAllByRole("radio")).toHaveLength(5)
    fireEvent.change(box, { target: { value: "sig" } })
    expect(screen.getAllByRole("radio")).toHaveLength(1)
    fireEvent.keyDown(box, { key: "Escape" })
    expect(box.value).toBe("")
    expect(screen.getAllByRole("radio")).toHaveLength(5)
  })

  it("the search box is a nodrag/nopan island so typing never drags or pans the canvas", () => {
    renderBody(data())
    expect(screen.getByLabelText("Search avatars").closest(".nodrag.nopan")).not.toBeNull()
  })
})

describe("AiAvatarSetupBody — empty, image source", () => {
  it("offers upload / wire, a URL link to settings, and the way back to the catalog", () => {
    renderBody(data({ avatarSource: "image" }))
    expect(screen.getByTestId("ai-avatar-setup-body")).toHaveAttribute("data-view", "image-empty")
    expect(screen.getByText("Upload a portrait")).toBeInTheDocument()
    expect(screen.getByLabelText("Upload a portrait")).toHaveAttribute("type", "file")
    fireEvent.click(screen.getByText("Paste a URL ›"))
    expect(selectNode).toHaveBeenCalledWith("N1")
    fireEvent.click(screen.getByRole("button", { name: /Choose an avatar/ }))
    expect(updateNodeData).toHaveBeenCalledWith("N1", { avatarSource: "avatar" })
    expect(status()).toHaveTextContent("Needs a source image, a voice and a script before it can run")
    expect(status()).toHaveTextContent("Image animation · 720p")
  })

  it("a wired Image input counts as the image and shows the configured card", () => {
    storeState = {
      nodes: [{ id: "IMG", type: "upload-image", data: { label: "Portrait", url: "https://cdn/wired.png" } }],
      edges: [{ id: "e1", source: "IMG", target: "N1", targetHandle: "image", sourceHandle: "image" }],
    }
    renderBody(data({ avatarSource: "image", voiceId: "brian", script: "hi" }))
    expect(screen.getByTestId("ai-avatar-setup-body")).toHaveAttribute("data-view", "configured")
    expect(screen.getByText("Wired from Portrait")).toBeInTheDocument()
    expect(screen.getByText("Wired input takes priority")).toBeInTheDocument()
    expect((screen.getByAltText("Source image") as HTMLImageElement).src).toBe("https://cdn/wired.png")
    expect(status()).toHaveAttribute("data-ready")
    expect(status()).toHaveTextContent("Ready to run · image, voice and script are set")
  })
})

describe("AiAvatarSetupBody — configured", () => {
  const configured = () =>
    data({ avatarId: "cora4", avatarName: "Cora Office 4", avatarPreviewUrl: "https://cdn/cora4.jpg", voiceId: "brian", script: "Welcome back to the channel." })

  it("shows the look, engine badge, voice (enriched from the catalog) and the editable script with its meta", () => {
    renderBody(configured())
    expect(screen.getByTestId("ai-avatar-setup-body")).toHaveAttribute("data-view", "configured")
    expect(screen.getByText("Cora Office 4")).toBeInTheDocument()
    expect(screen.getByText("Avatar IV")).toBeInTheDocument()
    expect(screen.getByText("Female · Avatar V ready")).toBeInTheDocument()
    expect(screen.getByText("Chill Brian")).toBeInTheDocument()
    expect(screen.getByText("English · Male")).toBeInTheDocument()
    const script = screen.getByLabelText("Avatar script") as HTMLTextAreaElement
    expect(script.tagName).toBe("TEXTAREA")
    expect(script.value).toBe("Welcome back to the channel.")
    expect(screen.getByText("28 chars · ~2s")).toBeInTheDocument()
    fireEvent.change(script, { target: { value: "New line." } })
    expect(updateNodeData).toHaveBeenCalledWith("N1", { script: "New line." })
    expect(status()).toHaveAttribute("data-ready")
    expect(status()).toHaveTextContent("Ready to run · avatar, voice and script are set")
  })

  it("renders from stored node data when the catalog is empty (keyless install opening a prod workflow)", () => {
    avatarsFixture = []; voicesFixture = []
    renderBody(data({ avatarId: "x1", avatarName: "Cora Office 4", avatarPreviewUrl: "https://cdn/x1.jpg", voiceId: "brian", voiceName: "Chill Brian", script: "hi" }))
    expect(screen.getByText("Cora Office 4")).toBeInTheDocument()
    expect(screen.getByText("Chill Brian")).toBeInTheDocument()
    expect((screen.getByAltText("Cora Office 4") as HTMLImageElement).src).toBe("https://cdn/x1.jpg")
    // no preview clip known → play is disabled, not broken
    expect(screen.getByRole("button", { name: "Play voice preview" })).toBeDisabled()
  })

  it("Change avatar reopens the quick pick with the current look checked; ✕ goes back", () => {
    renderBody(configured())
    fireEvent.click(screen.getByRole("button", { name: "Change avatar" }))
    expect(screen.getByTestId("ai-avatar-setup-body")).toHaveAttribute("data-view", "quick-pick")
    expect(screen.getByRole("radio", { name: "Cora Office 4" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("radio", { name: "Marieke Desk 1" })).toHaveAttribute("aria-checked", "false")
    fireEvent.click(screen.getByRole("button", { name: "Keep the current avatar" }))
    expect(screen.getByTestId("ai-avatar-setup-body")).toHaveAttribute("data-view", "configured")
    expect(updateNodeData).not.toHaveBeenCalled()
  })

  it("picking a new look from Change avatar writes it and returns to the configured card", () => {
    renderBody(configured())
    fireEvent.click(screen.getByRole("button", { name: "Change avatar" }))
    fireEvent.click(screen.getByRole("radio", { name: "Signe Studio 1" }))
    expect(updateNodeData).toHaveBeenCalledWith("N1", expect.objectContaining({ avatarId: "signe1", voiceId: "brian" }))
    expect(screen.getByTestId("ai-avatar-setup-body")).toHaveAttribute("data-view", "configured")
  })

  it("a wired Script input shows the upstream text read-only and satisfies readiness", () => {
    storeState = {
      nodes: [{ id: "W", type: "text-prompt", data: { label: "Writer", text: "Wired words." } }],
      edges: [{ id: "e1", source: "W", target: "N1", targetHandle: "script" }],
    }
    renderBody(data({ avatarId: "cora4", voiceId: "brian" }))
    expect(screen.getByText("Script · wired from Writer")).toBeInTheDocument()
    expect(screen.getByText("Wired words.")).toBeInTheDocument()
    expect(screen.queryByLabelText("Avatar script")).toBeNull()
    expect(status()).toHaveAttribute("data-ready")
  })

  it("voice row: clicking the voice opens the full voice picker on the card; picking writes voiceId + voiceName (same patch as the panel) and closes it", () => {
    renderBody(configured())
    expect(screen.queryByTestId("ai-avatar-voice-popover")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /Voice: Chill Brian/ }))
    const picker = screen.getByTestId("voice-picker")
    expect(picker).toHaveAttribute("data-value", "brian") // the current voice is passed in as selected
    fireEvent.click(screen.getByRole("button", { name: "pick Allison" }))
    expect(updateNodeData).toHaveBeenCalledWith("N1", { voiceId: "junk", voiceName: "\nAllison  " })
    expect(screen.queryByTestId("ai-avatar-voice-popover")).toBeNull()
    expect(selectNode).not.toHaveBeenCalled() // no detour through the settings panel
  })

  it("voice row: no voice → 'Choose a voice' opens the same picker; the play button calls the shared preview toggle", () => {
    renderBody(data({ avatarId: "cora4", script: "hi" }))
    expect(screen.getByText("Choose a voice")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Choose a voice" }))
    expect(screen.getByTestId("voice-picker")).toBeInTheDocument()
    expect(status()).toHaveTextContent("Needs a voice before it can run")
    cleanup()
    renderBody(configured())
    fireEvent.click(screen.getByRole("button", { name: "Play voice preview" }))
    expect(previewToggle).toHaveBeenCalled()
  })

  it("junk catalog rows: trims the name, hides unknown meta, disables play without a clip", () => {
    renderBody(data({ avatarId: "cora4", voiceId: "junk", script: "hi" }))
    expect(screen.getByText("Allison")).toBeInTheDocument()
    expect(screen.queryByText(/Unknown/)).toBeNull()
    expect(screen.getByRole("button", { name: "Play voice preview" })).toBeDisabled()
  })

  it("audio mode: shows the wired-audio strip instead of voice + script", () => {
    renderBody(data({ avatarId: "cora4", speechMode: "audio" }))
    expect(screen.getByTestId("ai-avatar-audio-row")).toBeInTheDocument()
    expect(screen.getByText("Nothing connected yet")).toBeInTheDocument()
    expect(screen.queryByTestId("ai-avatar-voice-row")).toBeNull()
    expect(screen.queryByLabelText("Avatar script")).toBeNull()
    expect(status()).toHaveTextContent("Needs wired audio before it can run")
    cleanup()
    storeState = {
      nodes: [{ id: "A", type: "text-to-speech", data: { label: "Narration", url: "https://cdn/n.mp3" } }],
      edges: [{ id: "e1", source: "A", target: "N1", targetHandle: "audio" }],
    }
    renderBody(data({ avatarId: "cora4", speechMode: "audio" }))
    expect(screen.getByText("From Narration")).toBeInTheDocument()
    expect(status()).toHaveTextContent("Ready to run · avatar and audio are set")
  })

  // ── After a FAILED run: same editable card, red bar with the error (the retry is the strip's Run) ──
  it("failed: the card stays editable and the status bar turns red with the error — no action buttons in the card", () => {
    render(<AiAvatarSetupBody nodeId="N1" data={configured()} failed failureMessage="Reconciliation could not recover this job. Please re-run." />)
    // still the configured card — script editable, avatar/voice on show
    expect(screen.getByTestId("ai-avatar-setup-body")).toHaveAttribute("data-view", "configured")
    expect(screen.getByLabelText("Avatar script")).toBeInTheDocument()
    const bar = status()
    expect(bar).toHaveAttribute("data-failed")
    expect(bar).not.toHaveAttribute("data-ready")
    expect(screen.getByRole("alert")).toHaveTextContent("Failed · Reconciliation could not recover this job. Please re-run.")
    expect(bar).toHaveTextContent("HeyGen Avatar IV · 720p")
    expect(screen.queryByRole("button", { name: /Run again|Retry|Show result/ })).toBeNull()
    expect(runSingleNode).not.toHaveBeenCalled()
  })

  it("failed without a message still says so", () => {
    render(<AiAvatarSetupBody nodeId="N1" data={configured()} failed />)
    expect(screen.getByRole("alert")).toHaveTextContent("Failed · run again from the strip")
  })

  it("not failed → the plain readiness bar (every action lives in the strip)", () => {
    renderBody(configured())
    expect(status()).not.toHaveAttribute("data-failed")
    expect(screen.queryByRole("button", { name: /Run again|Retry|Show result/ })).toBeNull()
  })

  it("image source, uploaded: file name as the title, Source image badge, Replace image", () => {
    renderBody(data({ avatarSource: "image", imageUrl: "https://cdn/uploads/portrait-final.png", voiceId: "brian", script: "hi" }))
    expect(screen.getByText("portrait-final.png")).toBeInTheDocument()
    expect(screen.getByText("Source image")).toBeInTheDocument()
    expect(screen.getByLabelText("Replace image")).toHaveAttribute("type", "file")
    expect(status()).toHaveTextContent("Ready to run · image, voice and script are set")
    expect(status()).toHaveTextContent("Image animation · 720p")
  })
})
