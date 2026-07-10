import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { BoardPage } from "../pages/board-page"
import type { CharacterStudioState } from "../use-character-studio"
import type { CharacterStudioJobs } from "../use-character-studio-jobs"

vi.mock("@/ee/hooks/use-model-credits", () => ({ useModelCredits: () => 4 }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))
vi.mock("../inject-helpers", () => ({
  injectAssetAsCanvasNode: vi.fn(),
  setCharacterNodeDefaultAsset: vi.fn(),
}))
vi.mock("@/lib/api", () => ({
  imageCollageApi: vi.fn().mockResolvedValue({ jobId: "job-9" }),
  getCharacter: vi.fn(),
}))

function makeState(over: Partial<CharacterStudioState["staged"]> = {}): CharacterStudioState {
  return {
    nodeId: "n1",
    staged: {
      characterName: "Kira",
      characterDbId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
      sourceImageUrl: "https://r2/p.png",
      expressions: [{ name: "smile", url: "https://r2/s.png" }],
      boards: [
        { name: "Base", url: "https://r2/base.png", type: "identity", sourceImages: ["https://r2/p.png", "https://r2/s.png"] },
        { name: "Studio look", url: "https://r2/looks.png" },
      ],
      ...over,
    } as CharacterStudioState["staged"],
    saveStatus: "idle",
    initialPendingJobs: null,
    initialPortraitCandidates: [],
    initialPreviousCandidates: [],
    patch: vi.fn(),
    patchWith: vi.fn(),
    ensureSaved: vi.fn().mockResolvedValue("6f9619ff-8b86-4d01-b42d-00cf4fc964ff"),
  }
}

function makeJobs(): CharacterStudioJobs {
  return {
    pending: new Map(),
    failed: new Map(),
    dismissFailed: vi.fn(),
    begin: vi.fn().mockReturnValue("optimistic:0"),
    settle: vi.fn(),
    abort: vi.fn(),
    track: vi.fn(),
    trackAndWait: vi.fn(),
    cancel: vi.fn(),
    runningTypes: vi.fn().mockReturnValue(new Set()),
  } as unknown as CharacterStudioJobs
}

describe("BoardPage (managed)", () => {
  it("renders boards with an Identity badge and a New board button", () => {
    render(<BoardPage state={makeState()} jobs={makeJobs()} />)
    expect(screen.getByText("Base")).toBeInTheDocument()
    expect(screen.getByText("Identity")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /new board/i })).toBeInTheDocument()
  })

  it("shows Duplicate only on identity boards with sourceImages", () => {
    render(<BoardPage state={makeState()} jobs={makeJobs()} />)
    expect(screen.getByRole("button", { name: /duplicate board base/i })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /duplicate board studio look/i })).not.toBeInTheDocument()
  })

  it("starts a generation: begin(meta) → imageCollageApi(attach fields) → settle", async () => {
    const jobs = makeJobs()
    const state = makeState()
    const { imageCollageApi } = await import("@/lib/api")
    render(<BoardPage state={state} jobs={jobs} />)
    fireEvent.click(screen.getByRole("button", { name: /new board/i }))
    fireEvent.click(screen.getByRole("button", { name: "Portrait" }))
    fireEvent.click(screen.getByRole("button", { name: "smile" }))
    fireEvent.click(screen.getByRole("button", { name: /generate/i }))
    await vi.waitFor(() => {
      expect(jobs.begin).toHaveBeenCalledWith("boards", "Identity board", {
        sourceImages: ["https://r2/p.png", "https://r2/s.png"],
        type: "identity",
      })
      expect(imageCollageApi).toHaveBeenCalledWith(
        ["https://r2/p.png", "https://r2/s.png"],
        expect.objectContaining({
          layout: "smart",
          resolution: "4K",
          aspectRatio: "4:3",
          attachToCharacterId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
          attachToColumn: "boards",
          attachName: "Identity board",
          attachBoardType: "identity",
        }),
      )
      expect(jobs.settle).toHaveBeenCalledWith("optimistic:0", "job-9")
    })
  })

  it("deletes a column board through patchWith", () => {
    const state = makeState()
    render(<BoardPage state={state} jobs={makeJobs()} />)
    fireEvent.click(screen.getByRole("button", { name: /delete board base/i }))
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i })) // confirm dialog
    expect(state.patchWith).toHaveBeenCalled()
  })
})
