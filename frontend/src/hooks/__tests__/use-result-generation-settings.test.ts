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

describe("Apply settings — Seedance 2.5 reference task type", () => {
  // Applying a past video result reproduces that run: the task type it
  // declared comes back with the ratio and length it ran at, and a run of a
  // model that takes the field but declared none sets the node back to Auto
  // (the key removed). Anything else gets no such key at all.
  const applied = (input: Record<string, unknown>) =>
    buildAppliedConfigPatch(selectSettings({ input_data: input } as unknown as Job), { includePrompt: false })

  it("a declared Edit comes back with the ratio and length it ran at", () => {
    expect(applied({ provider: "seedance-2-5", aspectRatio: "adaptive", resolution: "720p", duration: -1, referenceTaskType: "edit" })).toStrictEqual({
      providers: undefined, provider: "seedance-2-5", aspectRatio: "adaptive", resolution: "720p", duration: -1, referenceTaskType: "edit",
    })
    expect(applied({ provider: "seedance-2-5", aspectRatio: "adaptive", duration: 8, referenceTaskType: "extend" })).toStrictEqual({
      providers: undefined, provider: "seedance-2-5", aspectRatio: "adaptive", duration: 8, referenceTaskType: "extend",
    })
  })

  it("a run of a model that takes it and declared none sets the node back to Auto (the key removed)", () => {
    for (const recorded of [undefined, "auto", "Edit"]) {
      const patch = applied({ provider: "seedance-2-5", aspectRatio: "16:9", duration: 5, referenceTaskType: recorded })
      expect(patch, String(recorded)).toStrictEqual({ providers: undefined, provider: "seedance-2-5", aspectRatio: "16:9", duration: 5, referenceTaskType: undefined })
      expect(patch).toHaveProperty("referenceTaskType")
    }
  })

  it("a result of a model that does not take it clears the node's choice (the key removed)", () => {
    // The node moves onto that model: a choice left on it would come back,
    // unseen, on a switch back to Seedance 2.5.
    expect(applied({ provider: "nano-banana-pro", aspectRatio: "1:1", referenceTaskType: "edit" })).toStrictEqual({
      providers: undefined, provider: "nano-banana-pro", aspectRatio: "1:1", referenceTaskType: undefined,
    })
    const kling = applied({ provider: "kling-3.0", aspectRatio: "16:9", duration: 5, referenceTaskType: "edit" })
    expect(kling).toStrictEqual({
      providers: undefined, provider: "kling-3.0", aspectRatio: "16:9", duration: 5, referenceTaskType: undefined,
    })
    expect(kling).toHaveProperty("referenceTaskType")
  })

  it("a result with no model recorded leaves the node's choice alone", () => {
    expect(applied({ aspectRatio: "16:9" })).not.toHaveProperty("referenceTaskType")
  })

  it("a draft result restores its choice like any other result", () => {
    // A draft declares as any other run does, so what it recorded is the
    // node's choice: a declared type comes back with the ratio and length it
    // ran at, and none sets the node back to Auto (the key removed). The
    // draft flag itself is never re-applied.
    expect(applied({ provider: "seedance-2-5", aspectRatio: "adaptive", resolution: "480p", duration: -1, draft: true, referenceTaskType: "edit" })).toStrictEqual({
      providers: undefined, provider: "seedance-2-5", aspectRatio: "adaptive", resolution: "480p", duration: -1, referenceTaskType: "edit",
    })
    expect(applied({ provider: "seedance-2-5", aspectRatio: "adaptive", resolution: "480p", duration: 8, draft: true, referenceTaskType: "extend" })).toStrictEqual({
      providers: undefined, provider: "seedance-2-5", aspectRatio: "adaptive", resolution: "480p", duration: 8, referenceTaskType: "extend",
    })
    for (const recorded of [undefined, "auto"]) {
      const patch = applied({ provider: "seedance-2-5", aspectRatio: "16:9", resolution: "480p", duration: 5, draft: true, referenceTaskType: recorded })
      expect(patch, String(recorded)).toStrictEqual({ providers: undefined, provider: "seedance-2-5", aspectRatio: "16:9", resolution: "480p", duration: 5, referenceTaskType: undefined })
      expect(patch).toHaveProperty("referenceTaskType")
    }
  })

  it("a draft result's patch is the patch of the same result without Draft, whole", () => {
    for (const recorded of [undefined, "auto", "reference", "edit", "extend"]) {
      const input = { provider: "seedance-2-5", aspectRatio: "16:9", resolution: "480p", duration: 5, referenceTaskType: recorded }
      expect(applied({ ...input, draft: true }), String(recorded)).toStrictEqual(applied(input))
    }
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
