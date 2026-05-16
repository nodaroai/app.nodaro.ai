import { describe, it, expect, vi, beforeEach } from "vitest"

const mockGenerateCharacter = vi.fn()
const mockGenerateCharacterAsset = vi.fn()
const mockSaveCharacter = vi.fn()
const mockGenerateFace = vi.fn()
const mockSaveFace = vi.fn()
const mockGenerateObject = vi.fn()
const mockGenerateObjectAsset = vi.fn()
const mockSaveObject = vi.fn()
const mockGenerateLocation = vi.fn()
const mockGenerateLocationAsset = vi.fn()
const mockSaveLocation = vi.fn()
const mockGetJobStatus = vi.fn()
const mockPollJobToCompletion = vi.fn()
const mockUpdateNodeData = vi.fn()
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
      userPromptTemplates: {},
      flowPromptTemplates: {},
    }),
  },
}))

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user1" } } }) },
  }),
}))

vi.mock("@/lib/prompt-templates", () => ({
  resolveTemplate: () => "Generate {{description}} in {{style}} style",
  applyTemplate: (t: string, vars: Record<string, string>) => {
    let result = t
    for (const [k, v] of Object.entries(vars)) result = result.replace(`{{${k}}}`, v)
    return result
  },
}))

vi.mock("@/lib/api", () => ({
  generateCharacter: (...args: unknown[]) => mockGenerateCharacter(...args),
  generateCharacterAsset: (...args: unknown[]) => mockGenerateCharacterAsset(...args),
  saveCharacter: (...args: unknown[]) => mockSaveCharacter(...args),
  generateFace: (...args: unknown[]) => mockGenerateFace(...args),
  saveFace: (...args: unknown[]) => mockSaveFace(...args),
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
  generateObjectAsset: (...args: unknown[]) => mockGenerateObjectAsset(...args),
  saveObject: (...args: unknown[]) => mockSaveObject(...args),
  generateLocation: (...args: unknown[]) => mockGenerateLocation(...args),
  generateLocationAsset: (...args: unknown[]) => mockGenerateLocationAsset(...args),
  saveLocation: (...args: unknown[]) => mockSaveLocation(...args),
  getJobStatus: (...args: unknown[]) => mockGetJobStatus(...args),
}))

vi.mock("../types", () => ({
  WorkflowStaleError: class WorkflowStaleError extends Error {
    constructor() { super("Workflow changed during execution") }
  },
  MAX_CONSECUTIVE_POLL_FAILURES: 3,
  checkStorageError: () => false,
}))

vi.mock("../poll-job", () => ({
  pollJobToCompletion: (...args: unknown[]) => mockPollJobToCompletion(...args),
  setSuppressToasts: () => {},
  guardedToast: {
    info: (...args: unknown[]) => mockToastInfo(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

import {
  runCharacterGeneration,
  runFaceGeneration,
  runObjectGeneration,
  runLocationGeneration,
  handleGenerateCharacterAsset,
  handleGenerateObjectAsset,
  handleGenerateLocationAsset,
} from "../asset-executors"

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
    ...overrides,
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mockNodes = []
  mockSaveCharacter.mockResolvedValue({ id: "db1" })
  mockSaveFace.mockResolvedValue({ id: "db1" })
  mockSaveObject.mockResolvedValue({ id: "db1" })
  mockSaveLocation.mockResolvedValue({ id: "db1" })
})

// ---------------------------------------------------------------------------
// runCharacterGeneration
// ---------------------------------------------------------------------------
describe("runCharacterGeneration", () => {
  it("sets running status initially", () => {
    mockGenerateCharacter.mockReturnValue(new Promise(() => {}))
    runCharacterGeneration("n1", { characterName: "Alice", label: "Char" } as any, makeCtx())
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({ executionStatus: "running" }))
  })

  it("calls generateCharacter with correct params", () => {
    mockGenerateCharacter.mockReturnValue(new Promise(() => {}))
    runCharacterGeneration(
      "n1",
      {
        characterName: "Bob",
        description: "A wizard",
        gender: "male",
        style: "fantasy",
        baseOutfit: "robe",
        sourceImageUrl: "http://img.png",
        label: "Char",
      } as any,
      makeCtx({ userId: "u2" }),
    )
    expect(mockGenerateCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Bob",
        description: "A wizard",
        gender: "male",
        style: "fantasy",
        baseOutfit: "robe",
        sourceImageUrl: "http://img.png",
        userId: "u2",
      }),
    )
  })

  it("rejects when API fails", async () => {
    mockGenerateCharacter.mockRejectedValue(new Error("API down"))
    const promise = runCharacterGeneration("n1", { characterName: "Alice", label: "Char" } as any, makeCtx())
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("API down")
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({ executionStatus: "failed" }))
  })
})

// ---------------------------------------------------------------------------
// runFaceGeneration
// ---------------------------------------------------------------------------
describe("runFaceGeneration", () => {
  it("sets running status initially", () => {
    mockGenerateFace.mockReturnValue(new Promise(() => {}))
    runFaceGeneration("n1", { faceName: "Face1", label: "Face" } as any, makeCtx())
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({ executionStatus: "running" }))
  })

  it("calls generateFace with correct params", () => {
    mockGenerateFace.mockReturnValue(new Promise(() => {}))
    runFaceGeneration(
      "n1",
      {
        faceName: "Hero",
        description: "Scarred face",
        style: "realistic",
        sourceImageUrl: "http://face.png",
        label: "Face",
      } as any,
      makeCtx({ userId: "u3" }),
    )
    expect(mockGenerateFace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Hero",
        description: "Scarred face",
        style: "realistic",
        sourceImageUrl: "http://face.png",
        userId: "u3",
      }),
    )
  })

  it("rejects when API fails", async () => {
    mockGenerateFace.mockRejectedValue(new Error("Face API error"))
    const promise = runFaceGeneration("n1", { faceName: "Face1", label: "Face" } as any, makeCtx())
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("Face API error")
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({ executionStatus: "failed" }))
  })
})

// ---------------------------------------------------------------------------
// runObjectGeneration
// ---------------------------------------------------------------------------
describe("runObjectGeneration", () => {
  it("sets running status initially", () => {
    mockGenerateObject.mockReturnValue(new Promise(() => {}))
    runObjectGeneration("n1", { objectName: "Sword", label: "Obj" } as any, makeCtx())
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({ executionStatus: "running" }))
  })

  it("calls generateObject with correct params", () => {
    mockGenerateObject.mockReturnValue(new Promise(() => {}))
    runObjectGeneration(
      "n1",
      {
        objectName: "Shield",
        description: "Wooden shield",
        category: "weapon",
        style: "medieval",
        sourceImageUrl: "http://shield.png",
        label: "Obj",
      } as any,
      makeCtx({ userId: "u4" }),
    )
    expect(mockGenerateObject).toHaveBeenCalledWith({
      name: "Shield",
      description: "Wooden shield",
      category: "weapon",
      style: "medieval",
      sourceImageUrl: "http://shield.png",
      userId: "u4",
    })
  })

  it("rejects when API fails", async () => {
    mockGenerateObject.mockRejectedValue(new Error("Object API error"))
    const promise = runObjectGeneration("n1", { objectName: "Sword", label: "Obj" } as any, makeCtx())
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("Object API error")
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({ executionStatus: "failed" }))
  })
})

// ---------------------------------------------------------------------------
// runLocationGeneration
// ---------------------------------------------------------------------------
describe("runLocationGeneration", () => {
  it("sets running status initially", () => {
    mockGenerateLocation.mockReturnValue(new Promise(() => {}))
    runLocationGeneration("n1", { locationName: "Forest", label: "Loc" } as any, makeCtx())
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({ executionStatus: "running" }))
  })

  it("calls generateLocation with correct params", () => {
    mockGenerateLocation.mockReturnValue(new Promise(() => {}))
    runLocationGeneration(
      "n1",
      {
        locationName: "Castle",
        description: "Dark castle",
        category: "building",
        style: "gothic",
        sourceImageUrl: "http://castle.png",
        label: "Loc",
      } as any,
      makeCtx({ userId: "u5" }),
    )
    expect(mockGenerateLocation).toHaveBeenCalledWith({
      name: "Castle",
      description: "Dark castle",
      category: "building",
      style: "gothic",
      sourceImageUrl: "http://castle.png",
      userId: "u5",
    })
  })

  it("rejects when API fails", async () => {
    mockGenerateLocation.mockRejectedValue(new Error("Location API error"))
    const promise = runLocationGeneration("n1", { locationName: "Forest", label: "Loc" } as any, makeCtx())
    promise.catch(() => {})
    await expect(promise).rejects.toThrow("Location API error")
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({ executionStatus: "failed" }))
  })
})

// ---------------------------------------------------------------------------
// handleGenerateCharacterAsset
// ---------------------------------------------------------------------------
describe("handleGenerateCharacterAsset", () => {
  it("returns early when node not found", async () => {
    mockNodes = []
    await handleGenerateCharacterAsset("missing", "expressions", makeCtx())
    expect(mockGenerateCharacterAsset).not.toHaveBeenCalled()
  })

  it("shows error when no characterName", async () => {
    mockNodes = [{ id: "n1", data: { characterName: "", label: "Char" } }]
    await handleGenerateCharacterAsset("n1", "expressions", makeCtx())
    expect(mockToastError).toHaveBeenCalledWith("Set a character name first")
    expect(mockGenerateCharacterAsset).not.toHaveBeenCalled()
  })

  it("shows error when no portrait URL", async () => {
    mockNodes = [{ id: "n1", data: { characterName: "Alice", generatedResults: [], label: "Char" } }]
    await handleGenerateCharacterAsset("n1", "expressions", makeCtx())
    expect(mockToastError).toHaveBeenCalledWith("Generate or upload a main portrait first")
    expect(mockGenerateCharacterAsset).not.toHaveBeenCalled()
  })

  it("generates all expression variants", async () => {
    mockNodes = [{ id: "n1", data: { characterName: "Alice", generatedResults: [{ url: "http://portrait.png" }], activeResultIndex: 0, label: "Char" } }]
    mockGenerateCharacterAsset.mockResolvedValue({ jobId: "j1" })
    mockPollJobToCompletion.mockResolvedValue("http://result.png")

    await handleGenerateCharacterAsset("n1", "expressions", makeCtx())

    // expressions has 6 variants: neutral, smile, angry, surprised, sad, talking
    expect(mockGenerateCharacterAsset).toHaveBeenCalledTimes(6)
    expect(mockPollJobToCompletion).toHaveBeenCalledTimes(6)
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({ expressionStatus: "completed" }))
    expect(mockToastSuccess).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// handleGenerateObjectAsset
// ---------------------------------------------------------------------------
describe("handleGenerateObjectAsset", () => {
  it("returns early when node not found", async () => {
    mockNodes = []
    await handleGenerateObjectAsset("missing", "angles", makeCtx())
    expect(mockGenerateObjectAsset).not.toHaveBeenCalled()
  })

  it("shows error when no objectName", async () => {
    mockNodes = [{ id: "n1", data: { objectName: "", label: "Obj" } }]
    await handleGenerateObjectAsset("n1", "angles", makeCtx())
    expect(mockToastError).toHaveBeenCalledWith("Set an object name first")
    expect(mockGenerateObjectAsset).not.toHaveBeenCalled()
  })

  it("shows error when no main image", async () => {
    mockNodes = [{ id: "n1", data: { objectName: "Chair", generatedResults: [], label: "Obj" } }]
    await handleGenerateObjectAsset("n1", "angles", makeCtx())
    expect(mockToastError).toHaveBeenCalledWith("Generate or upload a main image first")
    expect(mockGenerateObjectAsset).not.toHaveBeenCalled()
  })

  it("generates all angle variants", async () => {
    mockNodes = [{ id: "n1", data: { objectName: "Chair", generatedResults: [{ url: "http://chair.png" }], activeResultIndex: 0, label: "Obj" } }]
    mockGenerateObjectAsset.mockResolvedValue({ jobId: "j1" })
    mockPollJobToCompletion.mockResolvedValue("http://result.png")

    await handleGenerateObjectAsset("n1", "angles", makeCtx())

    // angles has 5 variants: front, side, top, back, three-quarter
    expect(mockGenerateObjectAsset).toHaveBeenCalledTimes(5)
    expect(mockPollJobToCompletion).toHaveBeenCalledTimes(5)
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({ anglesStatus: "completed" }))
    expect(mockToastSuccess).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// handleGenerateLocationAsset
// ---------------------------------------------------------------------------
describe("handleGenerateLocationAsset", () => {
  it("returns early when node not found", async () => {
    mockNodes = []
    await handleGenerateLocationAsset("missing", "timeOfDay", makeCtx())
    expect(mockGenerateLocationAsset).not.toHaveBeenCalled()
  })

  it("shows error when no locationName", async () => {
    mockNodes = [{ id: "n1", data: { locationName: "", label: "Loc" } }]
    await handleGenerateLocationAsset("n1", "timeOfDay", makeCtx())
    expect(mockToastError).toHaveBeenCalledWith("Set a location name first")
    expect(mockGenerateLocationAsset).not.toHaveBeenCalled()
  })

  it("shows error when no main image", async () => {
    mockNodes = [{ id: "n1", data: { locationName: "Forest", generatedResults: [], label: "Loc" } }]
    await handleGenerateLocationAsset("n1", "timeOfDay", makeCtx())
    expect(mockToastError).toHaveBeenCalledWith("Generate or upload a main image first")
    expect(mockGenerateLocationAsset).not.toHaveBeenCalled()
  })

  it("generates all timeOfDay variants", async () => {
    mockNodes = [{ id: "n1", data: { locationName: "Forest", generatedResults: [{ url: "http://forest.png" }], activeResultIndex: 0, label: "Loc" } }]
    mockGenerateLocationAsset.mockResolvedValue({ jobId: "j1" })
    mockPollJobToCompletion.mockResolvedValue("http://result.png")

    await handleGenerateLocationAsset("n1", "timeOfDay", makeCtx())

    // timeOfDay has 6 variants: dawn, morning, noon, afternoon, dusk, night
    expect(mockGenerateLocationAsset).toHaveBeenCalledTimes(6)
    expect(mockPollJobToCompletion).toHaveBeenCalledTimes(6)
    expect(mockUpdateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({ timeOfDayStatus: "completed" }))
    expect(mockToastSuccess).toHaveBeenCalled()
  })
})
