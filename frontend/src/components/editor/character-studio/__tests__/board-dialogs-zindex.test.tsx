import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { BoardCreateModal } from "../board-create-modal"
import { BoardPage } from "../pages/board-page"
import { STUDIO_CHILD_DIALOG_Z, STUDIO_MODAL_Z_VALUE } from "../../studio-shell/studio-modal-z"
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

// Same bug class as the "voice dropdown does nothing" report (see
// voice-browser-zindex.test.ts): dialogs portal to <body> at the stock z-50,
// the studio modal hosting the Board page is opaque at STUDIO_MODAL_Z_VALUE —
// so an un-lifted dialog opens BEHIND the studio and "+ New board" looks dead.
// jsdom has no stacking contexts, which is why the interaction tests passed
// while the real browser buried the dialog; these assertions guard the class
// wiring itself.

const parseZ = (cls: string): number => {
  const m = cls.match(/z-\[(\d+)\]/)
  if (!m) throw new Error(`expected a z-[N] arbitrary value, got "${cls}"`)
  return Number(m[1])
}

function makeState(): CharacterStudioState {
  return {
    nodeId: "n1",
    staged: {
      characterName: "Kira",
      characterDbId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
      boards: [{ name: "Base", url: "https://r2/base.png", type: "identity", sourceImages: ["https://r2/p.png"] }],
    } as unknown as CharacterStudioState["staged"],
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

describe("board dialogs clear the studio modal tier", () => {
  it("STUDIO_CHILD_DIALOG_Z is above every studio modal (STUDIO_MODAL_Z)", () => {
    expect(parseZ(STUDIO_CHILD_DIALOG_Z)).toBeGreaterThan(STUDIO_MODAL_Z_VALUE)
  })

  it("BoardCreateModal content + overlay carry the lifted z class", () => {
    render(
      <BoardCreateModal
        open
        onClose={vi.fn()}
        groups={[]}
        boards={[]}
        generatingNames={[]}
        initial={null}
        onGenerate={vi.fn()}
      />,
    )
    const content = document.querySelector('[data-slot="dialog-content"]')
    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(content?.className ?? "").toContain(STUDIO_CHILD_DIALOG_Z)
    expect(overlay?.className ?? "").toContain(STUDIO_CHILD_DIALOG_Z)
  })

  it("Board page delete confirmation carries the lifted z class", () => {
    render(<BoardPage state={makeState()} jobs={makeJobs()} />)
    fireEvent.click(screen.getByRole("button", { name: /delete board base/i }))
    const content = document.querySelector('[data-slot="alert-dialog-content"]')
    const overlay = document.querySelector('[data-slot="alert-dialog-overlay"]')
    expect(content?.className ?? "").toContain(STUDIO_CHILD_DIALOG_Z)
    expect(overlay?.className ?? "").toContain(STUDIO_CHILD_DIALOG_Z)
  })
})
