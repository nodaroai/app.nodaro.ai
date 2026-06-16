import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement, type ReactNode } from "react"
import {
  buildAppliedConfigPatch,
  selectSettings,
  useResultGenerationSettings,
  type ResultGenerationSettings,
} from "@/hooks/use-result-generation-settings"
import type { Job } from "@/lib/api"

const mockGetJobStatus = vi.fn()
vi.mock("@/lib/api", () => ({
  getJobStatus: (...args: unknown[]) => mockGetJobStatus(...args),
}))

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return createElement(QueryClientProvider, { client: qc }, children)
}

const FULL: ResultGenerationSettings = {
  provider: "nano-banana-pro",
  aspectRatio: "16:9",
  resolution: "2K",
  quality: "high",
  seed: 12345,
  renderingSpeed: "TURBO",
  styleType: "GENERAL",
  expandPrompt: true,
  prompt: "a red fox in snow",
  negativePrompt: "blurry, low quality",
}

describe("buildAppliedConfigPatch", () => {
  it("config-only: restores generation params, clears providers, omits prompt/negative", () => {
    const patch = buildAppliedConfigPatch(FULL, { includePrompt: false })
    expect(patch).toEqual({
      providers: undefined,
      provider: "nano-banana-pro",
      aspectRatio: "16:9",
      resolution: "2K",
      quality: "high",
      seed: 12345,
      renderingSpeed: "TURBO",
      styleType: "GENERAL",
      expandPrompt: true,
    })
    expect("prompt" in patch).toBe(false)
    expect("negativePrompt" in patch).toBe(false)
  })

  it("config + prompt: also restores prompt and negative prompt", () => {
    const patch = buildAppliedConfigPatch(FULL, { includePrompt: true })
    expect(patch.prompt).toBe("a red fox in snow")
    expect(patch.negativePrompt).toBe("blurry, low quality")
    expect(patch.provider).toBe("nano-banana-pro")
  })

  it("always clears providers so a stale multi-provider cohort can't win", () => {
    const patch = buildAppliedConfigPatch(FULL, { includePrompt: false })
    expect("providers" in patch).toBe(true)
    expect(patch.providers).toBeUndefined()
  })

  it("omits fields the job didn't record (e.g. provider without a resolution lever)", () => {
    const minimal: ResultGenerationSettings = { provider: "flux", aspectRatio: "1:1" }
    const patch = buildAppliedConfigPatch(minimal, { includePrompt: false })
    expect(patch).toEqual({ providers: undefined, provider: "flux", aspectRatio: "1:1" })
    expect("resolution" in patch).toBe(false)
    expect("quality" in patch).toBe(false)
  })

  it("config + prompt with no recorded prompt → clears to empty strings", () => {
    const noPrompt: ResultGenerationSettings = { provider: "flux" }
    const patch = buildAppliedConfigPatch(noPrompt, { includePrompt: true })
    expect(patch.prompt).toBe("")
    expect(patch.negativePrompt).toBe("")
  })

  // --- Video-specific fields (additive; image jobs simply don't record them) ---

  it("video: restores duration / videoSize / generateAudio when present", () => {
    const v: ResultGenerationSettings = {
      provider: "kling-3.0",
      aspectRatio: "16:9",
      resolution: "1080p",
      duration: 5,
      videoSize: "high",
      generateAudio: true,
    }
    const patch = buildAppliedConfigPatch(v, { includePrompt: false })
    expect(patch.duration).toBe(5)
    expect(patch.videoSize).toBe("high")
    expect(patch.generateAudio).toBe(true)
  })

  it("video: restores generateAudio === false (a meaningful value, not 'absent')", () => {
    const v: ResultGenerationSettings = { provider: "veo3", generateAudio: false }
    const patch = buildAppliedConfigPatch(v, { includePrompt: false })
    expect("generateAudio" in patch).toBe(true)
    expect(patch.generateAudio).toBe(false)
  })

  it("video: omits duration / videoSize / generateAudio the job didn't record", () => {
    const v: ResultGenerationSettings = { provider: "kling", aspectRatio: "16:9" }
    const patch = buildAppliedConfigPatch(v, { includePrompt: false })
    expect("duration" in patch).toBe(false)
    expect("videoSize" in patch).toBe(false)
    expect("generateAudio" in patch).toBe(false)
  })
})

describe("selectSettings — video fields", () => {
  function jobWith(input: Record<string, unknown>): Job {
    return { input_data: input } as unknown as Job
  }

  it("extracts duration (number), videoSize (string), generateAudio (boolean)", () => {
    const s = selectSettings(
      jobWith({
        provider: "kling-3.0",
        aspectRatio: "16:9",
        resolution: "1080p",
        duration: 5,
        videoSize: "high",
        generateAudio: true,
      }),
    )
    expect(s.duration).toBe(5)
    expect(s.videoSize).toBe("high")
    expect(s.generateAudio).toBe(true)
  })

  it("preserves generateAudio === false (not coerced away)", () => {
    const s = selectSettings(jobWith({ provider: "veo3", generateAudio: false }))
    expect(s.generateAudio).toBe(false)
  })

  it("omits duration when it isn't a number", () => {
    const s = selectSettings(jobWith({ provider: "kling", duration: "5" }))
    expect(s.duration).toBeUndefined()
  })
})

describe("useResultGenerationSettings — backend-id guard", () => {
  beforeEach(() => vi.clearAllMocks())

  // A Filerobot-edited / locally-created result carries a synthetic id like
  // `image-edit-<ts>` that is NOT a backend job. Fetching it 404-spams the
  // console (the reported bug). The hook must stay disabled for non-UUID ids.
  it("does NOT fetch for a synthetic (non-UUID) job id", async () => {
    renderHook(() => useResultGenerationSettings("image-edit-1781549390289"), { wrapper })
    await new Promise((r) => setTimeout(r, 0))
    expect(mockGetJobStatus).not.toHaveBeenCalled()
  })

  it("does NOT fetch when the job id is undefined", async () => {
    renderHook(() => useResultGenerationSettings(undefined), { wrapper })
    await new Promise((r) => setTimeout(r, 0))
    expect(mockGetJobStatus).not.toHaveBeenCalled()
  })

  it("DOES fetch for a real UUID job id", async () => {
    mockGetJobStatus.mockResolvedValue({ input_data: {} } as Job)
    renderHook(() => useResultGenerationSettings("f96a99d2-bc45-4bc5-8196-cd7927ff845b"), { wrapper })
    await waitFor(() =>
      expect(mockGetJobStatus).toHaveBeenCalledWith("f96a99d2-bc45-4bc5-8196-cd7927ff845b"),
    )
  })
})
