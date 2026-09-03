// The YouTube/social node card was one of the last raw-English node surfaces:
// its URL placeholder, download button, "Not downloaded" / "Audio ready"
// badges and the ✕ tooltip were all hardcoded. These lock them to the dict and
// to a LIVE language switch (the node is memo()-wrapped, so a t() call that
// isn't a hook subscription would freeze on the boot locale).
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
  Handle: ({ type, id }: any) => <div data-testid={`handle-${type}-${id}`} />,
  NodeResizer: () => null,
  useStore: vi.fn(() => 1),
  useNodeId: vi.fn(() => "test-node"),
  useUpdateNodeInternals: vi.fn(() => () => {}),
  useConnection: vi.fn(() => ({ inProgress: false, fromHandle: null, fromNode: null })),
}))

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <>{children}</>,
  PopoverAnchor: ({ children }: any) => <>{children}</>,
  PopoverContent: () => null,
  PopoverTrigger: ({ children }: any) => <>{children}</>,
}))

vi.mock("@/hooks/use-handle-connections", () => ({ useHandleConnections: () => [] }))

vi.mock("../base-node", () => ({
  BaseNode: ({ children }: any) => <div data-testid="base-node">{children}</div>,
}))

vi.mock("lucide-react", () => new Proxy({}, {
  get: (_t, prop) => (typeof prop === "string" && prop !== "then" ? () => null : undefined),
  has: () => true,
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: any) => selector({ updateNodeData: () => {} }),
}))

vi.mock("@/components/ui/cached-image", () => ({
  CachedImage: (props: any) => <img data-testid="cached-image" src={props.src} alt={props.alt} />,
}))

vi.mock("@/lib/api", () => ({
  fetchYouTubeOEmbed: vi.fn(),
  startVideoDownload: vi.fn(),
  subscribeToDownloadProgress: vi.fn(),
  downloadYouTubeAudio: vi.fn(),
}))

vi.mock("react-dom", async () => {
  const actual = await vi.importActual("react-dom")
  return { ...actual, createPortal: (node: any) => node }
})

import { YouTubeVideoNode } from "../youtube-video-node"
import { useLocaleStore } from "@/lib/locale-store"
import { translate } from "@/lib/i18n"

function renderNode(data: Record<string, unknown> = {}) {
  return render(
    <YouTubeVideoNode
      {...({ id: "node-1", data: { label: "YouTube Video", youtubeUrl: "", videoId: "", ...data }, selected: false } as any)}
    />,
  )
}

/** A non-YouTube (TikTok) link that has resolved but not been downloaded yet —
 *  the state that renders "Not downloaded" + the Download button + ✕. */
const NEEDS_DOWNLOAD = {
  youtubeUrl: "https://www.tiktok.com/@someone/video/123",
  videoId: "123",
  title: "clip",
}

describe("YouTubeVideoNode copy comes from the dict", () => {
  afterEach(() => {
    cleanup()
    act(() => useLocaleStore.getState().setLocale("en"))
  })

  it("takes the URL placeholder from the dict and follows a language switch", () => {
    renderNode()
    expect(
      screen.getByPlaceholderText(translate("en", "inputcfg.youtubeFacebookTiktokInstagramOrX")),
    ).toBeInTheDocument()

    act(() => useLocaleStore.getState().setLocale("he"))
    expect(
      screen.getByPlaceholderText(translate("he", "inputcfg.youtubeFacebookTiktokInstagramOrX")),
    ).toBeInTheDocument()
    expect(
      screen.queryByPlaceholderText(translate("en", "inputcfg.youtubeFacebookTiktokInstagramOrX")),
    ).not.toBeInTheDocument()
  })

  it("localizes the not-downloaded state (badge, button, ✕ tooltip)", () => {
    renderNode(NEEDS_DOWNLOAD)
    expect(screen.getByText(translate("en", "node.notDownloaded"))).toBeInTheDocument()
    expect(screen.getByText(translate("en", "inputcfg.downloadVideo"))).toBeInTheDocument()
    expect(screen.getByTitle(translate("en", "imgcfg.remove"))).toBeInTheDocument()

    act(() => useLocaleStore.getState().setLocale("he"))
    expect(screen.getByText(translate("he", "inputcfg.downloadVideo"))).toBeInTheDocument()
    expect(screen.getByTitle(translate("he", "imgcfg.remove"))).toBeInTheDocument()
    expect(screen.queryByTitle(translate("en", "imgcfg.remove"))).not.toBeInTheDocument()
  })

  it("localizes the audio-download status line", () => {
    renderNode({ ...NEEDS_DOWNLOAD, audioDownloadStatus: "completed" })
    expect(screen.getByText(translate("en", "inputcfg.audioReady"))).toBeInTheDocument()

    act(() => useLocaleStore.getState().setLocale("he"))
    expect(screen.getByText(translate("he", "inputcfg.audioReady"))).toBeInTheDocument()
    expect(screen.queryByText(translate("en", "inputcfg.audioReady"))).not.toBeInTheDocument()
  })
})
