import { describe, it, expect, vi, beforeEach } from "vitest"
import { resolveSheetSections, planSheetGeneration } from "@nodaro/shared"
import type { ExecutionContext } from "../../workflow-editor/types"

// --- Module mocks -----------------------------------------------------------
const getCharacter = vi.fn()
const generateCharacterAsset = vi.fn()
vi.mock("@/lib/api", () => ({
  getCharacter: (...a: unknown[]) => getCharacter(...a),
  getObjectById: vi.fn(),
  getLocationById: vi.fn(),
  // The adapter (sheet-tab-adapter) imports these from @/lib/api:
  generateCharacterAsset: (...a: unknown[]) => generateCharacterAsset(...a),
  generateObjectAsset: vi.fn(),
  generateLocationAsset: vi.fn(),
  getJobStatusLean: vi.fn(),
}))

const pollJobToCompletion = vi.fn()
vi.mock("../../workflow-editor/poll-job", () => ({
  pollJobToCompletion: (...a: unknown[]) => pollJobToCompletion(...a),
}))

const updateNodeData = vi.fn()
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: { getState: () => ({ updateNodeData }) },
}))

import { ensureNodeSheetPanels, SHEET_STAGE_A_CANCELLED } from "../node-sheet-stage-a"

const ctx = { signal: undefined } as unknown as ExecutionContext

function charRow(overrides: Record<string, unknown> = {}) {
  return {
    name: "Hero",
    sourceImageUrl: "https://img/hero.png",
    angles: [], bodyAngles: [], expressions: [], poses: [],
    lightingVariations: [], detailCloseups: [], outfitVariations: [],
    ...overrides,
  }
}

const base = {
  entityKind: "character" as const,
  entityDbId: "char-1",
  type: "turnaround" as const,
  flavour: {
    outputFormat: "still" as const, withText: true, showLabels: true,
    aspect: "landscape" as const, background: "grey" as const,
  },
  ctx,
  nodeId: "n1",
  label: "Sheet",
}

describe("ensureNodeSheetPanels", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pollJobToCompletion.mockResolvedValue("")
    generateCharacterAsset.mockResolvedValue({ jobId: "j" })
  })

  it("no-ops (no confirm, no generation) when every planned panel already exists", async () => {
    // Discover the planned variants via the real planner, then present them all.
    const sections = resolveSheetSections("character", "turnaround")
    const planned = planSheetGeneration("character", sections, base.flavour, {}, "Hero").missing
    const angles = planned.map((m) => ({ name: m.variant, url: `u/${m.variant}` }))
    getCharacter.mockResolvedValue(charRow({ angles }))

    const confirm = vi.fn(() => true)
    await ensureNodeSheetPanels({ ...base, confirm })

    expect(confirm).not.toHaveBeenCalled()
    expect(generateCharacterAsset).not.toHaveBeenCalled()
  })

  it("declining the cost confirm throws CANCELLED and generates nothing (no charge)", async () => {
    getCharacter.mockResolvedValue(charRow()) // empty buckets → panels missing
    const confirm = vi.fn(() => false)

    await expect(ensureNodeSheetPanels({ ...base, confirm })).rejects.toThrow(SHEET_STAGE_A_CANCELLED)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(generateCharacterAsset).not.toHaveBeenCalled()
  })

  it("generates every missing panel and tolerates an individual panel failure", async () => {
    getCharacter.mockResolvedValue(charRow()) // empty buckets → all planned panels missing
    // Second panel's poll rejects; the batch must still resolve (compose proceeds).
    pollJobToCompletion
      .mockResolvedValueOnce("")
      .mockRejectedValueOnce(new Error("panel failed"))
      .mockResolvedValue("")
    let missingCount = 0
    const confirm = vi.fn((n: number) => { missingCount = n; return true })

    await expect(ensureNodeSheetPanels({ ...base, confirm })).resolves.toBeUndefined()

    expect(missingCount).toBeGreaterThan(0)
    expect(generateCharacterAsset).toHaveBeenCalledTimes(missingCount)
  })

  it("throws a main-image error when panels are missing but the entity has no source image", async () => {
    getCharacter.mockResolvedValue(charRow({ sourceImageUrl: null }))
    const confirm = vi.fn(() => true)

    await expect(ensureNodeSheetPanels({ ...base, confirm })).rejects.toThrow(/main image/i)
    expect(generateCharacterAsset).not.toHaveBeenCalled()
  })
})
