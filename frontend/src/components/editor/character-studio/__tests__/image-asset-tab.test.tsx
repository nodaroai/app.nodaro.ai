import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// Keep the generate request pending so the optimistic card is observable
// before the request resolves (that's the whole point — instant feedback).
vi.mock("@/lib/api", () => ({
  generateCharacterAsset: vi.fn(() => new Promise(() => {})),
  modifyImage: vi.fn(() => new Promise(() => {})),
  llmSuggestDescription: vi.fn(),
}))
// Canvas/store helpers — not exercised here.
vi.mock("../inject-helpers", () => ({
  injectAssetAsCanvasNode: vi.fn(),
  setCharacterNodeDefaultAsset: vi.fn(),
}))
vi.mock("@/ee/hooks/use-model-credits", () => ({ useModelCredits: () => 0 }))

import { ImageAssetTab } from "../expressions-tab"
import { useCharacterStudioJobs } from "../use-character-studio-jobs"
import type { CharacterStudioState } from "../use-character-studio"

function makeState(overrides: Partial<{ expressions: { name: string; url: string }[] }> = {}): CharacterStudioState {
  return {
    nodeId: "node-1",
    staged: {
      characterName: "Hero",
      description: "a hero",
      gender: "female",
      style: "realistic",
      baseOutfit: "",
      sourceImageUrl: "https://example.com/portrait.png",
      expressions: overrides.expressions ?? [],
      poses: [],
      realLifeRefsByVariant: {},
      canonicalDescription: "",
      characterDbId: "char-1",
    },
    ensureSaved: vi.fn(async () => "char-1"),
    patch: vi.fn(),
  } as unknown as CharacterStudioState
}

function Harness({ state }: { state: CharacterStudioState }) {
  const jobs = useCharacterStudioJobs(
    () => {},
    () => {},
  )
  return (
    <ImageAssetTab
      state={state}
      jobs={jobs}
      assetType="expressions"
      arrayField="expressions"
      presets={["smile", "angry"]}
      title="Expressions"
      description="Emotion reference images"
    />
  )
}

describe("ImageAssetTab quick-preset feedback", () => {
  beforeEach(() => vi.clearAllMocks())

  it("shows an optimistic spinner card and disables the preset the instant it's clicked", async () => {
    render(<Harness state={makeState()} />)

    const smile = screen.getByRole("button", { name: "smile" })
    expect(smile).toBeEnabled()

    await userEvent.click(smile)

    // The card appears BEFORE the generate request resolves (it never does here).
    expect(screen.getByText("smile…")).toBeInTheDocument()
    // ...and the clicked preset is now disabled + flagged "creating".
    const smileAfter = screen.getByRole("button", { name: "smile" })
    expect(smileAfter).toBeDisabled()
    expect(smileAfter).toHaveAttribute("data-state", "creating")
    // The other preset stays clickable.
    expect(screen.getByRole("button", { name: "angry" })).toBeEnabled()
  })

  it("renders a preset whose asset already exists as created + disabled", () => {
    render(<Harness state={makeState({ expressions: [{ name: "smile", url: "https://example.com/s.png" }] })} />)
    const smile = screen.getByRole("button", { name: "smile" })
    expect(smile).toBeDisabled()
    expect(smile).toHaveAttribute("data-state", "created")
  })
})
