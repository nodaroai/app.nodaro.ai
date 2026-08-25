import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, act, renderHook, waitFor } from "@testing-library/react"
import { UploadModerationOverlay, useUploadModeration } from "../upload-moderation"

const updateNodeData = vi.fn()
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (sel: (s: unknown) => unknown) => sel({ updateNodeData }),
}))
vi.mock("@/lib/i18n", () => ({ useT: () => (k: string) => k }))
const moderateImage = vi.fn()
vi.mock("@/lib/api", () => ({ moderateImage: (u: string) => moderateImage(u) }))
const enabledFlag = { value: true }
vi.mock("@/lib/runtime-config", () => ({
  runtimeUploadModerationEnabled: () => enabledFlag.value,
}))

afterEach(() => { vi.clearAllMocks(); enabledFlag.value = true })

describe("UploadModerationOverlay", () => {
  it("renders nothing when disabled even if status is blocked (mainline inert)", () => {
    const { container } = render(
      <UploadModerationOverlay enabled={false} status="blocked" onRemove={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders nothing when status is undefined", () => {
    const { container } = render(
      <UploadModerationOverlay enabled status={undefined} onRemove={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it("shows the checking label", () => {
    render(<UploadModerationOverlay enabled status="checking" onRemove={() => {}} />)
    expect(screen.getByText("node.moderation.checking")).toBeInTheDocument()
  })

  it("shows the blocked title + a remove control, and the provider reason when present", () => {
    const onRemove = vi.fn()
    render(<UploadModerationOverlay enabled status="blocked" reason="nudity" onRemove={onRemove} />)
    expect(screen.getByText("node.moderation.blockedTitle")).toBeInTheDocument()
    expect(screen.getByText("nudity")).toBeInTheDocument()
    screen.getByRole("button", { name: "node.moderation.remove" }).click()
    expect(onRemove).toHaveBeenCalled()
  })

  it("falls back to the generic reason string when the provider gives none", () => {
    render(<UploadModerationOverlay enabled status="blocked" onRemove={() => {}} />)
    expect(screen.getByText("node.moderation.blockedReason")).toBeInTheDocument()
  })

  it("shows the ok badge for status ok", () => {
    render(<UploadModerationOverlay enabled status="ok" onRemove={() => {}} />)
    expect(screen.getByText("node.moderation.ready")).toBeInTheDocument()
  })
})

describe("useUploadModeration", () => {
  it("moderate() is a no-op when disabled — no call, no state write", () => {
    enabledFlag.value = false
    const { result } = renderHook(() => useUploadModeration("n1", false, undefined))
    act(() => result.current.moderate("https://x/a.png"))
    expect(moderateImage).not.toHaveBeenCalled()
    expect(updateNodeData).not.toHaveBeenCalled()
  })

  it("moderate() writes checking then ok on an allowed verdict", async () => {
    moderateImage.mockResolvedValue({ ok: true })
    const { result } = renderHook(() => useUploadModeration("n1", true, undefined))
    await act(async () => { result.current.moderate("https://x/a.png") })
    expect(updateNodeData).toHaveBeenCalledWith("n1", { moderationStatus: "checking", moderationReason: undefined })
    await waitFor(() =>
      expect(updateNodeData).toHaveBeenCalledWith("n1", { moderationStatus: "ok", moderationReason: undefined }),
    )
  })

  it("moderate() writes blocked + reason on a rejected verdict", async () => {
    moderateImage.mockResolvedValue({ ok: false, reason: "policy" })
    const { result } = renderHook(() => useUploadModeration("n1", true, undefined))
    await act(async () => { result.current.moderate("https://x/a.png") })
    await waitFor(() =>
      expect(updateNodeData).toHaveBeenCalledWith("n1", { moderationStatus: "blocked", moderationReason: "policy" }),
    )
  })

  it("fail-open: a thrown call clears status rather than blocking", async () => {
    moderateImage.mockRejectedValue(new Error("network"))
    const { result } = renderHook(() => useUploadModeration("n1", true, undefined))
    await act(async () => { result.current.moderate("https://x/a.png") })
    await waitFor(() =>
      expect(updateNodeData).toHaveBeenCalledWith("n1", { moderationStatus: undefined, moderationReason: undefined }),
    )
  })

  it("self-heals a stale checking on mount (clears it)", () => {
    renderHook(() => useUploadModeration("n1", true, "checking"))
    expect(updateNodeData).toHaveBeenCalledWith("n1", { moderationStatus: undefined, moderationReason: undefined })
  })

  it("does NOT touch a stale checking when disabled", () => {
    renderHook(() => useUploadModeration("n1", false, "checking"))
    expect(updateNodeData).not.toHaveBeenCalled()
  })
})
