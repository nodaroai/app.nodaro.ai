import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockGenerateImage = vi.fn()
const mockEditImage = vi.fn()
const mockImageToImage = vi.fn()
const mockGenerateVideo = vi.fn()
const mockVideoToVideo = vi.fn()
const mockTextToVideo = vi.fn()
const mockTextToSpeech = vi.fn()
const mockGenerateScriptApi = vi.fn()
const mockCombineVideos = vi.fn()
const mockGetJobStatusLean = vi.fn()
// Apply writes to mockNodes so node state (e.g. currentJobId, which the
// abandon-guard reads mid-poll) reflects what the real store would hold.
const mockUpdateNodeData = vi.fn((id: string, patch: Record<string, unknown>) => {
  const node = mockNodes.find((n) => n.id === id)
  if (node) node.data = { ...node.data, ...patch }
})
const mockToastInfo = vi.fn()
const mockToastError = vi.fn()
const mockToastSuccess = vi.fn()
let mockNodes: any[] = []

vi.mock("sonner", () => ({
  toast: {
    info: (...args: unknown[]) => mockToastInfo(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: {
    getState: () => ({
      updateNodeData: mockUpdateNodeData,
      nodes: mockNodes,
    }),
  },
}))

vi.mock("@/lib/api", () => ({
  generateImage: (...args: unknown[]) => mockGenerateImage(...args),
  editImage: (...args: unknown[]) => mockEditImage(...args),
  imageToImage: (...args: unknown[]) => mockImageToImage(...args),
  generateVideo: (...args: unknown[]) => mockGenerateVideo(...args),
  videoToVideo: (...args: unknown[]) => mockVideoToVideo(...args),
  textToVideo: (...args: unknown[]) => mockTextToVideo(...args),
  textToSpeech: (...args: unknown[]) => mockTextToSpeech(...args),
  generateScriptApi: (...args: unknown[]) => mockGenerateScriptApi(...args),
  combineVideos: (...args: unknown[]) => mockCombineVideos(...args),
  getJobStatusLean: (...args: unknown[]) => mockGetJobStatusLean(...args),
}))

vi.mock("../types", () => ({
  WorkflowStaleError: class WorkflowStaleError extends Error {
    constructor() { super("Workflow changed during execution") }
  },
  MAX_CONSECUTIVE_POLL_FAILURES: 3,
  checkStorageError: () => false,
}))

import {
  runImageGeneration,
  runEditImage,
  runImageToImage,
  runVideoGeneration,
  runVideoToVideoGeneration,
  runTextToVideoGeneration,
  runTextToSpeechGeneration,
  runScriptGeneration,
  runCombineVideos,
} from "../node-executors"

function makeCtx(overrides: any = {}) {
  return {
    userId: "u1",
    projectId: "p1",
    trackInterval: (i: any) => i,
    untrackInterval: vi.fn(),
    save: vi.fn(),
    setIsRunning: vi.fn(),
    isWorkflowStale: () => false,
    isStorageError: () => false,
    setShowStorageExceeded: vi.fn(),
    setStorageExceededData: vi.fn(),
    setShowInsufficientCredits: vi.fn(),
    setInsufficientCreditsData: vi.fn(),
    ...overrides,
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mockNodes = []
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// runImageGeneration
// ---------------------------------------------------------------------------

describe("runImageGeneration", () => {
  it("sets running status initially", () => {
    mockGenerateImage.mockReturnValue(new Promise(() => {}))
    runImageGeneration("n1", "prompt", makeCtx())
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ executionStatus: "running" }),
    )
  })

  it("completes on successful job", async () => {
    vi.useFakeTimers()
    mockGenerateImage.mockResolvedValue({ jobId: "j1" })
    mockGetJobStatusLean.mockResolvedValue({
      status: "completed",
      output_data: { imageUrl: "http://img.png" },
    })
    mockNodes = [{ id: "n1", data: { generatedResults: [] } }]

    const promise = runImageGeneration("n1", "prompt", makeCtx())
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2000)
    await promise

    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        generatedImageUrl: "http://img.png",
      }),
    )
    expect(mockToastSuccess).toHaveBeenCalledWith("Image generation complete")
  })

  it("rejects when API call fails", async () => {
    mockGenerateImage.mockRejectedValue(new Error("API down"))
    const promise = runImageGeneration("n1", "prompt", makeCtx())
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("API down")
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ executionStatus: "failed" }),
    )
  })
})

// ---------------------------------------------------------------------------
// runEditImage
// ---------------------------------------------------------------------------

describe("runEditImage", () => {
  it("sets running status initially", () => {
    mockEditImage.mockReturnValue(new Promise(() => {}))
    runEditImage("n1", "http://src.png", makeCtx(), "fix sky", "recraft-upscale")
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ executionStatus: "running" }),
    )
  })

  it("completes on successful job", async () => {
    vi.useFakeTimers()
    mockEditImage.mockResolvedValue({ jobId: "j2" })
    mockGetJobStatusLean.mockResolvedValue({
      status: "completed",
      output_data: { imageUrl: "http://edited.png" },
    })
    mockNodes = [{ id: "n1", data: { generatedResults: [] } }]

    const promise = runEditImage("n1", "http://src.png", makeCtx(), "fix sky")
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2000)
    await promise

    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        generatedImageUrl: "http://edited.png",
      }),
    )
    expect(mockToastSuccess).toHaveBeenCalledWith("Image editing complete")
  })

  it("rejects when API call fails", async () => {
    mockEditImage.mockRejectedValue(new Error("API down"))
    const promise = runEditImage("n1", "http://src.png", makeCtx())
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("API down")
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ executionStatus: "failed" }),
    )
  })
})

// ---------------------------------------------------------------------------
// runImageToImage
// ---------------------------------------------------------------------------

describe("runImageToImage", () => {
  it("sets running status initially", () => {
    mockImageToImage.mockReturnValue(new Promise(() => {}))
    runImageToImage("n1", "http://src.png", "transform it", makeCtx())
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ executionStatus: "running" }),
    )
  })

  it("completes on successful job", async () => {
    vi.useFakeTimers()
    mockImageToImage.mockResolvedValue({ jobId: "j3" })
    mockGetJobStatusLean.mockResolvedValue({
      status: "completed",
      output_data: { imageUrl: "http://transformed.png" },
    })
    mockNodes = [{ id: "n1", data: { generatedResults: [] } }]

    const promise = runImageToImage("n1", "http://src.png", "transform it", makeCtx())
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2000)
    await promise

    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        generatedImageUrl: "http://transformed.png",
      }),
    )
    expect(mockToastSuccess).toHaveBeenCalledWith("Image transformation complete")
  })

  it("rejects when API call fails", async () => {
    mockImageToImage.mockRejectedValue(new Error("API down"))
    const promise = runImageToImage("n1", "http://src.png", "transform it", makeCtx())
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("API down")
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ executionStatus: "failed" }),
    )
  })
})

// ---------------------------------------------------------------------------
// runVideoGeneration
// ---------------------------------------------------------------------------

describe("runVideoGeneration", () => {
  it("sets running status initially", () => {
    mockGenerateVideo.mockReturnValue(new Promise(() => {}))
    runVideoGeneration("n1", "http://frame.png", makeCtx())
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ executionStatus: "running" }),
    )
  })

  it("completes on successful job", async () => {
    vi.useFakeTimers()
    mockGenerateVideo.mockResolvedValue({ jobId: "j4" })
    mockGetJobStatusLean.mockResolvedValue({
      status: "completed",
      output_data: { videoUrl: "http://vid.mp4" },
    })
    mockNodes = [{ id: "n1", data: { generatedResults: [] } }]

    const promise = runVideoGeneration("n1", "http://frame.png", makeCtx())
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2000)
    await promise

    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        generatedVideoUrl: "http://vid.mp4",
      }),
    )
    expect(mockToastSuccess).toHaveBeenCalledWith("Video generation complete")
  })

  it("rejects when API call fails", async () => {
    mockGenerateVideo.mockRejectedValue(new Error("API down"))
    const promise = runVideoGeneration("n1", "http://frame.png", makeCtx())
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("API down")
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ executionStatus: "failed" }),
    )
  })
})

// ---------------------------------------------------------------------------
// runVideoToVideoGeneration
// ---------------------------------------------------------------------------

describe("runVideoToVideoGeneration", () => {
  it("sets running status initially", () => {
    mockVideoToVideo.mockReturnValue(new Promise(() => {}))
    runVideoToVideoGeneration("n1", "http://source.mp4", makeCtx())
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ executionStatus: "running" }),
    )
  })

  it("completes on successful job", async () => {
    vi.useFakeTimers()
    mockVideoToVideo.mockResolvedValue({ jobId: "j5" })
    mockGetJobStatusLean.mockResolvedValue({
      status: "completed",
      output_data: { videoUrl: "http://v2v.mp4" },
    })
    mockNodes = [{ id: "n1", data: { generatedResults: [] } }]

    const promise = runVideoToVideoGeneration("n1", "http://source.mp4", makeCtx())
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2000)
    await promise

    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        generatedVideoUrl: "http://v2v.mp4",
      }),
    )
    expect(mockToastSuccess).toHaveBeenCalledWith("Video-to-video generation complete")
  })

  it("rejects when API call fails", async () => {
    mockVideoToVideo.mockRejectedValue(new Error("API down"))
    const promise = runVideoToVideoGeneration("n1", "http://source.mp4", makeCtx())
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("API down")
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ executionStatus: "failed" }),
    )
  })
})

// ---------------------------------------------------------------------------
// runTextToVideoGeneration
// ---------------------------------------------------------------------------

describe("runTextToVideoGeneration", () => {
  it("sets running status initially", () => {
    mockTextToVideo.mockReturnValue(new Promise(() => {}))
    runTextToVideoGeneration("n1", "a cat dancing", makeCtx())
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ executionStatus: "running" }),
    )
  })

  it("completes on successful job", async () => {
    vi.useFakeTimers()
    mockTextToVideo.mockResolvedValue({ jobId: "j6" })
    mockGetJobStatusLean.mockResolvedValue({
      status: "completed",
      output_data: { videoUrl: "http://t2v.mp4" },
    })
    mockNodes = [{ id: "n1", data: { generatedResults: [] } }]

    const promise = runTextToVideoGeneration("n1", "a cat dancing", makeCtx())
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2000)
    await promise

    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        generatedVideoUrl: "http://t2v.mp4",
      }),
    )
    expect(mockToastSuccess).toHaveBeenCalledWith("Text-to-video generation complete")
  })

  it("rejects when API call fails", async () => {
    mockTextToVideo.mockRejectedValue(new Error("API down"))
    const promise = runTextToVideoGeneration("n1", "a cat dancing", makeCtx())
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("API down")
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ executionStatus: "failed" }),
    )
  })
})

// ---------------------------------------------------------------------------
// runTextToSpeechGeneration
// ---------------------------------------------------------------------------

describe("runTextToSpeechGeneration", () => {
  it("sets running status initially", () => {
    mockTextToSpeech.mockReturnValue(new Promise(() => {}))
    runTextToSpeechGeneration("n1", "Hello world", makeCtx())
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ executionStatus: "running" }),
    )
  })

  it("completes on successful job", async () => {
    vi.useFakeTimers()
    mockTextToSpeech.mockResolvedValue({ jobId: "j7" })
    mockGetJobStatusLean.mockResolvedValue({
      status: "completed",
      output_data: { audioUrl: "http://audio.mp3" },
    })
    mockNodes = [{ id: "n1", data: { generatedResults: [] } }]

    const promise = runTextToSpeechGeneration("n1", "Hello world", makeCtx())
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2000)
    await promise

    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        generatedAudioUrl: "http://audio.mp3",
      }),
    )
    expect(mockToastSuccess).toHaveBeenCalledWith("Text-to-speech generation complete")
  })

  it("rejects when API call fails", async () => {
    mockTextToSpeech.mockRejectedValue(new Error("API down"))
    const promise = runTextToSpeechGeneration("n1", "Hello world", makeCtx())
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("API down")
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ executionStatus: "failed" }),
    )
  })
})

// ---------------------------------------------------------------------------
// runScriptGeneration
// ---------------------------------------------------------------------------

describe("runScriptGeneration", () => {
  it("sets running status initially", () => {
    mockGenerateScriptApi.mockReturnValue(new Promise(() => {}))
    runScriptGeneration("n1", "write a script", makeCtx())
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ executionStatus: "running" }),
    )
  })

  it("completes on successful job", async () => {
    vi.useFakeTimers()
    const script = { title: "Test", totalDuration: 30, scenes: [] }
    mockGenerateScriptApi.mockResolvedValue({ jobId: "j8" })
    mockGetJobStatusLean.mockResolvedValue({
      status: "completed",
      output_data: { script },
    })
    mockNodes = [{ id: "n1", data: { generatedResults: [] } }]

    const promise = runScriptGeneration("n1", "write a script", makeCtx())
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2000)
    await promise

    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        generatedScript: script,
      }),
    )
    expect(mockToastSuccess).toHaveBeenCalledWith("Script generated", expect.anything())
  })

  it("rejects when API call fails", async () => {
    mockGenerateScriptApi.mockRejectedValue(new Error("API down"))
    const promise = runScriptGeneration("n1", "write a script", makeCtx())
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("API down")
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ executionStatus: "failed" }),
    )
  })
})

// ---------------------------------------------------------------------------
// runCombineVideos
// ---------------------------------------------------------------------------

describe("runCombineVideos", () => {
  it("sets running status initially", () => {
    mockCombineVideos.mockReturnValue(new Promise(() => {}))
    runCombineVideos("n1", ["http://a.mp4", "http://b.mp4"], "fade", 500, "keep", makeCtx())
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ executionStatus: "running" }),
    )
  })

  it("completes on successful job", async () => {
    vi.useFakeTimers()
    mockCombineVideos.mockResolvedValue({ jobId: "j9" })
    mockGetJobStatusLean.mockResolvedValue({
      status: "completed",
      output_data: { videoUrl: "http://combined.mp4" },
    })
    mockNodes = [{ id: "n1", data: { generatedResults: [] } }]

    const promise = runCombineVideos(
      "n1", ["http://a.mp4", "http://b.mp4"], "fade", 500, "keep", makeCtx(),
    )
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(2000)
    await promise

    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({
        executionStatus: "completed",
        generatedVideoUrl: "http://combined.mp4",
      }),
    )
    expect(mockToastSuccess).toHaveBeenCalledWith("Combine videos complete")
  })

  it("rejects when API call fails", async () => {
    mockCombineVideos.mockRejectedValue(new Error("API down"))
    const promise = runCombineVideos(
      "n1", ["http://a.mp4", "http://b.mp4"], "fade", 500, "keep", makeCtx(),
    )
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("API down")
    expect(mockUpdateNodeData).toHaveBeenCalledWith(
      "n1",
      expect.objectContaining({ executionStatus: "failed" }),
    )
  })
})
